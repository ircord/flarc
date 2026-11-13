import { expect, it } from "vitest";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import { stream } from "./helpers/session-features";

it("new admin audit, bans, scopes and account-session aliases enforce authority and preserve independent accounts", async () => {
  const f = await createMatrixFixture();
  const streams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const observer = await f.connect(bob);
    observer.send("JOIN #sessionproof");
    await observer.waitForNumeric(366);
    expect(
      (await f.request("/api/v1/channels/%23sessionproof/join", alice, "POST", {})).status,
    ).toBe(200);
    const revokedTokens: (typeof alice)[] = [];
    for (const prefix of ["/admin", "/api/v1/admin"]) {
      const second = await f.login("alice", alice.password);
      const victim = await stream(f, second),
        safe = await stream(f, alice),
        unrelated = await stream(f, bob);
      streams.push(victim, safe, unrelated);
      const marker = async (receivers: typeof streams) => {
        const content = `admin-revoke-${crypto.randomUUID()}`;
        const response = await f.request("/api/v1/channels/%23sessionproof/messages", bob, "POST", {
          content,
        });
        expect(response.status).toBe(201);
        const id = ((await response.json()) as any).message.id;
        await Promise.all(
          receivers.map((receiver) => receiver.until((event) => event.messageId === id)),
        );
        await observer.waitForLine((line) => line.includes(content));
        return { id, content };
      };
      const sessions = await f.request(`${prefix}/accounts/alice/sessions`, root);
      expect(sessions.status).toBe(200);
      const rows = ((await sessions.json()) as any).sessions;
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const own = (
        (await (await f.request("/api/v1/auth/sessions", second)).json()) as any
      ).sessions.find((s: any) => s.current);
      expect(rows.some((s: any) => s.id === own.id)).toBe(true);
      const scopes = { scopes: [{ operation: "admin.route.accounts.get", resource: "alice" }] };
      const unauth = await f.request(`${prefix}/audit`);
      expect(unauth.status).toBe(401);
      for (const [route, method, body] of [
        [`${prefix}/audit`, "GET", undefined],
        [`${prefix}/bans`, "GET", undefined],
        [`${prefix}/bans`, "POST", { kind: "account", value: alice.account.id }],
        [`${prefix}/accounts/alice/scopes`, "GET", undefined],
        [`${prefix}/accounts/alice/scopes`, "PUT", scopes],
        [`${prefix}/accounts/alice/sessions`, "GET", undefined],
        [`${prefix}/accounts/alice/sessions/${own.id}`, "DELETE", undefined],
      ] as const)
        expect((await f.request(route, bob, method, body)).status).toBe(403);
      expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(200);
      await marker([victim, safe, unrelated]);
      expect((await f.request(`${prefix}/audit`, root)).status).toBe(200);
      expect((await f.request(`${prefix}/accounts/alice/scopes`, root, "PUT", scopes)).status).toBe(
        200,
      );
      const readScopes = await f.request(`${prefix}/accounts/alice/scopes`, root);
      expect(readScopes.status).toBe(200);
      expect(await readScopes.json()).toMatchObject({ restricted: true, scopes: scopes.scopes });
      expect(
        (await f.request(`${prefix}/accounts/alice/sessions/${own.id}`, root, "DELETE")).status,
      ).toBe(200);
      expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(401);
      revokedTokens.push(second);
      const afterRevoke = await marker([safe, unrelated]);
      expect(victim.frames.some((event) => event.messageId === afterRevoke.id)).toBe(false);
      expect(JSON.stringify(victim.frames)).not.toContain(afterRevoke.content);
      for (const socket of streams.splice(0)) socket.close();
      const banResponse = await f.request(`${prefix}/bans`, root, "POST", {
        kind: "account",
        value: alice.account.id,
      });
      expect(banResponse.status).toBe(200);
      const ban = ((await banResponse.json()) as any).ban;
      const listed = await f.request(`${prefix}/bans`, root);
      expect(listed.status).toBe(200);
      expect(((await listed.json()) as any).bans).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: ban.id, value: alice.account.id })]),
      );
      expect((await f.request(`${prefix}/bans/${ban.id}`, bob, "DELETE")).status).toBe(403);
      expect((await f.request(`${prefix}/bans/${ban.id}`, root, "DELETE")).status).toBe(200);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
      await f.barrier(observer);
    }
    await f.restart();
    for (const token of revokedTokens) {
      expect((await f.request("/api/v1/profiles/alice", token)).status).toBe(401);
      expect((await f.request("/api/v1/auth/events-ticket", token, "POST")).status).toBe(401);
    }
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    expect(((await (await f.request("/admin/bans", root)).json()) as any).bans).toEqual([]);
  } finally {
    for (const socket of streams) socket.close();
    await f.dispose();
  }
}, 60000);

