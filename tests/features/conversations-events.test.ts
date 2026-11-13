import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createMatrixFixture, json, operation, stream, wire } from "./helpers/session-features";

it("immutable participant conversations provide REST/IRC selectors, canonical edits/read markers and durable idempotency", async () => {
  const f = await createMatrixFixture();
  const streams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      other = await f.createActor("other"),
      admin = await f.createActor("rootadmin", true);
    const a = await f.connect(alice),
      b = await f.connect(bob),
      o = await f.connect(other);
    await wire(
      a,
      "CAP REQ :message-tags echo-message draft/message-redaction batch",
      / CAP .* ACK /,
    );
    const live = await stream(f, bob),
      outside = await stream(f, other);
    streams.push(live, outside);
    for (const client of [a, b, o]) await wire(client, "JOIN #dmproof", / 366 .*#dmproof/);
    const eventBarrier = async () => {
      const marker = `dm-denial-barrier-${randomUUID()}`;
      const posted = await json(
        f,
        "/api/v1/channels/%23dmproof/messages",
        alice,
        "POST",
        { content: marker },
        201,
      );
      await Promise.all([
        live.until((event) => event.messageId === posted.message.id),
        outside.until((event) => event.messageId === posted.message.id),
      ]);
      return posted.message.id as string;
    };
    const create = { peer: bob.account.id, clientOperationId: operation() };
    const { conversation } = await json(f, "/api/v1/conversations", alice, "POST", create);
    expect((await json(f, "/api/conversations", alice, "POST", create)).conversation.id).toBe(
      conversation.id,
    );
    const base = `/api/v1/conversations/${conversation.id}`;
    expect(
      (await json(f, "/api/v1/conversations", bob)).conversations.map((c: any) => c.id),
    ).toEqual([conversation.id]);
    expect((await json(f, "/api/v1/conversations", other)).conversations).toEqual([]);
    const independent = (
      await json(f, "/api/v1/conversations", other, "POST", {
        peer: admin.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    const independentBase = `/api/v1/conversations/${independent.id}`;
    const independentMessage = (
      await json(f, `${independentBase}/messages`, other, "POST", {
        content: "independent-conversation-control",
        clientOperationId: operation(),
      })
    ).message;
    const independentBefore = await json(f, `${independentBase}/messages`, other);
    const send = {
      content: "private canonical payload",
      senderId: alice.account.id,
      recipientId: bob.account.id,
      clientOperationId: operation(),
      tags: { "+role": "admin", account: "forged" },
    };
    const received = b.waitForNewLine((l) => l.includes("private canonical payload"));
    const { message } = await json(f, `${base}/messages`, alice, "POST", send);
    await received;
    expect(message.senderId).toBe(alice.account.id);
    expect(message.tags["+role"]).toBe("member");
    expect(message.tags.account).toBeUndefined();
    expect((await json(f, `${base}/messages`, alice, "POST", send)).message).toEqual(message);
    await live.until(
      (e) => e.type === "conversation.message_created" && e.messageId === message.id,
    );
    await eventBarrier();
    let denialOffsets = [live.frames.length, outside.frames.length];
    const beforeDeniedEdit = await json(f, `${base}/messages`, bob);
    for (const actor of [other, admin]) {
      await json(f, base, actor, "GET", undefined, 403);
      await json(f, `${base}/messages`, actor, "GET", undefined, 403);
      await json(f, `/api/v1/dms/messages/${message.id}`, actor, "GET", undefined, 404);
    }
    await json(
      f,
      `${base}/messages`,
      alice,
      "POST",
      { ...send, senderId: bob.account.id, clientOperationId: operation() },
      403,
    );
    await json(f, `${base}/messages?senderId=${other.account.id}`, alice, "GET", undefined, 403);
    expect(await json(f, `${independentBase}/messages`, other)).toEqual(independentBefore);
    await json(
      f,
      `${base}/messages/${message.id}`,
      other,
      "PATCH",
      {
        content: "foreign-edit-attempt",
        expectedRevision: 0,
        clientOperationId: operation(),
      },
      403,
    );
    await wire(o, `@+ircord/edit=${message.id} PRIVMSG bob :foreign-edit-attempt`, / 404 /);
    await f.barrier(b);
    expect(b.lines.join("\n")).not.toContain("foreign-edit-attempt");
    expect(await json(f, `${base}/messages`, bob)).toEqual(beforeDeniedEdit);
    const deniedBarrier = await eventBarrier();
    for (const [i, observer] of [live, outside].entries())
      expect(
        observer.frames
          .slice(denialOffsets[i])
          .filter((event) => event.messageId !== deniedBarrier),
      ).toEqual([]);
    const ircDelivered = a.waitForNewLine((line) => line.includes("allowed-irc-conversation"));
    b.send("PRIVMSG alice :allowed-irc-conversation");
    await ircDelivered;
    expect(await json(f, `${independentBase}/messages`, other)).toEqual(independentBefore);

    const selected = await json(
      f,
      `${base}/messages?senderId=${alice.account.id}&recipientId=${bob.account.id}`,
      bob,
    );
    expect(selected.messages).toEqual([message]);
    expect((await json(f, `/api/v1/dms/messages/${message.id}`, bob)).message).toEqual(message);
    expect((await json(f, `${base}/unread`, bob)).unread).toBe(1);

    const attachmentResponse = await fetch(new URL("/api/v1/media/upload?dm=bob", f.server.url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "text/plain",
        "X-Filename": "conversation-secret.txt",
      },
      body: "attachment-private-proof",
    });
    expect(attachmentResponse.status).toBe(201);
    const attachment = (await attachmentResponse.json()) as any;
    const listed = await json(f, `${base}/attachments`, bob);
    expect(listed.attachments).toContainEqual(
      expect.objectContaining({ id: attachment.id, filename: "conversation-secret.txt", size: 24 }),
    );
    await eventBarrier();
    denialOffsets = [live.frames.length, outside.frames.length];
    for (const actor of [other, admin]) {
      const denied = await f.request(`/api/conversations/${conversation.id}/attachments`, actor);
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain(attachment.id);
    }
    const attachmentBarrier = await eventBarrier();
    for (const [i, observer] of [live, outside].entries())
      expect(
        observer.frames
          .slice(denialOffsets[i])
          .filter((event) => event.messageId !== attachmentBarrier),
      ).toEqual([]);
    expect(await json(f, `${independentBase}/messages`, other)).toEqual(independentBefore);
    const read = { messageId: message.id, clientOperationId: operation() };
    await json(f, `${base}/read`, bob, "POST", read);
    expect((await json(f, `${base}/unread`, bob)).unread).toBe(0);
    const edit = {
      content: "canonical replacement",
      expectedRevision: 0,
      clientOperationId: operation(),
    };
    const edited = (await json(f, `${base}/messages/${message.id}`, alice, "PATCH", edit)).message;
    expect(edited).toMatchObject({
      id: message.id,
      senderId: alice.account.id,
      content: edit.content,
      revision: 1,
    });
    await json(
      f,
      `${base}/messages/${message.id}`,
      alice,
      "PATCH",
      { ...edit, clientOperationId: operation() },
      409,
    );
    await json(
      f,
      `${base}/messages/${message.id}`,
      bob,
      "DELETE",
      { expectedRevision: 1, clientOperationId: operation() },
      403,
    );
    const ircEdit = b.waitForNewLine((line) => line.includes("canonical-irc-replacement"));
    a.send(`@+ircord/edit=${message.id} PRIVMSG bob :canonical-irc-replacement`);
    await ircEdit;
    const afterIrcEdit = (await json(f, `${base}/messages/${message.id}`, bob)).message;
    expect(afterIrcEdit).toMatchObject({
      id: message.id,
      senderId: alice.account.id,
      content: "canonical-irc-replacement",
      revision: 2,
    });
    const redacted = (
      await json(f, `${base}/messages/${message.id}`, alice, "DELETE", {
        expectedRevision: 2,
        clientOperationId: operation(),
      })
    ).message;
    expect(redacted).toMatchObject({ id: message.id, content: null, redacted: true, revision: 3 });
    const irc = await wire(
      a,
      `CONVERSATION GET :${JSON.stringify({ conversationId: conversation.id })}`,
      / CONVERSATION GET /,
    );
    expect(irc).toContain(conversation.id);
    await f.barrier(o);
    expect(JSON.stringify(outside.frames)).not.toContain("private canonical payload");
    for (const s of streams) s.close();
    streams.length = 0;
    await f.stop();
    const rows = (await f.snapshot("direct_messages")).flat() as any[];
    const redactedRows = rows.filter((r) => r.id === message.id);
    expect(redactedRows.length).toBeGreaterThan(0);
    expect(
      redactedRows.every((r) => r.redacted === 1 && r.content === "" && r.tags_json === "{}"),
    ).toBe(true);
    expect(
      rows.some(
        (r) => r.id === independentMessage.id && r.content === "independent-conversation-control",
      ),
    ).toBe(true);
    const members = (await f.snapshot("conversation_members")).flat() as any[];
    expect(
      members
        .filter((r) => r.conversation_id === conversation.id)
        .map((r) => r.account_id)
        .sort(),
    ).toEqual([alice.account.id, bob.account.id].sort());
    await f.restart();
    expect((await json(f, `${base}/messages/${message.id}`, bob)).message).toEqual(redacted);
    expect((await json(f, `${base}/unread`, bob)).unread).toBe(0);
    expect((await json(f, `${base}/attachments`, bob)).attachments).toContainEqual(
      expect.objectContaining({ id: attachment.id, filename: "conversation-secret.txt" }),
    );
    for (const actor of [other, admin]) {
      await json(f, `/api/v1/dms/messages/${message.id}`, actor, "GET", undefined, 404);
      await json(f, base, actor, "GET", undefined, 403);
      const denied = await f.request(`/api/conversations/${conversation.id}/attachments`, actor);
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain(attachment.id);
    }
    expect(await json(f, `${independentBase}/messages`, other)).toEqual(independentBefore);
    await json(
      f,
      `${base}/messages`,
      other,
      "POST",
      { content: "foreign-rest-after-restart", clientOperationId: operation() },
      403,
    );
    const restoredAlice = await f.connect(alice),
      restoredBob = await f.connect(bob);
    const allowedAgain = restoredBob.waitForNewLine((line) =>
      line.includes("allowed-irc-after-restart"),
    );
    restoredAlice.send("PRIVMSG bob :allowed-irc-after-restart");
    await allowedAgain;
    const restoredOther = await f.connect(other);
    await wire(
      restoredOther,
      `@+ircord/edit=${message.id} PRIVMSG bob :foreign-edit-after-restart`,
      / 404 /,
    );
    expect(await json(f, `${independentBase}/messages`, other)).toEqual(independentBefore);
  } finally {
    for (const s of streams) s.close();
    await f.dispose();
  }
}, 90000);

it("offline registered-nickname DMs persist to immutable ownership and retained history never follows nickname reuse", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    let a = await f.connect(alice),
      b = await f.connect(bob, "BobAlias");
    await wire(b, "NS GROUP", /Successfully grouped nickname BobAlias/);
    await wire(a, "CAP REQ :message-tags echo-message", / CAP .* ACK /);
    b.close();
    await f.barrier(a);
    // Recreation closes every old transport, while retaining actual SQLite ownership.
    await f.restart();
    a = await f.connect(alice);
    await wire(a, "CAP REQ :message-tags echo-message", / CAP .* ACK /);
    const echo = await wire(
      a,
      "PRIVMSG BobAlias :offline-owner-secret",
      / PRIVMSG BobAlias :offline-owner-secret/,
    );
    const id = echo.match(/msgid=([^; ]+)/)?.[1];
    expect(id).toBeTruthy();
    const list = await json(f, "/api/v1/conversations", bob);
    expect(list.conversations).toHaveLength(1);
    const cid = list.conversations[0].id;
    expect((await json(f, `/api/v1/conversations/${cid}/messages`, bob)).messages[0]).toMatchObject(
      { id, recipientId: bob.account.id, content: "offline-owner-secret" },
    );
    b = await f.connect(bob, "BobAlias");
    await wire(b, "NS DROP BobAlias", /Successfully dropped nickname BobAlias/);
    b.close();
    await f.restart();
    const c = await f.connect(charlie, "BobAlias");
    await wire(c, "NS GROUP", /Successfully grouped nickname BobAlias/);
    a = await f.connect(alice);
    await wire(a, "CAP REQ :message-tags echo-message", / CAP .* ACK /);
    const next = c.waitForNewLine((l) => l.includes("new-owner-content"));
    a.send("PRIVMSG BobAlias :new-owner-content");
    await next;
    const old = await json(f, `/api/v1/conversations/${cid}/messages`, bob);
    expect(old.messages.map((m: any) => m.content)).toEqual(["offline-owner-secret"]);
    await json(f, `/api/v1/conversations/${cid}`, charlie, "GET", undefined, 403);
    await json(f, `/api/v1/dms/messages/${id}`, charlie, "GET", undefined, 404);
    const current = await json(f, "/api/v1/conversations", charlie);
    expect(current.conversations).toHaveLength(1);
    expect(current.conversations[0].id).not.toBe(cid);
    await f.stop();
    const rows = (await f.snapshot("direct_messages")).flat() as any[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === id).target_id).toBe(bob.account.id);
  } finally {
    await f.dispose();
  }
}, 90000);

