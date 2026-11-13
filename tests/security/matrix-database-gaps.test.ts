import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { reconstructLegacy } from "../helpers/database-gap-fixture";
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
  async function start(wrapped = false) {
    if (!stopped) throw new Error("Stop runtime before restarting");
    if (wrapped) {
      let scriptPath = await ensureNitroBuilt();
      {
        const directory = await mkdtemp(path.join(tmpdir(), "flarc-database-wrapper-"));
        wrappers.push(directory);
        await cp(path.dirname(scriptPath), path.join(directory, "production"), { recursive: true });
        scriptPath = path.join(directory, "wrapper.mjs");
        await writeFile(
          scriptPath,
          `export { default, AccountsDO, SessionDO } from './production/index.mjs';
import { ChannelDO as ProductionChannelDO } from './production/index.mjs';
export class ChannelDO extends ProductionChannelDO {
  matrixSql(query, ...args) { return this.ctx.storage.sql.exec(query, ...args).toArray(); }
  matrixTrySql(query, ...args) { try { this.ctx.storage.sql.exec(query, ...args).toArray(); return "ok"; } catch (error) { return String(error); } }
  matrixInvokeAlarm() { return super.alarm(); }
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

it("[DB-013] Worker SQLite enforces channel role references after recreation", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const owner = await f.connect(alice);
    await join(owner, "#refs");
    await join(owner, "#sentinel");
    const sentinelResponse = await f.request(`${base("#sentinel")}/roles`, alice, "POST", {
      name: "Sentinel",
      permissions: [],
    });
    expect(sentinelResponse.status).toBe(201);
    const sentinelRole = ((await sentinelResponse.json()) as any).role.id;
    expect(
      (
        await f.request(`${base("#sentinel")}/roles/assign`, alice, "POST", {
          userId: bob.account.id,
          roleGroupId: sentinelRole,
        })
      ).status,
    ).toBe(200);
    const created = await f.request(`${base("#refs")}/roles`, alice, "POST", {
      name: "Reference",
      permissions: [],
    });
    expect(created.status).toBe(201);
    const roleId = ((await created.json()) as any).role.id;
    expect(
      (
        await f.request(`${base("#refs")}/roles/assign`, alice, "POST", {
          userId: bob.account.id,
          roleGroupId: roleId,
        })
      ).status,
    ).toBe(200);
    await f.stop();
    await f.start(true);
    let namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    let channel = namespace.get(namespace.idFromName("FlaRC:#refs")) as any;
    let sentinel = namespace.get(namespace.idFromName("FlaRC:#sentinel")) as any;
    const checkSentinel = async () =>
      expect(
        await sentinel.matrixSql(
          "SELECT user_id, group_id FROM channel_user_roles WHERE group_id=?",
          sentinelRole,
        ),
      ).toEqual([{ user_id: bob.account.id, group_id: sentinelRole }]);
    await checkSentinel();
    expect(await channel.matrixSql("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    expect(
      await channel.matrixTrySql(
        "INSERT INTO channel_user_roles(user_id, group_id, assigned_at) VALUES(?, ?, ?)",
        charlie.account.id,
        "absent-role",
        Date.now(),
      ),
    ).toMatch(/FOREIGN KEY/i);
    await checkSentinel();
    await channel.matrixSql(
      "INSERT INTO channel_user_roles(user_id, group_id, assigned_at) VALUES(?, ?, ?)",
      charlie.account.id,
      roleId,
      Date.now(),
    );
    expect(
      await channel.matrixSql(
        "SELECT user_id, group_id FROM channel_user_roles WHERE group_id=? ORDER BY user_id",
        roleId,
      ),
    ).toEqual(
      [bob.account.id, charlie.account.id].sort().map((user_id) => ({ user_id, group_id: roleId })),
    );
    await f.stop();
    await f.start(true);
    namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    channel = namespace.get(namespace.idFromName("FlaRC:#refs")) as any;
    sentinel = namespace.get(namespace.idFromName("FlaRC:#sentinel")) as any;
    await checkSentinel();
    expect(await channel.matrixSql("PRAGMA foreign_key_check")).toEqual([]);
    expect(
      await channel.matrixSql(
        "SELECT user_id, group_id FROM channel_user_roles WHERE group_id=? ORDER BY user_id",
        roleId,
      ),
    ).toEqual(
      [bob.account.id, charlie.account.id].sort().map((user_id) => ({ user_id, group_id: roleId })),
    );
  } finally {
    await f.dispose();
  }
});

it("[DB-018 DB-019] cleanup survives later runtime recreation with history and FTS intact", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const owner = await f.connect(alice);
    await join(owner, "#retention");
    await join(owner, "#other");
    const expired = await post(f, alice, "#retention", "expiredneedle");
    const fresh = await post(f, alice, "#retention", "freshneedle");
    const other = await post(f, alice, "#other", "otherneedle");
    expect(expired.expiresAt - expired.createdAt).toBe(90 * 86400000);
    expect(fresh.expiresAt - fresh.createdAt).toBe(90 * 86400000);
    await f.stop();
    const db = await f.database("messages", "#retention");
    db.prepare("UPDATE messages SET created_at=?, expires_at=? WHERE id=?").run(
      Date.now() - 91 * 86400000,
      Date.now() - 86400000,
      expired.id,
    );
    db.close();
    await f.start(true);
    const ns = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const channel = ns.get(ns.idFromName("FlaRC:#retention")) as any;
    await channel.matrixInvokeAlarm();
    expect(await channel.matrixSql("SELECT id FROM messages ORDER BY sequence")).toEqual([
      { id: fresh.id },
    ]);
    expect(
      await channel.matrixSql("SELECT message_id FROM messages_fts WHERE message_id=?", expired.id),
    ).toEqual([]);
    await f.stop();
    await f.start(true);
    const ns2 = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const recreated = ns2.get(ns2.idFromName("FlaRC:#retention")) as any;
    expect(await recreated.matrixSql("SELECT id FROM messages ORDER BY sequence")).toEqual([
      { id: fresh.id },
    ]);
    expect(
      await recreated.matrixSql(
        "SELECT message_id FROM messages_fts WHERE message_id=?",
        expired.id,
      ),
    ).toEqual([]);
    expect(
      await recreated.matrixSql("SELECT message_id FROM messages_fts WHERE message_id=?", fresh.id),
    ).toEqual([{ message_id: fresh.id }]);
    for (const [name, expected] of [
      ["#retention", fresh.id],
      ["#other", other.id],
    ]) {
      const response = await f.request(`${base(name)}/messages`, bob);
      expect(response.status).toBe(200);
      expect(((await response.json()) as any).messages.map((m: any) => m.id)).toEqual([expected]);
    }
    for (const [q, ids] of [
      ["expiredneedle", []],
      ["freshneedle", [fresh.id]],
    ] as [string, string[]][]) {
      const response = await f.request(`${base("#retention")}/messages/search?q=${q}`, bob);
      expect(response.status).toBe(200);
      expect(((await response.json()) as any).messages.map((m: any) => m.id)).toEqual(ids);
    }
  } finally {
    await f.dispose();
  }
});

it("[DB-021] deleting an account retains channel history and unrelated messages after recreation", async () => {
  const f = await persistentFixture();
  const sockets: WebSocket[] = [];
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob);
    await join(a, "#history");
    await join(b, "#history");
    await join(b, "#other");
    const roleResponse = await f.request(`${base("#other")}/roles`, bob, "POST", {
      name: "unrelated-grant",
      permissions: [],
    });
    expect(roleResponse.status).toBe(201);
    const roleId = ((await roleResponse.json()) as any).role.id;
    expect(
      (
        await f.request(`${base("#other")}/roles/assign`, bob, "POST", {
          userId: charlie.account.id,
          roleGroupId: roleId,
        })
      ).status,
    ).toBe(200);
    const rolesBefore = await (await f.request(`${base("#other")}/roles`, bob)).json();
    const profileBefore = await (await f.request("/api/v1/profiles/bob", bob)).json();
    const c = await f.connect(charlie);
    await join(c, "#history");
    const observed: string[][] = [[], []];
    for (const [i, actor] of [alice, charlie].entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(ticket.status).toBe(200);
      const socket = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
      );
      sockets.push(socket);
      socket.on("message", (data) => observed[i].push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
    }
    const barrier = async (marker: string) => {
      const waits = sockets.map(
        (socket) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Missing event barrier ${marker}`)),
              4000,
            );
            socket.on("message", function listener(data) {
              if (data.toString().includes(marker)) {
                clearTimeout(timer);
                socket.off("message", listener);
                resolve();
              }
            });
          }),
      );
      await post(f, bob, "#history", marker);
      await Promise.all(waits);
      await Promise.all([
        a.waitForLine((l) => l.includes(marker)),
        c.waitForLine((l) => l.includes(marker)),
      ]);
    };
    const deletedAuthor = await post(f, alice, "#history", "alice-history-retained");
    const survivor = await post(f, bob, "#history", "bob-history-retained");
    const unrelated = await post(f, bob, "#other", "other-history-retained");
    await barrier("live-before-denial");
    const eventStarts = observed.map((x) => x.length),
      ircStarts = [a.lines.length, c.lines.length];
    expect((await f.request("/admin/accounts/alice", bob, "DELETE")).status).toBe(403);
    expect(await (await f.request(`${base("#history")}/messages`, bob)).text()).toContain(
      "alice-history-retained",
    );
    expect(await (await f.request(`${base("#other")}/roles`, bob)).json()).toEqual(rolesBefore);
    await barrier("live-after-denial");
    for (const [i, stream] of observed.entries())
      expect(stream.slice(eventStarts[i]).every((x) => x.includes("live-after-denial"))).toBe(true);
    for (const [i, client] of [a, c].entries())
      expect(client.lines.slice(ircStarts[i]).every((x) => x.includes("live-after-denial"))).toBe(
        true,
      );
    expect((await f.request("/admin/accounts/alice", root)).status).toBe(200);
    const quit = c.waitForNewLine((l) => l.includes(" QUIT ") && l.includes("alice!"));
    expect((await f.request("/admin/accounts/alice", root, "DELETE")).status).toBe(200);
    await quit;
    sockets.forEach((socket) => {
      socket.terminate();
    });
    const assertHistory = async () => {
      for (const [name, ids] of [
        ["#history", [deletedAuthor.id, survivor.id]],
        ["#other", [unrelated.id]],
      ] as [string, string[]][]) {
        const response = await f.request(`${base(name)}/messages`, bob);
        expect(response.status).toBe(200);
        const messages = ((await response.json()) as any).messages.filter(
          (m: any) => !m.content.startsWith("live-"),
        );
        expect(messages.map((m: any) => m.id).sort()).toEqual(ids.sort());
        expect(messages.map((m: any) => m.content).sort()).toEqual(
          name === "#history"
            ? ["alice-history-retained", "bob-history-retained"]
            : ["other-history-retained"],
        );
      }
    };
    await assertHistory();
    await f.stop();
    const db = await f.database("account_tombstones");
    expect(
      db.prepare("SELECT user_id FROM account_tombstones WHERE canonical_username=?").get("alice"),
    ).toEqual({ user_id: alice.account.id });
    db.close();
    const sentinel = await f.database("channel_user_roles", "#other");
    expect(
      sentinel
        .prepare("SELECT user_id, group_id FROM channel_user_roles WHERE group_id=?")
        .all(roleId),
    ).toEqual([{ user_id: charlie.account.id, group_id: roleId }]);
    sentinel.close();
    await f.start();
    const login = await f.request("/api/v1/auth/login", null, "POST", {
      username: bob.username,
      password: bob.password,
    });
    expect(login.status).toBe(200);
    bob.token = ((await login.json()) as any).token;
    const deletedLogin = await f.request("/api/v1/auth/login", null, "POST", {
      username: alice.username,
      password: alice.password,
    });
    expect(deletedLogin.status).toBe(401);
    expect(await deletedLogin.text()).not.toMatch(/sqlite|stack|password_hash/i);
    const staleBearer = await f.request("/api/v1/profiles/alice", alice);
    expect(staleBearer.status).toBe(401);
    await assertHistory();
    expect(await (await f.request(`${base("#other")}/roles`, bob)).json()).toEqual(rolesBefore);
    expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(profileBefore);
    expect((await f.request("/admin/accounts/alice", root)).status).toBe(404);
    await f.stop();
    const recreatedGrant = await f.database("channel_user_roles", "#other");
    expect(
      recreatedGrant
        .prepare("SELECT user_id, group_id FROM channel_user_roles WHERE group_id=?")
        .all(roleId),
    ).toEqual([{ user_id: charlie.account.id, group_id: roleId }]);
    recreatedGrant.close();
  } finally {
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
});

