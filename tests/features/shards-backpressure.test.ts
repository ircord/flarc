import { expect, it } from "vitest";
import { createMatrixFixture, json, operation, wire } from "./helpers/session-features";
import {
  deniedAnonymousUpgrade,
  deniedUpgrade,
  eventually,
  liveRows,
  relayFixture,
  shardStream,
} from "./helpers/shards-backpressure";

type Stream = Awaited<ReturnType<typeof shardStream>>;

it("distinct event SessionDO stores relay immutable private conversations and channel events with current revocation, replay and hibernation guards", async () => {
  const f = await createMatrixFixture(),
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await wire(a, "JOIN #shared", / 366 .* #shared /);
    await wire(b, "JOIN #shared", / 366 .* #shared /);
    const first = await shardStream(f, bob),
      second = await shardStream(f, bob, { avoidShard: first.shard, legacy: true }),
      outside = await shardStream(f, charlie);
    streams.push(first, second, outside);
    const leasesBefore = (await liveRows(f, "event_connection_leases"))
      .flat()
      .map((row) => row.lease_id)
      .sort();
    await deniedAnonymousUpgrade(f, "/api/events", 401);
    await deniedAnonymousUpgrade(f, `/api/events?ticket=${"0".repeat(64)}`, 401);
    await deniedAnonymousUpgrade(f, `/api/events?ticket=${second.ticket}`, 401);
    expect(
      (await liveRows(f, "event_connection_leases"))
        .flat()
        .map((row) => row.lease_id)
        .sort(),
    ).toEqual(leasesBefore);
    const topology = (await liveRows(f, "session_topology")).flat() as Array<{
      key: string;
      value: string;
    }>;
    const ids = topology.filter((row) => row.key === "durable-object-id").map((row) => row.value);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(2);
    expect(
      new Set(topology.filter((row) => row.key === "event-shard").map((row) => row.value)),
    ).toContain(String(first.shard));
    expect(
      new Set(topology.filter((row) => row.key === "event-shard").map((row) => row.value)),
    ).toContain(String(second.shard));
    const namespace = await f.server.mf.getDurableObjectNamespace("SESSION");
    for (const shard of [first.shard, second.shard])
      expect(ids).toContain(namespace.idFromName(`FlaRC:events:${shard}`).toString());
    const leases = (await liveRows(f, "event_connection_leases")).flat() as Array<any>;
    expect(
      leases
        .filter((row) => row.account_id === bob.account.id)
        .map((row) => row.shard)
        .sort(),
    ).toEqual([first.shard, second.shard].sort());
    expect((await liveRows(f, "conversations")).filter((rows) => rows.length)).toHaveLength(0);
    await deniedUpgrade(f, bob, "shard=999&accountId=alice", 400);

    const conversation = (
      await json(f, "/api/v1/conversations", alice, "POST", {
        peer: bob.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    const base = `/api/v1/conversations/${conversation.id}`;
    const boot = (await first.command({ type: "bootstrap" })).result;
    const send = {
      content: "only stable participants across shards",
      clientOperationId: operation(),
    };
    const message = (await json(f, `${base}/messages`, alice, "POST", send)).message;
    for (const stream of [first, second]) await stream.until((e) => e.messageId === message.id);
    expect(outside.frames.some((e) => e.messageId === message.id)).toBe(false);
    await json(f, base, charlie, "GET", undefined, 403);
    expect((await liveRows(f, "conversations")).filter((rows) => rows.length)).toHaveLength(1);
    expect(
      (await liveRows(f, "direct_messages")).flat().filter((row: any) => row.id === message.id),
    ).toHaveLength(1);
    const replay = (await second.command({ type: "replay", cursor: boot.cursor })).result;
    expect(replay.events.filter((e: any) => e.messageId === message.id)).toHaveLength(1);
    expect((await outside.command({ type: "replay", cursor: boot.cursor })).status).toBe(403);
    const channelMessage = (
      await json(
        f,
        "/api/v1/channels/%23shared/messages",
        alice,
        "POST",
        {
          content: "cross-shard current channel",
        },
        201,
      )
    ).message;
    for (const stream of [first, second])
      await stream.until((e) => e.messageId === channelMessage.id);

    await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
      name: `FlaRC:events:${second.shard}`,
      webSockets: "hibernate",
    });
    const after = (
      await json(f, `${base}/messages`, alice, "POST", {
        content: "after distinct shard wake",
        clientOperationId: operation(),
      })
    ).message;
    await second.until((e) => e.messageId === after.id);
    await wire(a, "MODE #shared +s", / MODE #shared \+s/);
    await wire(b, "PART #shared", / PART #shared/);
    const revoked = (
      await json(
        f,
        "/api/v1/channels/%23shared/messages",
        alice,
        "POST",
        {
          content: "never after channel revocation",
        },
        201,
      )
    ).message;
    const independent = (
      await json(f, `${base}/messages`, alice, "POST", {
        content: "private channel revocation preserves DM",
        clientOperationId: operation(),
      })
    ).message;
    for (const stream of [first, second]) {
      await stream.until((e) => e.messageId === independent.id);
      expect(stream.frames.some((e) => e.messageId === revoked.id)).toBe(false);
      const history = (await stream.command({ type: "replay", cursor: boot.cursor })).result;
      expect(history.events.some((e: any) => e.messageId === revoked.id)).toBe(false);
    }
    const loggedOut = new Promise<void>((resolve) => second.ws.once("close", () => resolve()));
    await json(f, "/api/v1/auth/logout", bob, "POST");
    await Promise.race([
      loggedOut,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Idle remote shard was not revoked")), 7000),
      ),
    ]);
    expect(second.closeCode).toBe(1008);
    await f.barrier(c);
    await f.barrier(a);
    await f.stop();
    expect(
      (await f.snapshot("direct_messages"))
        .flat()
        .map((row: any) => row.id)
        .sort(),
    ).toEqual([message.id, after.id, independent.id].sort());
  } finally {
    for (const stream of streams) stream.close();
    await f.dispose();
  }
}, 45000);

it("central event admission caps five real devices across shards and reconnects release only their own lease", async () => {
  const f = await createMatrixFixture(),
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    for (let i = 0; i < 5; i++) streams.push(await shardStream(f, alice));
    await deniedUpgrade(f, alice, "", 429);
    const unaffected = await shardStream(f, bob);
    streams.push(unaffected);
    expect((await unaffected.command({ type: "bootstrap" })).type).toBe("result");
    const removed = streams.shift()!;
    removed.ws.close(1000, "device released");
    await eventually(
      async () =>
        ((await liveRows(f, "event_connection_leases")).flat() as any[]).filter(
          (r) => r.account_id === alice.account.id,
        ).length === 4,
    );
    const replacement = await shardStream(f, alice);
    streams.push(replacement);
    expect((await replacement.command({ type: "bootstrap" })).type).toBe("result");
    await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
      name: "FlaRC",
      webSockets: "hibernate",
    });
    await deniedUpgrade(f, alice, "", 429);
    expect(
      ((await liveRows(f, "event_connection_leases")).flat() as any[]).filter(
        (r) => r.account_id === alice.account.id,
      ),
    ).toHaveLength(5);
  } finally {
    for (const stream of streams) stream.close();
    await f.dispose();
  }
}, 30000);