it("profile and explicit private metadata share persisted revisions across REST IRC events replay and recreation", async () => {
  const f = await createMatrixFixture();
  const streams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      admin = await f.createActor("rootadmin", true);
    const a = await f.connect(alice),
      b = await f.connect(bob);
    for (const c of [a, b]) {
      await wire(c, "CAP REQ :message-tags draft/metadata-2", / CAP .* ACK /);
      await wire(c, "JOIN #profiles", / 366 .*#profiles/);
      await wire(c, "METADATA * SUB :*", / 770 /);
    }
    const own = await stream(f, alice),
      outside = await stream(f, bob);
    streams.push(own, outside);
    const bobRevision = (await json(f, "/api/v1/profiles/bob", bob)).profile.revision;
    const bobPrivate = `independent-private-${randomUUID()}`;
    await json(f, "/api/v1/metadata/bob", bob, "PATCH", {
      key: "private:device",
      value: bobPrivate,
      expectedRevision: bobRevision,
      clientOperationId: operation(),
    });
    const bobBefore = (await json(f, "/api/v1/metadata/bob", bob)).metadata;
    expect(bobBefore["private:device"]).toBe(bobPrivate);
    const cursor = (await json(f, "/api/v1/events/bootstrap", alice)).cursor;
    const before = (await json(f, "/api/v1/profiles/alice", alice)).profile;
    const changed = await json(f, "/api/v1/profiles/alice", alice, "PATCH", {
      displayName: "Canonical Alice",
      expectedRevision: before.revision,
      clientOperationId: operation(),
    });
    expect(changed.profile.revision).toBe(before.revision + 1);
    await own.until(
      (e) => e.type === "user.profile_updated" && e.data.revision === changed.profile.revision,
    );
    await outside.until(
      (e) => e.type === "user.profile_updated" && e.data.revision === changed.profile.revision,
    );
    await json(
      f,
      "/api/v1/profiles/alice",
      alice,
      "PATCH",
      { bio: "stale", expectedRevision: before.revision, clientOperationId: operation() },
      409,
    );
    const pub = await wire(
      a,
      `@+draft/profile-revision=${changed.profile.revision};+draft/client-operation-id=${operation()} METADATA * SET pronouns :they/them`,
      / 761 .*pronouns \* they\/them/,
    );
    expect(pub).toContain("pronouns");
    const profile = (await json(f, "/api/v1/profiles/alice", alice)).profile;
    expect(profile.pronouns).toBe("they/them");
    expect(profile.revision).toBe(changed.profile.revision + 1);
    const secret = `private-${randomUUID()}`;
    const mutation = {
      key: "private:device",
      value: secret,
      expectedRevision: profile.revision,
      clientOperationId: operation(),
    };
    const first = await json(f, "/api/v1/metadata/alice", alice, "PATCH", mutation);
    expect((await json(f, "/api/metadata/alice", alice, "PATCH", mutation)).revision).toBe(
      first.revision,
    );
    await own.until(
      (e) => e.type === "user.metadata_updated" && e.data.metadata["private:device"] === secret,
    );
    for (const actor of [bob, admin])
      expect(
        (await json(f, "/api/v1/metadata/alice", actor)).metadata["private:device"],
      ).toBeUndefined();
    expect((await json(f, "/api/v1/metadata/alice", alice)).metadata["private:device"]).toBe(
      secret,
    );
    await wire(b, "METADATA alice GET private:device", / 766 | 762 /);
    await f.barrier(b);
    const replay = await json(f, `/api/v1/events/replay?cursor=${cursor}`, alice);
    expect(JSON.stringify(replay.events)).toContain(secret);
    const foreign = await json(f, "/api/v1/events/bootstrap", bob);
    const bobReplay = await json(f, `/api/v1/events/replay?cursor=${foreign.cursor}`, bob);
    expect(JSON.stringify(bobReplay)).not.toContain(secret);
    expect(b.lines.join("\n")).not.toContain(secret);
    expect(JSON.stringify(outside.frames)).not.toContain(secret);
    await json(
      f,
      "/api/v1/metadata/alice",
      bob,
      "PATCH",
      { ...mutation, clientOperationId: operation() },
      403,
    );
    expect((await json(f, "/api/v1/metadata/bob", bob)).metadata).toEqual(bobBefore);
    for (const s of streams) s.close();
    streams.length = 0;
    await f.restart();
    expect((await json(f, "/api/v1/metadata/alice", alice)).metadata["private:device"]).toBe(
      secret,
    );
    await json(f, "/api/v1/metadata/alice", alice, "PATCH", {
      key: "private:device",
      value: null,
      expectedRevision: first.revision,
      clientOperationId: operation(),
    });
    expect(
      (await json(f, "/api/v1/metadata/alice", alice)).metadata["private:device"],
    ).toBeUndefined();
    expect((await json(f, "/api/v1/profiles/alice", alice)).profile.displayName).toBe(
      "Canonical Alice",
    );
    expect((await json(f, "/api/v1/metadata/bob", bob)).metadata).toEqual(bobBefore);
  } finally {
    for (const s of streams) s.close();
    await f.dispose();
  }
}, 90000);

