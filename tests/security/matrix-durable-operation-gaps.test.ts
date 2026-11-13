import { createHash, createHmac, pbkdf2Sync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  createDurableOperationFixture,
  eventually,
} from "../helpers/durable-operation-gap-fixture";
import type { MatrixActor } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createDurableOperationFixture>>;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function trace(name: string, value: unknown) {
  const file = process.env.FLARC_DURABLE_OPERATION_TRACE;
  if (!file) return;
  const prior = await readFile(file, "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  prior[name] = value;
  await writeFile(file, JSON.stringify(prior, null, 2));
}
async function join(client: TestIRCClient, channel: string) {
  const done = client.waitForNewLine((line) => line.includes(" 366 ") && line.includes(channel));
  client.send(`JOIN ${channel}`);
  await done;
}
async function publish(
  f: Fixture,
  who: MatrixActor,
  channel: string,
  content: string,
  key?: string,
) {
  const response = await f.request(
    `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
    who,
    "POST",
    { content },
    key ? { "idempotency-key": key } : undefined,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as any).message;
}
function persistentChannel(state: any) {
  const { channel_members: _members, ...persistent } = state;
  return persistent;
}
async function actors(f: Fixture) {
  return Promise.all([f.actor("alice"), f.actor("bob"), f.actor("charlie")]);
}
async function witnesses(f: Fixture, people: MatrixActor[], first = true, channels = ["#vault"]) {
  const clients = await Promise.all(people.map((p) => f.connect(p)));
  for (const channel of channels) {
    await join(clients[0], channel);
    if (first) {
      const set = clients[0].waitForNewLine((line) => line.includes(` MODE ${channel} +s`));
      clients[0].send(`MODE ${channel} +s`);
      await set;
    }
    await join(clients[1], channel);
  }
  for (const c of clients) await join(c, "#barrier");
  await join(clients[2], "#unrelated");
  if (first) await publish(f, people[2], "#unrelated", "durable-unrelated-sentinel");
  const events = await Promise.all(people.map((p) => f.event(p)));
  async function barrier() {
    const marker = `durable-barrier-${randomUUID()}`;
    await publish(f, people[0], "#barrier", marker);
    await eventually(
      () =>
        clients.every((c) => c.lines.some((l) => l.includes(marker))) &&
        events.every((e) => e.lines.some((l) => l.includes(marker))),
      "all independent IRC/event observers live",
    );
    return marker;
  }
  async function silence(
    action: () => Promise<unknown>,
    allowedReply?: (line: string, index: number) => boolean,
  ) {
    await barrier();
    const ci = clients.map((c) => c.lines.length),
      ei = events.map((e) => e.lines.length);
    await action();
    const marker = await barrier();
    clients.forEach((c, i) => {
      expect(
        c.lines.slice(ci[i]).filter((l) => !l.includes(marker) && !allowedReply?.(l, i)),
      ).toEqual([]);
    });
    events.forEach((e, i) => {
      expect(e.lines.slice(ei[i]).filter((l) => !l.includes(marker))).toEqual([]);
    });
  }
  async function delivered(content: string, channel = "#vault") {
    await eventually(
      () =>
        [0, 1].every(
          (i) =>
            clients[i].lines.some((l) => l.includes(` PRIVMSG ${channel} :${content}`)) &&
            events[i].lines.some((l) => l.includes(content)),
        ),
      "authorized IRC and event delivery",
    );
    await barrier();
    expect(clients[2].lines.join("\n")).not.toContain(content);
    expect(events[2].lines.join("\n")).not.toContain(content);
  }
  return { clients, events, barrier, silence, delivered };
}
function identity(state: any) {
  return Object.fromEntries(
    ["users", "registered_nicks", "scram_credentials", "account_roles", "account_settings"].map(
      (t) => [t, state[t]],
    ),
  );
}
function checkCredentials(user: any, scram: any, password: string, foreignPassword: string) {
  const [kind, iterations, salt, key] = user.password_hash.split(":");
  expect(kind).toBe("pbkdf2");
  expect(Number(iterations)).toBe(100000);
  expect(Buffer.from(salt, "hex")).toHaveLength(16);
  expect(
    pbkdf2Sync(password, Buffer.from(salt, "hex"), Number(iterations), 32, "sha256").toString(
      "hex",
    ),
  ).toBe(key);
  expect(
    pbkdf2Sync(
      foreignPassword,
      Buffer.from(salt, "hex"),
      Number(iterations),
      32,
      "sha256",
    ).toString("hex"),
  ).not.toBe(key);
  expect(scram.iterations).toBe(100000);
  expect(Buffer.from(scram.salt, "base64")).toHaveLength(16);
  const salted = pbkdf2Sync(
    password,
    Buffer.from(scram.salt, "base64"),
    scram.iterations,
    32,
    "sha256",
  );
  const client = createHmac("sha256", salted).update("Client Key").digest();
  expect(Buffer.from(scram.stored_key, "base64").toString("hex")).toBe(digest(client));
  expect(Buffer.from(scram.server_key, "base64").toString("hex")).toBe(
    createHmac("sha256", salted).update("Server Key").digest("hex"),
  );
}

it("DB-001: public registration commits one complete canonical identity with independent credentials and empty privilege defaults across recreation", async () => {
  const f = await createDurableOperationFixture();
  try {
    const people = await actors(f),
      [alice, bob] = people;
    const w = await witnesses(f, people),
      before = await f.accounts(),
      unrelated = await f.channel("#unrelated");
    await w.silence(async () => {
      for (const body of [
        { username: "ALICE", password: `Duplicate-${randomUUID()}` },
        { username: "weakuser", password: "x" },
        { username: "NickServ", password: `Reserved-${randomUUID()}` },
        { username: "injectedrole", password: `Injected-${randomUUID()}`, roles: ["admin"] },
      ])
        expect((await f.request("/api/v1/auth/register", null, "POST", body)).status).toBe(400);
    });
    expect(await f.accounts()).toEqual(before);
    const password = `Delta-${randomUUID()}!`,
      start = Date.now();
    const response = await f.request("/api/v1/auth/register", null, "POST", {
      username: "Delta",
      password,
      displayName: "Delta Display",
    });
    expect(response.status).toBe(201);
    const created = ((await response.json()) as any).account,
      finish = Date.now();
    expect(created.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(created.roles).toEqual([]);
    const stored = await f.accounts(),
      user = stored.users.find((r: any) => r.id === created.id),
      scram = stored.scram_credentials.find((r: any) => r.user_id === created.id);
    expect(user).toEqual({
      id: created.id,
      username: "Delta",
      canonical_username: "delta",
      credential_version: 0,
      display_name: "Delta Display",
      password_hash: expect.any(String),
      created_at: created.createdAt,
      updated_at: created.createdAt,
      disabled_at: null,
    });
    expect(user.created_at).toBeGreaterThanOrEqual(start);
    expect(user.created_at).toBeLessThanOrEqual(finish);
    expect(stored.users.filter((r: any) => r.canonical_username === "delta")).toHaveLength(1);
    expect(stored.scram_credentials.filter((r: any) => r.user_id === created.id)).toHaveLength(1);
    checkCredentials(user, scram, password, alice.password);
    expect(stored.registered_nicks.filter((r: any) => r.user_id === created.id)).toEqual([
      { nickname: "delta", user_id: created.id, registered_at: created.createdAt },
    ]);
    for (const table of ["account_roles", "account_settings", "api_sessions"])
      expect(stored[table].filter((r: any) => r.user_id === created.id)).toEqual([]);
    for (const table of [
      "users",
      "registered_nicks",
      "scram_credentials",
      "account_roles",
      "account_settings",
      "api_sessions",
    ])
      expect(stored[table].filter((r: any) => (r.user_id ?? r.id) !== created.id)).toEqual(
        before[table],
      );
    expect(await f.channel("#unrelated")).toEqual(unrelated);
    await f.stop();
    expect((await f.snapshot("users")).find((r) => r.id === created.id)).toEqual(user);
    expect((await f.snapshot("scram_credentials")).find((r) => r.user_id === created.id)).toEqual(
      scram,
    );
    await f.restart();
    expect(identity(await f.accounts())).toEqual(identity(stored));
    const delta = await f.login("dElTa", password);
    expect(delta.account.id).toBe(created.id);
    expect(delta.account.roles).toEqual([]);
    const session = (await f.accounts()).api_sessions.filter((s: any) => s.user_id === created.id);
    expect(session).toHaveLength(1);
    expect(session[0].token_hash).toBe(digest(delta.token));
    const fresh = await witnesses(f, people, false);
    await join(await f.connect(delta, "Delta"), "#vault");
    const marker = `new-identity-${randomUUID()}`;
    await publish(f, delta, "#vault", marker);
    await fresh.delivered(marker);
    const members = (await f.channel("#vault")).channel_members;
    expect(members.find((m: any) => m.nickname === "Delta").user_id).toBe(created.id);
    expect(persistentChannel(await f.channel("#unrelated"))).toEqual(persistentChannel(unrelated));
    expect(alice.password).not.toBe(bob.password);
    await trace("registration", {
      canonicalIdentity: "delta",
      completeUsers: 1,
      nickRows: 1,
      scramRows: 1,
      defaultRoleRows: 0,
      registrationApiSessions: 0,
      afterLoginApiSessions: 1,
      independentPbkdf2AndScramDerivation: true,
      recreated: true,
    });
  } finally {
    await f.dispose();
  }
}, 60000);

it("DB-002: recreated workerd reads each persisted credential and rejects swapped foreign and wrong passwords without durable sessions or protected output", async () => {
  const f = await createDurableOperationFixture();
  try {
    const people = await actors(f),
      [alice, bob] = people;
    const credentials = identity(await f.accounts());
    let w = await witnesses(f, people),
      sentinel = persistentChannel(await f.channel("#unrelated"));
    let denied = 0;
    for (const phase of ["original", "recreated"]) {
      const before = await f.accounts();
      await w.silence(async () => {
        for (const [username, password] of [
          [alice.username, bob.password],
          [bob.username, alice.password],
          [alice.username, `wrong-${randomUUID()}`],
          ["missingaccount", alice.password],
        ]) {
          const bad = await f.request("/api/v1/auth/login", null, "POST", { username, password });
          expect(bad.status).toBe(401);
          const body = (await bad.json()) as any;
          expect(body.token).toBeUndefined();
          expect(body.account).toBeUndefined();
          denied++;
        }
      });
      const after = await f.accounts();
      expect(identity(after)).toEqual(credentials);
      expect(after.api_sessions).toEqual(before.api_sessions);
      expect(after.event_tickets).toEqual(before.event_tickets);
      expect(persistentChannel(await f.channel("#unrelated"))).toEqual(sentinel);
      const marker = `credential-control-${phase}-${randomUUID()}`;
      await publish(f, alice, "#vault", marker);
      await w.delivered(marker);
      if (phase === "original") {
        await f.stop();
        expect(await f.snapshot("api_sessions")).toHaveLength(3);
        await f.restart();
        expect(identity(await f.accounts())).toEqual(credentials);
        w = await witnesses(f, people, false);
      }
    }
    const freshAlice = await f.login("ALICE", alice.password),
      freshBob = await f.login("BoB", bob.password);
    expect(freshAlice.account.id).toBe(alice.account.id);
    expect(freshBob.account.id).toBe(bob.account.id);
    expect(freshAlice.token).not.toBe(freshBob.token);
    const sessions = (await f.accounts()).api_sessions;
    for (const who of [freshAlice, freshBob])
      expect(sessions.find((s: any) => s.token_hash === digest(who.token)).user_id).toBe(
        who.account.id,
      );
    await trace("login", {
      deniedPublicLogins: denied,
      preAndPostRecreationIdentityAndCredentialRowsUnchanged: true,
      denialsAddedSessions: 0,
      freshSessionPrincipalMappings: 2,
      liveIrcAndEventWitnesses: 3,
    });
  } finally {
    await f.dispose();
  }
}, 60000);

it("DB-017 DB-024: committed message keys and unique role assignments survive reconstruction and replay without duplicate rows sequences or recipient delivery", async () => {
  const f = await createDurableOperationFixture();
  try {
    const people = await actors(f),
      [alice, bob, charlie] = people;
    let w = await witnesses(f, people, true, ["#vault", "#second"]);
    const unrelated = persistentChannel(await f.channel("#unrelated")),
      key = `durable-key-${randomUUID()}`;
    const made = await f.request("/api/v1/channels/%23vault/roles", alice, "POST", {
      name: "DurableVoice",
      ircMode: "v",
      permissions: ["send_messages"],
    });
    expect(made.status).toBe(201);
    const role = ((await made.json()) as any).role;
    const assignment = { userId: bob.account.id, roleGroupId: role.id };
    const assign = () =>
      f.request("/api/v1/channels/%23vault/roles/assign", alice, "POST", assignment);
    const assigned = await Promise.all(Array.from({ length: 8 }, assign));
    expect(assigned.map((r) => r.status)).toEqual(Array(8).fill(200));
    await eventually(
      () =>
        w.events
          .slice(0, 2)
          .every((e) =>
            e.lines.some((l) => l.includes("channel.member_role_changed") && l.includes(role.id)),
          ),
      "actual committed role assignment events",
    );
    const target = await f.channel("#vault");
    expect(target.channel_user_roles).toHaveLength(1);
    expect(target.channel_user_roles[0]).toMatchObject({
      user_id: bob.account.id,
      group_id: role.id,
    });
    const post = () => publish(f, alice, "#vault", "durable-key-body", key);
    const messages = await Promise.all(Array.from({ length: 12 }, post)),
      canonical = messages[0];
    expect(new Set(messages.map((m) => m.id)).size).toBe(1);
    expect(canonical.sequence).toBe(1);
    await w.delivered("durable-key-body");
    for (const i of [0, 1]) {
      expect(w.clients[i].lines.filter((l) => l.includes(`msgid=${canonical.id}`))).toHaveLength(1);
      expect(
        w.events[i].lines.filter((l) => JSON.parse(l).messageId === canonical.id),
      ).toHaveLength(1);
      expect(
        w.events[i].lines.filter(
          (l) => l.includes("channel.member_role_changed") && l.includes(role.id),
        ),
      ).toHaveLength(1);
    }
    const distinct = await Promise.all([
      publish(f, bob, "#vault", "bob-same-key", key),
      publish(f, alice, "#second", "alice-second-key", key),
      publish(f, bob, "#second", "bob-second-key", key),
    ]);
    expect(new Set([canonical, ...distinct].map((m) => m.id)).size).toBe(4);
    await w.delivered("bob-same-key");
    await w.delivered("alice-second-key", "#second");
    await w.delivered("bob-second-key", "#second");
    const committed = await f.channel("#vault"),
      second = await f.channel("#second");
    expect(committed.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: canonical.id,
          sender_id: alice.account.id,
          sequence: 1,
          content: "durable-key-body",
        }),
        expect.objectContaining({
          id: distinct[0].id,
          sender_id: bob.account.id,
          sequence: 2,
          content: "bob-same-key",
        }),
      ]),
    );
    expect(second.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: distinct[1].id,
          sender_id: alice.account.id,
          content: "alice-second-key",
        }),
        expect.objectContaining({
          id: distinct[2].id,
          sender_id: bob.account.id,
          content: "bob-second-key",
        }),
      ]),
    );
    expect(committed.messages.map((m: any) => m.sequence).sort()).toEqual([1, 2]);
    expect(second.messages.map((m: any) => m.sequence).sort()).toEqual([1, 2]);
    await f.stop();
    expect((await f.snapshot("messages")).filter((r) => r.id === canonical.id)).toHaveLength(1);
    expect(
      (await f.snapshot("channel_user_roles")).filter(
        (r) => r.user_id === bob.account.id && r.group_id === role.id,
      ),
    ).toEqual(committed.channel_user_roles);
    await f.restart();
    w = await witnesses(f, people, false, ["#vault", "#second"]);
    expect(persistentChannel(await f.channel("#vault"))).toEqual(persistentChannel(committed));
    await w.silence(async () => {
      expect(await post()).toEqual(canonical);
      expect((await assign()).status).toBe(200);
      expect(
        (
          await f.request(
            "/api/v1/channels/%23vault/messages",
            alice,
            "POST",
            { content: "conflicting-retry" },
            { "idempotency-key": key },
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await f.request(
            "/api/v1/channels/%23vault/messages",
            charlie,
            "POST",
            { content: "foreign-retry" },
            { "idempotency-key": key },
          )
        ).status,
      ).toBe(403);
      expect(
        (await f.request("/api/v1/channels/%23vault/roles/assign", bob, "POST", assignment)).status,
      ).toBe(403);
    });
    expect(persistentChannel(await f.channel("#vault"))).toEqual(persistentChannel(committed));
    expect(persistentChannel(await f.channel("#second"))).toEqual(persistentChannel(second));
    expect(persistentChannel(await f.channel("#unrelated"))).toEqual(unrelated);
    const next = await publish(
      f,
      alice,
      "#vault",
      "sequence-after-replayed-commit",
      `next-${randomUUID()}`,
    );
    expect(next.sequence).toBe(3);
    await w.delivered("sequence-after-replayed-commit");
    expect((await f.channel("#vault")).channel_user_roles).toEqual(committed.channel_user_roles);
    await trace("retry", {
      initialConcurrentRetries: 12,
      canonicalMessageId: canonical.id,
      distinctAccountChannelKeys: 4,
      roleAssignmentRows: 1,
      concurrentAssignmentRequests: 8,
      afterRestartReplayExtraMessages: 0,
      afterRestartReplayExtraRoleRows: 0,
      afterRestartReplayExtraRecipientPublications: 0,
      nextSequence: next.sequence,
    });
  } finally {
    await f.dispose();
  }
}, 60000);

it("DB-017: concurrent role deletion assignment and sends preserve exact accepted messages and absent privileges after full workerd recreation", async () => {
  const f = await createDurableOperationFixture();
  try {
    const people = await actors(f),
      [alice, bob] = people;
    let w = await witnesses(f, people);
    const unrelated = persistentChannel(await f.channel("#unrelated"));
    const founderGrants = (await f.channel("#vault")).channel_permissions;
    expect(founderGrants).toEqual([
      { user_id: alice.account.id, account_name: alice.username, permission: "q" },
    ]);
    const mode = w.clients[0].waitForNewLine((l) => l.includes(" MODE #vault +m"));
    w.clients[0].send("MODE #vault +m");
    await mode;
    const made = await f.request("/api/v1/channels/%23vault/roles", alice, "POST", {
      name: "TemporaryVoice",
      ircMode: "v",
      permissions: ["send_messages"],
    });
    expect(made.status).toBe(201);
    const role = ((await made.json()) as any).role,
      assignment = { userId: bob.account.id, roleGroupId: role.id };
    const assign = () =>
      f.request("/api/v1/channels/%23vault/roles/assign", alice, "POST", assignment);
    expect((await assign()).status).toBe(200);
    const control = await publish(f, bob, "#vault", "role-positive-control");
    await w.delivered("role-positive-control");
    const raceMarker = `durable-role-race-${randomUUID()}`;
    const raceBodies = Array.from({ length: 8 }, (_, i) => `${raceMarker}-${i}`);
    const operations = await Promise.all([
      f.request(`/api/v1/channels/%23vault/roles/${role.id}`, alice, "DELETE"),
      ...raceBodies.map((content) =>
        f.request("/api/v1/channels/%23vault/messages", bob, "POST", {
          content,
        }),
      ),
      ...Array.from({ length: 4 }, assign),
    ]);
    expect(operations[0].status).toBe(200);
    const accepted = [control];
    const raceOutcomes: Array<{ content: string; status: number; id?: string; sequence?: number }> =
      [];
    for (const [i, response] of operations.slice(1, 9).entries()) {
      expect([201, 400]).toContain(response.status);
      const content = raceBodies[i];
      if (response.status === 201) {
        const message = ((await response.json()) as any).message;
        expect(message.content).toBe(content);
        accepted.push(message);
        raceOutcomes.push({
          content,
          status: response.status,
          id: message.id,
          sequence: message.sequence,
        });
      } else {
        raceOutcomes.push({ content, status: response.status });
      }
    }
    for (const r of operations.slice(9)) expect([200, 404]).toContain(r.status);
    for (const message of accepted) await w.delivered(message.content);
    await eventually(
      () =>
        w.events
          .slice(0, 2)
          .every((e) =>
            e.lines.some((l) => l.includes("channel.role_deleted") && l.includes(role.id)),
          ),
      "authorized deletion events",
    );
    await w.barrier();
    for (const outcome of raceOutcomes.filter((outcome) => outcome.status === 400)) {
      for (const observer of [...w.clients, ...w.events])
        expect(observer.lines.join("\n")).not.toContain(outcome.content);
    }
    for (const message of accepted) {
      for (const i of [0, 1]) {
        expect(
          w.clients[i].lines.filter((line) => line.includes(`msgid=${message.id}`)),
        ).toHaveLength(1);
        expect(
          w.events[i].lines.filter((line) => JSON.parse(line).messageId === message.id),
        ).toHaveLength(1);
      }
    }
    for (const observer of [w.clients[2], w.events[2]]) {
      expect(observer.lines.join("\n")).not.toContain(raceMarker);
      expect(observer.lines.join("\n")).not.toContain(role.id);
      expect(observer.lines.join("\n")).not.toContain(role.name);
    }
    expect(w.clients[2].lines.filter((line) => line.includes(" MODE #vault "))).toEqual([]);
    expect(
      w.events[2].lines.filter((line) => {
        const event = JSON.parse(line);
        return (
          event.channelId === "#vault" &&
          (event.type.startsWith("channel.role_") || event.type === "channel.member_role_changed")
        );
      }),
    ).toEqual([]);
    for (const phase of ["after-commit", "after-recreation"]) {
      await w.silence(
        async () => {
          expect(
            (
              await f.request("/api/v1/channels/%23vault/messages", bob, "POST", {
                content: `denied-rest-${phase}`,
              })
            ).status,
          ).toBe(400);
          const denied = w.clients[1].waitForNewLine((l) => l.includes(" 404 "));
          w.clients[1].send(`PRIVMSG #vault :denied-irc-${phase}`);
          await denied;
          expect((await assign()).status).toBe(404);
          expect(
            (await f.request("/api/v1/channels/%23vault/roles/assign", bob, "POST", assignment))
              .status,
          ).toBe(403);
        },
        (line, index) => index === 1 && line.includes(" 404 "),
      );
      const state = await f.channel("#vault");
      expect(state.channel_role_groups).toEqual([]);
      expect(state.channel_user_roles).toEqual([]);
      expect(state.channel_permissions).toEqual(founderGrants);
      expect(state.channel_members.filter((m: any) => m.user_id === bob.account.id)).toHaveLength(
        1,
      );
      expect(
        state.channel_members
          .filter((m: any) => m.user_id === bob.account.id)
          .every((m: any) => !/[vhoaq]/.test(m.modes)),
      ).toBe(true);
      const sorted = [...accepted].sort((a, b) => a.sequence - b.sequence);
      expect(
        state.messages
          .sort((a: any, b: any) => a.sequence - b.sequence)
          .map((m: any) => ({
            id: m.id,
            sequence: m.sequence,
            content: m.content,
            sender_id: m.sender_id,
          })),
      ).toEqual(
        sorted.map((m) => ({
          id: m.id,
          sequence: m.sequence,
          content: m.content,
          sender_id: bob.account.id,
        })),
      );
      expect(sorted.map((m) => m.sequence)).toEqual(
        Array.from({ length: sorted.length }, (_, i) => i + 1),
      );
      expect(persistentChannel(await f.channel("#unrelated"))).toEqual(unrelated);
      if (phase === "after-commit") {
        await f.stop();
        expect(await f.snapshot("channel_user_roles")).toEqual([]);
        expect(await f.snapshot("channel_role_groups")).toEqual([]);
        await f.restart();
        w = await witnesses(f, people, false);
      }
    }
    const next = await publish(f, alice, "#vault", "founder-healthy-after-race");
    expect(next.sequence).toBe(accepted.length + 1);
    await w.delivered("founder-healthy-after-race");
    await trace("roleRace", {
      racingSends: 8,
      raceOutcomes,
      deletedRoleId: role.id,
      rejectedRaceBodiesObservedOnIrcOrEvents: 0,
      authorizedDeliveriesPerAcceptedCanonicalId: { irc: 1, events: 1 },
      outsiderRaceOrRolePublications: 0,
      concurrentAssignments: 4,
      acceptedMessages: accepted.map((m) => ({ id: m.id, sequence: m.sequence })),
      deletedRoleRows: 0,
      deletedAssignmentRows: 0,
      recreatedDenialsAndRecipientSilence: true,
      healthyNextSequence: next.sequence,
    });
  } finally {
    await f.dispose();
  }
}, 60000);
