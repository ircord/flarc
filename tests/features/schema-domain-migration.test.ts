import { expect, it } from "vitest";
import {
  type Actor,
  channelTables,
  domainMigrationFixture,
  operation,
  sessionTables,
} from "../helpers/schema-domain-migration-fixture";

type Fixture = Awaited<ReturnType<typeof domainMigrationFixture>>;
async function json(
  f: Fixture,
  route: string,
  actor: Actor,
  method = "GET",
  body?: unknown,
  status = 200,
) {
  const response = await f.request(route, actor, method, body);
  expect(response.status, `${method} ${route}`).toBe(status);
  return (await response.json()) as any;
}

it("preserves Channel identities, role authorization and FTS across dropped-table rollback, retry and restart", async () => {
  const f = await domainMigrationFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      outsider = await f.actor("charlie");
    const room = "/api/v1/channels/%23migration",
      base = `${room}/messages`;
    const created = await json(
      f,
      "/api/v1/channels",
      alice,
      "POST",
      { name: "#migration", privacy: "secret" },
      201,
    );
    expect(created.generation).toBeTruthy();
    await json(f, `${room}/join`, bob, "POST", {});
    const role = (
      await json(
        f,
        `${room}/roles`,
        alice,
        "POST",
        { name: "moderator", priority: 7, permissions: ["change_topic"] },
        201,
      )
    ).role;
    await json(f, `${room}/roles/assign`, alice, "POST", {
      userId: bob.account.id,
      roleGroupId: role.id,
    });
    const original = (await json(f, base, alice, "POST", { content: "migrationbeforeterm" }, 201))
      .message;
    const edited = (
      await json(f, `${base}/${original.id}`, alice, "PATCH", { content: "migrationafterterm" })
    ).message;
    const removed = (await json(f, base, alice, "POST", { content: "migrationredactterm" }, 201))
      .message;
    await json(f, `${base}/${removed.id}`, alice, "DELETE");
    expect(edited.id).toBe(original.id);
    const searchBefore = await json(f, `${base}/search?q=migrationafterterm`, bob);
    expect(searchBefore.messages.map((message: any) => message.id)).toEqual([original.id]);
    expect((await f.request(`${base}/search?q=migrationafterterm`, outsider)).status).toBe(403);
    const historyBefore = await json(f, base, bob);
    const roleBefore = await json(f, `${room}/roles`, alice);
    const before = await f.snapshot("channel");
    expect(before.modeled).toEqual(
      expect.arrayContaining([
        "messages",
        "channel_role_groups",
        "channel_user_roles",
        "channel_feature_outbox",
      ]),
    );
    expect(before.unmodeled).toEqual(
      expect.arrayContaining(["messages_fts", "messages_fts_data", "messages_fts_idx"]),
    );
    expect(before.counts.messages).toBeGreaterThanOrEqual(2);
    expect(before.counts.channel_role_groups).toBeGreaterThan(0);
    expect(before.counts.channel_user_roles).toBeGreaterThan(0);
    expect(before.counts.messages_fts).toBe(1);
    expect(
      Object.keys(before.data).filter((name) => name.startsWith("messages_fts")).length,
    ).toBeGreaterThan(1);
    const options = { tables: channelTables, version: 801 };
    await f.dependency("channel", true);
    const unknownChannel = await f.snapshot("channel");
    expect((await f.migrate("channel", options)).error).toMatch(
      /Unapproved dependent table: unknown_dependency/,
    );
    expect(await f.snapshot("channel")).toEqual(unknownChannel);
    await f.dependency("channel", false);
    expect(await f.snapshot("channel")).toEqual(before);
    expect(await f.migrate("channel", { ...options, fault: "dropped" })).toEqual({
      error: "injected migration failure: dropped",
    });
    expect(await f.snapshot("channel")).toEqual(before);
    const migrated = await f.migrate("channel", options);
    expect(migrated.error).toBeUndefined();
    expect(migrated.result!.changed).toEqual(
      expect.arrayContaining(["messages", "channel_role_groups"]),
    );
    const after = await f.snapshot("channel");
    console.info(
      "Channel schema model differences",
      JSON.stringify({
        before: before.modelDiff,
        after: after.modelDiff,
        unmodeled: after.unmodeled,
      }),
    );
    expect(after.data).toEqual(before.data);
    expect(after.counts).toEqual(before.counts);
    expect(after.objects).toEqual(before.objects);
    expect(after.fk).toEqual([]);
    expect(after.unmodeled).toEqual(before.unmodeled);
    expect(after.provider).toEqual(before.provider);
    expect(await f.migrate("channel", options)).toEqual({
      result: { changed: [], preserved: [], rows: 0 },
    });
    expect(await f.snapshot("channel")).toEqual(after);
    expect(await json(f, `${base}/search?q=migrationafterterm`, bob)).toEqual(searchBefore);
    expect(await json(f, base, bob)).toEqual(historyBefore);
    expect(await json(f, `${room}/roles`, alice)).toEqual(roleBefore);
    expect((await json(f, `${base}/search?q=migrationredactterm`, bob)).messages).toEqual([]);
    expect((await f.request(`${room}/roles`, outsider)).status).toBe(403);
    expect(
      (await f.request(`${room}/info`, bob, "PATCH", { topic: "authorized after migration" }))
        .status,
    ).toBe(200);
    const beforeDenied = await f.snapshot("channel");
    const deniedSession = await f.snapshot("session");
    const denied = await f.request(`${room}/info`, outsider, "PATCH", { topic: "denied" });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("authorized after migration");
    expect(await f.snapshot("channel")).toEqual(beforeDenied);
    expect(await f.snapshot("session")).toEqual(deniedSession);
  } finally {
    await f.close();
  }
}, 90000);