it("[DB-028] Worker query plans bound history and role lookup under populated channel scope", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const owner = await f.connect(alice);
    await join(owner, "#queryplan");
    await join(owner, "#planother");
    const otherMessage = await post(f, alice, "#planother", "other-plan-message");
    const role = await f.request(`${base("#queryplan")}/roles`, alice, "POST", {
      name: "lookup",
      permissions: [],
    });
    expect(role.status).toBe(201);
    const id = ((await role.json()) as any).role.id;
    expect(
      (
        await f.request(`${base("#queryplan")}/roles/assign`, alice, "POST", {
          userId: bob.account.id,
          roleGroupId: id,
        })
      ).status,
    ).toBe(200);
    for (let i = 0; i < 20; i++) {
      const created = await f.request(`${base("#queryplan")}/roles`, alice, "POST", {
        name: `load-${i}`,
        permissions: [],
      });
      expect(created.status).toBe(201);
      const roleId = ((await created.json()) as any).role.id;
      expect(
        (
          await f.request(`${base("#queryplan")}/roles/assign`, alice, "POST", {
            userId: bob.account.id,
            roleGroupId: roleId,
          })
        ).status,
      ).toBe(200);
    }
    for (let offset = 0; offset < 120; offset += 20)
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => post(f, alice, "#queryplan", `indexed-${offset + i}`)),
      );
    const page = await f.request(`${base("#queryplan")}/messages?limit=100`, bob);
    expect(page.status).toBe(200);
    expect(((await page.json()) as any).messages).toHaveLength(100);
    await f.stop();
    await f.start(true);
    const ns = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const channel = ns.get(ns.idFromName("FlaRC:#queryplan")) as any;
    expect(await channel.matrixSql("SELECT COUNT(*) AS count FROM messages")).toEqual([
      { count: 120 },
    ]);
    const history = await channel.matrixSql(
      "EXPLAIN QUERY PLAN SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND sequence < ? ORDER BY sequence DESC LIMIT ?",
      Date.now(),
      100,
      20,
    );
    expect(history.map((r: any) => r.detail).join("\n")).toMatch(
      /SEARCH messages USING INDEX .*sequence/,
    );
    const auth = await channel.matrixSql(
      "EXPLAIN QUERY PLAN SELECT g.permissions_json FROM channel_role_groups g JOIN channel_user_roles r ON r.group_id = g.id WHERE r.user_id = ?",
      bob.account.id,
    );
    expect(auth.map((r: any) => r.detail).join("\n")).toMatch(/SEARCH r USING/);
    expect(auth.map((r: any) => r.detail).join("\n")).toMatch(/SEARCH g USING/);
    expect([...history, ...auth].map((r: any) => r.detail).join("\n")).not.toMatch(
      /\bSCAN (messages|r|g)\b/i,
    );
    expect(
      await channel.matrixSql(
        "SELECT count(*) AS count FROM channel_user_roles WHERE user_id=?",
        bob.account.id,
      ),
    ).toEqual([{ count: 21 }]);
    const otherChannel = ns.get(ns.idFromName("FlaRC:#planother")) as any;
    expect(await otherChannel.matrixSql("SELECT id, content FROM messages")).toEqual([
      { id: otherMessage.id, content: "other-plan-message" },
    ]);
    expect(
      await otherChannel.matrixSql(
        "SELECT count(*) AS count FROM channel_user_roles WHERE user_id=?",
        bob.account.id,
      ),
    ).toEqual([{ count: 0 }]);
  } finally {
    await f.dispose();
  }
});

