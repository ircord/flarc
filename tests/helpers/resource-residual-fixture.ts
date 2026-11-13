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

/** Real worker, public clients and SQLite; wrappers only hold real authorization
 * RPC results and observe application queue counters without changing decisions. */
export async function resourceResidualFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-resource-residuals-"));
  const bundle = await ensureNitroBuilt();
  await cp(path.dirname(bundle), path.join(directory, "production"), { recursive: true });
  await writeFile(
    path.join(directory, "wrapper.mjs"),
    `export { default } from './production/index.mjs';
import { AccountsDO as Accounts, SessionDO as Session, ChannelDO } from './production/index.mjs';
export { ChannelDO };
export class AccountsDO extends Accounts {
  held = new Set(); heldOnce = new Set(); releases = []; attempts = {};
  resourceHold(names) { this.held = new Set(names); this.heldOnce.clear(); this.attempts = {}; }
  resourceAttempts() { return this.attempts; }
  resourceRelease() { this.held.clear(); for (const release of this.releases.splice(0)) release(); }
  async getAccountByUsername(name) {
    const account = await super.getAccountByUsername(name);
    if (this.held.has(name) && !this.heldOnce.has(name)) {
      this.heldOnce.add(name);
      this.attempts[name] = (this.attempts[name] ?? 0) + 1;
      await new Promise(resolve => this.releases.push(resolve));
    }
    return account;
  }
}
export class SessionDO extends Session {
  watched = new Set(); observed = {}; peakTotal = 0;
  resourceWatch(names) { this.watched = new Set(names); this.observed = {}; this.peakTotal = 0; }
  sendLine(ws, attachment, line, metadata) {
    const q = this.outboundQueues.get(ws);
    const before = { bytes: q?.bytes ?? 0, frames: q?.frames.length ?? 0, total: this.outboundBytes };
    const bytes = new TextEncoder().encode(line).byteLength;
    super.sendLine(ws, attachment, line, metadata);
    this.peakTotal = Math.max(this.peakTotal, this.outboundBytes);
    if (!this.watched.has(attachment.nickname)) return;
    const after = this.outboundQueues.get(ws);
    const row = this.observed[attachment.nickname] ??= { accepted: 0, bytes: 0, rejected: 0, peakBytes: 0, peakWaitingFrames: 0, firstReject: null };
    if (after && after.bytes === before.bytes + bytes) {
      row.accepted++; row.bytes += bytes;
      row.peakBytes = Math.max(row.peakBytes, after.bytes);
      row.peakWaitingFrames = Math.max(row.peakWaitingFrames, after.frames.length);
    } else {
      row.rejected++;
      row.firstReject ??= { ...before, nextBytes: bytes, readyState: ws.readyState };
    }
  }
  resourceState() { return {
    observed: this.observed, peakTotal: this.peakTotal, total: this.outboundBytes,
    queues: [...this.outboundQueues].map(([ws, q]) => ({ nickname: ws.deserializeAttachment()?.nickname, bytes: q.bytes, waitingFrames: q.frames.length })),
    known: this.sql.exec('SELECT canonical_channel FROM known_channels ORDER BY canonical_channel').toArray(),
    sessions: [...this.sessionsById.values()].map(({attachment: a}) => ({ sessionId: a.sessionId, userId: a.userId, nickname: a.nickname })),
    channels: this.sql.exec('SELECT session_id, canonical_channel FROM session_channels ORDER BY session_id, canonical_channel').toArray(),
  }; }
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
  async function request(route: string, who?: MatrixActor, method = "GET", body?: unknown) {
    return fetch(new URL(route, url), {
      method,
      headers: {
        ...(who ? { Authorization: `Bearer ${who.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function actor(username: string): Promise<MatrixActor> {
    const password = `Resource-${username}-${randomUUID()}!`;
    expect(
      (await request("/api/v1/auth/register", undefined, "POST", { username, password })).status,
    ).toBe(201);
    const response = await request("/api/v1/auth/login", undefined, "POST", { username, password });
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    return { username, password, token: data.token, account: data.account };
  }
  async function connect(who: MatrixActor, nickname = who.username) {
    const client = new TestIRCClient(`ws://${url.host}/irc`);
    clients.push(client);
    await client.connect();
    client.send(`PASS ${who.username}:${who.password}`);
    await client.register(nickname);
    return client;
  }
  async function event(who: MatrixActor) {
    const ws = new WebSocket(`ws://${url.host}/api/v1/events`, ["flarc.events.v2"], {
      headers: { Authorization: `Bearer ${who.token}` },
    });
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
  async function stub(binding: "SESSION" | "ACCOUNTS" = "SESSION") {
    const ns = await mf.getDurableObjectNamespace(binding);
    return ns.get(ns.idFromName("FlaRC")) as any;
  }
  async function files(dir: string): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(dir, { withFileTypes: true })
        ).map((entry) =>
          entry.isDirectory()
            ? files(path.join(dir, entry.name))
            : [path.join(dir, entry.name)].filter((p) => p.endsWith(".sqlite")),
        ),
      )
    ).flat();
  }
  async function rows(table: string) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid table");
    const result: any[] = [];
    for (const file of await files(path.join(directory, "state"))) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
          result.push(...db.prepare(`SELECT * FROM ${table}`).all());
      } finally {
        db.close();
      }
    }
    return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  async function channelState(name: string) {
    for (const file of await files(path.join(directory, "state"))) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (!db.prepare("SELECT name FROM sqlite_master WHERE name='channel_metadata'").get())
          continue;
        if (db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get()?.value !== name)
          continue;
        const result: Record<string, any[]> = {};
        for (const table of [
          "channel_metadata",
          "channel_members",
          "channel_permissions",
          "channel_role_groups",
          "channel_user_roles",
          "messages",
        ])
          result[table] = db
            .prepare(`SELECT * FROM ${table}`)
            .all()
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return result;
      } finally {
        db.close();
      }
    }
    throw new Error(`Missing persisted channel ${name}`);
  }
  async function stop() {
    if (stopped) return;
    stopped = true;
    await (await stub("ACCOUNTS")).resourceRelease();
    for (const c of clients.splice(0)) c.close();
    for (const ws of sockets.splice(0)) ws.terminate();
    await mf.dispose();
  }
  return {
    actor,
    connect,
    event,
    request,
    stub,
    rows,
    channelState,
    stop,
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

export type ResourceFixture = Awaited<ReturnType<typeof resourceResidualFixture>>;