it("conversation, event and metadata REST aliases enforce the same authenticated resource boundaries", async () => {
  const f = await createMatrixFixture();
  let witnesses: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      outsider = await f.createActor("charlie");
    const bobIrc = await f.connect(bob),
      outsideIrc = await f.connect(outsider);
    const openWitnesses = async () => {
      const clients = await Promise.all(
        [alice, bob, outsider].map((actor) => f.connect(actor, `${actor.username}Proof`)),
      );
      for (const client of clients) {
        const joined = client.waitForNewLine(
          (line) => line.includes(" 366 ") && line.includes("#aliasproof"),
        );
        client.send("JOIN #aliasproof");
        await joined;
      }
      witnesses = await Promise.all([alice, bob, outsider].map((actor) => stream(f, actor)));
    };
    const eventBarrier = async () => {
      const content = `alias-denial-barrier-${crypto.randomUUID()}`;
      const response = await f.request("/api/v1/channels/%23aliasproof/messages", bob, "POST", {
        content,
      });
      expect(response.status).toBe(201);
      const id = ((await response.json()) as any).message.id;
      await Promise.all(
        witnesses.map((observer) => observer.until((event) => event.messageId === id)),
      );
      return id as string;
    };
    const quiet = async (action: () => Promise<void>) => {
      await eventBarrier();
      const offsets = witnesses.map((observer) => observer.frames.length);
      await action();
      const marker = await eventBarrier();
      for (const [i, observer] of witnesses.entries())
        expect(
          observer.frames.slice(offsets[i]).filter((event) => event.messageId !== marker),
        ).toEqual([]);
    };
    await openWitnesses();
    const op = () => `${Date.now()}.${crypto.randomUUID()}`;
    const conversations: Array<{ prefix: string; id: string }> = [];
    for (const prefix of ["/api", "/api/v1"]) {
      expect(
        (
          await f.request(`${prefix}/conversations`, undefined, "POST", {
            peer: bob.account.id,
            clientOperationId: op(),
          })
        ).status,
      ).toBe(401);
      const bootstrap = await f.request(`${prefix}/events/bootstrap`, bob);
      expect(bootstrap.status).toBe(200);
      const cursor = ((await bootstrap.json()) as any).cursor;
      const before = await f.request(`${prefix}/conversations`, alice, "POST", {
        peer: bob.account.id,
        clientOperationId: op(),
      });
      expect(before.status).toBe(200);
      const conversation = ((await before.json()) as any).conversation;
      conversations.push({ prefix, id: conversation.id });
      const base = `${prefix}/conversations/${conversation.id}`;
      const listed = await f.request(`${prefix}/conversations`, bob);
      expect(listed.status).toBe(200);
      expect(((await listed.json()) as any).conversations.map((item: any) => item.id)).toContain(
        conversation.id,
      );
      const absent = await f.request(`${prefix}/conversations`, outsider);
      expect(absent.status).toBe(200);
      expect(
        ((await absent.json()) as any).conversations.map((item: any) => item.id),
      ).not.toContain(conversation.id);
      const detail = await f.request(base, bob);
      expect(detail.status).toBe(200);
      expect(((await detail.json()) as any).conversation.id).toBe(conversation.id);
      expect((await f.request(base, outsider)).status).toBe(403);
      const messageBody = { content: `alias-secret-${prefix}`, clientOperationId: op() };
      const delivery = bobIrc.waitForNewLine((line) => line.includes(messageBody.content));
      const sent = await f.request(`${base}/messages`, alice, "POST", messageBody);
      expect(sent.status).toBe(200);
      const message = ((await sent.json()) as any).message;
      await delivery;
      const legacy = await f.request("/api/v1/dms/alice/messages", bob);
      expect(legacy.status).toBe(200);
      expect(JSON.stringify(await legacy.json())).toContain(messageBody.content);
      expect((await f.request("/api/v1/dms/bob/messages?user=alice", outsider)).status).toBe(403);
      expect(
        (
          await f.request(`${base}/messages`, outsider, "POST", {
            ...messageBody,
            clientOperationId: op(),
          })
        ).status,
      ).toBe(403);
      const readHistory = await f.request(`${base}/messages`, bob);
      expect(readHistory.status).toBe(200);
      expect(((await readHistory.json()) as any).messages).toContainEqual(
        expect.objectContaining({ id: message.id, content: messageBody.content }),
      );
      expect((await f.request(`${base}/messages`, outsider)).status).toBe(403);
      for (const route of [
        `${base}/messages/${message.id}`,
        `${prefix}/dms/messages/${message.id}`,
      ]) {
        const found = await f.request(route, bob);
        expect(found.status).toBe(200);
        expect(((await found.json()) as any).message.id).toBe(message.id);
        expect([403, 404]).toContain((await f.request(route, outsider)).status);
      }
      const unread = await f.request(`${base}/unread`, bob);
      expect(unread.status).toBe(200);
      expect(((await unread.json()) as any).unread).toBeGreaterThan(0);
      await quiet(async () => {
        expect((await f.request(`${base}/unread`, outsider)).status).toBe(403);
        expect(
          (
            await f.request(`${base}/read`, outsider, "POST", {
              messageId: message.id,
              clientOperationId: op(),
            })
          ).status,
        ).toBe(403);
      });
      expect(
        (
          await f.request(`${base}/read`, bob, "POST", {
            messageId: message.id,
            clientOperationId: op(),
          })
        ).status,
      ).toBe(200);
      expect(((await (await f.request(`${base}/unread`, bob)).json()) as any).unread).toBe(0);
      const attachments = await f.request(`${base}/attachments`, bob);
      expect(attachments.status).toBe(200);
      expect(Array.isArray(((await attachments.json()) as any).attachments)).toBe(true);
      await quiet(async () => {
        expect((await f.request(`${base}/attachments`, outsider)).status).toBe(403);
      });
      const edit = { content: `edited-${prefix}`, expectedRevision: 0, clientOperationId: op() };
      expect(
        (await f.request(`${base}/messages/${message.id}`, outsider, "PATCH", edit)).status,
      ).toBe(403);
      const updated = await f.request(`${base}/messages/${message.id}`, alice, "PATCH", edit);
      expect(updated.status).toBe(200);
      expect(((await updated.json()) as any).message).toMatchObject({
        id: message.id,
        content: edit.content,
        revision: 1,
      });
      const redact = { expectedRevision: 1, clientOperationId: op() };
      expect(
        (await f.request(`${base}/messages/${message.id}`, outsider, "DELETE", redact)).status,
      ).toBe(403);
      const deleted = await f.request(`${base}/messages/${message.id}`, alice, "DELETE", redact);
      expect(deleted.status).toBe(200);
      expect(((await deleted.json()) as any).message).toMatchObject({
        id: message.id,
        content: null,
        redacted: true,
      });
      const replay = await f.request(
        `${prefix}/events/replay?cursor=${encodeURIComponent(cursor)}`,
        bob,
      );
      expect(replay.status).toBe(200);
      const recovered = (await replay.json()) as any;
      expect(recovered.events).toContainEqual(
        expect.objectContaining({
          type: "conversation.message_redacted",
          conversationId: conversation.id,
          messageId: message.id,
        }),
      );
      expect(JSON.stringify(recovered.events)).not.toContain(messageBody.content);
      expect(JSON.stringify(recovered.events)).not.toContain(edit.content);
      expect(
        (await f.request(`${prefix}/events/replay?cursor=${encodeURIComponent(cursor)}`, outsider))
          .status,
      ).toBe(403);
      expect((await f.request(`${prefix}/events/bootstrap`)).status).toBe(401);
      const profile = ((await (await f.request("/api/v1/profiles/alice", alice)).json()) as any)
        .profile;
      const change = {
        key: "private:alias",
        value: `hidden-${prefix}`,
        expectedRevision: profile.revision,
        clientOperationId: op(),
      };
      expect((await f.request(`${prefix}/metadata/alice`, outsider, "PATCH", change)).status).toBe(
        403,
      );
      expect((await f.request(`${prefix}/metadata/alice`, alice, "PATCH", change)).status).toBe(
        200,
      );
      const mine = await f.request(`${prefix}/metadata/alice`, alice),
        theirs = await f.request(`${prefix}/metadata/alice`, outsider);
      expect(mine.status).toBe(200);
      expect(((await mine.json()) as any).metadata["private:alias"]).toBe(change.value);
      expect(theirs.status).toBe(200);
      expect(((await theirs.json()) as any).metadata["private:alias"]).toBeUndefined();
      await f.barrier(outsideIrc);
      expect(outsideIrc.lines.join("\n")).not.toContain(messageBody.content);
    }
    const otherConversation = await f.request("/api/v1/conversations", bob, "POST", {
      peer: outsider.account.id,
      clientOperationId: op(),
    });
    expect(otherConversation.status).toBe(200);
    const otherId = ((await otherConversation.json()) as any).conversation.id;
    const otherMessage = await f.request(`/api/v1/conversations/${otherId}/messages`, bob, "POST", {
      content: "bob-charlie-private",
      clientOperationId: op(),
    });
    expect(otherMessage.status).toBe(200);
    const ownLegacy = await f.request("/api/v1/dms/charlie/messages", bob);
    expect(ownLegacy.status).toBe(200);
    expect(JSON.stringify(await ownLegacy.json())).toContain("bob-charlie-private");
    const independentBefore = await (
      await f.request(`/api/v1/conversations/${otherId}/messages`, bob)
    ).json();
    await quiet(async () => {
      for (const selector of ["bob", bob.account.id]) {
        const forgedLegacy = await f.request(
          `/api/v1/dms/charlie/messages?user=${encodeURIComponent(selector)}`,
          alice,
        );
        expect(forgedLegacy.status).toBe(403);
        expect(await forgedLegacy.text()).not.toContain("bob-charlie-private");
      }
    });
    expect(
      await (await f.request(`/api/v1/conversations/${otherId}/messages`, bob)).json(),
    ).toEqual(independentBefore);
    for (const observer of witnesses) observer.close();
    witnesses = [];
    await f.restart();
    await openWitnesses();
    expect((await f.request("/api/v1/profiles/charlie", outsider)).status).toBe(200);
    for (const { prefix, id } of conversations) {
      await quiet(async () => {
        const unread = await f.request(`${prefix}/conversations/${id}/unread`, outsider);
        expect(unread.status).toBe(403);
      });
      expect(
        ((await (await f.request(`${prefix}/conversations/${id}/unread`, bob)).json()) as any)
          .unread,
      ).toBe(0);
    }
    await quiet(async () => {
      for (const selector of ["bob", bob.account.id]) {
        const restoredForgery = await f.request(
          `/api/v1/dms/charlie/messages?user=${encodeURIComponent(selector)}`,
          alice,
        );
        expect(restoredForgery.status).toBe(403);
        expect(await restoredForgery.text()).not.toContain("bob-charlie-private");
      }
    });
    expect(
      await (await f.request(`/api/v1/conversations/${otherId}/messages`, bob)).json(),
    ).toEqual(independentBefore);
  } finally {
    for (const observer of witnesses) observer.close();
    await f.dispose();
  }
}, 90000);

