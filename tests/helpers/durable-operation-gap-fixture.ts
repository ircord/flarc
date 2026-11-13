import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { expect } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "./event-reader";
import type { MatrixActor } from "./matrix-fixture";
import { ensureNitroBuilt, TestIRCClient } from "./miniflare-harness";

export async function eventually(check: () => boolean | Promise<boolean>, label: string) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Missing actual observable: ${label}`);
}

export async function createDurableOperationFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-durable-operations-"));
  const bundle = await ensureNitroBuilt();
  await cp(path.dirname(bundle), path.join(directory, "production"), { recursive: true });
  await writeFile(
    path.join(directory, "wrapper.mjs"),
    `
export { default, SessionDO } from './production/index.mjs';
import { AccountsDO as Accounts, ChannelDO as Channel } from './production/index.mjs';
export class AccountsDO extends Accounts {
  durableState() {
    return Object.fromEntries(['users','registered_nicks','scram_credentials','account_roles','account_settings','api_sessions','event_tickets'].map(table => [table, this.sql.exec('SELECT * FROM '+table+' ORDER BY 1,2').toArray()]));
  }
}
export class ChannelDO extends Channel {
  durableState() {
    return Object.fromEntries(['channel_metadata','messages','channel_members','channel_permissions','channel_role_groups','channel_user_roles'].map(table => [table,this.sql.exec('SELECT * FROM '+table+' ORDER BY 1,2').toArray()]));
  }
}
`,
  );
  const options = {
    modules: true as const,
    scriptPath: path.join(directory, "wrapper.mjs"),
    modulesRoot: directory,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SIGNUP_POLICY: "open" },
    durableObjectsPersist: path.join(directory, "state"),
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
  };
  let mf = new Miniflare(options),
    url = await mf.ready,
    stopped = false;
  const clients: TestIRCClient[] = [],
    sockets: WebSocket[] = [];
  const request = (
    route: string,
    actor?: MatrixActor | null,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(new URL(route, url), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function login(username: string, password: string): Promise<MatrixActor> {
    const response = await request("/api/v1/auth/login", null, "POST", { username, password });
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.token).toMatch(/^[a-f0-9]{64}$/);
    return { username, password, token: data.token, account: data.account };
  }
  async function actor(username: string) {
    const password = `Durable-${username}-${randomUUID()}!`;
    const response = await request("/api/v1/auth/register", null, "POST", {
      username,
      password,
      displayName: `${username} display`,
    });
    expect(response.status).toBe(201);
    return login(username, password);
  }
  async function connect(actor: MatrixActor, nickname = actor.username) {
    const client = new TestIRCClient(`ws://${url.host}/irc`);
    clients.push(client);
    await client.connect();
    client.send(`PASS ${actor.username}:${actor.password}`);
    await client.register(nickname);
    const cap = client.waitForNewLine((line) => line.includes(" CAP ") && line.includes(" ACK "));
    client.send("CAP REQ :message-tags");
    await cap;
    return client;
  }
  async function event(actor: MatrixActor) {
    const issued = await request("/api/v1/auth/events-ticket", actor, "POST");
    expect(issued.status).toBe(200);
    const ticket = ((await issued.json()) as any).ticket;
    const ws = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${ticket}`, [
      "flarc.events.v2",
    ]);
    sockets.push(ws);
    const lines: string[] = [];
    ws.on("message", (data) => {
      if (!isReaderControl(ws, data)) lines.push(data.toString());
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return { ws, lines };
  }
  async function stub(binding: "ACCOUNTS" | "CHANNELS", name = "FlaRC") {
    const ns = await mf.getDurableObjectNamespace(binding);
    return ns.get(ns.idFromName(name)) as any;
  }
  async function stop() {
    if (stopped) return;
    stopped = true;
    for (const c of clients.splice(0)) c.close();
    for (const ws of sockets.splice(0)) ws.terminate();
    await mf.dispose();
  }
  async function snapshot(table: string) {
    if (!stopped || !/^[a-z_]+$/.test(table))
      throw new Error("Stopped runtime and fixed table required");
    async function files(dir: string): Promise<string[]> {
      return (
        await Promise.all(
          (
            await readdir(dir, { withFileTypes: true })
          ).map((entry) => {
            const file = path.join(dir, entry.name);
            return entry.isDirectory() ? files(file) : [file].filter((p) => p.endsWith(".sqlite"));
          }),
        )
      ).flat();
    }
    const rows: any[] = [];
    for (const file of await files(path.join(directory, "state"))) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
          rows.push(...db.prepare(`SELECT * FROM ${table}`).all());
      } finally {
        db.close();
      }
    }
    return rows;
  }
  return {
    request,
    login,
    actor,
    connect,
    event,
    stop,
    snapshot,
    accounts: async () => JSON.parse(JSON.stringify(await (await stub("ACCOUNTS")).durableState())),
    channel: async (name: string) =>
      JSON.parse(JSON.stringify(await (await stub("CHANNELS", `FlaRC:${name}`)).durableState())),
    async restart() {
      await stop();
      mf = new Miniflare(options);
      url = await mf.ready;
      stopped = false;
    },
    async dispose() {
      await stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