it("public event relay rejects oversized UTF8 and binary frames and input bursts before forwarding while independent readers stay live", async () => {
  const gated = await relayFixture(),
    f = gated.fixture,
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      healthy = await shardStream(f, bob);
    streams.push(healthy);
    const leaseOf = async (stream: Stream) => {
      const leases = (await liveRows(f, "event_connection_leases"))
        .flat()
        .filter((row: any) => row.account_id === alice.account.id && row.shard === stream.shard);
      expect(leases).toHaveLength(1);
      return leases[0].lease_id as string;
    };
    // Both are real authenticated public sockets. Unicode length is below 64K
    // code units but above the UTF8-byte bound; binary has its own byte bound.
    for (const payload of [
      JSON.stringify({ type: "bootstrap", requestId: "é".repeat(32768) }),
      Buffer.alloc(65537, 120),
    ]) {
      const oversized = await shardStream(f, alice, {
        ack: false,
        avoidShard: healthy.shard,
        legacy: typeof payload === "string",
      });
      streams.push(oversized);
      const lease = await leaseOf(oversized);
      oversized.ws.send(payload);
      // Already queued later frames must stop at the same closed public hop.
      for (let i = 0; i < 8; i++)
        oversized.ws.send(JSON.stringify({ type: "bootstrap", requestId: `after-size-${i}` }));
      await eventually(() => oversized.closeCode !== undefined);
      expect(oversized.closeCode).toBe(1008);
      expect(oversized.closeReason).toContain("frame too large");
      expect((await gated.shardState(oversized.shard)).inputs[lease]).toBeUndefined();
      await eventually(async () =>
        (await liveRows(f, "event_connection_leases"))
          .flat()
          .every((row: any) => row.lease_id !== lease),
      );
    }
    const burst = await shardStream(f, alice, { ack: false, avoidShard: healthy.shard });
    streams.push(burst);
    const lease = await leaseOf(burst),
      started = Date.now();
    const cursor = (await burst.command({ type: "bootstrap" })).result.cursor;
    // Reuse one valid cursor with empty subscriptions, avoiding unrelated
    // bootstrap/cursor rotation limits. Fence batches below the separate
    // 16-command edge queue limit to isolate the public 150-frame/10s boundary.
    for (let first = 1; first < 150; first += 6) {
      const end = Math.min(first + 6, 150);
      for (let i = first; i < end; i++)
        burst.ws.send(
          JSON.stringify({ type: "subscribe", resources: {}, cursor, requestId: `burst-${i}` }),
        );
      await burst.until((event) => event.requestId === `burst-${end - 1}`);
    }
    expect(Date.now() - started).toBeLessThan(10000);
    expect(burst.closeCode).toBeUndefined();
    expect((await gated.shardState(burst.shard)).inputs[lease].frames).toBe(150);
    for (let i = 150; i < 170; i++)
      burst.ws.send(JSON.stringify({ type: "bootstrap", requestId: `burst-${i}` }));
    await eventually(() => burst.closeCode !== undefined);
    expect(burst.closeCode).toBe(1008);
    expect(burst.closeReason).toContain("rate exceeded");
    expect((await gated.shardState(burst.shard)).inputs[lease].frames).toBe(150);
    expect((await healthy.command({ type: "bootstrap" })).type).toBe("result");
    expect((await liveRows(f, "direct_messages")).flat()).toEqual([]);
  } finally {
    for (const stream of streams) stream.close();
    await gated.dispose();
  }
}, 30000);

