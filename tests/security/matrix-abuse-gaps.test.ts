import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { READER_WINDOW_LIMITS } from "../../server/features/session/flow-control";
import { closed, createAbuseFixture, eventually } from "../helpers/abuse-gap-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

async function trace(name: string, value: unknown) {
  const file = process.env.FLARC_ABUSE_TRACE;
  if (!file) return;
  const data = await readFile(file, "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  data[name] = value;
  await writeFile(file, JSON.stringify(data, null, 2));
}
async function join(client: TestIRCClient, channel: string) {
  const pending = client.waitForNewLine((line) => line.includes(" 366 ") && line.includes(channel));
  client.send(`JOIN ${channel}`);
  await pending;
}
async function post(
  f: Awaited<ReturnType<typeof createAbuseFixture>>,
  actor: any,
  channel: string,
  content: string,
) {
  const response = await f.request(
    `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
    actor,
    "POST",
    { content },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as any).message;
}

async function eventBarrier(
  f: Awaited<ReturnType<typeof createAbuseFixture>>,
  publisher: any,
  events: Array<{ lines: string[] }>,
) {
  const marker = `observer-barrier-${randomUUID()}`;
  await post(f, publisher, "#barrier", marker);
  await eventually(
    () => events.every((event) => event.lines.some((line) => line.includes(marker))),
    "independent event observer barrier",
  );
  return marker;
}

for (const mode of ["join-part", "create"] as const) {
  it(`${mode === "join-part" ? "ABUSE-005" : "ABUSE-006"}: actual JOIN/PART or channel-creation command burst closes only the hostile socket and preserves persistent unrelated state`, async () => {
    const f = await createAbuseFixture();
    try {
      const alice = await f.actor("alice"),
        bob = await f.actor("bob"),
        charlie = await f.actor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      await join(a, "#protected");
      const secret = a.waitForNewLine((line) => line.includes(" MODE #protected +s"));
      a.send("MODE #protected +s");
      await secret;
      await join(b, "#protected");
      await join(c, "#unrelated");
      await join(a, "#barrier");
      await join(c, "#barrier");
      const sentinel = await post(f, charlie, "#unrelated", "unrelated-persistent-sentinel");
      const unrelated = await (await f.channel("#unrelated")).abuseState();
      const ae = await f.event(alice),
        ce = await f.event(charlie);
      expect(ae.status).toBe(101);
      expect(ce.status).toBe(101);
      const terminated = closed(b.ws),
        start = Date.now();
      const commands = Array.from({ length: 220 }, (_, i) =>
        mode === "create" ? `JOIN #created${i}` : `${i % 2 ? "JOIN" : "PART"} #protected`,
      );
      b.send(commands.join("\r\n"));
      const close = await terminated;
      expect(close.reason).toMatch(/Flood|queue limit/);
      const state = await (await f.stub("SESSION")).abuseState();
      const serverCommittedJoins = [...state.createdJoinCommits];
      await eventually(
        async () =>
          !(await (await f.stub("SESSION")).abuseState()).sessions.some(
            (s: any) => s.userId === bob.account.id,
          ),
        "hostile session removed",
      );
      const joined = b.lines.filter((l) => /:bob!.* JOIN /.test(l)).length;
      expect(joined).toBeGreaterThan(1);
      expect(joined).toBeLessThanOrEqual(150);
      const created = state.known.filter((r: any) => r.canonical_channel.startsWith("#created"));
      const confirmedCreated = b.lines.flatMap((line) => {
        const match = line.match(/:bob!.* JOIN (#created\d+)(?:\r?\n)?$/);
        return match ? [match[1]] : [];
      });
      // Closing transport output can trail the committed JOIN. Compare the
      // exact server commit set with SQLite rather than subtracting one wire
      // confirmation from an unrelated initial JOIN.
      expect(created.map((row: any) => row.canonical_channel).sort()).toEqual(
        [...serverCommittedJoins].sort(),
      );
      expect(confirmedCreated).toEqual(serverCommittedJoins.slice(0, confirmedCreated.length));
      expect(confirmedCreated.length).toBeLessThanOrEqual(created.length);
      if (mode === "create") expect(created.length).toBeGreaterThan(1);
      else expect(created).toEqual([]);
      expect(created.length).toBeLessThan(150);
      if (mode === "join-part") expect(b.lines.some((l) => /:bob!.* PART /.test(l))).toBe(true);
      const before = b.lines.length;
      const marker = `healthy-after-flood-${randomUUID()}`;
      await post(f, alice, "#protected", marker);
      await eventually(
        () => ae.lines.some((l) => l.includes(marker)),
        "healthy event recipient progresses",
      );
      expect(ce.lines.join("\n")).not.toContain(marker);
      await eventBarrier(f, alice, [ae, ce]);
      const eventOffsets = [ae, ce].map((event) => event.lines.length);
      expect((await f.request("/api/v1/channels/%23protected/messages", bob)).status).toBe(403);
      const denialBarrier = await eventBarrier(f, alice, [ae, ce]);
      for (const [i, event] of [ae, ce].entries())
        expect(
          event.lines.slice(eventOffsets[i]).filter((line) => !line.includes(denialBarrier)),
        ).toEqual([]);
      expect(await (await f.channel("#unrelated")).abuseState()).toEqual(unrelated);
      expect(b.lines).toHaveLength(before);
      const elapsedMs = Date.now() - start;
      await f.stop();
      expect(
        (await f.snapshot("channel_members")).filter((r) => r.user_id === bob.account.id),
      ).toEqual([]);
      expect(
        (await f.snapshot("messages")).some(
          (r) => r.id === sentinel.id && r.content === "unrelated-persistent-sentinel",
        ),
      ).toBe(true);
      const persistedCreated = (await f.snapshot("channel_metadata"))
        .filter((r) => r.key === "canonical_name" && r.value.startsWith("#created"))
        .map((r) => r.value)
        .sort();
      expect(persistedCreated).toEqual(created.map((r: any) => r.canonical_channel).sort());
      expect(
        (await f.snapshot("known_channels")).filter((r) =>
          r.canonical_channel.startsWith("#created"),
        ),
      ).toHaveLength(created.length);
      await trace(mode, {
        close,
        elapsedMs,
        acceptedJoinFrames: joined,
        confirmedCreatedJoins: confirmedCreated.length,
        serverCommittedJoins: serverCommittedJoins.length,
        createdChannels: created.length,
        persistedCreatedChannels: persistedCreated.length,
        submittedCommands: commands.length,
        bobMembershipRowsAfterClose: 0,
      });
      await f.restart();
      expect(
        (await (await f.stub("SESSION")).abuseState()).known.filter((r: any) =>
          r.canonical_channel.startsWith("#created"),
        ),
      ).toHaveLength(created.length);
      const renewed = await f.connect(bob);
      await join(renewed, "#protected");
      await join(await f.connect(alice), "#protected");
      const fresh = `healthy-reconnect-${randomUUID()}`;
      const receive = renewed.waitForNewLine((line) => line.includes(fresh));
      await post(f, alice, "#protected", fresh);
      await receive;
      expect(
        await (await f.request("/api/v1/channels/%23unrelated/messages", charlie)).text(),
      ).toContain("unrelated-persistent-sentinel");
    } finally {
      await f.dispose();
    }
  }, 60000);
}