it("account-bound replay subscriptions bootstrap and WS retries recheck live authority without duplicate mutations", async () => {
  const f = await createMatrixFixture();
  const streams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      other = await f.createActor("other");
    const { conversation } = await json(f, "/api/v1/conversations", alice, "POST", {
      peer: "bob",
      clientOperationId: operation(),
    });
    const base = `/api/v1/conversations/${conversation.id}`,
      boot = await json(f, "/api/v1/events/bootstrap", bob);
    const b = await stream(f, bob),
      o = await stream(f, other);
    streams.push(b, o);
    expect(
      (
        await b.command({
          type: "subscribe",
          cursor: boot.cursor,
          resources: { conversations: [conversation.id] },
        })
      ).type,
    ).toBe("result");
    const denied = await o.command({
      type: "subscribe",
      resources: { conversations: [conversation.id] },
    });
    expect(denied).toMatchObject({ type: "error", status: 403 });
    await json(f, `/api/v1/events/replay?cursor=${boot.cursor}`, other, "GET", undefined, 403);
    const independent = (
      await json(f, "/api/v1/conversations", other, "POST", {
        peer: alice.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    await json(f, `/api/v1/conversations/${independent.id}/messages`, other, "POST", {
      content: "independent-retry-control",
      clientOperationId: operation(),
    });
    const independentBefore = await json(
      f,
      `/api/v1/conversations/${independent.id}/messages`,
      other,
    );
    const a = await stream(f, alice);
    streams.push(a);
    const input = {
      conversationId: conversation.id,
      content: "ws-once-payload",
      clientOperationId: operation(),
    };
    const first = await a.command({ type: "mutate", operation: "conversation.send", input });
    expect(first.type).toBe("result");
    const forgedRetry = await o.command({ type: "mutate", operation: "conversation.send", input });
    expect(forgedRetry).toMatchObject({ type: "error", status: 403 });
    expect(await json(f, `/api/v1/conversations/${independent.id}/messages`, other)).toEqual(
      independentBefore,
    );
    const second = await a.command({ type: "mutate", operation: "conversation.send", input });
    expect(second.result.message).toEqual(first.result.message);
    const conflict = await a.command({
      type: "mutate",
      operation: "conversation.send",
      input: { ...input, content: "conflicting" },
    });
    expect(conflict).toMatchObject({ type: "error", status: 409 });
    await b.until(
      (e) => e.type === "conversation.message_created" && e.messageId === first.result.message.id,
    );
    const history = await json(f, `${base}/messages`, bob);
    expect(history.messages.map((m: any) => m.id)).toEqual([first.result.message.id]);
    const replay = await json(f, `/api/v1/events/replay?cursor=${boot.cursor}`, bob);
    expect(
      replay.events.filter((e: any) => e.type === "conversation.message_created"),
    ).toHaveLength(1);
    const recovered = await b.command({ type: "bootstrap" });
    expect(recovered.result.recovery.crossObjectAtomic).toBe(false);
    expect(recovered.result.conversations[0].unread).toBe(1);
    await json(f, "/api/v1/auth/logout", bob, "POST");
    await json(f, `${base}/messages`, bob, "GET", undefined, 401);
    const before = b.frames.length;
    await json(f, `${base}/messages`, alice, "POST", {
      content: "after-logout-secret",
      clientOperationId: operation(),
    });
    await o.command({ type: "bootstrap" });
    expect(JSON.stringify(b.frames.slice(before))).not.toContain("after-logout-secret");
    for (const s of streams) s.close();
    streams.length = 0;
    await f.restart();
    const secondBob = await f.login("bob", bob.password);
    const persisted = (await json(f, `${base}/messages`, secondBob)).messages;
    expect(persisted).toHaveLength(2);
    expect(persisted.filter((message: any) => message.id === first.result.message.id)).toHaveLength(
      1,
    );
    await json(f, `/api/v1/events/replay?cursor=${boot.cursor}`, other, "GET", undefined, 403);
    const ownReplay = await json(f, `/api/v1/events/replay?cursor=${boot.cursor}`, secondBob);
    expect(ownReplay.events.some((event: any) => event.messageId === first.result.message.id)).toBe(
      true,
    );
    const restoredAlice = await stream(f, alice);
    streams.push(restoredAlice);
    const retried = await restoredAlice.command({
      type: "mutate",
      operation: "conversation.send",
      input,
    });
    expect(retried.result.message).toEqual(first.result.message);
    expect(
      (await json(f, `${base}/messages`, secondBob)).messages.filter(
        (message: any) => message.id === first.result.message.id,
      ),
    ).toHaveLength(1);
    expect(await json(f, `/api/v1/conversations/${independent.id}/messages`, other)).toEqual(
      independentBefore,
    );
    expect(JSON.stringify(o.frames)).not.toContain("ws-once-payload");
    for (const observer of streams) observer.close();
    streams.length = 0;
    await f.stop();
    const storedMessages = (await f.snapshot("direct_messages")).flat() as any[];
    expect(storedMessages.filter((message) => message.id === first.result.message.id)).toHaveLength(
      1,
    );
  } finally {
    for (const s of streams) s.close();
    await f.dispose();
  }
}, 90000);

it("expired retained event cursors return explicit resync after bounded journal retention and recreation", async () => {
  const { authGapFixture } = await import("../helpers/auth-gap-fixture");
  const f = await authGapFixture({ EVENT_JOURNAL_MAX_EVENTS: "16" });
  try {
    const alice = await f.create("alice"),
      bob = await f.create("bob");
    const create = await f.request("/api/v1/conversations", alice, "POST", {
      peer: "bob",
      clientOperationId: operation(),
    });
    expect(create.status).toBe(200);
    const cid = ((await create.json()) as any).conversation.id;
    const bootstrap = await f.request("/api/v1/events/bootstrap", bob);
    expect(bootstrap.status).toBe(200);
    const cursor = ((await bootstrap.json()) as any).cursor;
    for (let i = 0; i < 18; i++)
      expect(
        (
          await f.request(`/api/v1/conversations/${cid}/messages`, alice, "POST", {
            content: `bounded-${i}`,
            clientOperationId: operation(),
          })
        ).status,
      ).toBe(200);
    const expired = await f.request(`/api/v1/events/replay?cursor=${cursor}`, bob);
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("CURSOR_EXPIRED");
    const fresh = await f.request("/api/v1/events/bootstrap", bob);
    expect(fresh.status).toBe(200);
    expect(((await fresh.json()) as any).conversations[0].unread).toBe(18);
    await f.stop();
    expect((await f.rows("event_journal")).flat()).toHaveLength(16);
    expect((await f.rows("direct_messages")).flat()).toHaveLength(18);
    await f.restart();
    expect((await f.request(`/api/v1/events/replay?cursor=${cursor}`, bob)).status).toBe(410);
    expect((await f.request(`/api/v1/conversations/${cid}/messages`, bob)).status).toBe(200);
  } finally {
    await f.dispose();
  }
}, 90000);

it("durable observer handshakes preserve public live observation and suppress private revoked redacted replay across recreation", async () => {
  const f = await createMatrixFixture();
  const streams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      other = await f.createActor("other");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(other);
    const owner = await stream(f, alice),
      member = await stream(f, bob),
      observer = await stream(f, other);
    streams.push(owner, member, observer);
    const secretCreate = await owner.command({
      type: "mutate",
      operation: "channel.create",
      input: {
        channel: "#eventsecret",
        settings: { privacy: "secret" },
        clientOperationId: operation(),
      },
    });
    expect(secretCreate.result.ok).toBe(true);
    const generation = secretCreate.result.generation;
    const outsider = await observer.command({
      type: "subscribe",
      resources: { channels: [{ channel: "#eventsecret", generation }] },
    });
    expect(outsider).toMatchObject({ type: "error", status: 403 });
    const joined = await member.command({
      type: "mutate",
      operation: "channel.join",
      input: { channel: "#eventsecret", generation, clientOperationId: operation() },
    });
    expect(joined.result.ok).toBe(true);
    const start = (await json(f, "/api/v1/events/bootstrap", bob)).cursor;
    expect(
      (
        await member.command({
          type: "subscribe",
          cursor: start,
          resources: { channels: [{ channel: "#eventsecret", generation }] },
        })
      ).type,
    ).toBe("result");
    const sent = await owner.command({
      type: "mutate",
      operation: "channel.send",
      input: {
        channel: "#eventsecret",
        generation,
        content: "redacted-channel-secret",
        clientOperationId: operation(),
      },
    });
    expect(sent.result.ok).toBe(true);
    expect(sent.result.recipientSessionIds).toBeUndefined();
    await member.until(
      (e) => e.type === "message.created" && e.messageId === sent.result.message.id,
    );
    await owner.command({
      type: "mutate",
      operation: "channel.redact",
      input: {
        channel: "#eventsecret",
        generation,
        id: sent.result.message.id,
        clientOperationId: operation(),
      },
    });
    const redactedReplay = await json(f, `/api/v1/events/replay?cursor=${start}`, bob);
    expect(JSON.stringify(redactedReplay)).not.toContain("redacted-channel-secret");
    expect(
      redactedReplay.events.some(
        (e: any) => e.type === "message.deleted" && e.messageId === sent.result.message.id,
      ),
    ).toBe(true);
    await member.command({
      type: "mutate",
      operation: "channel.leave",
      input: { channel: "#eventsecret", generation, clientOperationId: operation() },
    });
    const privateMarker = "after-leave-private";
    await owner.command({
      type: "mutate",
      operation: "channel.send",
      input: {
        channel: "#eventsecret",
        generation,
        content: privateMarker,
        clientOperationId: operation(),
      },
    });
    expect(
      JSON.stringify(await json(f, `/api/v1/events/replay?cursor=${start}`, bob)),
    ).not.toContain(privateMarker);
    const publicCreated = await json(
      f,
      "/api/v1/channels",
      alice,
      "POST",
      { name: "#eventpublic", privacy: "public" },
      201,
    );
    await json(
      f,
      "/api/v1/channels/%23eventpublic/messages",
      alice,
      "POST",
      { content: "legacy-transient-positive" },
      201,
    );
    await observer.until(
      (e) =>
        (e.type === "message.created" && e.data.message?.content === "legacy-transient-positive") ||
        (e.type === "message.created" &&
          JSON.stringify(e.data).includes("legacy-transient-positive")),
    );
    const cursor = (await json(f, "/api/v1/events/bootstrap", other)).cursor;
    const registered = await observer.command({
      type: "subscribe",
      cursor,
      resources: { channels: [{ channel: "#eventpublic", generation: publicCreated.generation }] },
    });
    expect(registered.result.boundaries[0]).toMatchObject({ generation: publicCreated.generation });
    await json(
      f,
      "/api/v1/channels/%23eventpublic/messages",
      alice,
      "POST",
      { content: "durable-public-observer" },
      201,
    );
    await observer.until((e) => JSON.stringify(e).includes("durable-public-observer"));
    expect(
      JSON.stringify(await json(f, `/api/v1/events/replay?cursor=${cursor}`, other)),
    ).toContain("durable-public-observer");
    expect(JSON.stringify(observer.frames)).not.toContain(privateMarker);
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
    for (const s of streams) s.close();
    streams.length = 0;
    await f.restart();
    const resumed = await stream(f, bob);
    streams.push(resumed);
    expect(
      (
        await resumed.command({
          type: "subscribe",
          resources: { channels: [{ channel: "#eventsecret", generation }] },
        })
      ).type,
    ).toBe("error");
    expect(
      JSON.stringify(await json(f, `/api/v1/events/replay?cursor=${start}`, bob)),
    ).not.toContain(privateMarker);
  } finally {
    for (const s of streams) s.close();
    await f.dispose();
  }
}, 90000);

it("integration PASS credentials preserve hashed scope and targeted revocation after hibernation without disconnecting password devices", async () => {
  const { TestIRCClient } = await import("../helpers/miniflare-harness");
  const f = await createMatrixFixture();
  let bot: InstanceType<typeof TestIRCClient> | undefined;
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const a = await f.connect(alice),
      b = await f.connect(bob);
    const credential = (
      await json(f, "/api/v1/auth/credentials", alice, "POST", {
        label: "irc-device",
        expiresAt: Date.now() + 60000,
        scopes: [{ operation: "*", resource: "*" }],
      })
    ).credential;
    bot = new TestIRCClient(f.server.wsUrl);
    await bot.connect();
    bot.send(`PASS token:${credential.token}`);
    await bot.register("AliceBot");
    const received = b.waitForNewLine((line) => line.includes("credential-irc-positive"));
    bot.send("PRIVMSG bob :credential-irc-positive");
    await received;
    await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
      name: "FlaRC",
      webSockets: "hibernate",
    });
    await f.barrier(a);
    await json(f, `/api/v1/auth/sessions/${credential.id}`, alice, "DELETE");
    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Revoked credential IRC session remained open")),
        5000,
      );
      bot!.ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    bot.send("PING :revoked-device-probe");
    await closed;
    await Promise.all([f.barrier(a), f.barrier(b)]);
    expect((await json(f, "/api/v1/profiles/alice", alice)).profile.username).toBe("alice");
    const denied = await f.request("/api/v1/profiles/alice", { ...alice, token: credential.token });
    expect(denied.status).toBe(401);
    await f.stop();
    const sessions = (await f.snapshot("session_state")).flat() as any[];
    expect(JSON.stringify(sessions)).not.toContain(credential.token);
    expect(JSON.stringify(sessions)).not.toContain(alice.password);
    await f.restart();
    expect((await json(f, "/api/v1/profiles/alice", alice)).profile.username).toBe("alice");
  } finally {
    bot?.close();
    await f.dispose();
  }
}, 90000);

