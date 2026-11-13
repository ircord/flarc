import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "../helpers/event-reader";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import { TestIRCClient } from "../helpers/miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function ticket(f: Fixture, actor: MatrixActor) {
  const response = await f.request("/api/v1/auth/events-ticket", actor, "POST");
  expect(response.status).toBe(200);
  return ((await response.json()) as { ticket: string }).ticket;
}
async function upgrade(f: Fixture, query: string, origin?: string) {
  const ws = new WebSocket(
    `ws://${f.server.url.host}/api/v1/events${query}`,
    ["flarc.events.v2"],
    origin ? { origin } : {},
  );
  const lines: string[] = [];
  ws.on("message", (data) => {
    if (!isReaderControl(ws, data)) lines.push(data.toString());
  });
  const status = await new Promise<number>((resolve, reject) => {
    ws.once("open", () => resolve(101));
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
    });
    ws.once("error", reject);
  });
  return { ws, lines, status };
}
async function waitFor(lines: string[], marker: string) {
  for (let i = 0; i < 400; i++) {
    if (lines.some((line) => line.includes(marker))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Missing event ${marker}`);
}
async function join(client: TestIRCClient, channel: string) {
  const done = client.waitForNewLine((line) => line.includes(" 366 ") && line.includes(channel));
  client.send(`JOIN ${channel}`);
  await done;
}
async function post(f: Fixture, actor: MatrixActor, channel: string, content: string) {
  const response = await f.request(
    `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
    actor,
    "POST",
    { content },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as any).message;
}

for (const attempts of [1, 8]) {
  it(`[WS-002 WS-004 WS-005 WS-007 ABUSE-016] ${attempts} redemption attempts across full runtime recreation retain the ticket principal`, async () => {
    const f = await createMatrixFixture();
    const sockets: WebSocket[] = [];
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      await join(a, "#vault");
      const mode = a.waitForNewLine((line) => line.includes(" MODE #vault +s"));
      a.send("MODE #vault +s");
      await mode;
      await join(b, "#vault");
      await join(c, "#unrelated");
      const unrelated = await post(f, charlie, "#unrelated", `sentinel-${randomUUID()}`);
      const protectedMessage = await post(f, alice, "#vault", `protected-${randomUUID()}`);
      const issued = await ticket(f, alice);
      await f.stop();
      const beforeTickets = (await f.snapshot("event_tickets")).flat();
      expect(beforeTickets).toContainEqual(
        expect.objectContaining({ ticket_hash: hash(issued), session_hash: hash(alice.token) }),
      );
      const beforeMessages = (await f.snapshot("messages")).flat();
      const beforeSessions = (await f.snapshot("api_sessions")).flat();
      await f.restart(); // Disposes and creates an entire workerd runtime, not hibernation.
      const aa = await f.connect(alice),
        bb = await f.connect(bob),
        cc = await f.connect(charlie);
      for (const [client, channel] of [
        [aa, "#vault"],
        [bb, "#vault"],
        [cc, "#unrelated"],
        [aa, "#barrier"],
        [bb, "#barrier"],
        [cc, "#barrier"],
      ] as const)
        await join(client, channel);
      const forged = await upgrade(
        f,
        `?ticket=${issued}&username=charlie&accountId=${charlie.account.id}`,
      );
      sockets.push(forged.ws);
      expect(forged.status).toBe(400);
      expect(forged.lines).toEqual([]);
      expect(await liveRows(f, "event_tickets")).toContainEqual(
        expect.objectContaining({ ticket_hash: hash(issued), session_hash: hash(alice.token) }),
      );
      const candidates = await Promise.all(
        Array.from({ length: attempts }, () => upgrade(f, `?ticket=${issued}`)),
      );
      sockets.push(...candidates.map((candidate) => candidate.ws));
      expect(candidates.filter((candidate) => candidate.status === 101)).toHaveLength(1);
      expect(candidates.filter((candidate) => candidate.status === 401)).toHaveLength(attempts - 1);
      const winner = candidates.find((candidate) => candidate.status === 101)!;
      const bobStream = await upgrade(f, `?ticket=${await ticket(f, bob)}`);
      const outsider = await upgrade(f, `?ticket=${await ticket(f, charlie)}`);
      sockets.push(bobStream.ws, outsider.ws);
      expect([bobStream.status, outsider.status]).toEqual([101, 101]);
      const secret = `vault-${randomUUID()}`;
      const delivered = bb.waitForNewLine((line) => line.includes(secret));
      const sent = await post(f, alice, "#vault", secret);
      await Promise.all([
        waitFor(winner.lines, secret),
        waitFor(bobStream.lines, secret),
        delivered,
      ]);
      for (const stream of [winner, bobStream]) {
        const event = stream.lines
          .map((line) => JSON.parse(line))
          .find((item) => item.data?.content === secret);
        expect(event).toMatchObject({
          type: "message.created",
          channelId: "#vault",
          messageId: sent.id,
          data: { id: sent.id, senderId: alice.account.id, content: secret },
        });
      }
      const barrier = `barrier-${randomUUID()}`;
      const outsideDelivery = cc.waitForNewLine((line) => line.includes(barrier));
      await post(f, alice, "#barrier", barrier);
      await Promise.all([
        waitFor(winner.lines, barrier),
        waitFor(bobStream.lines, barrier),
        waitFor(outsider.lines, barrier),
        outsideDelivery,
      ]);
      expect(outsider.lines.join("\n")).not.toContain(secret);
      expect(cc.lines.join("\n")).not.toContain(secret);
      for (const loser of candidates.filter((candidate) => candidate.status !== 101))
        expect(loser.lines).toEqual([]);
      expect((await f.request("/api/v1/channels/%23vault/messages", charlie)).status).toBe(403);
      for (const socket of sockets) socket.terminate();
      await f.stop();
      expect((await f.snapshot("event_tickets")).flat()).not.toContainEqual(
        expect.objectContaining({ ticket_hash: hash(issued) }),
      );
      expect((await f.snapshot("api_sessions")).flat()).toEqual(beforeSessions);
      const afterMessages = (await f.snapshot("messages")).flat() as any[];
      for (const row of beforeMessages) expect(afterMessages).toContainEqual(row);
      expect(afterMessages).toContainEqual(
        expect.objectContaining({ id: unrelated.id, sender_id: charlie.account.id }),
      );
      expect(afterMessages).toContainEqual(
        expect.objectContaining({ id: protectedMessage.id, sender_id: alice.account.id }),
      );
      expect(afterMessages).toContainEqual(
        expect.objectContaining({ id: sent.id, content: secret, sender_id: alice.account.id }),
      );
      await f.restart();
      const replay = await upgrade(f, `?ticket=${issued}`);
      sockets.push(replay.ws);
      expect(replay.status).toBe(401);
      expect(replay.lines).toEqual([]);
      const fresh = await upgrade(f, `?ticket=${await ticket(f, alice)}`);
      sockets.push(fresh.ws);
      expect(fresh.status).toBe(101);
      const restored = await f.connect(alice);
      await join(restored, "#vault");
      const marker = `restored-${randomUUID()}`;
      await post(f, alice, "#vault", marker);
      await waitFor(fresh.lines, marker);
    } finally {
      for (const socket of sockets) socket.terminate();
      await f.dispose();
    }
  }, 60000);
}

