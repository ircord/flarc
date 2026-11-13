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
  throw new Error(`Observable did not settle: ${label}`);
}

export function closed(socket: WebSocket, timeout = 10000) {
  const pending = new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Expected actual socket close")), timeout);
    socket.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
  // Keep rejection owned even if an earlier assertion exits before the caller
  // awaits it; awaiting the original promise still reports the close failure.
  void pending.catch(() => {});
  return pending;
}

export async function createAbuseFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-abuse-gaps-"));
  const bundle = await ensureNitroBuilt();
  await cp(path.dirname(bundle), path.join(directory, "production"), { recursive: true });
  await writeFile(
    path.join(directory, "wrapper.mjs"),
    `export { default } from './production/index.mjs';
import { AccountsDO as Accounts, SessionDO as Session, ChannelDO as Channel } from './production/index.mjs';
export class AccountsDO extends Accounts {
  heldName = null; heldOnce = false; holdReached = false; holdWaiters = []; releases = []; failedName = null; failedOnce = false; persistentFailure = false; failedLookups = 0; failureTimes = []; attempts = 0;
  abuseHold(name) { this.heldName = name; this.heldOnce = false; this.holdReached = false; this.attempts = 0; }
  abuseReached() { return this.holdReached ? true : new Promise(resolve => this.holdWaiters.push(resolve)); }
  abuseRelease() { this.heldName = null; for (const resolve of this.releases.splice(0)) resolve(); }
  abuseFail(name, persistent = false) { this.failedName = name; this.failedOnce = false; this.persistentFailure = persistent; this.failedLookups = 0; this.failureTimes = []; this.attempts = 0; }
  abuseAttempts() { return this.attempts; }
  abuseFailedLookups() { return this.failedLookups; }
  abuseFailureTimesJSON() { return JSON.stringify(this.failureTimes); }
  async getAccountByUsername(name) {
    const account = await super.getAccountByUsername(name);
    if (name === this.failedName) this.failedLookups++;
    if (name === this.failedName && (this.persistentFailure || !this.failedOnce)) { this.failedOnce = true; this.attempts++; this.failureTimes.push(Date.now()); this.sql.exec('SELECT * FROM abuse_deliberately_missing_table').toArray(); }
    if (name === this.heldName && !this.heldOnce) {
      this.heldOnce = true;
      this.attempts++; this.holdReached = true;
      const wait = new Promise(resolve => this.releases.push(resolve));
      for (const resolve of this.holdWaiters.splice(0)) resolve(true);
      await wait;
    }
    return account;
  }
}
export class SessionDO extends Session {
  peak = new Map(); createdJoinCommits = new Set();
  async handleIRCCommand(ws, attachment, message) {
    await super.handleIRCCommand(ws, attachment, message);
    if(message.command==='JOIN') for(const channel of (message.params[0]??'').split(',')) {
      if(/^#created[0-9]+$/.test(channel) && this.sql.exec('SELECT 1 FROM known_channels WHERE canonical_channel=?',channel).toArray().length)
        this.createdJoinCommits.add(channel);
    }
  }
  abuseEdgeSockets() {
    return this.ctx.getWebSockets('edge-events').map(ws => ({leaseId: ws.deserializeAttachment()?.edgeLease, readyState: ws.readyState}));
  }
  sendLine(ws, attachment, line, metadata) {
    super.sendLine(ws, attachment, line, metadata);
    const queue = this.outboundQueues.get(ws);
    if (queue) {
      const prior = this.peak.get(attachment.accountName) ?? {bytes: 0, frames: 0};
      this.peak.set(attachment.accountName, {bytes: Math.max(prior.bytes, queue.bytes), frames: Math.max(prior.frames, queue.frames.length)});
    }
  }
  abuseState() {
    const live = this.ctx.getWebSockets();
    return {
      liveSockets: live.length,
      events: this.sql.exec('SELECT lease_id AS leaseId,account_id AS accountId,shard FROM event_connection_leases WHERE expires_at>?', Date.now()).toArray(),
      sessions: [...this.sessionsById.values()].map(({attachment: a}) => ({sessionId: a.sessionId, userId: a.userId, nickname: a.nickname})),
      monitors: this.sql.exec('SELECT session_id, target_nick FROM session_monitors ORDER BY session_id, target_nick').toArray(),
      channels: this.sql.exec('SELECT session_id, canonical_channel FROM session_channels ORDER BY session_id, canonical_channel').toArray(),
      known: this.sql.exec('SELECT canonical_channel FROM known_channels ORDER BY canonical_channel').toArray(),
      createdJoinCommits: [...this.createdJoinCommits],
      queued: [...this.outboundQueues].map(([ws, q]) => ({nickname: ws.deserializeAttachment()?.nickname, bytes: q.bytes, frames: q.frames.length})),
      totalQueuedBytes: this.outboundBytes,
      peak: Object.fromEntries(this.peak),
    };
  }
}
export class ChannelDO extends Channel {
  retryAlarms = [];
  async alarm() {
    const startedAt = Date.now();
    try { await super.alarm(); }
    finally { this.retryAlarms.push({startedAt, endedAt: Date.now(), nextAlarm: await this.ctx.storage.getAlarm()}); }
  }
  async abuseRetryStateJSON() { const nextAlarm = await this.ctx.storage.getAlarm(); return JSON.stringify({
    nextAlarm,
    alarms: this.retryAlarms,
    pending: this.sql.exec('SELECT id,generation,kind,payload,created_at,sequence FROM channel_feature_outbox ORDER BY sequence').toArray(),
    nextSequence: this.sql.exec('SELECT next_sequence FROM channel_feature_outbox_counter WHERE id=1').toArray()[0].next_sequence,
    observedAt: Date.now(),
  }); }
  abuseState() { return {
    members: this.sql.exec('SELECT session_id, user_id, nickname FROM channel_members ORDER BY session_id').toArray(),
    grants: this.sql.exec('SELECT user_id, permission FROM channel_permissions ORDER BY user_id, permission').toArray(),
    messages: this.sql.exec('SELECT id, sender_id, content FROM messages ORDER BY sequence').toArray(),
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
  async function request(route: string, actor?: MatrixActor, method = "GET", body?: unknown) {
    return fetch(new URL(route, url), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function actor(username: string): Promise<MatrixActor> {
    const password = `Abuse-${username}-${randomUUID()}!`;
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
    const issued = await request("/api/v1/auth/events-ticket", who, "POST");
    expect(issued.status).toBe(200);
    const ticket = ((await issued.json()) as any).ticket;
    const ws = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${ticket}`, [
      "flarc.events.v2",
    ]);
    sockets.push(ws);
    const lines: string[] = [];
    const challenges: string[] = [];
    let bytes = 0,
      wireBytes = 0;
    let contract: { maxBytes: number; maxFrames: number; maxAgeMs: number } | undefined;
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      const payloadBytes = Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
        : data.byteLength;
      wireBytes += payloadBytes + 2 + (payloadBytes < 126 ? 0 : payloadBytes <= 65535 ? 2 : 8);
      if (frame.type === "hello") contract = frame.ack;
      if (frame.type === "reader.challenge") challenges.push(frame.token);
      if (isReaderControl(ws, data)) return;
      bytes += payloadBytes;
      lines.push(data.toString());
    });
    const status = await new Promise<number>((resolve, reject) => {
      ws.once("open", () => resolve(101));
      ws.once("unexpected-response", (_req, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      ws.once("error", reject);
    });
    return {
      ws,
      status,
      lines,
      challenges,
      get contract() {
        return contract;
      },
      get wireBytes() {
        return wireBytes;
      },
      get bytes() {
        return bytes;
      },
    };
  }
  async function stub(binding: "SESSION" | "ACCOUNTS" | "CHANNELS", name = "FlaRC") {
    const namespace = await mf.getDurableObjectNamespace(binding);
    return namespace.get(namespace.idFromName(name)) as any;
  }
  async function stop() {
    if (stopped) return;
    stopped = true;
    await (await stub("ACCOUNTS")).abuseRelease();
    for (const c of clients.splice(0)) c.close();
    for (const s of sockets.splice(0)) if (s.readyState === WebSocket.OPEN) s.terminate();
    await mf.dispose();
  }
  async function snapshot(table: string) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid table");
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
    actor,
    request,
    connect,
    event,
    stub,
    stop,
    snapshot,
    channel: (name: string) => stub("CHANNELS", `FlaRC:${name}`),
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
