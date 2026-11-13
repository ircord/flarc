import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "../helpers/event-reader";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
async function stream(f: Fixture, actor: MatrixActor) {
  const res = await f.request("/api/v1/auth/events-ticket", actor, "POST");
  expect(res.status).toBe(200);
  const ticket = ((await res.json()) as any).ticket;
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`, [
    "flarc.events.v2",
  ]);
  const lines: string[] = [];
  ws.on("message", (data) => {
    if (!isReaderControl(ws, data)) lines.push(data.toString());
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  async function until(marker: string) {
    for (let i = 0; i < 400; i++) {
      if (lines.some((line) => line.includes(marker))) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Missing event barrier: ${marker}`);
  }
  return { ws, lines, until };
}
async function join(client: TestIRCClient, channel: string) {
  const joined = client.waitForNewLine((line) => line.includes(" 366 ") && line.includes(channel));
  client.send(`JOIN ${channel}`);
  await joined;
}
async function capability(client: TestIRCClient) {
  const ack = client.waitForNewLine((line) => line.includes(" CAP ") && line.includes(" ACK "));
  client.send("CAP REQ :message-tags echo-message draft/message-redaction batch chathistory");
  await ack;
}
async function sendDm(
  sender: TestIRCClient,
  recipient: TestIRCClient,
  target: string,
  marker: string,
) {
  const echo = sender.waitForNewLine((line) => line.includes(` PRIVMSG ${target} :${marker}`));
  const received = recipient.waitForNewLine((line) => line.includes(marker));
  sender.send(`PRIVMSG ${target} :${marker}`);
  const line = await echo;
  await received;
  const id = line.match(/msgid=([^; ]+)/)?.[1];
  expect(id).toBeTruthy();
  return id!;
}
async function barrier(
  f: Fixture,
  actor: MatrixActor,
  clients: TestIRCClient[],
  events: Awaited<ReturnType<typeof stream>>[],
) {
  const marker = `dm-barrier-${randomUUID()}`;
  const response = await f.request("/api/v1/channels/%23dmbarrier/messages", actor, "POST", {
    content: marker,
  });
  expect(response.status).toBe(201);
  await Promise.all([
    ...clients.map((c) => c.waitForLine((l) => l.includes(marker))),
    ...events.map((e) => e.until(marker)),
  ]);
}
const secrets = ["dm-gap-ab-unique", "dm-gap-bc-unique", "dm-gap-ac-unique"];

