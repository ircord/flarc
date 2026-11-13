import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare, Response as MiniflareResponse } from "miniflare";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import {
  createMiniflareServer,
  ensureNitroBuilt,
  TestIRCClient,
} from "../helpers/miniflare-harness";

async function sqliteFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sqliteFiles(file)));
    else if (entry.name.endsWith(".sqlite")) files.push(file);
  }
  return files;
}

async function persistentFixture() {
  const f = await createMatrixFixture();
  let server = f.server,
    stopped = false;
  const clients: TestIRCClient[] = [];
  const wrappers: string[] = [];
  const request = (
    route: string,
    actor?: MatrixActor | null,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(new URL(route, server.url), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function connect(actor: MatrixActor, nick = actor.username) {
    const client = new TestIRCClient(server.wsUrl);
    clients.push(client);
    await client.connect();
    client.send(`PASS ${actor.username}:${actor.password}`);
    await client.register(nick);
    return client;
  }
  async function stop() {
    for (const client of clients.splice(0)) client.close();
    await server.dispose();
    await f.stop();
    stopped = true;
  }
  async function start(
    webhookSink?: (body: string, url: string, secret: string | null) => number | undefined,
    alarmWrapper = false,
  ) {
    if (!stopped) throw new Error("Stop runtime before restarting");
    if (webhookSink || alarmWrapper) {
      let scriptPath = await ensureNitroBuilt();
      if (alarmWrapper) {
        const directory = await mkdtemp(path.join(tmpdir(), "flarc-alarm-wrapper-"));
        wrappers.push(directory);
        await cp(path.dirname(scriptPath), path.join(directory, "production"), { recursive: true });
        scriptPath = path.join(directory, "wrapper.mjs");
        await writeFile(
          scriptPath,
          `export { default, AccountsDO, SessionDO } from './production/index.mjs';
import { ChannelDO as ProductionChannelDO } from './production/index.mjs';
export class ChannelDO extends ProductionChannelDO {
  matrixRuns = 0; matrixWaiters = [];
  async alarm() { await super.alarm(); this.matrixRuns++; for (const resolve of this.matrixWaiters.splice(0)) resolve(this.matrixRuns); }
  matrixInvokeAlarm() { return super.alarm(); }
  matrixGetAlarm() { return this.ctx.storage.getAlarm(); }
  matrixSetAlarm(at) { return this.ctx.storage.setAlarm(at); }
  matrixDeleteAlarm() { return this.ctx.storage.deleteAlarm(); }
  matrixWaitAlarm(after) { return this.matrixRuns > after ? this.matrixRuns : new Promise(resolve => this.matrixWaiters.push(resolve)); }
}
`,
        );
      }
      const mf = new Miniflare({
        modules: true,
        scriptPath,
        modulesRoot: path.dirname(scriptPath),
        compatibilityDate: "2025-02-04",
        compatibilityFlags: ["nodejs_compat"],
        durableObjectsPersist: f.directory,
        bindings: { SIGNUP_POLICY: "open", OUTGOING_WEBHOOK_ALLOWED_HOSTS: "hooks.example.com" },
        durableObjects: {
          SESSION: { className: "SessionDO", useSQLite: true },
          CHANNELS: { className: "ChannelDO", useSQLite: true },
          ACCOUNTS: { className: "AccountsDO", useSQLite: true },
        },
        ...(webhookSink
          ? {
              outboundService: async (request: import("miniflare").Request) => {
                const status =
                  webhookSink(
                    await request.text(),
                    request.url,
                    request.headers.get("X-FlaRC-Secret"),
                  ) ?? 204;
                return new MiniflareResponse(null, {
                  status,
                  ...(status >= 300 && status < 400
                    ? { headers: { Location: "https://redirected.example.com/private-sink" } }
                    : {}),
                });
              },
            }
          : {}),
      });
      const url = await mf.ready;
      let disposed = false;
      server = {
        mf,
        url,
        wsUrl: `ws://${url.host}/irc`,
        dispose: async () => {
          if (!disposed) {
            disposed = true;
            await mf.dispose();
          }
        },
      };
    } else server = await createMiniflareServer({ durableObjectsPersist: f.directory });
    stopped = false;
  }
  async function database(table: string, channel?: string) {
    if (!stopped) throw new Error("SQLite inspection/fault injection requires stopped workerd");
    for (const file of await sqliteFiles(f.directory)) {
      const db = new DatabaseSync(file);
      if (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) &&
        (channel === undefined ||
          (db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as any)
            ?.value === channel)
      )
        return db;
      db.close();
    }
    throw new Error(`Missing ${table} database ${channel ?? ""}`);
  }
  return {
    ...f,
    request,
    connect,
    stop,
    start,
    database,
    get server() {
      return server;
    },
    async dispose() {
      await stop();
      await f.dispose();
      for (const directory of wrappers) await rm(directory, { recursive: true, force: true });
    },
  };
}

async function join(client: TestIRCClient, name: string) {
  client.send(`JOIN ${name}`);
  await client.waitForLine((l) => l.includes(" 366 ") && l.includes(name));
}
const base = (name: string) => `/api/v1/channels/${encodeURIComponent(name)}`;
async function post(
  f: Awaited<ReturnType<typeof persistentFixture>>,
  actor: MatrixActor,
  name: string,
  content: string,
  tags?: Record<string, string>,
) {
  const response = await f.request(`${base(name)}/messages`, actor, "POST", { content, tags });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as any).message;
}

