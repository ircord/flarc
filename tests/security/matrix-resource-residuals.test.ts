import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { closed, eventually } from "../helpers/abuse-gap-fixture";
import { wire } from "../helpers/auth-gap-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";
import {
  type ResourceFixture,
  resourceResidualFixture,
} from "../helpers/resource-residual-fixture";

async function trace(key: string, value: unknown) {
  const file = process.env.FLARC_RESOURCE_TRACE;
  if (!file) return;
  const previous = await readFile(file, "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  await writeFile(file, JSON.stringify({ ...previous, [key]: value }, null, 2));
}
async function join(client: TestIRCClient, channels: string[]) {
  for (let i = 0; i < channels.length; i += 20) {
    const batch = channels.slice(i, i + 20);
    const final = batch.at(-1)!;
    await wire(client, `JOIN ${batch.join(",")}`, new RegExp(` 366 .*${final} `));
  }
}
async function post(f: ResourceFixture, actor: any, channel: string, content: string) {
  const res = await f.request(
    `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
    actor,
    "POST",
    { content },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).message;
}
function attempt(client: TestIRCClient, text: string) {
  const marker = randomUUID();
  return new Promise<{ kind: "completed" | "closed"; code?: number; reason?: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Neither actual command completion nor close"));
      }, 10000);
      function cleanup() {
        clearTimeout(timer);
        client.ws.off("message", onMessage);
        client.ws.off("close", onClose);
      }
      function onMessage(data: unknown) {
        if (String(data).includes(" PONG ") && String(data).includes(marker)) {
          cleanup();
          resolve({ kind: "completed" });
        }
      }
      function onClose(code: number, reason: Buffer) {
        cleanup();
        resolve({ kind: "closed", code, reason: reason.toString() });
      }
      client.ws.on("message", onMessage);
      client.ws.once("close", onClose);
      client.send(`${text}\r\nPING :${marker}`);
    },
  );
}
async function budget(f: ResourceFixture, id: string) {
  return (await f.rows("request_limits")).find((row) => row.key === `irc-targets:${id}`);
}
async function accountSetup() {
  const f = await resourceResidualFixture();
  const alice = await f.actor("alice"),
    bob = await f.actor("bob"),
    charlie = await f.actor("charlie");
  const a = await f.connect(alice),
    c = await f.connect(charlie);
  await join(a, ["#watch", "#p0", "#p1", "#p2", "#barrier"]);
  await join(c, ["#unrelated", "#barrier"]);
  await wire(a, "MODE #watch +s", / MODE #watch \+s/);
  await post(f, charlie, "#unrelated", "resource-independent-sentinel");
  const streams = await Promise.all([alice, charlie].map((who) => f.event(who)));
  async function barrier() {
    const marker = `resource-barrier-${randomUUID()}`;
    const live = [a, c].map((client) => client.waitForNewLine((line) => line.includes(marker)));
    await post(f, alice, "#barrier", marker);
    await Promise.all(live);
    await eventually(
      () => streams.every((s) => s.lines.some((line) => line.includes(marker))),
      "independent live IRC and event observers",
    );
  }
  await barrier();
  return { f, alice, bob, charlie, a, c, streams, barrier };
}

it("ABUSE-005 ABUSE-006: concurrent authenticated devices reserve one durable account target budget and reconnect cannot partially create an over-budget batch", async () => {
  const r = await accountSetup();
  const { f, bob, a, c, streams } = r;
  try {
    const one = await f.connect(bob, "bobone"),
      two = await f.connect(bob, "bobtwo");
    const allowed = Array.from({ length: 140 }, (_, i) => `#acct${i}`);
    await join(one, allowed.slice(0, 70));
    await join(two, allowed.slice(70));
    const before = await f.channelState("#unrelated");
    await r.barrier();
    const peerOffset = a.lines.length,
      outsideOffset = c.lines.length,
      eventOffsets = streams.map((s) => s.lines.length);
    const candidates = [
      ["#watch", ...Array.from({ length: 5 }, (_, i) => `#left${i}`)],
      ["#watch", ...Array.from({ length: 5 }, (_, i) => `#right${i}`)],
    ];
    const outcomes = await Promise.all([
      attempt(one, `JOIN ${candidates[0].join(",")}`),
      attempt(two, `JOIN ${candidates[1].join(",")}`),
    ]);
    await r.barrier();
    const persisted = (await f.rows("channel_metadata"))
      .filter((row) => row.key === "canonical_name")
      .map((row) => row.value);
    const accountBudget = await budget(f, bob.account.id);
    const watchJoins = a.lines
      .slice(peerOffset)
      .filter((line) => /:bob(one|two)!.* JOIN #watch/.test(line));
    const reopened = await f.connect(bob, "bobreturn");
    const denied = Array.from({ length: 5 }, (_, i) => `#reconnect${i}`);
    const deniedBefore = await f.rows("channel_metadata");
    const reconnect = await attempt(reopened, `JOIN ${denied.join(",")}`);
    const deniedAfter = await f.rows("channel_metadata");
    await r.barrier();
    const state = await (await f.stub()).resourceState();
    expect(await f.channelState("#unrelated")).toEqual(before);
    expect(
      c.lines
        .slice(outsideOffset)
        .some((line) => /#(?:acct|left|right|reconnect|watch)/.test(line)),
    ).toBe(false);
    const deniedEvents = streams.map((s, i) =>
      s.lines.slice(eventOffsets[i]).filter((line) => denied.includes(JSON.parse(line).channelId)),
    );
    await trace("account-concurrency", {
      outcomes,
      reconnect,
      accountBudget,
      allowedCreations: persisted.filter((name) => allowed.includes(name)).length,
      candidateCreations: candidates.map((batch) =>
        batch.slice(1).filter((name) => persisted.includes(name)),
      ),
      watchJoinFrames: watchJoins.length,
      reconnectCreations: deniedAfter.filter(
        (row) => row.key === "canonical_name" && denied.includes(row.value),
      ),
      deniedEventCounts: deniedEvents.map((rows) => rows.length),
    });
    // Collect actual old-build creations/events before policy assertions.
    expect.soft(outcomes.filter((o) => o.kind === "completed")).toHaveLength(1);
    expect.soft(outcomes.filter((o) => o.reason === "Excess Flood")).toHaveLength(1);
    expect.soft(watchJoins).toHaveLength(1);
    expect.soft(accountBudget?.count).toBe(146);
    expect.soft(reconnect).toEqual({ kind: "closed", code: 1000, reason: "Excess Flood" });
    expect.soft(deniedAfter).toEqual(deniedBefore);
    for (const events of deniedEvents) expect.soft(events).toEqual([]);
    expect(persisted.filter((name) => allowed.includes(name))).toHaveLength(140);
    for (const [i, outcome] of outcomes.entries()) {
      const actual = candidates[i].slice(1).filter((name) => persisted.includes(name));
      expect.soft(actual).toHaveLength(outcome.kind === "completed" ? 5 : 0);
    }
    if (reconnect.kind === "closed")
      expect(state.sessions.some((s: any) => s.nickname === "bobreturn")).toBe(false);
    await f.stop();
    expect(
      (await f.rows("channel_metadata"))
        .filter((row) => row.key === "canonical_name")
        .map((row) => row.value),
    ).toEqual(
      [
        ...persisted,
        ...denied.filter((name) =>
          deniedAfter.some((row) => row.key === "canonical_name" && row.value === name),
        ),
      ].sort(),
    );
  } finally {
    await f.dispose();
  }
}, 60000);

it("ABUSE-005 ABUSE-006: account PART reservation denies all targets, JOIN0 still cleans up, and SQLite budget survives recreation until real expiry", async () => {
  const r = await accountSetup();
  const { f, bob, alice, charlie, a } = r;
  try {
    const one = await f.connect(bob, "bobone"),
      two = await f.connect(bob, "bobtwo");
    const channels = ["#p0", "#p1", "#p2"];
    // Real public JOIN requests, including repeated valid targets, each cost one.
    await join(
      one,
      Array.from({ length: 74 }, (_, i) => channels[i % 3]),
    );
    await join(
      two,
      Array.from({ length: 74 }, (_, i) => channels[i % 3]),
    );
    await wire(two, "PING :all-repeated-joins-complete", / PONG .*all-repeated-joins-complete/);
    const unrelated = await f.channelState("#unrelated");
    await r.barrier();
    const offset = a.lines.length;
    const result = await attempt(one, `PART ${channels.join(",")} :aggregate-denied`);
    await r.barrier();
    const parts = a.lines.slice(offset).filter((line) => /:bobone!.* PART /.test(line));
    const quits = a.lines
      .slice(offset)
      .filter((line) => /:bobone!.* QUIT :Excess Flood/.test(line));
    const before = await budget(f, bob.account.id);
    const survivor = `surviving-device-${randomUUID()}`,
      live = a.waitForNewLine((line) => line.includes(survivor));
    two.send(`NOTICE #p0 :${survivor}`);
    expect(await live).toContain(":bobtwo!bobtwo@");
    expect((await f.rows("messages")).find((row) => row.content === survivor)).toMatchObject({
      sender_id: bob.account.id,
      sender_nick: "bobtwo",
      command: "NOTICE",
    });
    const zeroStart = two.lines.length;
    await wire(two, "JOIN 0", / PART #p2 :Left all channels/);
    expect(
      two.lines.slice(zeroStart).filter((line) => / PART #p\d :Left all channels/.test(line)),
    ).toHaveLength(3);
    expect(await f.channelState("#unrelated")).toEqual(unrelated);
    await trace("account-part-before-recreation", {
      result,
      actualParts: parts.length,
      cleanupQuits: quits.length,
      budget: before,
    });
    expect.soft(result).toEqual({ kind: "closed", code: 1000, reason: "Excess Flood" });
    expect.soft(parts).toEqual([]);
    expect.soft(quits).toHaveLength(1);
    expect.soft(before?.count).toBe(148);
    // An old bundle has no account counter: do not pretend recreation/expiry was reached.
    if (!before) return;
    expect(await budget(f, bob.account.id)).toEqual(before);
    await f.restart();
    expect(await budget(f, bob.account.id)).toEqual(before);
    expect(Date.now()).toBeLessThan(before.reset_at);
    const aa = await f.connect(alice),
      cc = await f.connect(charlie),
      deniedClient = await f.connect(bob, "bobrecreated");
    await join(aa, ["#watch"]);
    await join(cc, ["#unrelated"]);
    const afterRestartControl = await f.channelState("#unrelated");
    const denied = ["#expiry0", "#expiry1", "#expiry2"];
    const stableBefore = await f.rows("channel_metadata");
    expect(await attempt(deniedClient, `JOIN ${denied.join(",")}`)).toEqual({
      kind: "closed",
      code: 1000,
      reason: "Excess Flood",
    });
    expect(await f.rows("channel_metadata")).toEqual(stableBefore);
    expect(await budget(f, bob.account.id)).toEqual(before);
    await wire(
      cc,
      "PING :healthy-during-account-throttle",
      / PONG .*healthy-during-account-throttle/,
    );
    // Real wall-clock expiry; no mutation of timestamps, counters or identity.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, before.reset_at - Date.now() + 30)),
    );
    const renewed = await f.connect(bob, "bobexpired");
    await join(renewed, denied);
    const after = await budget(f, bob.account.id);
    expect(after.count).toBe(3);
    expect(after.reset_at).toBeGreaterThan(before.reset_at);
    const marker = `expiry-healthy-${randomUUID()}`;
    const delivered = renewed.waitForNewLine((line) => line.includes(marker));
    await post(f, bob, denied[0], marker);
    await delivered;
    expect(await f.channelState("#unrelated")).toEqual(afterRestartControl);
    expect(
      (await f.rows("channel_metadata")).filter(
        (row) => row.key === "canonical_name" && denied.includes(row.value),
      ),
    ).toHaveLength(3);
    await trace("account-expiry", {
      before,
      after,
      recreatedDenial: true,
      realExpiry: true,
      successfulCreations: denied,
    });
  } finally {
    await f.dispose();
  }
}, 60000);

for (const mode of ["frames", "aggregate-bytes"] as const) {
  it(`WS-021 ABUSE-012: independent ${mode === "frames" ? "4096 waiting-frame" : "16MiB aggregate-byte"} queue bound holds real authorization RPCs while unrelated clients progress`, async () => {
    const f = await resourceResidualFixture();
    let accounts: any;
    try {
      const alice = await f.actor("alice"),
        bob = await f.actor("bob"),
        charlie = await f.actor("charlie"),
        outside = await f.actor("outside");
      const recipients = [bob];
      if (mode === "aggregate-bytes")
        recipients.push(await f.actor("carol"), await f.actor("evan"));
      const producers = [await f.connect(alice)];
      if (mode === "frames") producers.push(await f.connect(alice, "alicedevice"));
      const blocked = await Promise.all(recipients.map((who) => f.connect(who)));
      const healthy = await f.connect(charlie),
        independent = await f.connect(outside);
      const channels = Array.from({ length: 32 }, (_, i) => `#q${String(i).padStart(2, "0")}`);
      for (const client of [...producers, ...blocked, healthy]) await join(client, channels);
      for (const channel of channels)
        await wire(producers[0], `MODE ${channel} +s`, new RegExp(` MODE ${channel} \\+s`));
      for (const client of blocked) await wire(client, "CAP REQ :message-tags", / CAP .* ACK /);
      await join(independent, ["#unrelated"]);
      await post(f, outside, "#unrelated", "queue-independent-sentinel");
      let outsideState = await f.channelState("#unrelated");
      const event = await f.event(outside),
        healthyEvent = await f.event(charlie);
      const outsideOffset = independent.lines.length,
        blockedOffsets = blocked.map((client) => client.lines.length);
      const session = await f.stub();
      await eventually(
        async () => (await session.resourceState()).total === 0,
        "setup queues drained",
      );
      await session.resourceWatch(recipients.map((who) => who.username));
      accounts = await f.stub("ACCOUNTS");
      await accounts.resourceHold(recipients.map((who) => who.username));
      const closing = blocked.map((client) => {
        const p = closed(client.ws, 60000);
        void p.catch(() => {});
        return p;
      });
      let commands = 0,
        submittedBytes = 0,
        targetOperations = 0;
      async function send(targets: string[], padding = false) {
        const marker = `queue-residual-${mode}-${commands++}`;
        const content = `${marker} ${"x".repeat(padding ? 120 : 0)}`;
        const input = `${padding ? `@+padding=${"x".repeat(3800)} ` : ""}NOTICE ${targets.join(",")} :${content}`;
        expect(Buffer.byteLength(input.split("NOTICE ")[1])).toBeLessThan(510);
        const producer = producers[(commands - 1) % producers.length];
        const arrived = healthy.waitForNewLine(
          (line) => line.includes(` NOTICE ${targets[0]} `) && line.includes(marker),
        );
        const commandDone = producer.waitForNewLine(
          (line) => line.includes(` PONG `) && line.includes(`queue-send-${marker}`),
        );
        producer.send(input);
        producer.send(`PING :queue-send-${marker}`);
        submittedBytes += Buffer.byteLength(`${input}\r\n`);
        targetOperations += targets.length;
        await Promise.all([arrived, commandDone]);
      }
      const liveMarker = `queue-live-${randomUUID()}`;
      async function proveLiveEventProgress() {
        await post(f, charlie, channels[0], liveMarker);
        await eventually(
          () => healthyEvent.lines.some((line) => line.includes(liveMarker)),
          "healthy real-time recipient while independent authorization RPCs are held",
        );
      }
      if (mode === "frames") {
        await send(channels.slice(0, 1));
        await eventually(
          async () => (await accounts.resourceAttempts()).bob === 1,
          "real first delivery authorization held",
        );
        await proveLiveEventProgress();
        outsideState = await f.channelState("#unrelated");
        // The independent progress marker adds one real queued frame alongside the first Notice.
        for (let i = 0; i < 127; i++) await send(channels);
        await send(channels.slice(0, 31));
        const atLimit = (await session.resourceState()).observed.bob;
        expect(atLimit.accepted).toBe(4097); // one in-flight frame plus4096 waiting
        expect(atLimit.peakWaitingFrames).toBe(4096);
        expect(atLimit.rejected).toBe(0);
        await send(channels.slice(0, 1));
      } else {
        // At most64 legal, bounded frames; their32 distinct targets broadcast to
        // three authenticated held recipients (never a fabricated sendLine call).
        for (let i = 0; i < 64 && blocked.every((client) => client.ws.readyState === 1); i++) {
          await send(channels, true);
          if (i === 0)
            await eventually(
              async () => Object.keys(await accounts.resourceAttempts()).length === 3,
              "three genuine authorization RPCs held",
            );
          if (i === 0) {
            await proveLiveEventProgress();
            outsideState = await f.channelState("#unrelated");
          }
        }
      }
      await eventually(
        () => blocked.some((client) => client.ws.readyState !== 1),
        "actual overflow closes affected client",
      );
      const state = await session.resourceState();
      const rejectedNames = recipients
        .filter((who) => state.observed[who.username].rejected > 0)
        .map((who) => who.username);
      for (const [i, who] of recipients.entries()) {
        const observed = state.observed[who.username];
        expect(observed.peakBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(observed.peakWaitingFrames).toBeLessThanOrEqual(4096);
        expect(
          blocked[i].lines
            .slice(blockedOffsets[i])
            .some((line) => line.includes("queue-residual-")),
        ).toBe(false);
        if (!observed.rejected) continue;
        expect(await closing[i]).toEqual({ code: 1008, reason: "Output queue limit reached" });
        const first = observed.firstReject;
        if (mode === "frames") {
          expect(observed.accepted).toBe(4097);
          expect(observed.rejected).toBe(1);
          expect(first.frames).toBe(4096);
          expect(first.bytes + first.nextBytes).toBeLessThan(8 * 1024 * 1024);
          expect(first.total + first.nextBytes).toBeLessThan(16 * 1024 * 1024);
        } else {
          expect(first.frames).toBeLessThan(4096);
          expect(first.bytes + first.nextBytes).toBeLessThan(8 * 1024 * 1024);
          expect(first.total).toBeLessThanOrEqual(16 * 1024 * 1024);
          expect(first.total + first.nextBytes).toBeGreaterThan(16 * 1024 * 1024);
        }
      }
      expect(rejectedNames.length).toBeGreaterThan(0);
      expect(state.peakTotal).toBeLessThanOrEqual(16 * 1024 * 1024);
      if (mode === "aggregate-bytes")
        expect(state.peakTotal).toBeGreaterThan(16 * 1024 * 1024 - 16384);
      expect(await accounts.resourceAttempts()).toEqual(
        Object.fromEntries(recipients.map((who) => [who.username, 1])),
      );
      await wire(independent, "PING :healthy-while-held", / PONG .*healthy-while-held/);
      expect((await f.request("/api/v1/channels/%23q00/messages", outside)).status).toBe(403);
      await wire(independent, "PING :outside-private-window", / PONG .*outside-private-window/);
      expect(event.lines.some((line) => /queue-residual-|queue-live-/.test(line))).toBe(false);
      expect(
        independent.lines
          .slice(outsideOffset)
          .some((line) => /queue-residual-|queue-live-/.test(line)),
      ).toBe(false);
      expect(await f.channelState("#unrelated")).toEqual(outsideState);
      await trace(`queue-${mode}`, {
        commands,
        submittedBytes,
        targetOperations,
        rejectedNames,
        observed: state.observed,
        peakTotal: state.peakTotal,
        scope: "application queues only; no native/provider memory ceiling claim",
      });
      await accounts.resourceRelease();
      await eventually(
        async () => (await session.resourceState()).total === 0,
        "all held queue bytes released",
      );
      const messages = (await f.rows("messages")).filter((row) =>
        row.content.startsWith(`queue-residual-${mode}-`),
      );
      expect(messages).toHaveLength(targetOperations);
      expect(
        messages.every((row) => row.sender_id === alice.account.id && row.command === "NOTICE"),
      ).toBe(true);
      await f.restart();
      expect(
        (await f.rows("messages")).filter((row) =>
          row.content.startsWith(`queue-residual-${mode}-`),
        ),
      ).toHaveLength(targetOperations);
      const restored = await f.connect(bob),
        good = await f.connect(charlie);
      await join(restored, [channels[0]]);
      await join(good, [channels[0]]);
      const marker = `after-queue-${randomUUID()}`,
        delivered = restored.waitForNewLine((line) => line.includes(marker));
      await post(f, charlie, channels[0], marker);
      await delivered;
      expect((await (await f.stub()).resourceState()).total).toBe(0);
    } finally {
      if (accounts) {
        try {
          await accounts.resourceRelease();
        } catch {
          // Recreation invalidates the previous runtime's diagnostic stub.
        }
      }
      await f.dispose();
    }
  }, 120000);
}
