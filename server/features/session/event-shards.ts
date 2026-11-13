import { hashSessionToken } from "../../core/authentication/tokens";
import { eventShardCount, SERVER_CONFIG } from "../../core/config";
import type { RequestSource } from "../../core/request-source";
import type { SessionDO } from "../../durable-objects/session";
import { EventCommandSchema } from "../../schemas/conversations";
import { ReaderAckSchema } from "../../schemas/event-stream";
import { FeatureError } from "../operations";
import type { EventSubscriptions, SessionCredential } from "./contracts";
import { EVENT_INPUT_LIMITS } from "./event-input-limits";

const LEASE_MS = 30_000;
const POLL_MS = 1000;
const MAX_CONNECTIONS = 2000;
const MAX_ACCOUNT_CONNECTIONS = 5;
export const shardName = (network: string, shard: number) => `${network}:events:${shard}`;
type Lease = {
  lease_id: string;
  account_id: string;
  session_hash: string;
  source_json: string;
  shard: number;
  protocol: number;
  cursor: string;
  pending_cursor: string | null;
  subscriptions_json: string | null;
  expires_at: number;
};
type EdgeAttachment = {
  edgeLease: string;
  eventProtocol: number;
  shard: number;
  leaseExpiresAt: number;
  ackCursor?: string;
};
export type Admission = { lease: string; shard: number; protocol: number; expiresAt: number };
export type EventAdmissionInput = {
  url: string;
  authorization: string | null;
  protocol: string | null;
  origin: string | null;
  source: RequestSource;
};
export type EventAdmissionResult =
  | { ok: true; admission: Admission; networkId: string }
  | { ok: false; status: number; text: string };

type EdgePollResult = {
  events: Array<{ eventId: string; cursor: string }>;
  cursor: string;
  expiresAt: number;
  caughtUp: boolean;
};
interface EdgeAuthorityRPC {
  pollEventShard(lease: string, shard: number, cursor?: string): Promise<EdgePollResult>;
  eventForShard(lease: string, shard: number, id: string): Promise<Record<string, unknown> | null>;
  eventShardCommand(lease: string, shard: number, input: unknown): Promise<unknown>;
  releaseEventShard(lease: string, shard: number): Promise<void>;
}

/** Central durable admission/journal authority; no socket or private history is moved. */
export class EventShardAuthority {
  constructor(
    private readonly session: SessionDO,
    private readonly storage: DurableObjectStorage,
  ) {
    session.sql.exec(`CREATE TABLE IF NOT EXISTS event_connection_leases (
      lease_id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, session_hash TEXT NOT NULL,
      source_json TEXT NOT NULL, shard INTEGER NOT NULL,protocol INTEGER NOT NULL,
      cursor TEXT NOT NULL,pending_cursor TEXT,subscriptions_json TEXT,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_event_lease_account ON event_connection_leases(account_id,expires_at);
      CREATE TABLE IF NOT EXISTS event_shard_hints (shard INTEGER PRIMARY KEY NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS event_edge_admissions (lease_id TEXT PRIMARY KEY NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS session_topology (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL);`);
  }

  hint() {
    const revision = this.session.features.journal.highWatermark();
    for (let shard = 0; shard < eventShardCount(this.session.env); shard++)
      this.session.sql.exec(
        "INSERT INTO event_shard_hints(shard,revision) VALUES (?,?) ON CONFLICT(shard) DO UPDATE SET revision=MAX(revision,excluded.revision)",
        shard,
        revision,
      );
  }

  /** Wake only occupied shards; never wait for a shard to call back into the authority. */
  async wakeEdges() {
    const shards = this.session.sql
      .exec<{ shard: number }>(
        "SELECT DISTINCT shard FROM event_connection_leases WHERE expires_at>?",
        Date.now(),
      )
      .toArray();
    await Promise.allSettled(
      shards.map(({ shard }) =>
        this.session.env.SESSION.get(
          this.session.env.SESSION.idFromName(shardName(SERVER_CONFIG.networkId, shard)),
        ).scheduleAlarm(Date.now() + 1),
      ),
    );
  }