it("bootstrap pages actual joined channels without registering unrelated public discovery rooms or consuming observer quota", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      healthy = await f.createActor("healthy");
    for (let i = 0; i < 101; i++)
      await json(
        f,
        "/api/v1/channels",
        bob,
        "POST",
        { name: `#public${String(i).padStart(3, "0")}`, privacy: "public" },
        201,
      );
    const owned = await json(
      f,
      "/api/v1/channels",
      alice,
      "POST",
      { name: "#zz-owned", privacy: "secret" },
      201,
    );
    const first = await json(f, "/api/v1/events/bootstrap", alice);
    expect(first.channels).toEqual([]);
    expect(first.channelsComplete).toBe(false);
    expect(first.nextPageToken).toMatch(/^[0-9a-f]{64}$/);
    const second = await json(
      f,
      `/api/v1/events/bootstrap?pageToken=${first.nextPageToken}`,
      alice,
    );
    expect(second.channelsComplete).toBe(true);
    expect(second.nextPageToken).toBeNull();
    expect(second.channels).toHaveLength(1);
    expect(second.channels[0]).toMatchObject({
      channel: "#zz-owned",
      generation: owned.generation,
      isMember: true,
      eventBoundary: { kind: "membership" },
    });
    expect(second.channels[0].info).toMatchObject({
      channel: "#zz-owned",
      generation: owned.generation,
    });
    expect(second.channels[0].history).toEqual([]);
    const c = await f.connect(healthy);
    await f.barrier(c);
    await f.stop();
    expect((await f.snapshot("event_subscriptions")).flat()).toEqual([]);
    expect((await f.snapshot("channel_feature_observers")).flat()).toEqual([]);
    await f.restart();
    const restored = await json(
      f,
      `/api/v1/events/bootstrap?pageToken=${first.nextPageToken}`,
      alice,
    );
    expect(restored.channels[0].generation).toBe(owned.generation);
  } finally {
    await f.dispose();
  }
}, 90000);