it("[MSG-025 DB-015] failed SQL insertion emits no durable acknowledgement and rolls back the sequence reservation", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      outsider = await f.createActor("charlie");
    await join(await f.connect(alice), "#fault");
    const original = await post(f, alice, "#fault", "retained-before-insert-failure");
    await f.stop();
    const db = await f.database("messages", "#fault");
    const before = db.prepare("SELECT * FROM messages").all();
    const next = (
      db.prepare("SELECT value FROM channel_metadata WHERE key='next_sequence'").get() as any
    ).value;
    db.exec(
      "CREATE TRIGGER matrix_fail_insert BEFORE INSERT ON messages WHEN NEW.content = 'faulted-message' BEGIN SELECT RAISE(ABORT, 'matrix injected message insert failure'); END",
    );
    db.close();
    await f.start();
    const owner = await f.connect(alice),
      receiver = await f.connect(bob),
      unrelated = await f.connect(outsider);
    await join(owner, "#fault");
    await join(receiver, "#fault");
    for (const client of [owner, receiver, unrelated]) await join(client, "#barrier");
    const failed = await f.request(`${base("#fault")}/messages`, alice, "POST", {
      content: "faulted-message",
    });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toMatch(/matrix injected|sqlite|stack/i);
    const marker = `after-failed-insert-${randomUUID()}`;
    await post(f, alice, "#barrier", marker);
    await Promise.all([
      receiver.waitForLine((l) => l.includes(marker)),
      unrelated.waitForLine((l) => l.includes(marker)),
    ]);
    expect(receiver.lines.join("\n")).not.toContain("faulted-message");
    expect(unrelated.lines.join("\n")).not.toContain("faulted-message");
    expect(
      (
        await f.request(`${base("#fault")}/messages/${original.id}`, bob, "PATCH", {
          content: "forbidden-overwrite",
        })
      ).status,
    ).toBe(403);
    await f.stop();
    const final = await f.database("messages", "#fault");
    try {
      expect(final.prepare("SELECT * FROM messages").all()).toEqual(before);
      expect(
        final.prepare("SELECT message_id FROM messages_fts WHERE content MATCH 'faulted'").all(),
      ).toHaveLength(0);
      // A failed append must not leave a partial metadata write either.
      expect(
        final.prepare("SELECT value FROM channel_metadata WHERE key='next_sequence'").get(),
      ).toEqual({ value: next });
    } finally {
      final.close();
    }
  } finally {
    await f.dispose();
  }
});

it("[MSG-025 DB-015] a real SQL edit-lineage fault cannot leave an unacknowledged partial message in history", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    await join(await f.connect(alice), "#editfault");
    const original = await post(f, alice, "#editfault", "original-before-edit-fault");
    await f.stop();
    const db = await f.database("messages", "#editfault");
    const before = db.prepare("SELECT * FROM messages").all();
    db.exec(
      "CREATE TRIGGER matrix_fail_edit_lineage BEFORE INSERT ON message_edits BEGIN SELECT RAISE(ABORT, 'matrix injected edit lineage failure'); END",
    );
    db.close();
    await f.start();
    const owner = await f.connect(alice),
      receiver = await f.connect(bob);
    await join(owner, "#editfault");
    await join(receiver, "#editfault");
    const failure = await f.request(`${base("#editfault")}/messages`, alice, "POST", {
      content: "unacknowledged-edit-body",
      tags: { "+ircord/edit": original.id },
    });
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toMatch(/matrix injected|sqlite|stack/i);
    const marker = `edit-fault-barrier-${randomUUID()}`;
    await join(owner, "#barrier");
    await join(receiver, "#barrier");
    await post(f, alice, "#barrier", marker);
    await receiver.waitForLine((l) => l.includes(marker));
    expect(receiver.lines.join("\n")).not.toContain("unacknowledged-edit-body");
    const history = (await (await f.request(`${base("#editfault")}/messages`, bob)).json()) as any;
    expect
      .soft(history.messages.map((m: any) => m.content))
      .toEqual(["original-before-edit-fault"]);
    await f.stop();
    const final = await f.database("messages", "#editfault");
    try {
      expect(final.prepare("SELECT * FROM messages").all()).toEqual(before);
    } finally {
      final.close();
    }
  } finally {
    await f.dispose();
  }
});