it("WS-020: real IRC disconnect and event close release actual socket state and event slots across reconstruction", async () => {
  const f = await createAbuseFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await join(a, "#private");
    const secret = a.waitForNewLine((l) => l.includes(" MODE #private +s"));
    a.send("MODE #private +s");
    await secret;
    await join(b, "#private");
    await join(c, "#unrelated");
    await post(f, charlie, "#unrelated", "disconnect-unrelated-control");
    const sentinel = await (await f.channel("#unrelated")).abuseState();
    const monitor = b.waitForNewLine((l) => l.includes(" 730 "));
    b.send("MONITOR + alice");
    await monitor;
    const events = [];
    for (let i = 0; i < 5; i++) {
      const e = await f.event(bob);
      expect(e.status).toBe(101);
      events.push(e);
    }
    expect((await f.event(bob)).status).toBe(429);
    const session = await f.stub("SESSION");
    expect(
      (await session.abuseState()).events.filter((e: any) => e.accountId === bob.account.id),
    ).toHaveLength(5);
    const leases = (await session.abuseState()).events.filter(
      (e: any) => e.accountId === bob.account.id,
    );
    for (const lease of leases) {
      const edge = await f.stub("SESSION", `FlaRC:events:${lease.shard}`);
      expect(await edge.abuseEdgeSockets()).toContainEqual(
        expect.objectContaining({ leaseId: lease.leaseId, readyState: 1 }),
      );
    }
    const eventClosed = closed(events[0].ws);
    events[0].ws.terminate();
    await eventClosed;
    await eventually(
      async () =>
        (await session.abuseState()).events.filter((e: any) => e.accountId === bob.account.id)
          .length === 4,
      "closed event frees actual fifth slot",
    );
    const replacement = await f.event(bob);
    expect(replacement.status).toBe(101);
    const beforeIrcClose = await session.abuseState();
    expect(beforeIrcClose.events.filter((e: any) => e.accountId === bob.account.id)).toHaveLength(
      5,
    );
    const closedSessionId = beforeIrcClose.sessions.find(
      (s: any) => s.userId === bob.account.id,
    ).sessionId;
    const ircClosed = closed(b.ws);
    const quit = a.waitForNewLine((l) => l.includes(":bob!") && l.includes(" QUIT "));
    b.ws.terminate();
    await ircClosed;
    await quit;
    await eventually(
      async () =>
        !(await session.abuseState()).sessions.some((s: any) => s.userId === bob.account.id),
      "closed IRC session removed",
    );
    await eventually(
      async () => (await session.abuseState()).liveSockets === beforeIrcClose.liveSockets - 1,
      "closed IRC socket releases an actual transport slot",
    );
    const after = await session.abuseState();
    expect(after.monitors).toEqual([]);
    expect(after.channels.filter((row: any) => row.session_id === closedSessionId)).toEqual([]);
    expect(
      (await (await f.channel("#private")).abuseState()).members.some(
        (m: any) => m.user_id === bob.account.id,
      ),
    ).toBe(false);
    const oldIrcFrames = b.lines.length,
      oldEventFrames = events[0].lines.length;
    const privateMarker = `closed-socket-private-${randomUUID()}`;
    await post(f, alice, "#private", privateMarker);
    const fresh = await f.connect(bob);
    await join(fresh, "#private");
    const marker = `replacement-private-${randomUUID()}`;
    const receive = fresh.waitForNewLine((l) => l.includes(marker));
    await post(f, alice, "#private", marker);
    await receive;
    await eventually(
      () => replacement.lines.some((l) => l.includes(marker)),
      "replacement event delivers authorized private output",
    );
    expect(b.lines).toHaveLength(oldIrcFrames);
    expect(events[0].lines).toHaveLength(oldEventFrames);
    expect(replacement.lines.join("\n")).not.toContain(privateMarker);
    expect(await (await f.channel("#unrelated")).abuseState()).toEqual(sentinel);
    await trace("disconnect", {
      eventSlotsBefore: 5,
      eventSlotsAfterClose: 4,
      replacementAccepted: replacement.status,
      closedIrcSessionRemoved: true,
      monitorRowsAfterClose: after.monitors.length,
      ircLiveTransportSlotsBefore: beforeIrcClose.liveSockets,
      ircLiveTransportSlotsAfter: after.liveSockets,
      closedSessionChannelRowsAfter: 0,
    });
    for (const event of [...events.slice(1), replacement]) event.ws.terminate();
    await eventually(
      async () => (await session.abuseState()).events.length === 0,
      "edge closes release central leases",
    );
    await f.restart();
    expect((await (await f.stub("SESSION")).abuseState()).events).toEqual([]);
    const newBob = await f.connect(bob),
      newAlice = await f.connect(alice);
    await join(newAlice, "#private");
    await join(newBob, "#private");
    const restored = await f.event(bob);
    expect(restored.status).toBe(101);
    const finalMarker = `recreated-private-${randomUUID()}`;
    await post(f, alice, "#private", finalMarker);
    await eventually(
      () => restored.lines.some((l) => l.includes(finalMarker)),
      "reconstructed runtime accepts fresh real event socket",
    );
    const outside = await f.event(charlie);
    await join(newAlice, "#barrier");
    await join(newBob, "#barrier");
    await join(await f.connect(charlie), "#barrier");
    await eventBarrier(f, alice, [restored, outside]);
    const offsets = [restored, outside].map((event) => event.lines.length);
    expect((await f.request("/api/v1/channels/%23private/messages", charlie)).status).toBe(403);
    const denialBarrier = await eventBarrier(f, alice, [restored, outside]);
    for (const [i, event] of [restored, outside].entries())
      expect(event.lines.slice(offsets[i]).filter((line) => !line.includes(denialBarrier))).toEqual(
        [],
      );
  } finally {
    await f.dispose();
  }
}, 60000);