it("native paused event reader reaches a bounded charged-output close while acknowledged independent devices preserve ordered messages", async () => {
  const gated = await relayFixture(),
    f = gated.fixture,
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const slow = await shardStream(f, bob, { ack: false, legacy: true }),
      healthy = await shardStream(f, bob, { avoidShard: slow.shard }),
      outside = await shardStream(f, charlie);
    streams.push(slow, healthy, outside);
    const conversation = (
      await json(f, "/api/v1/conversations", alice, "POST", {
        peer: bob.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    const route = `/api/v1/conversations/${conversation.id}/messages`;
    slow.pause();
    const ids: string[] = [];
    for (let i = 0; i < 72; i++)
      ids.push(
        (
          await json(f, route, alice, "POST", {
            content: `bounded-${i}:${"x".repeat(7800)}`,
            clientOperationId: operation(),
          })
        ).message.id,
      );
    await healthy.until((e) => e.messageId === ids.at(-1), 18000);
    expect(
      healthy.frames
        .filter((e) => e.type === "conversation.message_created")
        .map((e) => e.messageId),
    ).toEqual(ids);
    expect(healthy.challenges.length).toBeGreaterThan(0);
    expect(outside.frames.some((e) => ids.includes(e.messageId))).toBe(false);
    // Resume the genuine native TCP reader to observe the queued protocol Close;
    // no terminate/sleep substitutes for the asserted server-side close outcome.
    slow.resume();
    await eventually(() => slow.closeCode !== undefined, 7000).catch(async () => {
      throw new Error(
        JSON.stringify({ client: slow.diagnostic(), server: await gated.shardState(slow.shard) }),
      );
    });
    expect(slow.closeCode).toBe(1008);
    expect(slow.diagnostic().transport).toMatchObject({
      frameSent: true,
      frameReceived: true,
      readableEnded: true,
      writableEnded: true,
      destroyed: true,
    });
    const delivered = slow.frames.filter((e) => e.type === "conversation.message_created");
    expect(delivered.length).toBeLessThan(ids.length);
    const payloadBytes = delivered.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0);
    expect(payloadBytes).toBeLessThanOrEqual(262144);
    expect(slow.challenges).toHaveLength(1);
    expect((await healthy.command({ type: "bootstrap" })).type).toBe("result");
    expect((await liveRows(f, "direct_messages")).flat()).toHaveLength(ids.length);
    await f.stop();
    expect(
      (await f.snapshot("direct_messages"))
        .flat()
        .map((row: any) => row.id)
        .sort(),
    ).toEqual([...ids].sort());
  } finally {
    for (const stream of streams) {
      stream.resume();
      stream.close();
    }
    await gated.dispose();
  }
}, 40000);

it("foreign, guessed and stale reader ACKs give no credit while v1 receives an explicit bounded resync", async () => {
  const f = await createMatrixFixture(),
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const first = await shardStream(f, alice, { ack: false }),
      second = await shardStream(f, alice, { ack: false }),
      stale = await shardStream(f, alice),
      legacy = await shardStream(f, bob, { v1: true });
    streams.push(first, second, stale, legacy);
    // Real successful read commands generate the charged boundary, with no mutation flood.
    for (let i = 0; i < 34; i++) {
      if (first.ws.readyState === 1) await first.command({ type: "bootstrap" });
      if (second.ws.readyState === 1) await second.command({ type: "bootstrap" });
      await stale.command({ type: "bootstrap" });
      if (legacy.ws.readyState === 1) await legacy.command({ type: "bootstrap" }).catch(() => null);
    }
    await first.until((e) => e.type === "reader.challenge");
    await second.until((e) => e.type === "reader.challenge");
    expect(first.challenges[0]).not.toBe(second.challenges[0]);
    await stale.until((e) => e.type === "reader.challenge");
    // Its automatic ACK already advanced credit; replaying that same proof is invalid.
    await stale.command({ type: "bootstrap" });
    stale.ws.send(JSON.stringify({ type: "reader.ack", token: stale.challenges[0] }));
    first.ws.send(JSON.stringify({ type: "reader.ack", token: second.challenges[0] }));
    second.ws.send(JSON.stringify({ type: "reader.ack", token: "0".repeat(32) }));
    await eventually(
      () =>
        first.closeCode !== undefined &&
        second.closeCode !== undefined &&
        legacy.closeCode !== undefined &&
        stale.closeCode !== undefined,
    );
    expect(stale.closeCode).toBe(1008);
    expect(first.closeCode).toBe(1008);
    expect(second.closeCode).toBe(1008);
    expect(legacy.frames).toContainEqual(
      expect.objectContaining({
        type: "resync.required",
        code: "READER_ACK_REQUIRED",
        protocol: 2,
      }),
    );
    expect(legacy.closeCode).toBe(1008);
    expect((await liveRows(f, "direct_messages")).flat()).toEqual([]);
    const healthy = await shardStream(f, bob);
    streams.push(healthy);
    expect((await healthy.command({ type: "bootstrap" })).type).toBe("result");
  } finally {
    for (const stream of streams) stream.close();
    await f.dispose();
  }
}, 30000);