it("[MSG-025 DB-015] an original-message UPDATE fault rolls back the append, lineage and FTS before publishing any event", async () => {
  const f = await persistentFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    await join(await f.connect(alice), "#updatefault");
    const original = await post(f, alice, "#updatefault", "unchanged-original-update-fault");
    await f.stop();
    const db = await f.database("messages", "#updatefault");
    const before = db.prepare("SELECT * FROM messages").all();
    const next = db.prepare("SELECT value FROM channel_metadata WHERE key='next_sequence'").get();
    db.exec(
      "CREATE TRIGGER matrix_fail_original_update BEFORE UPDATE OF content ON messages BEGIN SELECT RAISE(ABORT, 'matrix injected original update failure'); END",
    );
    db.close();
    await f.start();
    const owner = await f.connect(alice),
      receiver = await f.connect(bob),
      outsider = await f.connect(charlie);
    await join(owner, "#updatefault");
    await join(receiver, "#updatefault");
    for (const client of [owner, receiver, outsider]) await join(client, "#faultbarrier");
    const streams = new Map<WebSocket, string[]>();
    for (const actor of [alice, bob, charlie]) {
      const response = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(response.status).toBe(200);
      const socket = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await response.json()) as any).ticket}`,
      );
      sockets.push(socket);
      const values: string[] = [];
      streams.set(socket, values);
      socket.on("message", (data) => values.push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
    }
    const failed = await f.request(`${base("#updatefault")}/messages`, alice, "POST", {
      content: "must-rollback-failed-update",
      tags: { "+ircord/edit": original.id },
    });
    expect(failed.status).toBe(500);
    const marker = `after-update-fault-${randomUUID()}`;
    const barriers = sockets.map(
      (socket) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Missing event output barrier after failed update")),
            4000,
          );
          socket.on("message", (data) => {
            if (data.toString().includes(marker)) {
              clearTimeout(timer);
              resolve();
            }
          });
        }),
    );
    await post(f, alice, "#faultbarrier", marker);
    await Promise.all(barriers);
    await receiver.waitForLine((l) => l.includes(marker));
    await outsider.waitForLine((l) => l.includes(marker));
    for (const values of streams.values())
      expect(values.join("\n")).not.toContain("must-rollback-failed-update");
    expect(receiver.lines.join("\n")).not.toContain("must-rollback-failed-update");
    const history = (await (
      await f.request(`${base("#updatefault")}/messages`, alice)
    ).json()) as any;
    expect
      .soft(history.messages.map((m: any) => m.content))
      .toEqual(["unchanged-original-update-fault"]);
    for (const socket of sockets) socket.terminate();
    await f.stop();
    const final = await f.database("messages", "#updatefault");
    try {
      expect.soft(final.prepare("SELECT * FROM messages").all()).toEqual(before);
      expect.soft(final.prepare("SELECT * FROM message_edits").all()).toHaveLength(0);
      expect
        .soft(final.prepare("SELECT value FROM channel_metadata WHERE key='next_sequence'").get())
        .toEqual(next);
      expect(
        final.prepare("SELECT * FROM messages_fts WHERE content MATCH 'rollback'").all(),
      ).toHaveLength(0);
    } finally {
      final.close();
    }
  } finally {
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
});

it("[API-014 CHAN-010 DB-025] literal FTS punctuation, phrases and malformed text remain safe across REST and IRC without changing private history", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const owner = await f.connect(alice),
      member = await f.connect(bob),
      outsider = await f.connect(charlie);
    await join(owner, "#search");
    owner.send("MODE #search +s");
    await owner.waitForLine((l) => l.includes(" MODE #search +s"));
    await join(member, "#search");
    const hyphen = await post(f, alice, "#search", "private-replay-needle");
    const url = await post(f, alice, "#search", "https://example.com/a");
    const apostrophe = await post(f, alice, "#search", "can't stop this phrase");
    const phrase = await post(f, alice, "#search", "red blue");
    const separated = await post(f, alice, "#search", "red distant blue");
    const bobPhrase = await post(f, bob, "#search", "red blue bob");
    const before = await (await f.request(`${base("#search")}/messages`, alice)).json();
    const cases = [
      { q: "private-replay-needle", ids: [hyphen.id] },
      { q: "https://example.com/a", ids: [url.id] },
      { q: "can't", ids: [apostrophe.id] },
      { q: '"red blue"', ids: [phrase.id, bobPhrase.id] },
      { q: "red blue", ids: [phrase.id, separated.id, bobPhrase.id] },
      { q: 'from:bob "red blue"', ids: [bobPhrase.id] },
      { q: '""', ids: [] },
      { q: "***", ids: [] },
      { q: '("unterminated', ids: [] },
      { q: "messages_fts:private", ids: [] },
    ];
    for (const { q, ids } of cases) {
      const route = `${base("#search")}/messages/search?q=${encodeURIComponent(q)}`;
      const response = await f.request(route, alice);
      expect.soft(response.status, `REST query ${q}`).toBe(200);
      if (response.status === 200)
        expect
          .soft(((await response.json()) as any).messages.map((m: any) => m.id).sort(), q)
          .toEqual([...ids].sort());
      else expect(await response.text()).not.toMatch(/no such column|fts5|sqlite|stack/i);
      const denied = await f.request(route, charlie);
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain("private-replay-needle");
      const start = owner.lines.length;
      const done = owner.waitForNewLine((l) => l.includes(" 709 ") || l.includes("FAIL SEARCH"));
      owner.send(`SEARCH #search :${q}`);
      await done;
      const results = owner.lines.slice(start);
      expect
        .soft(
          results.some((l) => l.includes("FAIL SEARCH")),
          `IRC query ${q}`,
        )
        .toBe(false);
      for (const id of ids) {
        const expectedContent = [hyphen, url, apostrophe, phrase, separated, bobPhrase].find(
          (m) => m.id === id,
        ).content;
        expect
          .soft(
            results.some((l) => l.includes(` PRIVMSG #search :${expectedContent}`)),
            `IRC query ${q}`,
          )
          .toBe(true);
      }
      expect
        .soft(results.filter((l) => l.includes(" PRIVMSG #search ")).length, `IRC query ${q}`)
        .toBe(ids.length);
    }
    expect((await f.request(`${base("#search")}/messages/search?q=`, alice)).status).toBe(400);
    const filtersOnly = await f.request(`${base("#search")}/messages/search?q=from:bob`, alice);
    expect(filtersOnly.status).toBe(200);
    expect(((await filtersOnly.json()) as any).messages.map((m: any) => m.id)).toEqual([
      bobPhrase.id,
    ]);
    const outsiderStart = outsider.lines.length;
    const deniedIRC = outsider.waitForNewLine((l) => l.includes(" 442 "));
    outsider.send("SEARCH #search :private-replay-needle");
    await deniedIRC;
    expect(outsider.lines.slice(outsiderStart).join("\n")).not.toContain(hyphen.content);
    expect(await (await f.request(`${base("#search")}/messages`, alice)).json()).toEqual(before);
    await f.stop();
    const db = await f.database("messages", "#search");
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 6 });
    db.close();
  } finally {
    await f.dispose();
  }
});