it("foreign and expired subscribe cursors deny before durable interest writes and preserve empty subscription delivery policy", async () => {
  const f = await createMatrixFixture();
  const streams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const created = await json(
      f,
      "/api/v1/channels",
      alice,
      "POST",
      { name: "#cursor-effects", privacy: "public" },
      201,
    );
    const foreign = (await json(f, "/api/v1/events/bootstrap", alice)).cursor;
    const b = await stream(f, bob);
    streams.push(b);
    expect((await b.command({ type: "subscribe", resources: {} })).type).toBe("result");
    for (const s of streams) s.close();
    streams.length = 0;
    await f.stop();
    const beforeSession = (await f.snapshot("event_subscriptions")).flat();
    const beforeChannel = (await f.snapshot("channel_feature_observers")).flat();
    const beforePreferences = (await f.snapshot("event_subscription_preferences")).flat();
    await f.restart();
    const resumed = await stream(f, bob),
      positive = await stream(f, alice);
    streams.push(resumed, positive);
    const own = (await json(f, "/api/v1/events/bootstrap", bob)).cursor;
    const resources = {
      channels: [{ channel: "#cursor-effects", generation: created.generation }],
    };
    expect(await resumed.command({ type: "subscribe", resources, cursor: foreign })).toMatchObject({
      type: "error",
      status: 403,
      code: "CURSOR_FORBIDDEN",
    });
    expect(
      await resumed.command({ type: "subscribe", resources, cursor: "0".repeat(64) }),
    ).toMatchObject({ type: "error", status: 410, code: "CURSOR_EXPIRED" });
    await json(
      f,
      "/api/v1/channels/%23cursor-effects/messages",
      alice,
      "POST",
      { content: "cursor-denial-marker" },
      201,
    );
    await positive.until(
      (e) =>
        e.type === "message.created" && JSON.stringify(e.data).includes("cursor-denial-marker"),
    );
    const replay = await json(f, `/api/v1/events/replay?cursor=${own}`, bob);
    expect(JSON.stringify(replay)).not.toContain("cursor-denial-marker");
    expect(resumed.frames.filter((e) => e.type === "message.created")).toEqual([]);
    for (const s of streams) s.close();
    streams.length = 0;
    await f.stop();
    expect((await f.snapshot("event_subscriptions")).flat()).toEqual(beforeSession);
    expect((await f.snapshot("channel_feature_observers")).flat()).toEqual(beforeChannel);
    expect((await f.snapshot("event_subscription_preferences")).flat()).toEqual(beforePreferences);
  } finally {
    for (const s of streams) s.close();
    await f.dispose();
  }
}, 90000);