it("IRC unpredictable PING boundaries prove reader drain without changing ordinary PONG and isolate a native paused reader", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const sender = await f.connect(alice),
      slow = await f.connect(bob),
      healthy = await f.connect(charlie);
    const challenges: string[] = [];
    const observeChallenge = (data: import("ws").RawData) => {
      const match = data.toString().match(/^PING :(flarc-reader:[0-9a-f]{32})/);
      if (match) {
        challenges.push(match[1]);
      }
    };
    healthy.ws.on("message", observeChallenge);
    await wire(healthy, "CAP REQ :message-tags", / CAP .* ACK /);
    await wire(slow, "CAP REQ :message-tags", / CAP .* ACK /);
    // An ordinary unsolicited PONG is harmless and cannot acknowledge the feature window.
    healthy.send("PONG :ordinary-client-token");
    await f.barrier(healthy);
    await wire(sender, "JOIN #reader", / 366 .* #reader /);
    await wire(slow, "JOIN #reader", / 366 .* #reader /);
    await wire(healthy, "JOIN #reader", / 366 .* #reader /);
    (slow.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    const slowClosed = new Promise<number>((resolve) =>
      slow.ws.once("close", (code) => resolve(code)),
    );
    for (let i = 0; i < 90; i++) {
      sender.send(`@+reader-pad=${"z".repeat(3800)} PRIVMSG #reader :wire-${i}:bounded`);
      if (i % 8 === 7) await f.barrier(sender);
    }
    await healthy.waitForNewLine((line) => line.includes("wire-89:"), 15000);
    expect(challenges.length).toBeGreaterThan(0);
    (slow.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    expect(
      await Promise.race([
        slowClosed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Paused IRC reader was not closed")), 7000),
        ),
      ]),
    ).toBe(1008);
    expect(
      slow.lines.filter((line) => line.includes(" PRIVMSG #reader :wire-")).length,
    ).toBeLessThan(90);
    await f.barrier(healthy);
    // Guessed tokens in our namespace are protocol violations, not ordinary PONGs.
    const badClosed = new Promise<number>((resolve) =>
      sender.ws.once("close", (code) => resolve(code)),
    );
    sender.send(`PONG :flarc-reader:${"0".repeat(32)}`);
    expect(
      await Promise.race([
        badClosed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Forged IRC ACK accepted")), 7000),
        ),
      ]),
    ).toBe(1008);
    await f.barrier(healthy);
  } finally {
    await f.dispose();
  }
}, 35000);

it("current authorization suppresses a real in-flight shard candidate after channel removal and credential revocation", async () => {
  const gated = await relayFixture(),
    f = gated.fixture,
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await wire(a, "JOIN #inflight", / 366 .* #inflight /);
    await wire(b, "JOIN #inflight", / 366 .* #inflight /);
    await wire(a, "MODE #inflight +s", / MODE #inflight \+s/);
    const recipient = await shardStream(f, bob),
      outside = await shardStream(f, charlie);
    streams.push(recipient, outside);
    const cursor = (await recipient.command({ type: "bootstrap" })).result.cursor;
    const state = (await liveRows(f, "direct_messages")).flat();
    await gated.authority.setRelayMode("hold");
    const message = (
      await json(
        f,
        "/api/v1/channels/%23inflight/messages",
        alice,
        "POST",
        { content: "held real channel payload" },
        201,
      )
    ).message;
    await eventually(async () => (await gated.authority.getRelayHeld()) > 0);
    expect(recipient.frames.some((e) => e.messageId === message.id)).toBe(false);
    await wire(b, "PART #inflight", / PART #inflight/);
    await gated.authority.setRelayMode("open");
    await recipient.command({ type: "bootstrap" });
    const replay = (await recipient.command({ type: "replay", cursor })).result;
    expect(replay.events.some((e: any) => e.messageId === message.id)).toBe(false);
    expect(recipient.frames.some((e) => e.messageId === message.id)).toBe(false);
    expect(outside.frames.some((e) => e.messageId === message.id)).toBe(false);
    expect((await liveRows(f, "direct_messages")).flat()).toEqual(state);
    await f.barrier(a);
    await f.barrier(c);

    const conversation = (
      await json(f, "/api/v1/conversations", alice, "POST", {
        peer: bob.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    await gated.authority.setRelayMode("hold");
    const prior = await gated.authority.getRelayHeld();
    const privateMessage = (
      await json(f, `/api/v1/conversations/${conversation.id}/messages`, alice, "POST", {
        content: "credential revoked during actual relay",
        clientOperationId: operation(),
      })
    ).message;
    await eventually(async () => (await gated.authority.getRelayHeld()) > prior);
    const closed = new Promise<number>((resolve) =>
      recipient.ws.once("close", (code) => resolve(code)),
    );
    await json(f, "/api/v1/auth/logout", bob, "POST");
    await gated.authority.setRelayMode("open");
    expect(
      await Promise.race([
        closed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Revoked in-flight shard remained active")), 7000),
        ),
      ]),
    ).toBe(1008);
    expect(recipient.frames.some((e) => e.messageId === privateMessage.id)).toBe(false);
    expect(outside.frames.some((e) => e.messageId === privateMessage.id)).toBe(false);
    expect(
      (await liveRows(f, "direct_messages"))
        .flat()
        .filter((row: any) => row.id === privateMessage.id),
    ).toHaveLength(1);
    await f.barrier(c);
  } finally {
    await gated.authority.setRelayMode("open");
    for (const stream of streams) stream.close();
    await gated.dispose();
  }
}, 35000);

it("a real failed shard relay preserves the journal and reconnect replay recovers once without repeating a mutation", async () => {
  const gated = await relayFixture(),
    f = gated.fixture,
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      other = await f.createActor("other");
    const old = await shardStream(f, bob),
      outside = await shardStream(f, other);
    streams.push(old, outside);
    const schedule = await gated.shardState(old.shard);
    expect(
      schedule.remaining,
      "first poll must survive low-volume reader deadline scheduling",
    ).toBeLessThanOrEqual(1500);
    const cursor = (await old.command({ type: "bootstrap" })).result.cursor;
    const conversation = (
      await json(f, "/api/v1/conversations", alice, "POST", {
        peer: bob.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    await gated.authority.setRelayMode("fail-once");
    const closed = new Promise<number>((resolve) => old.ws.once("close", (code) => resolve(code)));
    const send = { content: "recover after actual relay failure", clientOperationId: operation() };
    const route = `/api/v1/conversations/${conversation.id}/messages`;
    const message = (await json(f, route, alice, "POST", send)).message;
    expect(
      await Promise.race([
        closed,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Failed relay did not require recovery: ${JSON.stringify(old.diagnostic())}`,
                ),
              ),
            7000,
          ),
        ),
      ]),
    ).toBe(1008);
    expect(old.frames.some((e) => e.messageId === message.id)).toBe(false);
    const fresh = await shardStream(f, bob, { avoidShard: old.shard });
    streams.push(fresh);
    const result = (await fresh.command({ type: "replay", cursor })).result;
    expect(result.events.filter((e: any) => e.messageId === message.id)).toHaveLength(1);
    expect(result.events.find((e: any) => e.messageId === message.id).data.content).toBe(
      send.content,
    );
    expect((await json(f, route, alice, "POST", send)).message.id).toBe(message.id);
    expect(
      (await liveRows(f, "direct_messages")).flat().filter((row: any) => row.id === message.id),
    ).toHaveLength(1);
    expect(outside.frames.some((e) => e.messageId === message.id)).toBe(false);
    expect((await outside.command({ type: "replay", cursor })).status).toBe(403);
    expect((await outside.command({ type: "bootstrap" })).type).toBe("result");
  } finally {
    for (const stream of streams) stream.close();
    await gated.dispose();
  }
}, 25000);

it("idle low-volume native event connections challenge before their absolute deadline and only acknowledged readers stay live", async () => {
  const gated = await relayFixture(),
    f = gated.fixture,
    streams: Stream[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const healthy = await shardStream(f, alice),
      slow = await shardStream(f, bob, { ack: false });
    streams.push(healthy, slow);
    expect((await healthy.command({ type: "bootstrap" })).type).toBe("result");
    expect((await slow.command({ type: "bootstrap" })).type).toBe("result");
    await slow.until((e) => e.type === "reader.challenge", 26000);
    await healthy.until((e) => e.type === "reader.challenge", 2000);
    await eventually(async () => {
      const current = await gated.shardState(slow.shard);
      return current.remaining !== null && current.remaining > 0 && current.remaining <= 1500;
    }, 1500);
    await eventually(() => slow.closeCode !== undefined, 13000).catch(async () => {
      throw new Error(
        JSON.stringify({ client: slow.diagnostic(), server: await gated.shardState(slow.shard) }),
      );
    });
    expect(slow.closeCode).toBe(1008);
    expect(slow.closeReason).toContain("timed out");
    expect(healthy.closeCode).toBeUndefined();
    expect((await healthy.command({ type: "bootstrap" })).type).toBe("result");
    expect((await liveRows(f, "direct_messages")).flat()).toEqual([]);
  } finally {
    for (const stream of streams) stream.close();
    await gated.dispose();
  }
}, 42000);