it("[MSG-025 DB-015] a failed edit commit never reaches the outbound webhook sink while authorized controls do", async () => {
  const f = await persistentFixture();
  const bodies: string[] = [];
  const observers = new Set<(body: string) => void>();
  const sink = (body: string) => {
    bodies.push(body);
    for (const observer of observers) observer(body);
    return 204;
  };
  const delivery = (needle: string) =>
    new Promise<void>((resolve, reject) => {
      const observer = (body: string) => {
        if (body.includes(needle)) {
          clearTimeout(timer);
          observers.delete(observer);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        observers.delete(observer);
        reject(new Error(`Webhook sink missing ${needle}`));
      }, 4000);
      observers.add(observer);
    });
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const owner = await f.connect(alice);
    await join(owner, "#hookfault");
    await join(owner, "#hookcontrol");
    const original = await post(f, alice, "#hookfault", "original-before-webhook-fault");
    await f.stop();
    const db = await f.database("messages", "#hookfault");
    const before = db.prepare("SELECT * FROM messages").all();
    db.exec(
      "CREATE TRIGGER matrix_fail_hook_edit BEFORE INSERT ON message_edits BEGIN SELECT RAISE(ABORT, 'matrix injected webhook edit failure'); END",
    );
    db.close();
    await f.start(sink);
    const writer = await f.connect(alice);
    await join(writer, "#hookfault");
    await join(writer, "#hookcontrol");
    for (const name of ["#hookfault", "#hookcontrol"]) {
      const hook = {
        target_url: "https://hooks.example.com/record",
        events: ["message.created", "message.updated"],
      };
      expect((await f.request(`${base(name)}/outgoing-webhooks`, bob, "POST", hook)).status).toBe(
        403,
      );
      expect((await f.request(`${base(name)}/outgoing-webhooks`, alice, "POST", hook)).status).toBe(
        200,
      );
    }
    const control = delivery("authorized-webhook-control");
    await post(f, alice, "#hookcontrol", "authorized-webhook-control");
    await control;
    const failed = await f.request(`${base("#hookfault")}/messages`, alice, "POST", {
      content: "forbidden-precommit-webhook",
      tags: { "+ircord/edit": original.id },
    });
    expect(failed.status).toBe(500);
    const marker = delivery("webhook-output-barrier");
    await post(f, alice, "#hookcontrol", "webhook-output-barrier");
    await marker;
    await f.stop();
    expect(bodies).toHaveLength(2);
    expect(bodies.join("\n")).not.toContain("forbidden-precommit-webhook");
    const final = await f.database("messages", "#hookfault");
    try {
      expect(final.prepare("SELECT * FROM messages").all()).toEqual(before);
    } finally {
      final.close();
    }
  } finally {
    await f.dispose();
  }
});