it("bootstrap continuation hides unrelated secret names binds opaque pages to the account and retains the first recovery cursor", async () => {
  const { authGapFixture } = await import("../helpers/auth-gap-fixture");
  const f = await authGapFixture({ EVENT_JOURNAL_RETENTION_MS: "2000" });
  try {
    const alice = await f.create("alice"),
      bob = await f.create("bob");
    const hidden = Array.from(
      { length: 101 },
      (_, i) => `#hidden-private-${String(i).padStart(3, "0")}`,
    );
    for (const name of hidden)
      await json(f, "/api/v1/channels", bob, "POST", { name, privacy: "secret" }, 201);
    const owned = await json(
      f,
      "/api/v1/channels",
      alice,
      "POST",
      { name: "#zz-pagination-owned", privacy: "secret" },
      201,
    );
    const first = await json(f, "/api/v1/events/bootstrap", alice);
    for (const name of hidden) expect(JSON.stringify(first)).not.toContain(name);
    expect(first.channels).toEqual([]);
    expect(first.channelsComplete).toBe(false);
    expect(first.nextPageToken).toMatch(/^[0-9a-f]{64}$/);
    await json(
      f,
      `/api/v1/events/bootstrap?pageToken=${first.nextPageToken}`,
      bob,
      "GET",
      undefined,
      403,
    );
    await json(
      f,
      "/api/v1/channels/%23zz-pagination-owned/messages",
      alice,
      "POST",
      { content: "between-bootstrap-pages" },
      201,
    );
    const second = await json(
      f,
      `/api/v1/events/bootstrap?pageToken=${first.nextPageToken}`,
      alice,
    );
    for (const name of hidden) expect(JSON.stringify(second)).not.toContain(name);
    expect(second.cursor).toBe(first.cursor);
    expect(second.recovery.replayFrom).toBe(first.cursor);
    expect(second.channelsComplete).toBe(true);
    expect(second.nextPageToken).toBeNull();
    expect(second.channels).toHaveLength(1);
    expect(second.channels[0]).toMatchObject({
      channel: "#zz-pagination-owned",
      generation: owned.generation,
      isMember: true,
    });
    expect(
      JSON.stringify(await json(f, `/api/v1/events/replay?cursor=${first.cursor}`, alice)),
    ).toContain("between-bootstrap-pages");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await json(
      f,
      `/api/v1/events/bootstrap?pageToken=${first.nextPageToken}`,
      alice,
      "GET",
      undefined,
      410,
    );
    await f.stop();
    expect((await f.rows("event_subscriptions")).flat()).toEqual([]);
    expect((await f.rows("channel_feature_observers")).flat()).toEqual([]);
  } finally {
    await f.dispose();
  }
}, 90000);