it("[DB-012] authenticated per-account MARKREAD values remain monotonic after recreation", async () => {
  const f = await persistentFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    let a = await f.connect(alice),
      b = await f.connect(bob);
    const second = await f.connect(alice, "alice2");
    for (const client of [a, b, second]) {
      const ack = client.waitForNewLine(
        (l) => l.includes(" CAP ") && l.includes("draft/read-marker"),
      );
      client.send("CAP REQ :draft/read-marker");
      await ack;
    }
    await join(a, "#marker");
    await join(b, "#marker");
    const set = async (client: TestIRCClient, target: string, sent: string, expected: string) => {
      const reply = client.waitForNewLine((l) =>
        l.includes(`MARKREAD ${target} timestamp=${expected}`),
      );
      client.send(`MARKREAD ${target} timestamp=${sent}`);
      await reply;
    };
    const newer = "2025-06-01T00:00:00.000Z",
      older = "2025-05-01T00:00:00.000Z",
      other = "2025-04-01T00:00:00.000Z";
    const secondDelivery = second.waitForNewLine((l) =>
      l.includes(`MARKREAD #marker timestamp=${newer}`),
    );
    const bobStart = b.lines.length;
    await set(a, "#marker", newer, newer);
    await secondDelivery;
    const ping = b.waitForNewLine((l) => l.includes(" PONG ") && l.includes("marker-barrier"));
    b.send("PING :marker-barrier");
    await ping;
    expect(b.lines.slice(bobStart).filter((l) => l.includes(" MARKREAD "))).toEqual([]);
    await set(b, "#marker", other, other);
    await set(a, "#marker", older, newer);
    await set(a, "#independent", older, older);
    const observers = [a, second, b];
    await Promise.all(
      observers.map(async (client, i) => {
        const marker = `before-denial-marker-${i}`;
        const done = client.waitForNewLine((l) => l.includes(" PONG ") && l.includes(marker));
        client.send(`PING :${marker}`);
        await done;
      }),
    );
    const beforeDenial = observers.map((c) => c.lines.length);
    const denial = await f.request(`${base("#marker")}/unread?username=bob`, alice);
    expect(denial.status).toBe(403);
    expect(await denial.text()).not.toContain(other);
    await Promise.all(
      observers.map(async (client, i) => {
        const marker = `denial-marker-barrier-${i}`;
        const done = client.waitForNewLine((l) => l.includes(" PONG ") && l.includes(marker));
        client.send(`PING :${marker}`);
        await done;
      }),
    );
    for (const [i, client] of observers.entries())
      expect(client.lines.slice(beforeDenial[i]).filter((l) => l.includes(" MARKREAD "))).toEqual(
        [],
      );
    for (const [client, target, expected] of [
      [a, "#marker", newer],
      [a, "#independent", older],
      [b, "#marker", other],
    ] as [TestIRCClient, string, string][]) {
      const reply = client.waitForNewLine((l) =>
        l.includes(`MARKREAD ${target} timestamp=${expected}`),
      );
      client.send(`MARKREAD ${target}`);
      await reply;
    }
    const own = await f.request(`${base("#marker")}/unread`, bob);
    expect(own.status).toBe(200);
    expect(((await own.json()) as any).lastReadTimestamp).toBe(other);
    await f.stop();
    const db = await f.database("read_markers");
    expect(
      db
        .prepare("SELECT user_key, target, timestamp FROM read_markers ORDER BY user_key, target")
        .all(),
    ).toEqual([
      { user_key: "alice", target: "#independent", timestamp: older },
      { user_key: "alice", target: "#marker", timestamp: newer },
      { user_key: "bob", target: "#marker", timestamp: other },
    ]);
    db.close();
    await f.start();
    a = await f.connect(alice);
    b = await f.connect(bob);
    for (const [client, target, expected] of [
      [a, "#marker", newer],
      [a, "#independent", older],
      [b, "#marker", other],
    ] as [TestIRCClient, string, string][]) {
      const reply = client.waitForNewLine((l) =>
        l.includes(`MARKREAD ${target} timestamp=${expected}`),
      );
      client.send(`MARKREAD ${target}`);
      await reply;
    }
  } finally {
    await f.dispose();
  }
});