describe("direct-message privacy gaps", () => {
  it("DM selectors, public event streams, search and revoked sessions remain confined to real participants", async () => {
    const f = await createMatrixFixture();
    const streams: Awaited<ReturnType<typeof stream>>[] = [];
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice, "AliceDevice"),
        b = await f.connect(bob),
        c = await f.connect(charlie),
        r = await f.connect(root);
      for (const client of [a, b, c, r]) {
        await capability(client);
        await join(client, "#dmbarrier");
      }
      for (const actor of [alice, bob, charlie, root]) streams.push(await stream(f, actor));
      const ab = await sendDm(a, b, "bob", secrets[0]);
      const bc = await sendDm(b, c, "charlie", secrets[1]);
      const ac = await sendDm(a, c, "charlie", secrets[2]);
      await barrier(f, alice, [a, b, c, r], streams);
      for (const [index, event] of streams.entries()) {
        for (const [secretIndex, secret] of secrets.entries()) {
          const permitted = [[0, 2], [0, 1], [1, 2], []][index].includes(secretIndex);
          if (permitted) expect(event.lines.join("\n")).toContain(secret);
          else expect(event.lines.join("\n")).not.toContain(secret);
        }
      }
      for (const [client, denied] of [
        [c, secrets[0]],
        [a, secrets[1]],
        [b, secrets[2]],
        [r, secrets[0]],
      ] as const)
        expect(client.lines.join("\n")).not.toContain(denied);
      async function history(actor: MatrixActor, target: string, query = "") {
        return f.request(`/api/v1/dms/${encodeURIComponent(target)}/messages${query}`, actor);
      }
      for (const [actor, target, secret] of [
        [alice, "bob", secrets[0]],
        [bob, "alice", secrets[0]],
        [bob, "charlie", secrets[1]],
        [charlie, "bob", secrets[1]],
        [alice, "charlie", secrets[2]],
        [charlie, "alice", secrets[2]],
      ] as const) {
        const response = await history(actor, target);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain(secret);
      }
      for (const [actor, target, user, secret] of [
        [charlie, "bob", "alice", secrets[0]],
        [alice, "charlie", "bob", secrets[1]],
        [root, "bob", "alice", secrets[0]],
        [charlie, bob.account.id, alice.account.id, secrets[0]],
        [charlie, "bob", "AliceDevice", secrets[0]],
      ] as const) {
        const response = await history(actor, target, `?user=${encodeURIComponent(user)}`);
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain(secret);
      }
      for (const [actor, target, secret, foreign] of [
        [charlie, "bob", secrets[0], ab],
        [alice, "charlie", secrets[1], bc],
        [root, "bob", secrets[0], ab],
        [charlie, bob.account.id, secrets[0], ab],
        [alice, bob.account.id, secrets[0], ab],
      ] as const) {
        const res = await history(actor, target, `?before=${encodeURIComponent(foreign)}`);
        expect(res.status).toBe(200);
        expect(await res.text()).not.toContain(secret);
      }
      for (const ref of [ab, bc, ac]) {
        const response = await history(charlie, "bob", `?after=${encodeURIComponent(ref)}`);
        expect(response.status).toBe(200);
        expect(await response.text()).not.toContain(secrets[0]);
      }
      const nicknameTarget = await history(bob, "AliceDevice");
      expect(nicknameTarget.status).toBe(200);
      expect(await nicknameTarget.text()).not.toContain(secrets[0]);
      for (const target of [ab, bc, ac]) {
        const response = await history(alice, target);
        expect(response.status).toBe(200);
        const text = await response.text();
        for (const secret of secrets) expect(text).not.toContain(secret);
      }
      for (const [target, id, content] of [
        [bob.account.id, ab, secrets[0]],
        [charlie.account.id, ac, secrets[2]],
      ] as const) {
        const response = await history(alice, target);
        expect(response.status).toBe(200);
        const body = (await response.json()) as any;
        expect(body.messages).toContainEqual(expect.objectContaining({ id, content }));
        const forbidden = target === bob.account.id ? secrets[1] : secrets[0];
        expect(JSON.stringify(body)).not.toContain(forbidden);
      }
      const forged = await history(
        alice,
        "bob",
        `?sender=${bob.account.id}&recipient=${charlie.account.id}&user=alice`,
      );
      expect(forged.status).toBe(200);
      const forgedText = await forged.text();
      expect(forgedText).toContain(secrets[0]);
      expect(forgedText).not.toContain(secrets[1]);
      const channelMarker = "dmsearch-public-positive";
      const posted = await f.request("/api/v1/channels/%23dmbarrier/messages", alice, "POST", {
        content: channelMarker,
      });
      expect(posted.status).toBe(201);
      const channelId = ((await posted.json()) as any).message.id as string;
      expect(channelId).toBeTruthy();
      async function searchControls() {
        for (const actor of [alice, charlie, root]) {
          for (const endpoint of ["/api/v1/search", "/api/v1/messages/search"]) {
            const positive = await f.request(`${endpoint}?q=${channelMarker}`, actor);
            expect(positive.status).toBe(200);
            const found = (await positive.json()) as any;
            expect(Array.isArray(found.items)).toBe(true);
            expect(Array.isArray(found.messages)).toBe(true);
            expect(found.count).toBe(found.items.length);
            expect(found.count).toBe(found.messages.length);
            expect(found.items).toContainEqual(
              expect.objectContaining({
                message: expect.objectContaining({
                  id: channelId,
                  content: channelMarker,
                  conversationId: "#dmbarrier",
                }),
              }),
            );
            expect(found.messages).toContainEqual(
              expect.objectContaining({
                id: channelId,
                content: channelMarker,
                channel: "#dmbarrier",
              }),
            );
            for (const [secret, id, author] of [
              [secrets[0], ab, "alice"],
              [secrets[1], bc, "bob"],
              [secrets[2], ac, "alice"],
            ] as const) {
              for (const filter of ["", `&sender=${author}`]) {
                const result = await f.request(`${endpoint}?q=${secret}${filter}`, actor);
                expect(result.status).toBe(200);
                const data = (await result.json()) as any;
                expect(Array.isArray(data.items)).toBe(true);
                expect(Array.isArray(data.messages)).toBe(true);
                expect(data.count).toBe(data.items.length);
                expect(data.count).toBe(data.messages.length);
                expect(JSON.stringify([data.items, data.messages])).not.toContain(secret);
                expect(JSON.stringify([data.items, data.messages])).not.toContain(id);
              }
            }
          }
        }
      }
      await searchControls();
      await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
        name: "FlaRC",
        webSockets: "hibernate",
      });
      const deniedEdit = c.waitForNewLine((line) => line.includes(" 404 "));
      c.send(`@+ircord/edit=${ab} PRIVMSG bob :dm-hibernate-forgery`);
      await deniedEdit;
      const deniedRedact = c.waitForNewLine((line) => line.includes("REDACT_FORBIDDEN"));
      c.send(`REDACT bob ${ab}`);
      await deniedRedact;
      const postHibernate = `dm-after-hibernate-${randomUUID()}`;
      await sendDm(a, b, "bob", postHibernate);
      await barrier(f, alice, [a, b, c, r], streams);
      expect(c.lines.join("\n")).not.toContain(postHibernate);
      expect(a.lines.join("\n")).not.toContain("dm-hibernate-forgery");
      expect(b.lines.join("\n")).not.toContain("dm-hibernate-forgery");
      for (const [index, event] of streams.entries()) {
        if (index < 2) expect(event.lines.join("\n")).toContain(postHibernate);
        else {
          expect(event.lines.join("\n")).not.toContain(postHibernate);
          expect(event.lines.join("\n")).not.toContain(ab);
        }
        expect(event.lines.join("\n")).not.toContain("dm-hibernate-forgery");
      }
      expect((await f.request("/api/v1/auth/logout", bob, "POST")).status).toBe(200);
      expect((await history(bob, "alice")).status).toBe(401);
      const saved = await f.login("bob", bob.password);
      expect((await history(saved, "alice")).status).toBe(200);
      for (const event of streams) event.ws.terminate();
      await f.stop();
      const records = (await f.snapshot("direct_messages")).flat() as any[];
      for (const [id, sender, target, secret] of [
        [ab, alice, bob, secrets[0]],
        [bc, bob, charlie, secrets[1]],
        [ac, alice, charlie, secrets[2]],
      ] as const)
        expect(records).toContainEqual(
          expect.objectContaining({
            id,
            sender_id: sender.account.id,
            target_id: target.account.id,
            content: secret,
          }),
        );
      await f.restart();
      expect((await history(bob, "alice")).status).toBe(401);
      for (const [actor, target, secret] of [
        [alice, "bob", secrets[0]],
        [saved, "charlie", secrets[1]],
        [charlie, "alice", secrets[2]],
      ] as const)
        expect(await (await history(actor, target)).text()).toContain(secret);
      for (const [target, id, content] of [
        [bob.account.id, ab, secrets[0]],
        [charlie.account.id, ac, secrets[2]],
      ] as const) {
        const response = await history(alice, target);
        expect(response.status).toBe(200);
        expect(((await response.json()) as any).messages).toContainEqual(
          expect.objectContaining({ id, content }),
        );
      }
      const denial = await history(root, "bob", "?user=alice");
      expect(denial.status).toBe(403);
      expect(await denial.text()).not.toContain(secrets[0]);
      const restoredClients = await Promise.all([
        f.connect(alice, "AliceDevice"),
        f.connect(charlie),
        f.connect(root),
      ]);
      for (const client of restoredClients) await join(client, "#dmbarrier");
      await searchControls();
    } finally {
      for (const e of streams) e.ws.terminate();
      await f.dispose();
    }
  }, 60000);
});