it("channel invite revocation and leaving are actor-bound operations", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const created = await f.request("/api/v1/channels", alice, "POST", {
      name: "#alias-room",
      privacy: "secret",
      inviteOnly: true,
    });
    expect(created.status).toBe(201);
    const room = "/api/v1/channels/%23alias-room";
    expect((await f.request(`${room}/invites`, alice, "POST", { username: "bob" })).status).toBe(
      200,
    );
    expect((await f.request(`${room}/invites/bob`, charlie, "DELETE")).status).toBe(403);
    expect((await f.request(`${room}/join`, bob, "POST", {})).status).toBe(200);
    expect((await f.request(`${room}/leave`, charlie, "POST")).status).toBe(403);
    expect((await f.request(`${room}/leave`, bob, "POST")).status).toBe(200);
    expect((await f.request(`${room}/members`, bob)).status).toBe(403);
    expect((await f.request(`${room}/invites`, alice, "POST", { username: "bob" })).status).toBe(
      200,
    );
    expect((await f.request(`${room}/invites/bob`, alice, "DELETE")).status).toBe(200);
    expect((await f.request(`${room}/join`, bob, "POST", {})).status).toBe(403);
    await f.restart();
    expect((await f.request(`${room}/members`, alice)).status).toBe(200);
    expect((await f.request(`${room}/join`, bob, "POST", {})).status).toBe(403);
  } finally {
    await f.dispose();
  }
}, 60000);