it("[DB-020 DB-023] legacy account columns migrate without losing real account data on repeated recreation", async () => {
  const f = await persistentFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice");
    await f.stop();
    const db = await f.database("users");
    const before = db
      .prepare(
        "SELECT id, username, display_name, password_hash, created_at, updated_at, disabled_at FROM users ORDER BY username",
      )
      .all();
    const roles = db
      .prepare("SELECT user_id, role FROM account_roles ORDER BY user_id, role")
      .all();
    // Reconstruct the users table as created by commit a9db5e6: its constructor did not add these later columns.
    db.exec(
      "DROP INDEX idx_users_canonical; ALTER TABLE users DROP COLUMN canonical_username; ALTER TABLE users DROP COLUMN credential_version",
    );
    expect((db.prepare("PRAGMA table_info(users)").all() as any[]).map((c) => c.name)).toEqual([
      "id",
      "username",
      "display_name",
      "password_hash",
      "created_at",
      "updated_at",
      "disabled_at",
    ]);
    db.close();
    for (let i = 0; i < 2; i++) {
      await f.start();
      for (const actor of [root, alice]) {
        const response = await f.request("/api/v1/auth/login", null, "POST", {
          username: actor.username,
          password: actor.password,
        });
        expect(response.status).toBe(200);
        expect(((await response.json()) as any).account.id).toBe(actor.account.id);
      }
      await f.stop();
      const reopened = await f.database("users");
      expect(
        reopened
          .prepare(
            "SELECT id, username, display_name, password_hash, created_at, updated_at, disabled_at FROM users ORDER BY username",
          )
          .all(),
      ).toEqual(before);
      expect(
        reopened.prepare("SELECT user_id, role FROM account_roles ORDER BY user_id, role").all(),
      ).toEqual(roles);
      expect(
        reopened
          .prepare(
            "SELECT username, canonical_username, credential_version FROM users ORDER BY username",
          )
          .all(),
      ).toEqual([
        { username: "alice", canonical_username: "alice", credential_version: 0 },
        { username: "rootadmin", canonical_username: "rootadmin", credential_version: 0 },
      ]);
      expect(
        reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version=2").get(),
      ).toEqual({ count: 1 });
      expect(
        (reopened.prepare("PRAGMA index_list(users)").all() as any[]).some(
          (x) => x.name === "idx_users_canonical" && x.unique === 1,
        ),
      ).toBe(true);
      reopened.close();
    }
  } finally {
    await f.dispose();
  }
});