it("WS-021 ABUSE-012: actual IRC output bytes are bounded while one real authorization RPC is pending and healthy recipients progress", async () => {
  const f = await createAbuseFixture();
  let accounts: any;
  let closing: ReturnType<typeof closed> | undefined;
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie"),
      dave = await f.actor("dave"),
      mallory = await f.actor("mallory");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await join(a, "#pressure");
    const secret = a.waitForNewLine((line) => line.includes(" MODE #pressure +s"));
    a.send("MODE #pressure +s");
    await secret;
    await join(b, "#pressure");
    await join(c, "#pressure");
    const d = await f.connect(dave);
    await join(d, "#unrelated");
    for (const client of [a, c, d]) await join(client, "#barrier");
    await post(f, dave, "#unrelated", "queue-unrelated-control");
    const sentinel = await (await f.channel("#unrelated")).abuseState();
    const healthy = await f.event(charlie),
      outside = await f.event(dave);
    expect(healthy.status).toBe(101);
    expect(outside.status).toBe(101);
    for (const client of [b, c]) {
      const ack = client.waitForNewLine((line) => line.includes(" CAP ") && line.includes(" ACK "));
      client.send("CAP REQ :message-tags");
      await ack;
    }
    // Use genuine separately authenticated devices rather than disabling the
    // 300/min API budget or the 150/10s per-socket IRC command budget.
    const producers = [a];
    for (let i = 1; i < 8; i++) {
      const device = await f.connect(alice, `alice${i}`);
      producers.push(device);
    }
    for (let i = 0; i < 8; i++) {
      const device = await f.connect(mallory, `mallory${i}`);
      producers.push(device);
    }
    accounts = await f.stub("ACCOUNTS");
    await eventually(
      async () => (await (await f.stub("SESSION")).abuseState()).totalQueuedBytes === 0,
      "setup output has drained before holding one delivery authorization",
    );
    await accounts.abuseHold("bob");
    const session = await f.stub("SESSION");
    let observedClose: { code: number; reason: string } | undefined;
    b.ws.once("close", (code, reason) => {
      observedClose = { code, reason: reason.toString() };
    });
    let sent = 0,
      payloadBytes = 0;
    for (const producer of producers) {
      // Join only the active producer: retired producers need not multiply the
      // independent healthy witness work while filling the same 8 MiB queue.
      if (producer !== a) await join(producer, "#pressure");
      for (let i = 0; i < 140 && b.ws.readyState === b.ws.OPEN; i++) {
        const marker = `queue-body-${sent}-`;
        const content = marker + "x".repeat(400 - marker.length);
        const delivered = c.waitForNewLine((line) => line.includes(marker));
        const line = `@+padding=${"x".repeat(3800)} PRIVMSG #pressure :${content}`;
        producer.send(line);
        expect(await delivered).toContain("+padding=");
        payloadBytes += Buffer.byteLength(line);
        sent++;
        if (sent === 1) await accounts.abuseReached();
      }
      if (producer !== a) producer.close();
      if (b.ws.readyState !== b.ws.OPEN) break;
    }
    // Observe early closes from before pressure begins, but measure the close
    // deadline after generating the bounded workload, not its CPU throughput.
    const result = observedClose ?? (await (closing = closed(b.ws)));
    const state = await session.abuseState();
    await trace("output", {
      result,
      sent,
      payloadBytes,
      peak: state.peak.bob,
      attempts: await accounts.abuseAttempts(),
      scope: "actual application queue, not native event/TCP transport buffering",
    });
    expect(result.code).toBe(1008);
    expect(result.reason).toContain("Output queue limit");
    expect(state.peak.bob.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(state.peak.bob.bytes).toBeGreaterThan(8 * 1024 * 1024 - 16384);
    expect(await accounts.abuseAttempts()).toBe(1);
    expect(outside.lines.join("\n")).not.toContain("queue-body-");
    await eventBarrier(f, alice, [healthy, outside]);
    const eventOffsets = [healthy, outside].map((event) => event.lines.length);
    expect((await f.request("/api/v1/channels/%23pressure/messages", dave)).status).toBe(403);
    const denialBarrier = await eventBarrier(f, alice, [healthy, outside]);
    for (const [i, event] of [healthy, outside].entries())
      expect(
        event.lines.slice(eventOffsets[i]).filter((line) => !line.includes(denialBarrier)),
      ).toEqual([]);
    const marker = `healthy-pressure-${randomUUID()}`;
    await post(f, alice, "#pressure", marker);
    await eventually(
      () => healthy.lines.some((l) => l.includes(marker)),
      "healthy peer/event makes progress during held recipient authorization",
    );
    await accounts.abuseRelease();
    await eventually(
      async () => (await session.abuseState()).totalQueuedBytes === 0,
      "actual queued bytes released after close",
    );
    expect(await (await f.channel("#unrelated")).abuseState()).toEqual(sentinel);
    await f.restart();
    const aa = await f.connect(alice),
      bb = await f.connect(bob);
    await join(aa, "#pressure");
    await join(bb, "#pressure");
    const after = `after-pressure-${randomUUID()}`,
      receive = bb.waitForNewLine((l) => l.includes(after));
    await post(f, alice, "#pressure", after);
    await receive;
    expect((await (await f.stub("SESSION")).abuseState()).totalQueuedBytes).toBe(0);
  } finally {
    if (accounts) {
      try {
        await accounts.abuseRelease();
      } catch {
        // A successful restart invalidates the old runtime stub.
      }
    }
    await f.dispose();
    await closing?.catch(() => undefined);
  }
}, 120000);