  /** Trusted HTTP adapter supplies source proof; this RPC grants no caller-selected actor. */
  async authenticate(input: EventAdmissionInput): Promise<EventAdmissionResult> {
    const url = new URL(input.url);
    const ticket = url.searchParams.get("ticket"),
      bearer = input.authorization;
    if (!ticket && !bearer?.startsWith("Bearer "))
      return { ok: false, status: 401, text: "A logged-in API session is required" };
    if (
      !["/api/v1/events", "/api/events"].includes(url.pathname.replace(/\/+$/, "")) ||
      [...url.searchParams.keys()].some((key) => key !== "ticket")
    )
      return { ok: false, status: 400, text: "Unsupported event selector" };
    if (
      input.origin &&
      input.origin !== url.origin &&
      !(this.session.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((v) => v.trim())
        .includes(input.origin)
    )
      return { ok: false, status: 403, text: "Origin denied" };
    const accounts = this.session.getAccountsStub();
    if (!(await accounts.checkRequestLimit(`event-handshake:${input.source.ip}`, 30)))
      return { ok: false, status: 429, text: "Handshake limit reached" };
    const sessionHash = ticket
      ? await accounts.consumeEventTicket(ticket)
      : bearer?.startsWith("Bearer ") && (await accounts.verifyApiSession(bearer.slice(7)))
        ? await hashSessionToken(bearer.slice(7))
        : null;
    if (!sessionHash)
      return { ok: false, status: 401, text: "A logged-in API session is required" };
    try {
      const protocol = input.protocol
        ?.split(",")
        .map((p) => p.trim())
        .includes("flarc.events.v2")
        ? 2
        : 1;
      const admission = await this.admit(
        sessionHash,
        input.source,
        ticket ?? crypto.randomUUID(),
        protocol,
      );
      return { ok: true, admission, networkId: SERVER_CONFIG.networkId };
    } catch (error) {
      if (error instanceof FeatureError)
        return { ok: false, status: error.statusCode, text: "Event admission denied" };
      throw error;
    }
  }

  async admit(
    sessionHash: string,
    source: RequestSource,
    seed: string,
    protocol: number,
  ): Promise<Admission> {
    const actor = await this.session.features.actor({ sessionHash, source }, "events.connect", "*");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    const shard = new DataView(digest).getUint32(0) % eventShardCount(this.session.env);
    const lease = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    const cursor = this.session.features.journal.cursor(actor.id);
    const preferences = this.session.sql
      .exec<{ subscriptions_json: string }>(
        "SELECT subscriptions_json FROM event_subscription_preferences WHERE account_id=?",
        actor.id,
      )
      .toArray()[0];
    const expiresAt = Date.now() + LEASE_MS;
    this.storage.transactionSync(() => {
      this.session.sql.exec("DELETE FROM event_connection_leases WHERE expires_at<=?", Date.now());
      const total = this.session.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM event_connection_leases")
        .toArray()[0].n;
      const own = this.session.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM event_connection_leases WHERE account_id=?",
          actor.id,
        )
        .toArray()[0].n;
      if (
        total + this.session.legacyEventConnectionCount() >= MAX_CONNECTIONS ||
        own + this.session.legacyEventConnectionCount(actor.id) >= MAX_ACCOUNT_CONNECTIONS
      )
        throw new FeatureError(429, "CONNECTION_LIMIT", "Event connection limit reached");
      this.session.sql.exec(
        "INSERT INTO event_connection_leases VALUES (?,?,?,?,?,?,?,?,?,?)",
        lease,
        actor.id,
        sessionHash,
        JSON.stringify(source),
        shard,
        protocol,
        cursor,
        null,
        preferences?.subscriptions_json ?? null,
        expiresAt,
      );
    });
    return { lease, shard, protocol, expiresAt };
  }