it("[DB-015 DB-002] SQL credential failure rolls back hashes, SCRAM credentials, credential version and existing sessions", async () => {
  const f = await persistentFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    await f.stop();
    const db = await f.database("users");
    const before = {
      users: db.prepare("SELECT * FROM users ORDER BY id").all(),
      scram: db.prepare("SELECT * FROM scram_credentials ORDER BY user_id").all(),
      sessions: db.prepare("SELECT * FROM api_sessions ORDER BY token_hash").all(),
    };
    db.exec(
      "CREATE TRIGGER matrix_fail_credentials BEFORE INSERT ON scram_credentials BEGIN SELECT RAISE(ABORT, 'matrix injected credential failure'); END",
    );
    db.close();
    await f.start();
    const replacement = `Replacement-${randomUUID()}!`;
    expect(
      (await f.request("/admin/accounts/alice/password", bob, "POST", { password: replacement }))
        .status,
    ).toBe(403);
    expect(
      (await f.request("/admin/accounts/alice/password", root, "POST", { password: replacement }))
        .status,
    ).toBe(500);
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
    await f.stop();
    const final = await f.database("users");
    try {
      expect(final.prepare("SELECT * FROM users ORDER BY id").all()).toEqual(before.users);
      expect(final.prepare("SELECT * FROM scram_credentials ORDER BY user_id").all()).toEqual(
        before.scram,
      );
      expect(final.prepare("SELECT * FROM api_sessions ORDER BY token_hash").all()).toEqual(
        before.sessions,
      );
    } finally {
      final.close();
    }
    await f.start();
    expect(
      (
        await f.request("/api/v1/auth/login", null, "POST", {
          username: "alice",
          password: replacement,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await f.request("/api/v1/auth/login", null, "POST", {
          username: "alice",
          password: alice.password,
        })
      ).status,
    ).toBe(200);
  } finally {
    await f.dispose();
  }
});

it("[DB-004 DB-007 DB-008 ROLE-027 ROLE-029 ROLE-030 CHAN-032] restart preserves retained grants without resurrecting removed roles or kicked private membership", async () => {
  const f = await persistentFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      disabled = await f.createActor("disabled");
    const owner = await f.connect(alice),
      member = await f.connect(bob);
    for (const name of ["#removed", "#retained"]) {
      await join(owner, name);
      await join(member, name);
    }
    owner.send("MODE #removed +si");
    await owner.waitForLine((l) => l.includes(" MODE #removed +si"));
    const roles: Record<string, string> = {};
    for (const name of ["#removed", "#retained"]) {
      const created = await f.request(`${base(name)}/roles`, alice, "POST", {
        name: "Moderator",
        ircMode: "o",
        permissions: ["manage_channel"],
      });
      expect(created.status).toBe(201);
      roles[name] = ((await created.json()) as any).role.id;
      expect(
        (
          await f.request(`${base(name)}/roles/assign`, alice, "POST", {
            userId: bob.account.id,
            roleGroupId: roles[name],
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await f.request(`${base("#retained")}/info`, bob, "PATCH", {
          description: "permitted-persistent-role",
        })
      ).status,
    ).toBe(200);
    expect(
      (await f.request(`${base("#removed")}/roles/${roles["#removed"]}`, bob, "DELETE")).status,
    ).toBe(403);
    expect(
      (await f.request(`${base("#removed")}/roles/${roles["#removed"]}`, alice, "DELETE")).status,
    ).toBe(200);
    expect(
      (
        await f.request(`${base("#removed")}/info`, bob, "PATCH", {
          description: "stale-privilege",
        })
      ).status,
    ).toBe(403);
    owner.send("KICK #removed bob :revoked-membership");
    await owner.waitForLine((l) => l.includes(" KICK #removed bob"));
    await post(f, alice, "#removed", "private-after-removal");
    expect((await f.request("/admin/accounts/disabled/disable", root, "POST")).status).toBe(200);
    await f.stop();
    const removed = await f.database("channel_user_roles", "#removed");
    expect(
      removed.prepare("SELECT * FROM channel_role_groups WHERE id=?").all(roles["#removed"]),
    ).toHaveLength(0);
    expect(
      removed.prepare("SELECT * FROM channel_user_roles WHERE user_id=?").all(bob.account.id),
    ).toHaveLength(0);
    expect(
      removed.prepare("SELECT * FROM channel_members WHERE user_id=?").all(bob.account.id),
    ).toHaveLength(0);
    removed.close();
    await f.start();
    expect((await f.request("/api/v1/profiles/disabled", disabled)).status).toBe(401);
    expect(
      (
        await f.request("/api/v1/auth/login", null, "POST", {
          username: "disabled",
          password: disabled.password,
        })
      ).status,
    ).toBe(401);
    expect((await f.request(`${base("#removed")}/messages`, bob)).status).toBe(403);
    expect(
      (
        await f.request(`${base("#retained")}/info`, bob, "PATCH", {
          description: "role-survived-restart",
        })
      ).status,
    ).toBe(200);
    expect((await f.request(`${base("#removed")}/roles`, alice)).status).toBe(200);
    const reconnect = await f.connect(bob);
    reconnect.send("JOIN #removed");
    await reconnect.waitForNumeric(473);
    await join(reconnect, "#retained");
    reconnect.send("MODE #retained +i");
    await reconnect.waitForLine((l) => l.includes(" MODE #retained +i"));
    const history = (await (await f.request(`${base("#removed")}/messages`, alice)).json()) as any;
    expect(history.messages.map((m: any) => m.content)).toEqual(["private-after-removal"]);
  } finally {
    await f.dispose();
  }
});

it("[DB-009 DB-010 DB-011 MSG-026 DM-017 DB-027] independent runtime restart preserves private messages, edits and redactions and rejects foreign cursors", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const owner = await f.connect(alice),
      receiver = await f.connect(bob);
    await join(owner, "#vault");
    owner.send("MODE #vault +s");
    await owner.waitForLine((l) => l.includes(" MODE #vault +s"));
    await join(receiver, "#vault");
    const original = await post(f, alice, "#vault", "original-text");
    expect(
      (
        await f.request(`${base("#vault")}/messages/${original.id}`, alice, "PATCH", {
          content: "edited-retained-text",
        })
      ).status,
    ).toBe(200);
    const redacted = await post(f, alice, "#vault", "redacted-must-stay-absent");
    expect(
      (await f.request(`${base("#vault")}/messages/${redacted.id}`, alice, "DELETE")).status,
    ).toBe(200);
    owner.send("PRIVMSG bob :alice-bob-private-after-restart");
    await receiver.waitForLine((l) => l.includes("alice-bob-private-after-restart"));
    const unrelated = await f.connect(charlie);
    await join(unrelated, "#unrelated");
    const foreign = await post(f, charlie, "#unrelated", "foreign-channel-cursor-body");
    await f.stop();
    await f.start();
    for (const limit of ["-1", "999999999", "0", "NaN"]) {
      const response = await f.request(
        `${base("#vault")}/messages?limit=${limit}&before=${foreign.id}`,
        charlie,
      );
      expect(response.status).toBe(403);
      expect(await response.text()).not.toMatch(/edited-retained|alice-bob-private|redacted-must/);
    }
    const history = (await (
      await f.request(`${base("#vault")}/messages?limit=100`, alice)
    ).json()) as any;
    expect(history.messages.find((m: any) => m.id === original.id).content).toBe(
      "edited-retained-text",
    );
    expect(JSON.stringify(history)).not.toMatch(
      /original-text|redacted-must-stay-absent|foreign-channel-cursor-body/,
    );
    const dm = (await (await f.request("/api/v1/dms/bob/messages", alice)).json()) as any;
    expect(JSON.stringify(dm)).toContain("alice-bob-private-after-restart");
    expect(
      JSON.stringify(await (await f.request("/api/v1/dms/alice/messages", charlie)).json()),
    ).not.toContain("alice-bob-private-after-restart");
    const scoped = (await (
      await f.request(`${base("#unrelated")}/messages?around=${original.id}&limit=1`, charlie)
    ).json()) as any;
    expect(JSON.stringify(scoped)).not.toContain("edited-retained-text");
    expect(scoped.messages.length).toBeLessThanOrEqual(1);
    await f.stop();
    const db = await f.database("messages", "#vault");
    expect(
      db.prepare("SELECT content, redacted FROM messages WHERE id=?").get(redacted.id),
    ).toEqual({ content: "", redacted: 1 });
    expect(
      db.prepare("SELECT * FROM messages_fts WHERE message_id=?").all(redacted.id),
    ).toHaveLength(0);
    db.close();
  } finally {
    await f.dispose();
  }
});

it("[DB-013 DB-014 DB-028] actual SQLite foreign keys, unique sequences and indexed bounded history queries enforce integrity", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    await join(await f.connect(alice), "#indexed");
    // Real public operations populate representative multi-page history; no synthetic principals.
    for (let offset = 0; offset < 120; offset += 20)
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          post(f, alice, "#indexed", `indexed-message-${offset + i}`),
        ),
      );
    const created = await f.request(`${base("#indexed")}/roles`, alice, "POST", {
      name: "Reference",
      permissions: [],
    });
    expect(created.status).toBe(201);
    const roleId = ((await created.json()) as any).role.id;
    expect(
      (
        await f.request(`${base("#indexed")}/roles/assign`, alice, "POST", {
          userId: bob.account.id,
          roleGroupId: roleId,
        })
      ).status,
    ).toBe(200);
    const page = (await (
      await f.request(`${base("#indexed")}/messages?limit=9999999`, bob)
    ).json()) as any;
    expect(page.messages).toHaveLength(100);
    expect(page.pagination.has_more).toBe(true);
    const older = (await (
      await f.request(
        `${base("#indexed")}/messages?limit=100&before=${page.pagination.oldest_id}`,
        bob,
      )
    ).json()) as any;
    expect(older.messages).toHaveLength(20);
    expect(new Set([...page.messages, ...older.messages].map((m) => m.id)).size).toBe(120);
    await f.stop();
    const db = await f.database("messages", "#indexed");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      expect(() =>
        db
          .prepare("INSERT INTO channel_user_roles(user_id, group_id, assigned_at) VALUES(?, ?, ?)")
          .run(bob.account.id, "absent-role", Date.now()),
      ).toThrow(/FOREIGN KEY/);
      expect(() =>
        db
          .prepare("INSERT INTO channel_user_roles(user_id, group_id, assigned_at) VALUES(?, ?, ?)")
          .run(bob.account.id, roleId, Date.now()),
      ).toThrow(/UNIQUE/);
      expect(() =>
        db.exec(
          "INSERT INTO messages SELECT 'duplicate-sequence-id', sequence, sender_id, sender_account, sender_nick, sender_user, sender_host, command, content, tags_json, multiline_json, redacted, created_at, expires_at FROM messages LIMIT 1",
        ),
      ).toThrow(/UNIQUE/);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
      const historyPlan = db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND sequence < ? ORDER BY sequence DESC LIMIT ?",
        )
        .all(Date.now(), 100, 20) as any[];
      expect(historyPlan.map((r) => r.detail).join("\n")).toMatch(
        /SEARCH messages USING INDEX .*sequence/,
      );
      const rolePlan = db
        .prepare("EXPLAIN QUERY PLAN SELECT group_id FROM channel_user_roles WHERE user_id=?")
        .all(bob.account.id) as any[];
      expect(rolePlan.map((r) => r.detail).join("\n")).toMatch(/SEARCH channel_user_roles USING/);
      expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 120 });
    } finally {
      db.close();
    }
  } finally {
    await f.dispose();
  }
});