it("WS-021 ABUSE-012: a real paused event TCP reader resumes private frames within negotiated credit while independent recipients progress without proving a provider buffer ceiling", async () => {
  const f = await createAbuseFixture();
  let reader: import("node:net").Socket | undefined;
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie"),
      dave = await f.actor("dave");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie),
      d = await f.connect(dave);
    await join(a, "#paused");
    const secret = a.waitForNewLine((line) => line.includes(" MODE #paused +s"));
    a.send("MODE #paused +s");
    await secret;
    for (const client of [b, c]) await join(client, "#paused");
    for (const client of [a, c, d]) await join(client, "#barrier");
    await join(d, "#unrelated");
    await post(f, dave, "#unrelated", "paused-unrelated-control");
    const sentinel = await (await f.channel("#unrelated")).abuseState();
    const slow = await f.event(bob),
      healthy = await f.event(charlie),
      outside = await f.event(dave);
    const initial = `paused-initial-${randomUUID()}`;
    await post(f, alice, "#paused", initial);
    await eventually(() => slow.lines.some((line) => line.includes(initial)), "reader starts live");
    expect(slow.contract).toMatchObject({ maxBytes: READER_WINDOW_LIMITS.maxBytes });
    const beforeFrames = slow.lines.length,
      beforeBytes = slow.bytes,
      beforeWireBytes = slow.wireBytes,
      beforeChallenges = slow.challenges.length;
    reader = (slow.ws as any)._socket;
    expect(reader).toBeDefined();
    slow.ws.pause();
    expect(reader?.isPaused()).toBe(true);
    const pausedAt = Date.now();
    const saved: Array<{ id: string; content: string }> = [];
    let requestContentBytes = 0;
    // Acknowledge on resume before the existing 10s challenge deadline and
    // remain below 256KiB of actual debt; the separate shard test covers the
    // hard-close path for a reader that never returns credit.
    const pausedMessages = 12;
    for (let i = 0; i < pausedMessages; i++) {
      const marker = `paused-body-${i}-`,
        content = marker + "x".repeat(8191 - marker.length);
      const delivered = c.waitForNewLine((line) => line.includes(marker));
      const message = await post(f, alice, "#paused", content);
      saved.push({ id: message.id, content });
      requestContentBytes += Buffer.byteLength(content);
      await delivered;
    }
    await eventually(
      () => healthy.lines.some((line) => line.includes(`paused-body-${pausedMessages - 1}-`)),
      "healthy event reader progresses while separate TCP reader is paused",
    );
    expect(slow.ws.readyState).toBe(slow.ws.OPEN);
    expect(slow.lines).toHaveLength(beforeFrames);
    expect(slow.bytes).toBe(beforeBytes);
    expect(requestContentBytes).toBeLessThan(slow.contract!.maxBytes / 2);
    expect(outside.lines.join("\n")).not.toContain("paused-body-");
    const state = await (await f.channel("#paused")).abuseState();
    for (const message of saved)
      expect(
        state.messages.some((row: any) => row.id === message.id && row.content === message.content),
      ).toBe(true);
    const pauseElapsedMs = Date.now() - pausedAt;
    expect(pauseElapsedMs).toBeLessThan(READER_WINDOW_LIMITS.challengeTimeoutMs);
    slow.ws.resume();
    await eventually(
      () => slow.lines.some((line) => line.includes(`paused-body-${pausedMessages - 1}-`)),
      "real paused reader resumes its final private frame",
    );
    expect(
      slow.lines
        .slice(beforeFrames)
        .filter((line) => line.includes("paused-body-"))
        .map((line) => JSON.parse(line).messageId),
    ).toEqual(saved.map((message) => message.id));
    expect(slow.bytes - beforeBytes).toBeGreaterThan(requestContentBytes);
    expect(slow.wireBytes - beforeWireBytes).toBeLessThan(READER_WINDOW_LIMITS.maxBytes);
    expect(slow.challenges.length).toBeGreaterThan(beforeChallenges);
    expect(slow.ws.readyState).toBe(slow.ws.OPEN);
    await eventBarrier(f, alice, [healthy, outside]);
    const offsets = [healthy, outside].map((event) => event.lines.length);
    expect((await f.request("/api/v1/channels/%23paused/messages", dave)).status).toBe(403);
    const denialBarrier = await eventBarrier(f, alice, [healthy, outside]);
    for (const [i, event] of [healthy, outside].entries())
      expect(event.lines.slice(offsets[i]).filter((line) => !line.includes(denialBarrier))).toEqual(
        [],
      );
    expect(await (await f.channel("#unrelated")).abuseState()).toEqual(sentinel);
    await trace("pausedNativeReader", {
      acceptedMessages: saved.length,
      requestContentBytes,
      resumedEventFrames: slow.lines.length - beforeFrames,
      resumedPrivateMessageFrames: slow.lines
        .slice(beforeFrames)
        .filter((line) => line.includes("paused-body-")).length,
      resumedEventBytes: slow.bytes - beforeBytes,
      chargedFrameBytes: slow.wireBytes - beforeWireBytes,
      negotiatedMaxBytes: slow.contract!.maxBytes,
      acknowledgementChallenges: slow.challenges.length - beforeChallenges,
      pauseElapsedMs,
      closedOrThrottled: false,
      scope:
        "finite credit-bounded Node TCP pause/resume with real v2 challenge ACK; server/provider allocation is not observable or proved, nonacknowledging hard-close is covered separately",
    });
    reader = undefined;
    await f.restart();
    const aa = await f.connect(alice),
      bb = await f.connect(bob);
    await join(aa, "#paused");
    await join(bb, "#paused");
    const fresh = await f.event(bob),
      marker = `paused-reconnected-${randomUUID()}`;
    await post(f, alice, "#paused", marker);
    await eventually(() => fresh.lines.some((line) => line.includes(marker)), "fresh event reader");
    expect((await (await f.channel("#paused")).abuseState()).messages).toEqual(
      expect.arrayContaining(saved.map((message) => expect.objectContaining(message))),
    );
    expect(
      await (await f.request("/api/v1/channels/%23unrelated/messages", dave)).text(),
    ).toContain("paused-unrelated-control");
  } finally {
    reader?.resume();
    await f.dispose();
  }
}, 60000);

