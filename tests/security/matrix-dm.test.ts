import { afterEach, describe, expect, it } from "vitest";
import { createMatrixFixture } from "../helpers/matrix-fixture";

describe("matrix direct messages", () => {
  let f: Awaited<ReturnType<typeof createMatrixFixture>>;
  afterEach(async () => {
    await f?.dispose();
  });
  it("DM-001 DM-002 DM-003 DM-004 DM-011 DM-012 DM-014 DM-017 DM-021: three independent conversations and event recipients", async () => {
    f = await createMatrixFixture();
    const root = await f.createActor("rootadmin", true);
    const alice = await f.createActor("alice");
    const bob = await f.createActor("bob");
    const charlie = await f.createActor("charlie");
    const a = await f.connect(alice);
    const b = await f.connect(bob);
    const c = await f.connect(charlie);
    const r = await f.connect(root);
    for (const [sender, recipient, target, content] of [
      [a, b, "bob", "matrix-ab-secret"],
      [b, c, "charlie", "matrix-bc-secret"],
      [a, c, "charlie", "matrix-ac-secret"],
    ] as const) {
      const received = recipient.waitForNewLine((l) => l.includes(content));
      sender.send(`PRIVMSG ${target} :${content}`);
      await received;
    }
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c), f.barrier(r)]);
    expect(c.lines.some((l) => l.includes("matrix-ab-secret"))).toBe(false);
    expect(a.lines.some((l) => l.includes("matrix-bc-secret"))).toBe(false);
    expect(b.lines.some((l) => l.includes("matrix-ac-secret"))).toBe(false);
    expect(r.lines.some((l) => l.includes("matrix-") && l.includes("-secret"))).toBe(false);
    for (const [actor, target, secret] of [
      [alice, "bob", "matrix-ab-secret"],
      [bob, "alice", "matrix-ab-secret"],
      [bob, "charlie", "matrix-bc-secret"],
      [charlie, "alice", "matrix-ac-secret"],
    ] as const) {
      const res = await f.request(`/api/v1/dms/${target}/messages`, actor);
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).toContain(secret);
    }
    const charlieDenied = await f.request("/api/v1/dms/bob/messages?user=alice", charlie);
    expect(charlieDenied.status).toBe(403);
    expect(await charlieDenied.text()).not.toContain("matrix-ab-secret");
    const aliceOwn = await (await f.request("/api/v1/dms/charlie/messages", alice)).text();
    expect(aliceOwn).not.toContain("matrix-bc-secret");
    for (const actor of [alice, root]) {
      const res = await f.request("/api/v1/dms/charlie/messages?user=bob", actor);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("matrix-bc-secret");
    }
    await f.stop();
    const rows = JSON.stringify(await f.snapshot("direct_messages"));
    expect(rows).toContain("matrix-ab-secret");
    expect(rows).toContain("matrix-bc-secret");
    expect(rows).toContain("matrix-ac-secret");
    await f.restart();
    for (const [actor, target, secret] of [
      [alice, "bob", "matrix-ab-secret"],
      [bob, "charlie", "matrix-bc-secret"],
      [charlie, "alice", "matrix-ac-secret"],
    ] as const) {
      const res = await f.request(`/api/v1/dms/${target}/messages`, actor);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(secret);
    }
    for (const actor of [alice, root]) {
      const res = await f.request("/api/v1/dms/charlie/messages?user=bob", actor);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("matrix-bc-secret");
    }
  });
});