it("[DB-018 DB-019] production retention cleanup deletes distinct expired rows and FTS while preserving unexpired rows across restart", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice");
    await join(await f.connect(alice), "#retention");
    const expired = await post(f, alice, "#retention", "expired-unique-retention-needle");
    const fresh = await post(f, alice, "#retention", "unexpired-distinct-retention-needle");
    const retentionMs = 90 * 24 * 60 * 60 * 1000;
    expect(expired.expiresAt - expired.createdAt).toBe(retentionMs);
    expect(fresh.expiresAt - fresh.createdAt).toBe(retentionMs);
    await f.stop();
    const db = await f.database("messages", "#retention");
    db.prepare("UPDATE messages SET created_at=?, expires_at=? WHERE id=?").run(
      Date.now() - retentionMs - 10000,
      Date.now() - 10000,
      expired.id,
    );
    db.close();
    await f.start();
    const namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const channel = namespace.get(namespace.idFromName("FlaRC:#retention")) as any;
    // This is the production method used by alarm(), not proof the scheduler fires.
    expect(await channel.cleanupExpiredMessages()).toBe(1);
    expect(await channel.cleanupExpiredMessages()).toBe(0);
    const history = (await (
      await f.request(`${base("#retention")}/messages`, alice)
    ).json()) as any;
    expect(history.messages.map((m: any) => m.id)).toEqual([fresh.id]);
    await f.stop();
    const final = await f.database("messages", "#retention");
    try {
      expect(final.prepare("SELECT id FROM messages").all()).toEqual([{ id: fresh.id }]);
      expect(
        final.prepare("SELECT message_id FROM messages_fts WHERE message_id=?").all(expired.id),
      ).toHaveLength(0);
      expect(final.prepare("SELECT content FROM messages WHERE id=?").get(fresh.id)).toEqual({
        content: "unexpired-distinct-retention-needle",
      });
    } finally {
      final.close();
    }
  } finally {
    await f.dispose();
  }
});