describe("direct-message mutation ownership", () => {
  it("recipient outsider and administrator cannot edit or redact across conversations; author changes persist", async () => {
    const f = await createMatrixFixture();
    const streams: Awaited<ReturnType<typeof stream>>[] = [];
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      async function connectAll() {
        const clients = await Promise.all([
          f.connect(alice),
          f.connect(bob),
          f.connect(charlie),
          f.connect(root),
        ]);
        for (const client of clients) {
          await capability(client);
          await join(client, "#dmbarrier");
        }
        const events = await Promise.all(
          [alice, bob, charlie, root].map((actor) => stream(f, actor)),
        );
        streams.push(...events);
        return { clients, events };
      }
      let {
        clients: [a, b, c, r],
        events,
      } = await connectAll();
      const id = await sendDm(a, b, "bob", "dm-mutate-original"),
        other1 = await sendDm(b, c, "charlie", "dm-mutate-bc"),
        other2 = await sendDm(a, c, "charlie", "dm-mutate-ac");
      for (const e of events) e.ws.terminate();
      await f.stop();
      const baseline = (await f.snapshot("direct_messages")).flat() as any[];
      const baselineEdits = (await f.snapshot("direct_message_edits")).flat();
      expect(baseline).toHaveLength(3);
      expect(baselineEdits).toEqual([]);
      const conversationId = baseline.find((row) => row.id === id)?.conversation_id;
      expect(conversationId).toBeTruthy();
      await f.restart();
      ({
        clients: [a, b, c, r],
        events,
      } = await connectAll());
      await barrier(f, alice, [a, b, c, r], events);
      const observerStarts = [a, b, c, r].map((client) => client.lines.length);
      for (const [attacker, target, label] of [
        [b, "alice", "recipient"],
        [c, "bob", "outsider"],
        [r, "bob", "admin"],
      ] as const) {
        for (const tag of ["+ircord/edit", "+draft/edit", "+edit"]) {
          const reply = attacker.waitForNewLine((line) => line.includes(" 404 "));
          attacker.send(`@${tag}=${id} PRIVMSG ${target} :denied-${label}-${tag}`);
          await reply;
        }
        const denied = attacker.waitForNewLine((line) => line.includes("REDACT_FORBIDDEN"));
        attacker.send(`REDACT ${target} ${id}`);
        await denied;
      }
      const wrongPairEdit = a.waitForNewLine((line) => line.includes(" 404 "));
      a.send(`@+ircord/edit=${id} PRIVMSG charlie :denied-wrong-pair`);
      await wrongPairEdit;
      const wrongPairRedact = a.waitForNewLine((line) => line.includes("REDACT_FORBIDDEN"));
      a.send(`REDACT charlie ${id}`);
      await wrongPairRedact;
      await barrier(f, alice, [a, b, c, r], events);
      for (const [index, client] of [a, b, c, r].entries()) {
        const lines = client.lines.slice(observerStarts[index]).join("\n");
        expect(lines).not.toContain("denied-recipient-");
        expect(lines).not.toContain("denied-outsider-");
        expect(lines).not.toContain("denied-admin-");
        expect(lines).not.toContain("denied-wrong-pair");
        expect(lines).not.toMatch(/ REDACT (alice|bob|charlie) /);
      }
      for (const event of events) {
        expect(event.lines.join("\n")).not.toMatch(
          /dm-mutate-|denied-(recipient|outsider|admin|wrong-pair)/,
        );
        expect(event.lines.join("\n")).not.toContain(id);
      }
      const ab = await f.request("/api/v1/dms/bob/messages", alice),
        bc = await f.request("/api/v1/dms/charlie/messages", bob),
        ac = await f.request("/api/v1/dms/charlie/messages", alice);
      expect(await ab.text()).toContain("dm-mutate-original");
      expect(await bc.text()).toContain("dm-mutate-bc");
      expect(await ac.text()).toContain("dm-mutate-ac");
      for (const e of events) e.ws.terminate();
      await f.stop();
      const deniedSnapshot = (await f.snapshot("direct_messages")).flat();
      expect(deniedSnapshot).toEqual(baseline);
      expect((await f.snapshot("direct_message_edits")).flat()).toEqual(baselineEdits);
      await f.restart();
      ({
        clients: [a, b, c, r],
        events,
      } = await connectAll());
      const edited = b.waitForNewLine((line) => line.includes("dm-mutate-author-edit"));
      a.send(`@+ircord/edit=${id} PRIVMSG bob :dm-mutate-author-edit`);
      await edited;
      await barrier(f, alice, [a, b, c, r], events);
      expect(c.lines.join("\n")).not.toContain("dm-mutate-author-edit");
      expect(r.lines.join("\n")).not.toContain("dm-mutate-author-edit");
      const updates = events
        .slice(0, 2)
        .map((event) =>
          event.lines.map((line) => JSON.parse(line)).filter((frame) => frame.messageId === id),
        );
      for (const frames of updates) {
        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({
          type: "conversation.message_updated",
          conversationId,
          messageId: id,
          senderId: alice.account.id,
          data: {
            id,
            conversationId,
            senderId: alice.account.id,
            recipientId: bob.account.id,
            content: "dm-mutate-author-edit",
            redacted: false,
          },
        });
      }
      expect(updates[0][0].eventId).toBe(updates[1][0].eventId);
      for (const e of events.slice(2)) {
        expect(e.lines.join("\n")).not.toContain("dm-mutate-author-edit");
        expect(e.lines.join("\n")).not.toContain(id);
      }
      const publicHistory = await f.request("/api/v1/channels/%23dmbarrier/messages", alice);
      expect(publicHistory.status).toBe(200);
      expect(await publicHistory.text()).not.toMatch(/dm-mutate-author-edit|dm-mutate-original/);
      for (const e of events) e.ws.terminate();
      await f.stop();
      const editedRows = (await f.snapshot("direct_messages")).flat() as any[];
      expect(editedRows.find((row) => row.id === id)).toMatchObject({
        content: "dm-mutate-author-edit",
        redacted: 0,
      });
      expect(editedRows.find((row) => row.id === other1)).toEqual(
        baseline.find((row) => row.id === other1),
      );
      expect(editedRows.find((row) => row.id === other2)).toEqual(
        baseline.find((row) => row.id === other2),
      );
      await f.restart();
      expect(await (await f.request("/api/v1/dms/bob/messages", alice)).text()).toContain(
        "dm-mutate-author-edit",
      );
      ({
        clients: [a, b, c, r],
        events,
      } = await connectAll());
      const redacted = b.waitForNewLine((line) => line.includes(` REDACT bob ${id}`));
      a.send(`REDACT bob ${id}`);
      await redacted;
      await barrier(f, alice, [a, b, c, r], events);
      expect(c.lines.join("\n")).not.toContain(` REDACT bob ${id}`);
      expect(r.lines.join("\n")).not.toContain(` REDACT bob ${id}`);
      const redactions = events
        .slice(0, 2)
        .map((event) =>
          event.lines.map((line) => JSON.parse(line)).filter((frame) => frame.messageId === id),
        );
      for (const frames of redactions) {
        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({
          type: "conversation.message_redacted",
          conversationId,
          messageId: id,
          data: {
            id,
            conversationId,
            senderId: alice.account.id,
            recipientId: bob.account.id,
            content: null,
            redacted: true,
          },
        });
      }
      expect(redactions[0][0].eventId).toBe(redactions[1][0].eventId);
      for (const e of events.slice(2)) {
        expect(e.lines.join("\n")).not.toContain(id);
        expect(e.lines.join("\n")).not.toContain("dm-mutate-author-edit");
      }
      const publicAfterRedact = await f.request("/api/v1/channels/%23dmbarrier/messages", alice);
      expect(publicAfterRedact.status).toBe(200);
      expect(await publicAfterRedact.text()).not.toContain(id);
      for (const e of events) e.ws.terminate();
      await f.stop();
      const redactedRows = (await f.snapshot("direct_messages")).flat() as any[];
      expect(redactedRows.find((row) => row.id === id)).toMatchObject({ content: "", redacted: 1 });
      expect(redactedRows.find((row) => row.id === other1)).toEqual(
        baseline.find((row) => row.id === other1),
      );
      expect(redactedRows.find((row) => row.id === other2)).toEqual(
        baseline.find((row) => row.id === other2),
      );
      await f.restart();
      const final = await (await f.request("/api/v1/dms/bob/messages", alice)).text();
      expect(final).not.toContain("dm-mutate-original");
      expect(final).not.toContain("dm-mutate-author-edit");
      expect(await (await f.request("/api/v1/dms/charlie/messages", bob)).text()).toContain(
        "dm-mutate-bc",
      );
      expect(await (await f.request("/api/v1/dms/charlie/messages", alice)).text()).toContain(
        "dm-mutate-ac",
      );
    } finally {
      for (const e of streams) e.ws.terminate();
      await f.dispose();
    }
  }, 60000);
});