describe("matrix DM IRC replay and mutations", () => {
  it("DM-006 DM-007: only the author can edit and redact a private message", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      const c = await f.connect(charlie);
      for (const [client, nick] of [
        [a, "alice"],
        [b, "bob"],
        [c, "charlie"],
      ] as const) {
        client.send("CAP REQ :message-tags echo-message draft/message-redaction");
        await client.waitForLine((l) => l.includes(` CAP ${nick} ACK `));
      }
      const sent = a.waitForNewLine((l) => l.includes(" PRIVMSG bob :private-edit-original"));
      a.send("PRIVMSG bob :private-edit-original");
      const line = await sent;
      const id = line.match(/msgid=([^; ]+)/)?.[1];
      expect(id).toBeTruthy();
      await b.waitForLine((l) => l.includes("private-edit-original"));
      b.send(`@+ircord/edit=${id} PRIVMSG alice :recipient-forgery`);
      await b.waitForNumeric(404);
      c.send(`@+ircord/edit=${id} PRIVMSG bob :outsider-forgery`);
      await c.waitForNumeric(404);
      const noticeStart = c.lines.length;
      c.send(`@+ircord/edit=${id} NOTICE bob :outsider-notice-forgery`);
      await f.barrier(c);
      expect(c.lines.slice(noticeStart).some((line) => / 404 | FAIL /.test(line))).toBe(false);
      b.send(`REDACT alice ${id}`);
      await b.waitForLine((l) => l.includes("REDACT_FORBIDDEN"));
      c.send(`REDACT bob ${id}`);
      await c.waitForLine((l) => l.includes("REDACT_FORBIDDEN"));
      await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
      expect(a.lines.some((l) => l.includes("forgery"))).toBe(false);
      const before = await (await f.request("/api/v1/dms/bob/messages", alice)).text();
      expect(before).toContain("private-edit-original");
      expect(before).not.toContain("forgery");
      const edited = b.waitForNewLine((l) => l.includes("private-edit-author"));
      a.send(`@+ircord/edit=${id} PRIVMSG bob :private-edit-author`);
      await edited;
      const redacted = b.waitForNewLine((l) => l.includes(` REDACT bob ${id}`));
      a.send(`REDACT bob ${id}`);
      await redacted;
      const history = await (await f.request("/api/v1/dms/bob/messages", alice)).text();
      expect(history).not.toContain("private-edit-original");
      expect(history).not.toContain("private-edit-author");
      await f.stop();
      const stored = JSON.stringify(await f.snapshot("direct_messages"));
      expect(stored).not.toContain("private-edit-original");
      expect(stored).not.toContain("recipient-forgery");
      expect(stored).not.toContain("outsider-forgery");
      expect(stored).not.toContain("outsider-notice-forgery");
      // The denied outsider edit must also roll back any provisional conversation.
      expect((await f.snapshot("conversations")).flat()).toHaveLength(1);
      expect((await f.snapshot("conversation_members")).flat()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account_id: alice.account.id }),
          expect.objectContaining({ account_id: bob.account.id }),
        ]),
      );
      expect((await f.snapshot("conversation_members")).flat()).toHaveLength(2);
    } finally {
      await f.dispose();
    }
  });
  it("DM-016 DM-017: offline IRC messages persist to the stable recipient and remain private after restart", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const a = await f.connect(alice);
      a.send("CAP REQ :message-tags echo-message");
      await a.waitForLine((line) => line.includes(" CAP alice ACK "));
      const echoed = a.waitForNewLine((line) =>
        line.includes(" PRIVMSG bob :offline-private-marker"),
      );
      a.send("PRIVMSG bob :offline-private-marker");
      const sent = await echoed;
      const id = sent.match(/msgid=([^; ]+)/)?.[1];
      expect(id, sent).toBeTruthy();
      // An unknown account remains an error and never gains a conversation.
      a.send("PRIVMSG neverregistered :unknown-recipient-marker");
      await a.waitForNumeric(401);
      await f.barrier(a);
      const before = await f.request("/api/v1/dms/alice/messages", bob);
      expect(before.status).toBe(200);
      expect(await before.text()).toContain("offline-private-marker");
      await f.stop();
      const rows = (await f.snapshot("direct_messages")).flat() as any[];
      expect(rows).toContainEqual(
        expect.objectContaining({
          id,
          sender_id: alice.account.id,
          target_id: bob.account.id,
          content: "offline-private-marker",
        }),
      );
      expect(JSON.stringify(rows)).not.toContain("unknown-recipient-marker");
      await f.restart();
      const b = await f.connect(bob, "BobOtherDevice");
      b.send("CAP REQ :message-tags batch chathistory");
      await b.waitForLine((line) => line.includes(" CAP BobOtherDevice ACK "));
      const replay = b.waitForNewLine(
        (line) => line.includes("batch=") && line.includes("offline-private-marker"),
      );
      b.send("CHATHISTORY LATEST alice * 10");
      expect(await replay).toContain(`msgid=${id}`);
      const restored = await f.request("/api/v1/dms/alice/messages", bob);
      expect(restored.status).toBe(200);
      expect(await restored.text()).toContain("offline-private-marker");
      const outsider = await f.request("/api/v1/dms/alice/messages?user=bob", charlie);
      expect(outsider.status).toBe(403);
      expect(await outsider.text()).not.toContain("offline-private-marker");
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix DM history transports", () => {
  it("DM-020 DM-024: replay and search are scoped to the authenticated participant", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      const c = await f.connect(charlie);
      const r = await f.connect(root);
      for (const [client, nick] of [
        [a, "alice"],
        [b, "bob"],
        [c, "charlie"],
        [r, "rootadmin"],
      ] as const) {
        client.send("CAP REQ :message-tags batch chathistory");
        await client.waitForLine((l) => l.includes(` CAP ${nick} ACK `));
      }
      c.send("JOIN #publicstream");
      await c.waitForLine((l) => l.includes(" 366 ") && l.includes("#publicstream"));
      const delivered = b.waitForNewLine((l) => l.includes("private-replay-needle"));
      a.send("PRIVMSG bob :private-replay-needle");
      await delivered;
      await f.barrier(c);
      expect(c.lines.some((l) => l.includes("private-replay-needle"))).toBe(false);
      const replay = a.waitForNewLine(
        (l) => l.includes("batch=") && l.includes("private-replay-needle"),
      );
      a.send("CHATHISTORY LATEST bob * 10");
      await replay;
      const histReplay = b.waitForNewLine(
        (l) => l.includes("batch=") && l.includes("private-replay-needle"),
      );
      b.send("HISTSERV PLAY alice 10");
      await histReplay;
      for (const client of [c, r]) {
        const start = client.lines.length;
        client.send("CHATHISTORY LATEST bob * 10");
        client.send("HISTSERV PLAY bob 10");
        await f.barrier(client);
        expect(client.lines.slice(start).some((l) => l.includes("private-replay-needle"))).toBe(
          false,
        );
      }
      for (const actor of [charlie, root]) {
        const response = await f.request("/api/v1/search?q=private-replay-needle", actor);
        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(JSON.stringify(data.items)).not.toContain("private-replay-needle");
        expect(JSON.stringify(data.messages)).not.toContain("private-replay-needle");
      }
    } finally {
      await f.dispose();
    }
  });
});