it("ABUSE-013: repeated real failing account RPCs close the affected recipient with bounded attempts while healthy deliveries persist", async () => {
  const f = await createAbuseFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    const a = await f.connect(alice),
      c = await f.connect(charlie);
    await join(a, "#rpc");
    const secret = a.waitForNewLine((line) => line.includes(" MODE #rpc +s"));
    a.send("MODE #rpc +s");
    await secret;
    for (const client of [a, c]) await join(client, "#barrier");
    await join(c, "#unrelated");
    await post(f, charlie, "#unrelated", "rpc-unrelated-control");
    const sentinel = await (await f.channel("#unrelated")).abuseState();
    const healthy = await f.event(alice),
      outside = await f.event(charlie);
    const accounts = await f.stub("ACCOUNTS");
    const attempts: number[] = [];
    const lookupObservations: Array<{ beforeQuiet: number; afterQuiet: number }> = [];
    const persistedFaults: Array<{ id: string; content: string }> = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await accounts.abuseFail(null);
      const b = await f.connect(bob);
      await join(b, "#rpc");
      const delivered = b.waitForNewLine((l) => l.includes(`rpc-positive-${cycle}`));
      await post(f, alice, "#rpc", `rpc-positive-${cycle}`);
      await delivered;
      await accounts.abuseFail("bob");
      const close = closed(b.ws),
        faultContent = `rpc-fault-${cycle}`;
      const saved = await post(f, alice, "#rpc", faultContent);
      persistedFaults.push({ id: saved.id, content: faultContent });
      expect((await close).reason).toContain("could not be authorized");
      expect(b.lines.join("\n")).not.toContain(faultContent);
      await eventually(
        async () =>
          !(await (await f.channel("#rpc")).abuseState()).members.some(
            (member: any) => member.user_id === bob.account.id,
          ),
        "failed delivery removes actual IRC channel membership",
      );
      const marker = `rpc-healthy-${cycle}`;
      const progress = a.waitForNewLine((l) => l.includes(marker));
      await post(f, alice, "#rpc", marker);
      await progress;
      await eventually(
        () => healthy.lines.some((line) => line.includes(marker)),
        "healthy event progress",
      );
      await eventBarrier(f, alice, [healthy, outside]);
      const offsets = [healthy, outside].map((event) => event.lines.length);
      expect((await f.request("/api/v1/channels/%23rpc/messages", charlie)).status).toBe(403);
      const denialBarrier = await eventBarrier(f, alice, [healthy, outside]);
      for (const [i, event] of [healthy, outside].entries())
        expect(
          event.lines.slice(offsets[i]).filter((line) => !line.includes(denialBarrier)),
        ).toEqual([]);
      expect(outside.lines.join("\n")).not.toContain(faultContent);
      // The fault applies to one independent real RPC, allowing other domain
      // authorization to continue. Count all matching lookups separately so
      // the quiet-window check still detects background retries after close.
      const beforeQuiet = await accounts.abuseFailedLookups();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const afterQuiet = await accounts.abuseFailedLookups();
      lookupObservations.push({ beforeQuiet, afterQuiet });
      expect(afterQuiet).toBe(beforeQuiet);
      attempts.push(await accounts.abuseAttempts());
      expect(attempts.at(-1)).toBe(1);
    }
    expect(await (await f.channel("#unrelated")).abuseState()).toEqual(sentinel);
    expect((await (await f.channel("#rpc")).abuseState()).messages).toEqual(
      expect.arrayContaining(persistedFaults.map((message) => expect.objectContaining(message))),
    );
    await trace("rpc", {
      actualFailingRpcAttemptsPerCycle: attempts,
      allMatchingLookupObservationsPerCycle: lookupObservations,
      errorSource: "real Worker SQLite SELECT of deliberately missing table inside account RPC",
      quietWindowLookupsAfterActualClose: lookupObservations.map(
        ({ beforeQuiet, afterQuiet }) => afterQuiet - beforeQuiet,
      ),
      minimumQuietObservationMsPerCycle: 250,
    });
    await f.restart();
    const aa = await f.connect(alice),
      bb = await f.connect(bob);
    await join(aa, "#rpc");
    await join(bb, "#rpc");
    const marker = `rpc-after-recreation-${randomUUID()}`,
      receive = bb.waitForNewLine((l) => l.includes(marker));
    await post(f, alice, "#rpc", marker);
    await receive;
    expect((await (await f.channel("#rpc")).abuseState()).messages).toEqual(
      expect.arrayContaining(persistedFaults.map((message) => expect.objectContaining(message))),
    );
    expect(
      await (await f.request("/api/v1/channels/%23unrelated/messages", charlie)).text(),
    ).toContain("rpc-unrelated-control");
  } finally {
    await f.dispose();
  }
}, 60000);

