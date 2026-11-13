import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { closed, createAbuseFixture, eventually } from "../helpers/abuse-gap-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

async function trace(name: string, value: unknown) {
  const path = process.env.FLARC_MULTITARGET_TRACE;
  if (!path) return;
  const previous = await readFile(path, "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  await writeFile(path, JSON.stringify({ ...previous, [name]: value }, null, 2));
}
async function command(c: TestIRCClient, text: string, marker: string) {
  const done = c.waitForNewLine((line) => line.includes(marker));
  c.send(text);
  await done;
}
async function join(c: TestIRCClient, channel: string) {
  await command(c, `JOIN ${channel}`, ` ${channel} :End of`);
}
// Observe either actual completion or actual flood close, so the old bundle can
// finish the complete mutation/persistence measurement before policy assertions.
async function attempt(c: TestIRCClient, commands: string) {
  const marker = randomUUID();
  return new Promise<{ kind: string; reason?: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Neither PONG nor close"));
    }, 15000);
    function cleanup() {
      clearTimeout(timer);
      c.ws.off("message", message);
      c.ws.off("close", close);
    }
    function message(data: unknown) {
      if (String(data).includes(" PONG ") && String(data).includes(marker)) {
        cleanup();
        resolve({ kind: "completed" });
      }
    }
    function close(_code: number, reason: Buffer) {
      cleanup();
      resolve({ kind: "closed", reason: reason.toString() });
    }
    c.ws.on("message", message);
    c.ws.once("close", close);
    c.send(`${commands}\r\nPING :${marker}`);
  });
}
async function setup() {
  const f = await createAbuseFixture();
  const alice = await f.actor("alice"),
    bob = await f.actor("bob"),
    charlie = await f.actor("charlie");
  const a = await f.connect(alice),
    c = await f.connect(charlie);
  await join(a, "#watch");
  await join(c, "#unrelated");
  for (const client of [a, c]) await join(client, "#barrier");
  const seeded = await f.request("/api/v1/channels/%23unrelated/messages", charlie, "POST", {
    content: "fanout-independent-sentinel",
  });
  expect(seeded.status).toBe(201);
  const sentinel = ((await seeded.json()) as any).message;
  const streams = await Promise.all([alice, charlie].map((who) => f.event(who)));
  expect(streams.map((s) => s.status)).toEqual([101, 101]);
  async function barrier() {
    const marker = `fanout-barrier-${randomUUID()}`;
    const deliveries = [a, c].map((client) =>
      client.waitForNewLine((line) => line.includes(marker)),
    );
    const result = await f.request("/api/v1/channels/%23barrier/messages", alice, "POST", {
      content: marker,
    });
    expect(result.status).toBe(201);
    await Promise.all(deliveries);
    await eventually(
      () => streams.every((s) => s.lines.some((line) => line.includes(marker))),
      "healthy fanout observers",
    );
  }
  return { f, alice, bob, charlie, a, c, streams, sentinel, barrier };
}