it("session and credential endpoints reject anonymous requests and foreign session revocation", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      second = await f.login("alice", alice.password);
    expect((await f.request("/api/v1/auth/sessions")).status).toBe(401);
    expect(
      (
        await f.request("/api/v1/auth/credentials", undefined, "POST", {
          label: "reader",
          expiresAt: Date.now() + 60000,
          scopes: [{ operation: "rest.get", resource: "/api/v1/profiles/alice" }],
        })
      ).status,
    ).toBe(401);
    const sessions = await f.request("/api/v1/auth/sessions", second);
    expect(sessions.status).toBe(200);
    const own = ((await sessions.json()) as any).sessions.find((session: any) => session.current);
    expect(own.id).toBeTruthy();
    expect((await f.request(`/api/v1/auth/sessions/${own.id}`, bob, "DELETE")).status).toBe(403);
    expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(200);
    const credential = await f.request("/api/v1/auth/credentials", alice, "POST", {
      label: "reader",
      expiresAt: Date.now() + 60000,
      scopes: [{ operation: "rest.get", resource: "/api/v1/profiles/alice" }],
    });
    expect(credential.status).toBe(200);
    expect(((await credential.json()) as any).credential.id).toBeTruthy();
    expect((await f.request(`/api/v1/auth/sessions/${own.id}`, alice, "DELETE")).status).toBe(200);
    expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(401);
  } finally {
    await f.dispose();
  }
}, 45000);