it("ABUSE-013: persistent real account RPC failure keeps ordered channel work bounded with paced alarms and recovers after authority returns", async () => {
  const f = await createAbuseFixture();
  let accounts: any;
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie"),
      dave = await f.actor("dave");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie),
      d = await f.connect(dave);
    const room = "#persistent-rpc",
      publicRoom = "#persistent-control";
    await join(a, room);
    const secret = a.waitForNewLine((line) => line.includes(` MODE ${room} +s`));
    a.send(`MODE ${room} +s`);
    await secret;
    await join(b, room);
    await join(c, publicRoom);
    await join(d, publicRoom);
    const inside = await f.event(alice),
      outside = await f.event(dave);
    const channel = await f.channel(room);
    const retryState = async () => JSON.parse(await channel.abuseRetryStateJSON());
    const publicIds: string[] = [];
    async function publicControl(stage: string) {
      const marker = `persistent-public-${stage}-${randomUUID()}`;
      const received = d.waitForNewLine((line) => line.includes(marker));
      const saved = await post(f, charlie, publicRoom, marker);
      await received;
      await eventually(
        () => outside.lines.some((line) => JSON.parse(line).messageId === saved.id),
        `independent public IRC and event progress: ${stage}`,
      );
      publicIds.push(saved.id);
    }
    await publicControl("before");
    const positive = `persistent-private-before-${randomUUID()}`;
    const receivedPositive = b.waitForNewLine((line) => line.includes(positive));
    await post(f, alice, room, positive);
    await receivedPositive;
    await eventually(
      async () => (await retryState()).pending.length === 0,
      "initial real outbox drains",
    );
    accounts = await f.stub("ACCOUNTS");
    await accounts.abuseFail("bob", true);
    const closing = closed(b.ws);
    const faultMarker = `persistent-private-fault-${randomUUID()}`;
    const fault = await post(f, alice, room, faultMarker);
    const close = await closing;
    expect(close.code).toBe(1008);
    expect(close.reason).toContain("could not be authorized");
    expect(b.lines.join("\n")).not.toContain(faultMarker);
    await eventually(async () => {
      const pending = (await retryState()).pending;
      return (
        pending.length === 1 &&
        pending[0].kind === "membership-event" &&
        JSON.parse(pending[0].payload).accountId === bob.account.id &&
        JSON.parse(pending[0].payload).joined === false
      );
    }, "closed Bob leaves one real blocked membership intent");
    expect(
      (await channel.abuseState()).members.some((member: any) => member.user_id === bob.account.id),
    ).toBe(false);
    const closedLines = b.lines.length;
    const queued: Array<{ id: string; content: string }> = [];
    for (let i = 0; i < 2; i++) {
      const content = `persistent-private-ordered-${i}-${randomUUID()}`;
      const saved = await post(f, alice, room, content);
      queued.push({ id: saved.id, content });
    }
    expect(
      (await f.request(`/api/v1/channels/${encodeURIComponent(room)}/messages`, dave)).status,
    ).toBe(403);
    // The same failing authority prevents Bob's own HTTP read as well. Its
    // dependency error must contain no private content; after repair the
    // removed membership is denied with 403 below.
    const unavailable = await f.request(
      `/api/v1/channels/${encodeURIComponent(room)}/messages`,
      bob,
    );
    expect(unavailable.status).toBe(500);
    const unavailableBody = await unavailable.text();
    expect(unavailableBody).not.toMatch(/abuse_deliberately_missing_table|SQLITE|"stack"/);
    for (const saved of queued) expect(unavailableBody).not.toContain(saved.content);
    const baseline = await retryState();
    await trace("persistentRpcProgress", { stage: "committed-pending", baseline });
    // The one failed membership intent plus event and IRC intents for each of
    // the two real committed writes is the complete fixed pending workload.
    expect(baseline.pending).toHaveLength(1 + 2 * queued.length);
    expect(baseline.pending.map((row: any) => row.kind)).toEqual([
      "membership-event",
      "event",
      "irc-message",
      "event",
      "irc-message",
    ]);
    const pendingBytes = Buffer.byteLength(JSON.stringify(baseline.pending));
    for (const saved of queued) {
      expect(
        (await channel.abuseState()).messages.some(
          (row: any) => row.id === saved.id && row.content === saved.content,
        ),
      ).toBe(true);
      expect(a.lines.join("\n")).not.toContain(saved.content);
      expect(inside.lines.join("\n")).not.toContain(saved.content);
    }
    // Production schedules an unsuccessful ordered head at Date.now()+1000.
    // Observe four actual runtime alarms (three complete spacing intervals),
    // without invoking alarm(), changing its schedule, or issuing room writes.
    const retryIntervalMs = 1000;
    const alarmSnapshots: any[] = [];
    for (let i = 1; i <= 4; i++) {
      let observed: any;
      await eventually(async () => {
        observed = await retryState();
        return (
          observed.alarms.filter((alarm: any) => alarm.startedAt >= baseline.observedAt).length >= i
        );
      }, `real persistent-failure retry alarm ${i}`);
      await trace("persistentRpcProgress", { stage: `alarm-${i}`, baseline, observed });
      expect(observed.pending).toEqual(baseline.pending);
      expect(Buffer.byteLength(JSON.stringify(observed.pending))).toBe(pendingBytes);
      expect(observed.nextSequence).toBe(baseline.nextSequence);
      alarmSnapshots.push(observed);
      await publicControl(`during-${i}`);
    }
    const after = await retryState();
    const failures: number[] = JSON.parse(await accounts.abuseFailureTimesJSON());
    const alarms = after.alarms.filter((alarm: any) => alarm.startedAt >= baseline.observedAt);
    await trace("persistentRpcProgress", { stage: "pacing-check", baseline, after, failures });
    expect(alarms.length).toBeGreaterThanOrEqual(4);
    expect(alarms.at(-1).startedAt - alarms[0].startedAt).toBeGreaterThanOrEqual(
      3 * retryIntervalMs,
    );
    const maximumAlarms = 1 + Math.floor((after.observedAt - baseline.nextAlarm) / retryIntervalMs);
    expect(alarms.length).toBeLessThanOrEqual(maximumAlarms);
    for (const [i, alarm] of alarms.entries()) {
      const attempts = failures.filter((time) => time >= alarm.startedAt && time <= alarm.endedAt);
      expect(attempts).toHaveLength(1);
      expect(alarm.nextAlarm).toBeGreaterThanOrEqual(attempts[0] + retryIntervalMs);
      if (i > 0) expect(alarm.startedAt).toBeGreaterThanOrEqual(alarms[i - 1].nextAlarm);
    }
    expect(
      failures.filter((time) => time >= baseline.observedAt && time <= after.observedAt),
    ).toHaveLength(alarms.length);
    expect(after.pending).toEqual(baseline.pending);
    for (const saved of queued) {
      expect(a.lines.join("\n")).not.toContain(saved.content);
      expect(inside.lines.join("\n")).not.toContain(saved.content);
    }
    const privateMarkers = [faultMarker, ...queued.map((saved) => saved.content)];
    for (const marker of privateMarkers) {
      expect(outside.lines.join("\n")).not.toContain(marker);
      expect(d.lines.join("\n")).not.toContain(marker);
      expect(b.lines.join("\n")).not.toContain(marker);
    }
    expect(outside.lines.join("\n")).not.toContain(positive);
    expect(d.lines.join("\n")).not.toContain(positive);
    expect(b.lines).toHaveLength(closedLines);

    // A persistent authority outage blocks this room's ordered head. Clearing
    // the fault lets its existing scheduled alarm recover the committed work;
    // isolation belongs to the independently working channel above.
    await accounts.abuseFail(null);
    await eventually(
      async () => (await retryState()).pending.length === 0,
      "scheduled retry recovers ordered outbox after real authority returns",
    );
    await eventually(
      () => inside.lines.some((line) => JSON.parse(line).messageId === queued.at(-1)!.id),
      "recovered private event delivery",
    );
    await eventually(
      () => a.lines.some((line) => line.includes(queued.at(-1)!.content)),
      "recovered private IRC delivery",
    );
    await publicControl("after");
    expect(
      a.lines
        .filter((line) => line.includes("persistent-private-ordered-"))
        .map((line) => queued.find((saved) => line.includes(saved.content))?.id),
    ).toEqual(queued.map((saved) => saved.id));
    expect(
      inside.lines
        .map((line) => JSON.parse(line))
        .filter((event) => queued.some((saved) => saved.id === event.messageId))
        .map((event) => event.messageId),
    ).toEqual(queued.map((saved) => saved.id));
    for (const marker of privateMarkers) {
      expect(outside.lines.join("\n")).not.toContain(marker);
      expect(d.lines.join("\n")).not.toContain(marker);
    }
    expect(b.lines).toHaveLength(closedLines);
    expect(
      (await f.request(`/api/v1/channels/${encodeURIComponent(room)}/messages`, dave)).status,
    ).toBe(403);
    expect(
      (await f.request(`/api/v1/channels/${encodeURIComponent(room)}/messages`, bob)).status,
    ).toBe(403);
    const recovered = await retryState();
    expect(recovered.pending).toEqual([]);
    await f.stop();
    const persistedPending = await f.snapshot("channel_feature_outbox");
    await trace("persistentRpcProgress", {
      stage: "persisted-after-client-close",
      baseline,
      after,
      failures,
      recovered,
      persistedPending,
    });
    expect(
      persistedPending.filter((row) =>
        baseline.pending.some((pending: any) => pending.id === row.id),
      ),
    ).toEqual([]);
    // Closing the remaining real clients during stop can commit new leave
    // intents. They are distinct from the recovered ordered writes and may
    // remain on disk until the reconstructed object's normal retry alarm.
    for (const row of persistedPending) {
      expect(row.kind).toBe("membership-event");
      expect(row.created_at).toBeGreaterThanOrEqual(recovered.observedAt);
      expect(JSON.parse(row.payload).joined).toBe(false);
      expect([alice.account.id, charlie.account.id, dave.account.id]).toContain(
        JSON.parse(row.payload).accountId,
      );
    }
    const persisted = await f.snapshot("messages");
    for (const saved of [fault, ...queued])
      expect(persisted.filter((row) => row.id === saved.id)).toHaveLength(1);
    for (const id of publicIds) expect(persisted.filter((row) => row.id === id)).toHaveLength(1);
    await trace("persistentRpc", {
      close,
      affectedHttpStatusDuringFailure: unavailable.status,
      retryIntervalMs,
      pendingRows: baseline.pending,
      pendingBytes,
      nextSequence: baseline.nextSequence,
      baselineObservedAt: baseline.observedAt,
      firstScheduledAlarm: baseline.nextAlarm,
      observationEnd: after.observedAt,
      maximumAlarms,
      alarms,
      failureTimes: failures,
      alarmPendingCounts: alarmSnapshots.map((state) => state.pending.length),
      recoveredMessageIds: queued.map((saved) => saved.id),
      publicControlIds: publicIds,
      liveOutboxRowsAfterRecovery: recovered.pending.length,
      persistedOriginalOutboxRowsAfterRecovery: 0,
      distinctNewShutdownMembershipIntents: persistedPending,
      limitation:
        "A permanently unavailable account authority keeps that channel's ordered membership head and subsequent messages pending with continued paced retries; no hard maximum total attempts or same-room availability is claimed.",
    });
    await f.restart();
    expect((await (await f.channel(room)).abuseState()).messages).toEqual(
      expect.arrayContaining(queued.map((saved) => expect.objectContaining(saved))),
    );
    const renewedAlice = await f.connect(alice),
      renewedBob = await f.connect(bob);
    await join(renewedAlice, room);
    await join(renewedBob, room);
    const fresh = `persistent-private-restored-${randomUUID()}`;
    const received = renewedBob.waitForNewLine((line) => line.includes(fresh));
    await post(f, alice, room, fresh);
    await received;
  } finally {
    if (accounts) {
      try {
        await accounts.abuseFail(null);
      } catch {
        /* Restart invalidates the old runtime stub. */
      }
    }
    await f.dispose();
  }
}, 60000);