it("preserves Session DM confidentiality, read markers, idempotency and journal across rollback, retry and restart", async () => {
  const f = await domainMigrationFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      outsider = await f.actor("charlie");
    const create = { peer: bob.account.id, clientOperationId: operation() };
    const conversation = (await json(f, "/api/v1/conversations", alice, "POST", create))
      .conversation;
    const base = `/api/v1/conversations/${conversation.id}`;
    const send = { content: "session-migration-secret", clientOperationId: operation() };
    const message = (await json(f, `${base}/messages`, alice, "POST", send)).message;
    expect((await json(f, `${base}/messages`, alice, "POST", send)).message).toEqual(message);
    await json(f, `${base}/read`, bob, "POST", {
      messageId: message.id,
      clientOperationId: operation(),
    });
    expect((await json(f, `${base}/unread`, bob)).unread).toBe(0);
    const updated = (
      await json(f, `${base}/messages/${message.id}`, alice, "PATCH", {
        content: "session-migration-edited",
        expectedRevision: 0,
        clientOperationId: operation(),
      })
    ).message;
    const redactTarget = (
      await json(f, `${base}/messages`, alice, "POST", {
        content: "redacted-session-secret",
        clientOperationId: operation(),
      })
    ).message;
    const redacted = (
      await json(f, `${base}/messages/${redactTarget.id}`, alice, "DELETE", {
        expectedRevision: 0,
        clientOperationId: operation(),
      })
    ).message;
    expect(redacted).toMatchObject({ id: redactTarget.id, content: null, redacted: true });
    const history = await json(f, `${base}/messages`, bob);
    expect((await f.request(`${base}/messages`, outsider)).status).toBe(403);
    const before = await f.snapshot("session");
    expect(before.modeled).toEqual(
      expect.arrayContaining([
        "direct_messages",
        "conversations",
        "conversation_members",
        "feature_operations",
        "event_journal",
        "event_audience",
      ]),
    );
    for (const table of [
      "direct_messages",
      "conversations",
      "conversation_members",
      "feature_operations",
      "event_journal",
      "event_audience",
    ])
      expect(before.counts[table]).toBeGreaterThan(0);
    const options = { tables: sessionTables, version: 802 };
    await f.dependency("session", true);
    const unknownSession = await f.snapshot("session");
    expect((await f.migrate("session", options)).error).toMatch(
      /Unapproved dependent table: unknown_dependency/,
    );
    expect(await f.snapshot("session")).toEqual(unknownSession);
    await f.dependency("session", false);
    expect(await f.snapshot("session")).toEqual(before);
    expect(await f.migrate("session", { ...options, fault: "dropped" })).toEqual({
      error: "injected migration failure: dropped",
    });
    expect(await f.snapshot("session")).toEqual(before);
    const migrated = await f.migrate("session", options);
    expect(migrated.error).toBeUndefined();
    expect(migrated.result!.changed.length).toBeGreaterThan(0);
    const after = await f.snapshot("session");
    console.info(
      "Session schema model differences",
      JSON.stringify({
        before: before.modelDiff,
        after: after.modelDiff,
        unmodeled: after.unmodeled,
      }),
    );
    expect(after.data).toEqual(before.data);
    expect(after.counts).toEqual(before.counts);
    expect(after.objects).toEqual(before.objects);
    expect(after.fk).toEqual([]);
    expect(after.unmodeled).toEqual(before.unmodeled);
    expect(after.provider).toEqual(before.provider);
    expect(await f.migrate("session", options)).toEqual({
      result: { changed: [], preserved: [], rows: 0 },
    });
    expect(await f.snapshot("session")).toEqual(after);
    expect(await json(f, `${base}/messages`, bob)).toEqual(history);
    expect((await json(f, `${base}/messages/${message.id}`, bob)).message).toEqual(updated);
    expect((await json(f, `${base}/unread`, bob)).unread).toBe(0);
    expect((await json(f, `${base}/messages`, alice, "POST", send)).message).toEqual(message);
    const denied = await f.request(`${base}/messages`, outsider);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("session-migration-edited");
  } finally {
    await f.close();
  }
}, 90000);