  private async live(
    leaseId: string,
    shard: number,
  ): Promise<{ lease: Lease; credential: SessionCredential }> {
    const lease = this.session.sql
      .exec<Lease>("SELECT * FROM event_connection_leases WHERE lease_id=?", leaseId)
      .toArray()[0];
    if (!lease || lease.expires_at <= Date.now() || lease.shard !== shard)
      throw new FeatureError(401, "CONNECTION_EXPIRED", "Reconnect with a fresh event ticket");
    const credential = { sessionHash: lease.session_hash, source: JSON.parse(lease.source_json) };
    const actor = await this.session.features.actor(credential, "events.replay", "*");
    if (actor.id !== lease.account_id)
      throw new FeatureError(403, "CONNECTION_FORBIDDEN", "Connection owner changed");
    // Recheck after authorization RPC, preventing close/expiry from renewing a stale row.
    if (
      !this.session.sql
        .exec(
          "SELECT 1 FROM event_connection_leases WHERE lease_id=? AND expires_at>?",
          leaseId,
          Date.now(),
        )
        .toArray().length
    )
      throw new FeatureError(401, "CONNECTION_EXPIRED", "Connection expired during authorization");
    return { lease, credential };
  }

  async poll(leaseId: string, shard: number, ackCursor?: string) {
    const { lease, credential } = await this.live(leaseId, shard);
    if (ackCursor && ackCursor === lease.pending_cursor) {
      lease.cursor = ackCursor;
      this.session.sql.exec(
        "UPDATE event_connection_leases SET cursor=?,pending_cursor=NULL WHERE lease_id=?",
        ackCursor,
        leaseId,
      );
    }
    const actor = await this.session.features.actor(credential, "events.replay", "*");
    const position = this.session.features.journal.position(actor.id, lease.cursor);
    const hint =
      this.session.sql
        .exec<{ revision: number }>("SELECT revision FROM event_shard_hints WHERE shard=?", shard)
        .toArray()[0]?.revision ?? 0;
    if (position >= hint && position >= this.session.features.journal.highWatermark()) {
      const expiresAt = Date.now() + LEASE_MS;
      this.session.sql.exec(
        "UPDATE event_connection_leases SET expires_at=? WHERE lease_id=?",
        expiresAt,
        leaseId,
      );
      return { events: [], cursor: lease.cursor, expiresAt, caughtUp: true };
    }
    const subscriptions: EventSubscriptions | undefined = lease.subscriptions_json
      ? JSON.parse(lease.subscriptions_json)
      : undefined;
    const result = await this.session.features.journal.replay(
      actor,
      lease.cursor,
      8,
      (r) => this.session.features.service.matches(subscriptions, r),
      !subscriptions,
    );
    const expiresAt = Date.now() + LEASE_MS;
    const live = await this.live(leaseId, shard);
    if (live.lease.cursor !== lease.cursor)
      return {
        events: [],
        cursor: live.lease.cursor,
        expiresAt: live.lease.expires_at,
        caughtUp: false,
      };
    this.session.sql.exec(
      "UPDATE event_connection_leases SET pending_cursor=?,expires_at=? WHERE lease_id=?",
      result.cursor,
      expiresAt,
      leaseId,
    );
    return { ...result, expiresAt };
  }

  async event(leaseId: string, shard: number, id: string) {
    const { lease, credential } = await this.live(leaseId, shard);
    const actor = await this.session.features.actor(credential, "events.replay", "*");
    const event = await this.session.features.journal.event(actor, id, !lease.subscriptions_json);
    if (event) await this.live(leaseId, shard);
    return event;
  }

  async command(leaseId: string, shard: number, input: unknown) {
    const { lease, credential } = await this.live(leaseId, shard);
    const command = EventCommandSchema.parse(input);
    const state = {
      cursor: lease.cursor,
      subscriptions: lease.subscriptions_json ? JSON.parse(lease.subscriptions_json) : undefined,
    };
    const result = await this.session.features.eventCommand(credential, state, command);
    await this.live(leaseId, shard);
    this.session.sql.exec(
      "UPDATE event_connection_leases SET cursor=?,pending_cursor=NULL,subscriptions_json=? WHERE lease_id=?",
      state.cursor ?? lease.cursor,
      state.subscriptions ? JSON.stringify(state.subscriptions) : null,
      leaseId,
    );
    return result;
  }

