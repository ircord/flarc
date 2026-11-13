import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Readable } from "node:stream";
import { Miniflare } from "miniflare";
import { expect } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "./event-reader";
import type { MatrixActor } from "./matrix-fixture";
import { ensureNitroBuilt, TestIRCClient } from "./miniflare-harness";

export async function wire(client: TestIRCClient, command: string, pattern: RegExp) {
  const reply = client.waitForNewLine((line) => pattern.test(line));
  client.send(command);
  return reply;
}
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function authGapFixture(bindings: Record<string, string> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-auth-gaps-"));
  const bootstrap = randomUUID(),
    signup = randomUUID(),
    logs: string[] = [];
  const secretValues: string[] = [bootstrap, signup];
  const trace: { path: string; method: string; status: number }[] = [];
  const clients: TestIRCClient[] = [],
    sockets: WebSocket[] = [];
  let mf: Miniflare,
    url: URL,
    stopped = true;
  async function start() {
    const scriptPath = await ensureNitroBuilt();
    mf = new Miniflare({
      modules: true,
      scriptPath,
      modulesRoot: path.dirname(scriptPath),
      compatibilityDate: "2025-02-04",
      compatibilityFlags: ["nodejs_compat"],
      durableObjectsPersist: directory,
      bindings: {
        SIGNUP_POLICY: "open",
        ADMIN_USERS: "rootadmin",
        ADMIN_TOKEN: bootstrap,
        SIGNUP_TOKEN: signup,
        ...bindings,
      },
      durableObjects: {
        SESSION: { className: "SessionDO", useSQLite: true },
        CHANNELS: { className: "ChannelDO", useSQLite: true },
        ACCOUNTS: { className: "AccountsDO", useSQLite: true },
      },
      handleRuntimeStdio(stdout: Readable, stderr: Readable) {
        for (const stream of [stdout, stderr])
          stream.on("data", (chunk: Buffer | string) => logs.push(chunk.toString()));
      },
    });
    url = await mf.ready;
    stopped = false;
  }
  await start();
  async function request(
    route: string,
    actor?: MatrixActor | null,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(new URL(route, url), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    trace.push({ path: route, method, status: response.status });
    return response;
  }
  async function login(username: string, password: string): Promise<MatrixActor> {
    const res = await request("/api/v1/auth/login", null, "POST", { username, password });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^[a-f0-9]{64}$/);
    secretValues.push(password, body.token);
    return { username, password, token: body.token, account: body.account };
  }
  async function create(username: string, root = false) {
    const password = `Auth-${username}-${randomUUID()}!`;
    const res = await request(
      "/api/v1/auth/register",
      null,
      "POST",
      { username, password },
      root ? { "x-bootstrap-token": bootstrap } : {},
    );
    expect(res.status).toBe(201);
    return login(username, password);
  }
  async function guest() {
    const c = new TestIRCClient(`ws://${url.host}/irc`);
    clients.push(c);
    await c.connect();
    return c;
  }
  async function connect(actor: MatrixActor, nick = actor.username) {
    const c = await guest();
    c.send(`PASS ${actor.username}:${actor.password}`);
    await c.register(nick);
    return c;
  }
  async function barrier(c: TestIRCClient) {
    const marker = randomUUID();
    await wire(c, `PING :${marker}`, new RegExp(` PONG .*${marker}`));
  }
  async function event(actor: MatrixActor) {
    const r = await request("/api/v1/auth/events-ticket", actor, "POST");
    expect(r.status).toBe(200);
    const { ticket } = (await r.json()) as any;
    secretValues.push(ticket);
    const ws = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${ticket}`, [
      "flarc.events.v2",
    ]);
    sockets.push(ws);
    const received: string[] = [];
    ws.on("message", (data) => {
      if (!isReaderControl(ws, data)) received.push(data.toString());
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return {
      ws,
      received,
      async until(text: string) {
        for (let i = 0; i < 100; i++) {
          if (received.some((line) => line.includes(text))) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Missing auth-fixture marker event");
      },
    };
  }
  async function files(dir = directory): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(dir, { withFileTypes: true })
        ).map((e) =>
          e.isDirectory()
            ? files(path.join(dir, e.name))
            : Promise.resolve(e.name.endsWith(".sqlite") ? [path.join(dir, e.name)] : []),
        ),
      )
    ).flat();
  }
  async function stop() {
    if (!stopped) {
      for (const ws of sockets.splice(0)) ws.terminate();
      for (const c of clients.splice(0)) c.close();
      await mf.dispose();
      stopped = true;
    }
  }
  async function rows(table: string): Promise<any[][]> {
    if (!stopped) throw new Error("Stop runtime before SQLite reads");
    if (!/^[a-z_]+$/.test(table)) throw new Error("Bad table");
    const tables: any[][] = [];
    for (const file of await files()) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
          tables.push(db.prepare(`SELECT * FROM ${table}`).all());
      } finally {
        db.close();
      }
    }
    return tables;
  }
  async function snapshot() {
    await stop();
    const meta = await rows("channel_metadata");
    const indices = meta.flatMap((rs, i) =>
      rs.some((r) => r.key === "name" && r.value !== "#markers") ? [i] : [],
    );
    const result: Record<string, any[]> = {};
    for (const table of [
      "users",
      "scram_credentials",
      "account_roles",
      "registered_nicks",
      "api_sessions",
      "event_tickets",
      "account_tombstones",
      "channel_metadata",
      "channel_kv_metadata",
      "channel_permissions",
      "channel_members",
      "channel_role_groups",
      "channel_user_roles",
      "messages",
      "direct_messages",
    ]) {
      const tables = await rows(table);
      let values =
        table.startsWith("channel_") || table === "messages"
          ? indices.flatMap((i) => tables[i] ?? [])
          : tables.flat();
      if (table === "channel_members")
        values = values.map((r) => ({
          user_id: r.user_id,
          account_name: r.account_name,
          nickname: r.nickname,
          modes: [...r.modes].sort().join(""),
          is_persistent: r.is_persistent,
        }));
      result[table] = values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return result;
  }
  async function expire(actor: MatrixActor) {
    await stop();
    let count = 0;
    for (const file of await files()) {
      const db = new DatabaseSync(file);
      try {
        if (
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_sessions'")
            .get()
        )
          count += Number(
            db
              .prepare("UPDATE api_sessions SET expires_at=0 WHERE token_hash=?")
              .run(hashToken(actor.token)).changes,
          );
      } finally {
        db.close();
      }
    }
    expect(count).toBe(1);
  }
  async function restart() {
    await stop();
    await start();
  }
  return {
    directory,
    bootstrap,
    signup,
    logs,
    secretValues,
    trace,
    request,
    login,
    create,
    guest,
    connect,
    barrier,
    event,
    stop,
    rows,
    snapshot,
    expire,
    restart,
    get url() {
      return url;
    },
    async dispose() {
      await stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export type AuthFixture = Awaited<ReturnType<typeof authGapFixture>>;

export async function observedAuthFixture() {
  const f = await authGapFixture();
  const root = await f.create("rootadmin", true),
    alice = await f.create("alice"),
    bob = await f.create("bob"),
    charlie = await f.create("charlie");
  let a!: TestIRCClient,
    b!: TestIRCClient,
    c!: TestIRCClient,
    good: Awaited<ReturnType<typeof f.event>>,
    outside: Awaited<ReturnType<typeof f.event>>;
  let aliceEnabled = true;
  async function observers() {
    b = await f.connect(bob);
    c = await f.connect(charlie);
    await wire(b, "JOIN #protected", / 366 .*#protected/);
    await wire(c, "JOIN #unrelated", / 366 .*#unrelated/);
    if (aliceEnabled) {
      a = await f.connect(alice);
      await wire(a, "JOIN #protected", / 366 .*#protected/);
    }
    for (const client of [b, c]) await wire(client, "JOIN #markers", / 366 .*#markers/);
    good = await f.event(bob);
    outside = await f.event(charlie);
  }
  await observers();
  await wire(b, "MODE #protected +s", / MODE #protected \+s/);
  await wire(c, "MODE #unrelated +s", / MODE #unrelated \+s/);
  expect(
    (
      await f.request("/api/v1/channels/%23unrelated/info", charlie, "PATCH", {
        description: "unrelated-auth-sentinel",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request("/api/v1/channels/%23protected/messages", bob, "POST", {
        content: "protected-auth-control",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await f.request("/api/v1/channels/%23unrelated/messages", charlie, "POST", {
        content: "unrelated-auth-control",
      })
    ).status,
  ).toBe(201);
  const dm = b.waitForNewLine((line) => line.includes("independent-dm-control"));
  a!.send("PRIVMSG bob :independent-dm-control");
  await dm;
  async function flush() {
    const marker = `auth-live-marker-${randomUUID()}`;
    expect(
      (await f.request("/api/v1/channels/%23markers/messages", bob, "POST", { content: marker }))
        .status,
    ).toBe(201);
    await Promise.all([good.until(marker), outside.until(marker), f.barrier(b), f.barrier(c)]);
    expect(outside.received.some((line) => line.includes('"channelId":"#protected"'))).toBe(false);
    expect(
      c.lines.some((line) => / (MODE|TOPIC|KICK|JOIN|PART|PRIVMSG) #protected(?: |$)/.test(line)),
    ).toBe(false);
    const r = await f.request("/api/v1/channels/%23unrelated/info", charlie);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).channel.description).toBe("unrelated-auth-sentinel");
  }
  async function silence(action: () => Promise<void>) {
    await flush();
    const gs = good.received.length,
      os = outside.received.length,
      bs = b.lines.length,
      cs = c.lines.length;
    await action();
    await flush();
    for (const [events, start] of [
      [good.received, gs],
      [outside.received, os],
    ] as const)
      expect(events.slice(start).filter((line) => !line.includes("auth-live-marker-"))).toEqual([]);
    for (const [client, start] of [
      [b, bs],
      [c, cs],
    ] as const)
      expect(
        client.lines.slice(start).filter((line) => !/PONG|auth-live-marker-/.test(line)),
      ).toEqual([]);
  }
  return {
    f,
    root,
    alice,
    bob,
    charlie,
    get a() {
      return a!;
    },
    get b() {
      return b;
    },
    get c() {
      return c;
    },
    get good() {
      return good;
    },
    get outside() {
      return outside;
    },
    setAliceEnabled(value: boolean) {
      aliceEnabled = value;
    },
    flush,
    silence,
    async resume() {
      await f.restart();
      await observers();
    },
    async dispose() {
      await f.dispose();
    },
  };
}
export function sameProtected(
  before: Record<string, any[]>,
  after: Record<string, any[]>,
  except: string[] = [],
) {
  for (const table of Object.keys(before))
    if (!except.includes(table)) expect(after[table], table).toEqual(before[table]);
}