it("[DB-020 DB-023] historical accounts session and channel schemas migrate twice with real records", async () => {
  const f = await persistentFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const a = await f.connect(alice),
      b = await f.connect(bob);
    await join(a, "#legacy");
    await join(b, "#legacy");
    const msg = await post(f, alice, "#legacy", "legacy-channel-message");
    const role = await f.request(`${base("#legacy")}/roles`, alice, "POST", {
      name: "legacy-role",
      permissions: [],
    });
    expect(role.status).toBe(201);
    const roleId = ((await role.json()) as any).role.id;
    expect(
      (
        await f.request(`${base("#legacy")}/roles/assign`, alice, "POST", {
          userId: bob.account.id,
          roleGroupId: roleId,
        })
      ).status,
    ).toBe(200);
    const received = b.waitForNewLine((l) => l.includes("legacy-direct-message"));
    a.send("PRIVMSG bob :legacy-direct-message");
    await received;
    await f.stop();
    const dbAccounts = await f.database("users"),
      dbChannel = await f.database("messages", "#legacy"),
      dbSession = await f.database("direct_messages");
    reconstructLegacy(dbAccounts, "accounts");
    reconstructLegacy(dbChannel, "channel");
    reconstructLegacy(dbSession, "session");
    expect(
      (dbAccounts.prepare("PRAGMA table_info(users)").all() as any[]).some(
        (x) => x.name === "canonical_username",
      ),
    ).toBe(false);
    expect(
      (dbSession.prepare("PRAGMA table_info(direct_messages)").all() as any[]).some(
        (x) => x.name === "expires_at",
      ),
    ).toBe(false);
    expect(
      (dbChannel.prepare("PRAGMA table_info(channel_invites)").all() as any[]).some(
        (x) => x.name === "target_user_id",
      ),
    ).toBe(false);
    dbAccounts.close();
    dbChannel.close();
    dbSession.close();
    for (let pass = 0; pass < 2; pass++) {
      await f.start();
      for (const actor of [root, alice, bob]) {
        const login = await f.request("/api/v1/auth/login", null, "POST", {
          username: actor.username,
          password: actor.password,
        });
        expect(login.status).toBe(200);
        const data = (await login.json()) as any;
        expect(data.account.id).toBe(actor.account.id);
        actor.token = data.token;
      }
      const history = await f.request(`${base("#legacy")}/messages`, bob);
      expect(history.status).toBe(200);
      expect(
        ((await history.json()) as any).messages.some(
          (m: any) => m.id === msg.id && m.content === "legacy-channel-message",
        ),
      ).toBe(true);
      const dm = await f.request("/api/v1/dms/bob/messages", alice);
      expect(dm.status).toBe(200);
      expect(await dm.text()).toContain("legacy-direct-message");
      await f.stop();
      const channel = await f.database("messages", "#legacy"),
        session = await f.database("direct_messages"),
        accounts = await f.database("users");
      expect(
        channel
          .prepare("SELECT user_id,group_id FROM channel_user_roles WHERE group_id=?")
          .all(roleId),
      ).toEqual([{ user_id: bob.account.id, group_id: roleId }]);
      expect(
        channel.prepare("SELECT message_id FROM messages_fts WHERE content MATCH 'legacy'").all(),
      ).toEqual([{ message_id: msg.id }]);
      expect(
        channel
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'messages_fts_%'",
          )
          .all() as any[],
      ).toHaveLength(3);
      expect(
        (channel.prepare("PRAGMA table_info(channel_invites)").all() as any[]).some(
          (x) => x.name === "target_user_id",
        ),
      ).toBe(true);
      expect(
        (session.prepare("PRAGMA table_info(direct_messages)").all() as any[]).some(
          (x) => x.name === "expires_at",
        ),
      ).toBe(true);
      expect(
        session
          .prepare("SELECT content FROM direct_messages WHERE content=?")
          .all("legacy-direct-message"),
      ).toHaveLength(1);
      expect(
        accounts.prepare("SELECT canonical_username FROM users WHERE id=?").get(alice.account.id),
      ).toEqual({ canonical_username: "alice" });
      expect(
        accounts.prepare("SELECT count(*) AS count FROM schema_migrations WHERE version=2").get(),
      ).toEqual({ count: 1 });
      expect(
        accounts
          .prepare("SELECT role FROM account_roles WHERE user_id=? AND role='admin'")
          .all(root.account.id),
      ).toEqual([{ role: "admin" }]);
      for (const [db, table, index] of [
        [channel, "messages", "idx_messages_sequence"],
        [session, "direct_messages", "idx_dm_expiry"],
        [accounts, "users", "idx_users_canonical"],
      ] as [DatabaseSync, string, string][]) {
        expect(
          (db.prepare(`PRAGMA index_list(${table})`).all() as any[]).some((x) => x.name === index),
        ).toBe(true);
      }
      channel.close();
      session.close();
      accounts.close();
    }
  } finally {
    await f.dispose();
  }
});