it("[DB-018 DB-019] actual workerd alarms delete expired rows and reschedule after both deletion and a no-op", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const owner = await f.connect(alice);
    await join(owner, "#alarm");
    await join(owner, "#untouched");
    const old = await post(f, alice, "#alarm", "expired-alarm-needle");
    const fresh = await post(f, alice, "#alarm", "retained-alarm-needle");
    const unrelated = await post(f, alice, "#untouched", "unrelated-alarm-control");
    await f.stop();
    const db = await f.database("messages", "#alarm");
    db.prepare("UPDATE messages SET created_at=?, expires_at=? WHERE id=?").run(
      Date.now() - 91 * 86400000,
      Date.now() - 10000,
      old.id,
    );
    db.close();
    // The copied frozen bundle is unchanged. Only this test runtime binds the subclass;
    // public registration/authentication and production authorization stay intact.
    await f.start(undefined, true);
    const namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const channel = namespace.get(namespace.idFromName("FlaRC:#alarm")) as any;
    async function fire(after: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Installed workerd did not deliver scheduled alarm within 5 seconds")),
          5000,
        );
      });
      const completed = channel.matrixWaitAlarm(after);
      const before = Date.now();
      try {
        await channel.matrixSetAlarm(Date.now() + 1);
        expect(await Promise.race([completed, deadline])).toBe(after + 1);
      } finally {
        clearTimeout(timer);
      }
      const scheduled = await channel.matrixGetAlarm();
      expect(scheduled).toBeGreaterThanOrEqual(before + 86400000);
      expect(scheduled).toBeLessThanOrEqual(Date.now() + 86400000);
    }
    await fire(0);
    const history = (await (await f.request(`${base("#alarm")}/messages`, bob)).json()) as any;
    expect(history.messages.map((m: any) => m.id)).toEqual([fresh.id]);
    await fire(1); // No expired rows remain; a future alarm must still be scheduled.
    expect(
      ((await (await f.request(`${base("#untouched")}/messages`, bob)).json()) as any).messages.map(
        (m: any) => m.id,
      ),
    ).toEqual([unrelated.id]);
    await f.stop();
    const final = await f.database("messages", "#alarm");
    try {
      expect(final.prepare("SELECT id, content FROM messages").all()).toEqual([
        { id: fresh.id, content: fresh.content },
      ]);
      expect(
        final.prepare("SELECT message_id FROM messages_fts WHERE message_id=?").all(old.id),
      ).toHaveLength(0);
    } finally {
      final.close();
    }
  } finally {
    await f.dispose();
  }
});

it("outgoing webhook 3xx responses never forward the body or secret to a second recipient", async () => {
  const f = await persistentFixture();
  const calls: { body: string; url: string; secret: string | null }[] = [];
  let received!: () => void;
  const delivered = new Promise<void>((resolve) => {
    received = resolve;
  });
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    await join(await f.connect(alice), "#redirect");
    await f.stop();
    await f.start((body, url, secret) => {
      calls.push({ body, url, secret });
      received();
      return 302;
    });
    const owner = await f.connect(alice);
    await join(owner, "#redirect");
    const secret = `Webhook-${randomUUID()}`;
    const hook = {
      target_url: "https://hooks.example.com/record",
      secret,
      events: ["message.created"],
    };
    expect(
      (await f.request(`${base("#redirect")}/outgoing-webhooks`, bob, "POST", hook)).status,
    ).toBe(403);
    expect(
      (await f.request(`${base("#redirect")}/outgoing-webhooks`, alice, "POST", hook)).status,
    ).toBe(200);
    await post(f, alice, "#redirect", "private-body-redirect-must-not-forward");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        delivered,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error("Configured webhook recipient did not receive its authorized control"),
              ),
            4000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    await f.stop(); // Drain actual waitUntil work before asserting no second request.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://hooks.example.com/record", secret });
    expect(calls[0].body).toContain("private-body-redirect-must-not-forward");
    expect(calls.some((call) => call.url.includes("redirected.example.com"))).toBe(false);
    const db = await f.database("messages", "#redirect");
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 1 });
    db.close();
  } finally {
    await f.dispose();
  }
});