  release(leaseId: string, shard: number) {
    this.session.sql.exec(
      "DELETE FROM event_connection_leases WHERE lease_id=? AND shard=?",
      leaseId,
      shard,
    );
  }
}

/** Separately named SessionDO owns only event sockets, bounded transport state and leases. */
export class EventShardConnections {
  private queues = new WeakMap<WebSocket, { tail: Promise<void>; frames: number; bytes: number }>();
  private inputLimits = new WeakMap<WebSocket, { start: number; count: number }>();
  constructor(
    private readonly session: SessionDO,
    private readonly ctx: DurableObjectState,
  ) {}
  private central(): EdgeAuthorityRPC {
    return this.session.env.SESSION.get(
      this.session.env.SESSION.idFromName(SERVER_CONFIG.networkId),
    ) as unknown as EdgeAuthorityRPC;
  }
  isEdge() {
    return (
      this.session.sql.exec("SELECT 1 FROM session_topology WHERE key='event-shard'").toArray()
        .length > 0
    );
  }
  async open(request: Request) {
    const admission = JSON.parse(
      request.headers.get("x-flarc-event-admission") ?? "null",
    ) as Admission | null;
    if (
      !admission ||
      !/^[0-9a-f]{64}$/.test(admission.lease) ||
      !Number.isInteger(admission.shard) ||
      admission.shard < 0 ||
      admission.shard >= eventShardCount(this.session.env) ||
      admission.expiresAt <= Date.now() ||
      ![1, 2].includes(admission.protocol) ||
      this.ctx.id.toString() !==
        this.session.env.SESSION.idFromName(
          shardName(SERVER_CONFIG.networkId, admission.shard),
        ).toString()
    )
      return new Response("Invalid internal event admission", { status: 403 });
    if (this.ctx.getWebSockets("edge-events").length >= MAX_CONNECTIONS)
      return new Response("Shard connection limit", { status: 429 });
    // This internal admission is one-use as well as its original public ticket.
    this.session.sql.exec("DELETE FROM event_edge_admissions WHERE expires_at<=?", Date.now());
    if (
      this.session.sql
        .exec("SELECT 1 FROM event_edge_admissions WHERE lease_id=?", admission.lease)
        .toArray().length
    )
      return new Response("Event admission already used", { status: 409 });
    this.session.sql.exec(
      "INSERT INTO event_edge_admissions VALUES (?,?)",
      admission.lease,
      admission.expiresAt,
    );
    this.session.sql.exec(
      "INSERT OR REPLACE INTO session_topology(key,value) VALUES ('event-shard',?)",
      String(admission.shard),
    );
    this.session.sql.exec(
      "INSERT OR REPLACE INTO session_topology(key,value) VALUES ('durable-object-id',?)",
      this.ctx.id.toString(),
    );
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["edge-events"]);
    server.serializeAttachment({
      edgeLease: admission.lease,
      eventProtocol: admission.protocol,
      shard: admission.shard,
      leaseExpiresAt: admission.expiresAt,
    } satisfies EdgeAttachment);
    if (admission.protocol === 2)
      this.session.sendEventFrame(
        server,
        JSON.stringify({
          type: "hello",
          protocol: 2,
          ack: { type: "reader.ack", maxBytes: 262144, maxFrames: 1024, maxAgeMs: 30000 },
        }),
      );
    await this.session.scheduleAlarm(Date.now() + POLL_MS);
    const headers = new Headers();
    if (admission.protocol === 2) headers.set("Sec-WebSocket-Protocol", "flarc.events.v2");
    return new Response(null, { status: 101, webSocket: client, headers } as any);
  }
  private enqueue(ws: WebSocket, bytes: number, work: () => Promise<void>) {
    const q = this.queues.get(ws) ?? { tail: Promise.resolve(), frames: 0, bytes: 0 };
    if (q.frames >= 16 || q.bytes + bytes > 262144) {
      ws.close(1008, "Event input queue limit reached");
      return Promise.resolve();
    }
    q.frames++;
    q.bytes += bytes;
    const task = q.tail
      .then(work)
      .catch((error) => {
        const text = String(error?.message ?? error),
          match = text.match(/F3:(\d+):([A-Z_]+):/);
        if (match && Number(match[1]) === 410)
          this.session.sendEventFrame(
            ws,
            JSON.stringify({ type: "resync.required", code: match[2] }),
          );
        try {
          ws.close(1008, "Event authorization or recovery required");
        } catch {}
      })
      .finally(() => {
        q.frames--;
        q.bytes -= bytes;
      });
    q.tail = task;
    this.queues.set(ws, q);
    return task;
  }
  async message(ws: WebSocket, message: string | ArrayBuffer) {
    const now = Date.now(),
      old = this.inputLimits.get(ws);
    const limit =
      old && now - old.start < EVENT_INPUT_LIMITS.windowMs ? old : { start: now, count: 0 };
    if (++limit.count > EVENT_INPUT_LIMITS.maxFramesPerWindow) {
      ws.close(1008, "Event command rate exceeded");
      return;
    }
    this.inputLimits.set(ws, limit);
    const bytes =
      typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    if (bytes > EVENT_INPUT_LIMITS.maxFrameBytes) {
      ws.close(1008, "Event input frame too large");
      return;
    }
    return this.enqueue(ws, bytes, async () => {
      const a = ws.deserializeAttachment() as EdgeAttachment;
      const input = JSON.parse(
        typeof message === "string"
          ? message
          : new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(message),
      );
      if (input?.type === "reader.ack") {
        if (a.eventProtocol !== 2) throw new Error("Invalid reader ACK");
        const ack = ReaderAckSchema.parse(input);
        this.session.reader.acknowledge(ws, ack.token, "events-v2");
        return;
      }
      try {
        const result = await this.central().eventShardCommand(a.edgeLease, a.shard, input);
        this.session.sendEventFrame(
          ws,
          JSON.stringify({ type: "result", requestId: input.requestId, result }),
        );
      } catch (error) {
        const match = String((error as Error).message).match(/F3:(\d+):([A-Z_]+):/);
        if (!match) throw error;
        this.session.sendEventFrame(
          ws,
          JSON.stringify({
            type: "error",
            requestId: input.requestId,
            status: Number(match[1]),
            code: match[2],
            resync: Number(match[1]) === 410,
          }),
        );
        if (["SESSION_EXPIRED", "NETWORK_BANNED", "CONNECTION_EXPIRED"].includes(match[2]))
          ws.close(1008, "Event authorization revoked");
      }
      await this.drain(ws);
    });
  }
  private async drain(ws: WebSocket) {
    if (ws.readyState !== 1 || ws.deserializeAttachment()?.readerClosed) return;
    const a = ws.deserializeAttachment() as EdgeAttachment;
    if (a.leaseExpiresAt <= Date.now()) {
      ws.close(1008, "Event authority lease expired");
      return;
    }
    const result = await this.central().pollEventShard(a.edgeLease, a.shard, a.ackCursor);
    for (const candidate of result.events) {
      const event = await this.central().eventForShard(a.edgeLease, a.shard, candidate.eventId);
      if (
        event &&
        !this.session.sendEventFrame(ws, JSON.stringify({ ...event, cursor: candidate.cursor }))
      )
        return;
    }
    ws.serializeAttachment({
      ...ws.deserializeAttachment(),
      ackCursor: result.cursor,
      leaseExpiresAt: result.expiresAt,
    });
    if (!result.caughtUp) await this.session.scheduleAlarm(Date.now() + 1);
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets("edge-events")) {
      this.session.reader.inspect(
        ws,
        ws.deserializeAttachment()?.eventProtocol === 2 ? "events-v2" : "events-v1",
      );
      await this.enqueue(ws, 0, () => this.drain(ws));
    }
    if (
      this.ctx
        .getWebSockets("edge-events")
        .some((ws) => ws.readyState === 1 && !ws.deserializeAttachment()?.readerClosed)
    ) {
      await this.session.scheduleAlarm(Date.now() + POLL_MS);
    }
  }
  async close(ws: WebSocket) {
    const a = ws.deserializeAttachment() as EdgeAttachment;
    if (a?.edgeLease) await this.central().releaseEventShard(a.edgeLease, a.shard);
  }
}