it("foreign conversation subscriptions preserve independent durable interests across recreation", async () => {
  const f = await createMatrixFixture();
  const streams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      other = await f.createActor("other");
    const target = (
      await json(f, "/api/v1/conversations", alice, "POST", {
        peer: bob.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    const independent = (
      await json(f, "/api/v1/conversations", alice, "POST", {
        peer: other.account.id,
        clientOperationId: operation(),
      })
    ).conversation;
    let b = await stream(f, bob),
      o = await stream(f, other);
    streams.push(b, o);
    expect(
      (await b.command({ type: "subscribe", resources: { conversations: [target.id] } })).type,
    ).toBe("result");
    expect(
      (await o.command({ type: "subscribe", resources: { conversations: [independent.id] } })).type,
    ).toBe("result");
    for (const s of streams) s.close();
    streams.length = 0;
    await f.stop();
    const tables = ["event_subscriptions", "event_subscription_preferences"] as const;
    const before = await Promise.all(tables.map((table) => f.snapshot(table)));
    const canonical = (snapshots: unknown[][][]) =>
      snapshots.map((groups) =>
        groups
          .flat()
          .map((row) => JSON.stringify(row))
          .sort(),
      );
    const preferences = before[1].flat() as any[];
    const otherPreference = preferences.find((row) => row.account_id === other.account.id);
    expect(JSON.parse(otherPreference.subscriptions_json).conversations).toContain(independent.id);
    const bobPreference = preferences.find((row) => row.account_id === bob.account.id);
    expect(JSON.parse(bobPreference.subscriptions_json).conversations).toContain(target.id);
    await f.restart();
    o = await stream(f, other);
    streams.push(o);
    expect(
      await o.command({ type: "subscribe", resources: { conversations: [target.id] } }),
    ).toMatchObject({ type: "error", status: 403 });
    for (const s of streams) s.close();
    streams.length = 0;
    await f.stop();
    expect(canonical(await Promise.all(tables.map((table) => f.snapshot(table))))).toEqual(
      canonical(before),
    );
    await f.restart();
    b = await stream(f, bob);
    o = await stream(f, other);
    streams.push(b, o);
    expect(
      await o.command({ type: "subscribe", resources: { conversations: [target.id] } }),
    ).toMatchObject({ type: "error", status: 403 });
    const saved = (
      await json(f, `/api/v1/conversations/${independent.id}/messages`, alice, "POST", {
        content: "independent-subscription-live",
        clientOperationId: operation(),
      })
    ).message;
    await o.until(
      (event) => event.type === "conversation.message_created" && event.messageId === saved.id,
    );
    expect(JSON.stringify(b.frames)).not.toContain("independent-subscription-live");
    for (const observer of streams) observer.close();
    streams.length = 0;
    await f.stop();
    expect(canonical(await Promise.all(tables.map((table) => f.snapshot(table))))).toEqual(
      canonical(before),
    );
  } finally {
    for (const s of streams) s.close();
    await f.dispose();
  }
}, 90000);