// Read-only inspection while live observers remain connected across the denial window.
async function liveRows(f: Fixture, table: string): Promise<any[]> {
  async function files(directory: string): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(directory, { withFileTypes: true })
        ).map((entry) =>
          entry.isDirectory()
            ? files(path.join(directory, entry.name))
            : Promise.resolve(
                entry.name.endsWith(".sqlite") ? [path.join(directory, entry.name)] : [],
              ),
        ),
      )
    ).flat();
  }
  const rows: any[] = [];
  for (const file of await files(f.directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
        rows.push(...db.prepare(`SELECT * FROM ${table}`).all());
    } finally {
      db.close();
    }
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

it("[WS-001 WS-006 WS-016 WS-023] endpoint and origin denials remain isolated across full runtime recreation", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  const pretenders: TestIRCClient[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await join(a, "#vault");
    const mode = a.waitForNewLine((line) => line.includes(" MODE #vault +s"));
    a.send("MODE #vault +s");
    await mode;
    await join(b, "#vault");
    await join(c, "#unrelated");
    const protectedMessage = await post(f, alice, "#vault", `protected-${randomUUID()}`);
    const unrelated = await post(f, charlie, "#unrelated", `sentinel-${randomUUID()}`);

    async function exercise(phase: string, clients: [TestIRCClient, TestIRCClient, TestIRCClient]) {
      const [, peer, outsiderIrc] = clients;
      for (const client of clients) await join(client, "#barrier");
      const observers = await Promise.all(
        [alice, bob, charlie].map(async (actor) => upgrade(f, `?ticket=${await ticket(f, actor)}`)),
      );
      sockets.push(...observers.map((stream) => stream.ws));
      expect(observers.map((stream) => stream.status)).toEqual([101, 101, 101]);
      const issued = await ticket(f, alice);
      async function barrier(marker: string) {
        const deliveries = clients.map((client) =>
          client.waitForNewLine((line) => line.includes(marker)),
        );
        const message = await post(f, alice, "#barrier", marker);
        await Promise.all([
          ...deliveries,
          ...observers.map((stream) => waitFor(stream.lines, marker)),
        ]);
        return message;
      }
      await barrier(`before-${phase}-${randomUUID()}`);
      const ircOffsets = clients.map((client) => client.lines.length);
      const eventOffsets = observers.map((stream) => stream.lines.length);
      const beforeMessages = await liveRows(f, "messages");
      const beforeSessions = await liveRows(f, "api_sessions");
      const beforeTickets = await liveRows(f, "event_tickets");
      expect(beforeTickets).toEqual([
        expect.objectContaining({ ticket_hash: hash(issued), session_hash: hash(alice.token) }),
      ]);
      const irc = new TestIRCClient(`${f.server.wsUrl}?ticket=${issued}`);
      pretenders.push(irc);
      await irc.connect();
      irc.send(`NICK Pretender${phase}\r\nUSER pretender 0 * :No identity\r\nJOIN #vault`);
      await irc.waitForNumeric(451);
      await f.barrier(irc);
      expect(
        irc.lines.some((line) => line.includes(" 001 ") || line.includes(" JOIN #vault")),
      ).toBe(false);
      for (const query of [
        "",
        `?token=${alice.token}`,
        `?authorization=${alice.token}`,
        "?ticket=invalid",
      ]) {
        const denied = await upgrade(f, query);
        sockets.push(denied.ws);
        expect(denied.status).toBe(401);
        expect(denied.lines).toEqual([]);
      }
      const foreign = await upgrade(f, `?ticket=${issued}`, "https://untrusted.invalid");
      sockets.push(foreign.ws);
      expect(foreign.status).toBe(403);
      expect(foreign.lines).toEqual([]);
      const afterMarker = `after-${phase}-${randomUUID()}`;
      const after = await barrier(afterMarker);
      for (const [index, client] of clients.entries())
        expect(
          client.lines.slice(ircOffsets[index]).filter((line) => !line.includes(afterMarker)),
        ).toEqual([]);
      for (const [index, stream] of observers.entries())
        expect(
          stream.lines.slice(eventOffsets[index]).filter((line) => !line.includes(afterMarker)),
        ).toEqual([]);
      expect((await liveRows(f, "messages")).filter((row) => row.id !== after.id)).toEqual(
        beforeMessages,
      );
      expect(await liveRows(f, "api_sessions")).toEqual(beforeSessions);
      expect(await liveRows(f, "event_tickets")).toEqual(beforeTickets);
      const good = await upgrade(f, `?ticket=${issued}`, f.server.url.origin);
      sockets.push(good.ws);
      expect(good.status).toBe(101);
      expect(await liveRows(f, "event_tickets")).toEqual([]);
      expect(await liveRows(f, "api_sessions")).toEqual(beforeSessions);
      const marker = `legitimate-${phase}-${randomUUID()}`;
      const bobDelivery = peer.waitForNewLine((line) => line.includes(marker));
      const message = await post(f, alice, "#vault", marker);
      await Promise.all([
        waitFor(good.lines, marker),
        waitFor(observers[0].lines, marker),
        waitFor(observers[1].lines, marker),
        bobDelivery,
      ]);
      for (const stream of [good, observers[0], observers[1]]) {
        const event = stream.lines
          .map((line) => JSON.parse(line))
          .find((item) => item.data?.content === marker);
        expect(event).toMatchObject({
          type: "message.created",
          channelId: "#vault",
          messageId: message.id,
          data: { id: message.id, senderId: alice.account.id, content: marker },
        });
      }
      await barrier(`control-${phase}-${randomUUID()}`);
      expect(observers[2].lines.join("\n")).not.toContain(marker);
      expect(outsiderIrc.lines.join("\n")).not.toContain(marker);
      expect(irc.lines.join("\n")).not.toContain(marker);
      expect(await liveRows(f, "messages")).toContainEqual(
        expect.objectContaining({ id: protectedMessage.id, sender_id: alice.account.id }),
      );
      expect(await liveRows(f, "messages")).toContainEqual(
        expect.objectContaining({ id: unrelated.id, sender_id: charlie.account.id }),
      );
      irc.close();
      for (const stream of observers) stream.ws.terminate();
      good.ws.terminate();
    }
    await exercise("first", [a, b, c]);
    await f.restart(); // Complete runtime disposal and recreation, not socket hibernation.
    const aa = await f.connect(alice),
      bb = await f.connect(bob),
      cc = await f.connect(charlie);
    await join(aa, "#vault");
    await join(bb, "#vault");
    await join(cc, "#unrelated");
    await exercise("restart", [aa, bb, cc]);
  } finally {
    for (const irc of pretenders) irc.close();
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
}, 60000);