it("ABUSE-005 ABUSE-006: comma JOIN fanout reserves the remaining budget before creating a batch, while valid labeled fanout and JOIN0 retain semantics", async () => {
  const r = await setup();
  const { f, a, bob, alice, charlie, c, streams } = r;
  try {
    for (const channel of ["#controlone", "#controltwo"]) await join(a, channel);
    const b = await f.connect(bob);
    await command(b, "CAP REQ :message-tags labeled-response batch", " CAP bob ACK ");
    const start = b.lines.length;
    await command(b, "@label=fanout JOIN #controlone,,#controltwo", " BATCH -");
    const replies = b.lines.slice(start);
    const open = replies.find(
      (line) => line.includes(" BATCH +") && line.includes("labeled-response"),
    );
    expect(open).toContain("label=fanout");
    const batchId = open!.match(/ BATCH \+(\S+)/)![1];
    expect(
      replies.filter((line) => line.includes(" 366 ") && line.includes(`batch=${batchId}`)),
    ).toHaveLength(2);
    await command(
      b,
      "PART #controlone,,#controltwo :valid-parts",
      " PART #controltwo :valid-parts",
    );
    await command(b, "JOIN #controlone,#controltwo", " #controltwo :End of");
    const zeroStart = b.lines.length;
    await command(b, "@label=leaveall JOIN 0", " ACK");
    expect(
      b.lines
        .slice(zeroStart)
        .filter((line) => line.includes(" PART ") && line.includes("Left all channels")),
    ).toHaveLength(2);
    expect(
      b.lines
        .slice(zeroStart)
        .some((line) => line.includes("label=leaveall") && line.includes(" ACK")),
    ).toBe(true);
    await r.barrier();
    const unrelated = JSON.parse(
      JSON.stringify(await (await f.channel("#unrelated")).abuseState()),
    );
    const watch = JSON.parse(JSON.stringify(await (await f.channel("#watch")).abuseState()));
    const allowed = Array.from({ length: 120 }, (_, i) => `#fanout${i}`);
    const denied = ["#watch", ...Array.from({ length: 39 }, (_, i) => `#fanout${120 + i}`)];
    const targets = [...allowed, ...denied];
    const allowedCommands = Array.from(
      { length: 6 },
      (_, i) => `JOIN ${allowed.slice(i * 20, (i + 1) * 20).join(",")}`,
    );
    const denialCommand = `JOIN ${denied.join(",")}`;
    expect(allowedCommands.every((line) => line.length <= 510)).toBe(true);
    expect(denialCommand.length).toBeLessThan(510);
    const bo = b.lines.length,
      ao = a.lines.length,
      co = c.lines.length,
      eo = streams.map((s) => s.lines.length);
    const prefixOutcome = await attempt(b, allowedCommands.join("\r\n"));
    expect(prefixOutcome).toEqual({ kind: "completed" });
    const committedPrefix = b.lines.slice(bo).filter((line) => /:bob!.* JOIN #fanout/.test(line));
    expect(committedPrefix).toHaveLength(120);
    const prefixKnown = (await (await f.stub("SESSION")).abuseState()).known
      .filter((row: any) => row.canonical_channel.startsWith("#fanout"))
      .map((row: any) => row.canonical_channel)
      .sort();
    expect(prefixKnown).toEqual(allowed.slice().sort());
    const outcome = await attempt(b, denialCommand);
    await r.barrier();
    const state = await (await f.stub("SESSION")).abuseState();
    const created = state.known
      .filter((row: any) => row.canonical_channel.startsWith("#fanout"))
      .map((row: any) => row.canonical_channel)
      .sort();
    const observedJoins = b.lines.slice(bo).filter((line) => /:bob!.* JOIN /.test(line));
    const peerJoins = a.lines.slice(ao).filter((line) => /:bob!.* JOIN #watch/.test(line));
    const targetEvents = streams.map((s, i) =>
      s.lines.slice(eo[i]).filter((line) => denied.includes(JSON.parse(line).channelId)),
    );
    const actualWatch = JSON.parse(JSON.stringify(await (await f.channel("#watch")).abuseState()));
    expect(await (await f.channel("#unrelated")).abuseState()).toEqual(unrelated);
    expect(
      c.lines
        .slice(co)
        .some((line) => line.includes("#fanout") || /:bob!.* JOIN #watch/.test(line)),
    ).toBe(false);
    if (outcome.kind === "completed") {
      const stopped = closed(b.ws);
      b.send("QUIT :baseline-probe-complete");
      await stopped;
    }
    await f.stop();
    const persisted = (await f.snapshot("channel_metadata"))
      .filter((row) => row.key === "canonical_name" && row.value.startsWith("#fanout"))
      .map((row) => row.value)
      .sort();
    expect(persisted).toEqual(created);
    expect(
      (await f.snapshot("messages")).some(
        (row) => row.id === r.sentinel.id && row.content === "fanout-independent-sentinel",
      ),
    ).toBe(true);
    expect(
      (await f.snapshot("channel_members")).filter((row) => row.user_id === bob.account.id),
    ).toEqual([]);
    await trace("join", {
      outcome,
      requestedTargets: targets.length,
      submittedJoinCommands: allowedCommands.length + 1,
      committedPrefixJoinFrames: committedPrefix.length,
      actualJoinFrames: observedJoins.length,
      peerWatchJoinFrames: peerJoins.length,
      createdChannels: created,
      persistedChannels: persisted,
      targetEventCounts: targetEvents.map((e) => e.length),
    });
    expect.soft(outcome).toEqual({ kind: "closed", reason: "Excess Flood" });
    expect.soft(observedJoins).toHaveLength(120);
    expect.soft(peerJoins).toHaveLength(0);
    expect.soft(created).toEqual(allowed.slice().sort());
    expect.soft(actualWatch).toEqual(watch);
    for (const events of targetEvents) expect.soft(events).toEqual([]);
    await f.restart();
    expect(
      (await (await f.stub("SESSION")).abuseState()).known
        .filter((row: any) => row.canonical_channel.startsWith("#fanout"))
        .map((row: any) => row.canonical_channel)
        .sort(),
    ).toEqual(persisted);
    const healthy = await f.connect(alice);
    await join(healthy, "#watch");
    const renewed = await f.connect(bob);
    await join(renewed, "#watch");
    const marker = `healthy-after-fanout-${randomUUID()}`;
    const delivery = renewed.waitForNewLine((line) => line.includes(marker));
    expect(
      (await f.request("/api/v1/channels/%23watch/messages", alice, "POST", { content: marker }))
        .status,
    ).toBe(201);
    await delivery;
    expect(
      await (await f.request("/api/v1/channels/%23unrelated/messages", charlie)).text(),
    ).toContain("fanout-independent-sentinel");
  } finally {
    await f.dispose();
  }
}, 60000);

it("ABUSE-005: PART fanout reserves all target costs before any PART and keeps independent clients healthy", async () => {
  const r = await setup();
  const { f, a, bob, alice, charlie, streams } = r;
  try {
    const channels = ["#partone", "#parttwo", "#partthree"];
    for (const channel of channels) await join(a, channel);
    await r.barrier();
    const b = await f.connect(bob),
      start = Date.now();
    await command(b, `JOIN ${channels.join(",")}`, " #partthree :End of");
    await r.barrier();
    const generations = await Promise.all(
      channels.map(async (channel) => {
        const info = await f.request(`/api/v1/channels/${encodeURIComponent(channel)}/info`, alice);
        expect(info.status).toBe(200);
        return ((await info.json()) as any).channel.generation as string;
      }),
    );
    const unrelated = JSON.parse(
      JSON.stringify(await (await f.channel("#unrelated")).abuseState()),
    );
    const bo = b.lines.length,
      ao = a.lines.length,
      eo = streams.map((s) => s.lines.length);
    // PASS/NICK/USER=3, three JOIN targets=3, then143 PINGs leaves one of150.
    const pings = Array.from({ length: 143 }, (_, i) => `PING :fill-${i}`);
    const outcome = await attempt(
      b,
      [...pings, `PART ${channels.join(",")} :over-budget`].join("\r\n"),
    );
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(10000);
    await r.barrier();
    const ownParts = b.lines.slice(bo).filter((line) => /:bob!.* PART /.test(line));
    const peerParts = a.lines.slice(ao).filter((line) => /:bob!.* PART /.test(line));
    const quits = a.lines.slice(ao).filter((line) => /:bob!.* QUIT :Excess Flood/.test(line));
    const targetEvents = streams.map((s, i) =>
      s.lines.slice(eo[i]).filter((line) => channels.includes(JSON.parse(line).channelId)),
    );
    const authorizedCleanup = targetEvents[0].map((line) => JSON.parse(line));
    const unrelatedCleanup = targetEvents[1].map((line) => JSON.parse(line));
    const members = await Promise.all(
      channels.map(async (channel) =>
        (await (await f.channel(channel)).abuseState()).members.map((row: any) => row.user_id),
      ),
    );
    expect(await (await f.channel("#unrelated")).abuseState()).toEqual(unrelated);
    await f.stop();
    expect(
      (await f.snapshot("channel_members")).filter((row) => row.user_id === bob.account.id),
    ).toEqual([]);
    const persisted = (await f.snapshot("channel_metadata"))
      .filter((row) => row.key === "canonical_name" && channels.includes(row.value))
      .map((row) => row.value)
      .sort();
    expect(persisted).toEqual(channels.slice().sort());
    await trace("part", {
      outcome,
      elapsedMs,
      pingFrames: b.lines.slice(bo).filter((line) => line.includes(" PONG ")).length,
      requestedParts: 3,
      actualPartFrames: ownParts.length,
      peerPartFrames: peerParts.length,
      cleanupQuitFrames: quits.length,
      persistedChannels: persisted,
    });
    expect.soft(outcome).toEqual({ kind: "closed", reason: "Excess Flood" });
    expect.soft(ownParts).toHaveLength(0);
    expect.soft(peerParts).toHaveLength(0);
    expect.soft(quits).toHaveLength(1);
    expect(unrelatedCleanup).toEqual([]);
    authorizedCleanup.sort((left, right) => left.channelId.localeCompare(right.channelId));
    expect(authorizedCleanup.map((event) => event.channelId)).toEqual(channels.slice().sort());
    for (const [index, event] of authorizedCleanup.entries()) {
      const channel = channels.slice().sort()[index];
      const generation = generations[channels.indexOf(channel)];
      expect(event).toMatchObject({
        type: "channel.member_left",
        channelId: channel,
        channelGeneration: generation,
        operationId: expect.any(String),
        eventId: `membership:${generation}:${event.operationId}:${bob.account.id}:false`,
        data: {
          accountId: bob.account.id,
          joined: false,
          generation,
          revision: expect.any(Number),
        },
      });
      expect(event.ownerId).toBeUndefined();
    }
    for (const ids of members) expect(ids).toEqual([alice.account.id]);
    await f.restart();
    const healthy = await f.connect(alice);
    await join(healthy, "#partone");
    expect(
      (
        await f.request("/api/v1/channels/%23partone/messages", alice, "POST", {
          content: "healthy-after-part-budget",
        })
      ).status,
    ).toBe(201);
    expect(
      await (await f.request("/api/v1/channels/%23unrelated/messages", charlie)).text(),
    ).toContain("fanout-independent-sentinel");
  } finally {
    await f.dispose();
  }
}, 60000);