for (const expired of ["ticket", "parent-session"] as const) {
  it(`[${expired === "ticket" ? "WS-003" : "AUTH-010 API-003"}] persisted expired ${expired} cannot authorize an event stream after full runtime restart`, async () => {
    const f = await persistentFixture();
    const sockets: WebSocket[] = [];
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      await join(await f.connect(alice), "#expiry-control");
      const ticketResponse = await f.request("/api/v1/auth/events-ticket", alice, "POST");
      expect(ticketResponse.status).toBe(200);
      const { ticket } = (await ticketResponse.json()) as any;
      await f.stop();
      const db = await f.database("api_sessions");
      if (expired === "ticket")
        db.prepare("UPDATE event_tickets SET expires_at=?").run(Date.now() - 10000);
      else
        db.prepare("UPDATE api_sessions SET expires_at=? WHERE user_id=?").run(
          Date.now() - 10000,
          alice.account.id,
        );
      db.close();
      await f.start();
      const failed = await f.server.mf.dispatchFetch(
        `${f.server.url.origin}/api/v1/events?ticket=${ticket}`,
        { headers: { Upgrade: "websocket" } },
      );
      expect(failed.status).toBe(401);
      expect(await failed.text()).not.toContain(alice.password);
      expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(
        expired === "ticket" ? 200 : 401,
      );
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
      const login = await f.request("/api/v1/auth/login", null, "POST", {
        username: "alice",
        password: alice.password,
      });
      expect(login.status).toBe(200);
      const fresh = { ...alice, token: ((await login.json()) as any).token };
      const goodTicket = await f.request("/api/v1/auth/events-ticket", fresh, "POST");
      expect(goodTicket.status).toBe(200);
      const value = ((await goodTicket.json()) as any).ticket;
      const socket = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${value}`);
      sockets.push(socket);
      const received: string[] = [];
      socket.on("message", (data) => received.push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const owner = await f.connect(alice);
      await join(owner, "#expiry-control");
      const marker = `fresh-expiry-control-${randomUUID()}`;
      const delivered = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Fresh authenticated ticket did not receive control")),
          4000,
        );
        socket.on("message", (data) => {
          if (data.toString().includes(marker)) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await post(f, fresh, "#expiry-control", marker);
      await delivered;
      expect(received.join("\n")).toContain(marker);
      socket.terminate();
      await f.stop();
      const final = await f.database("messages", "#expiry-control");
      expect(final.prepare("SELECT content, sender_id FROM messages").all()).toEqual([
        { content: marker, sender_id: alice.account.id },
      ]);
      final.close();
    } finally {
      for (const socket of sockets) socket.terminate();
      await f.dispose();
    }
  });
}

it("[DB-016 DB-025] destination commit followed by a real Accounts SQL fault keeps both rename generations fail-closed after restart", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const owner = await f.connect(alice);
    await join(owner, "#source");
    owner.send("MODE #source +s");
    await owner.waitForLine((l) => l.includes(" MODE #source +s"));
    const original = await post(f, alice, "#source", "destination-committed-private-body");
    const upload = await fetch(new URL("/api/v1/media/upload?channel=%23source", f.server.url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice.token}`,
        "Content-Type": "text/plain",
        "X-Filename": "private.txt",
      },
      body: "private-after-uncertain-rename",
    });
    expect(upload.status).toBe(201);
    const media = (await upload.json()) as any;
    await f.stop();
    const accounts = await f.database("media_uploads");
    accounts.exec(
      "CREATE TRIGGER matrix_fail_rename_rebind BEFORE UPDATE OF scope_target ON media_uploads BEGIN SELECT RAISE(ABORT, 'matrix injected post-destination-commit failure'); END",
    );
    accounts.close();
    await f.start();
    const renamer = await f.connect(alice);
    await join(renamer, "#source");
    renamer.send("RENAME #source #destination");
    await renamer.waitForLine((l) => l.includes("FAIL RENAME INTERNAL_ERROR"));
    expect(renamer.lines.some((l) => l.includes(" RENAME #source #destination"))).toBe(false);
    for (const name of ["#source", "#destination"]) {
      const response = await f.request(`${base(name)}/messages`, bob);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(original.content);
      expect(
        (
          await f.request(`${base(name)}/messages`, alice, "POST", {
            content: "unauthorized-partial-write",
          })
        ).status,
      ).toBe(403);
    }
    expect((await f.request(media.url, bob)).status).toBe(404); // Private media deliberately conceals existence.
    await f.stop();
    for (const name of ["#source", "#destination"]) {
      const channel = await f.database("messages", name);
      expect(channel.prepare("SELECT content FROM messages WHERE id=?").get(original.id)).toEqual({
        content: original.content,
      });
      expect(
        channel.prepare("SELECT value FROM channel_metadata WHERE key='rename_pending'").get(),
      ).toBeDefined();
      expect(
        channel
          .prepare("SELECT content FROM messages WHERE content='unauthorized-partial-write'")
          .all(),
      ).toHaveLength(0);
      channel.close();
    }
    await f.start();
    for (const name of ["#source", "#destination"])
      expect((await f.request(`${base(name)}/messages`, bob)).status).toBe(403);
    expect((await f.request(media.url, bob)).status).toBe(404);
  } finally {
    await f.dispose();
  }
});
