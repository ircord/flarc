import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { applyEnvConfig, SERVER_CONFIG } from "../core/config";
import { IRCProtocolError } from "../core/errors";
import { SlidingWindowRateLimiter } from "../core/permissions/rate-limits";
import { isValidChannelName } from "../core/permissions/validation";
import { normalizePeerAddress, type RequestSource, requestSource } from "../core/request-source";
import type { Env, SessionAttachment, StoredChannelMessage, Subprotocol } from "../core/types";
import { FeatureError } from "../features/operations";
import { EarliestAlarm } from "../features/session/alarm-scheduler";
import { SessionFeatureBridge } from "../features/session/bridge";
import type { SessionCredential } from "../features/session/contracts";
import {
  type EventAdmissionInput,
  type EventAdmissionResult,
  EventShardAuthority,
  EventShardConnections,
  shardName,
} from "../features/session/event-shards";
import { IRC_READER_PREFIX, ReaderTransport } from "../features/session/reader-transport";
import { handleJoin } from "../protocol/irc/commands/channel";
import { dispatchIRCCommand } from "../protocol/irc/commands/dispatcher";
import type { ISessionDO, PendingMultilineBatch } from "../protocol/irc/commands/types";
import { encodeIRCMessage, encodeNumeric, encodeWebSocketFrame } from "../protocol/irc/encoder";
import { Numerics } from "../protocol/irc/numerics";
import { canonicalizeIRCName, decodeWebSocketFrame, parseIRCMessage } from "../protocol/irc/parser";
import type { IRCMessage } from "../protocol/irc/types";
import { initializeSessionSchema } from "../storage/migrations/init";
import { initializePrimaryKeyIntegrity } from "../storage/migrations/schema-integrity";
import * as sessionSchema from "../storage/schemas/session";

function _truncateUtf8(str: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  if (bytes.length <= maxBytes) return str;
  let cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
    cut--;
  }
  const dec = new TextDecoder("utf-8");
  return dec.decode(bytes.subarray(0, cut));
}

type MetadataVisibility = {
  key: string;
  sourceSessionId?: string;
  sourceUserId?: string;
  sourceNick?: string;
  channel?: string;
  allowUnsubscribed?: boolean;
  channelGeneration?: string;
  requested?: boolean;
  control?: boolean;
  controlRecipientSessionId?: string;
  controlRecipientUserId?: string;
  conversationId?: string;
};
type OutboundFrame = {
  line: string;
  userId: string;
  accountName: string;
  version: number;
  metadata?: MetadataVisibility;
};

export class SessionDO extends DurableObject<Env> implements ISessionDO {
  public override env: Env;
  public sql: SqlStorage;
  public db: ReturnType<typeof drizzle<typeof sessionSchema>>;
  public sessionsById = new Map<string, { ws: WebSocket; attachment: SessionAttachment }>();
  public sessionsByNick = new Map<string, string>(); // canonicalNick -> primary sessionId
  private commandRateLimiter = new SlidingWindowRateLimiter(
    SERVER_CONFIG.rateLimitWindowMs,
    SERVER_CONFIG.rateLimitMaxCommands,
  );
  public pendingPassBySession = new Map<string, string>();
  public pendingBatchesBySession = new Map<string, Map<string, PendingMultilineBatch>>();
  public activeBatchRefBySession = new Map<string, string>();
  private sessionMessageQueues = new Map<string, Promise<void>>();
  private queuedInput = new Map<string, { bytes: number; frames: number }>();
  private outboundQueues = new Map<
    WebSocket,
    {
      frames: OutboundFrame[];
      bytes: number;
      readerResponse?: boolean;
    }
  >();
  private outboundBytes = 0;
  public saslBuffersBySession = new Map<string, string>();
  public maxLocalUsers = 0;
  public maxGlobalUsers = 0;
  public readonly features: SessionFeatureBridge;
  public readonly eventAuthority: EventShardAuthority;
  public readonly eventConnections: EventShardConnections;
  private readonly alarms = new EarliestAlarm(this.ctx.storage, (task) => this.ctx.waitUntil(task));
  public scheduleAlarm(deadline: number): Promise<void> {
    return this.alarms.schedule(deadline);
  }
  public readonly reader = new ReaderTransport((deadline) => {
    this.ctx.waitUntil(this.scheduleAlarm(deadline));
  });

  public sendEventFrame(ws: WebSocket, payload: string): boolean {
    const protocol = ws.deserializeAttachment()?.eventProtocol;
    return this.reader.send(ws, payload, protocol === 2 ? "events-v2" : "events-v1");
  }

  public legacyEventConnectionCount(accountId?: string): number {
    return this.ctx
      .getWebSockets("events")
      .filter(
        (ws) =>
          ws.readyState === 1 &&
          (accountId === undefined || ws.deserializeAttachment()?.accountId === accountId),
      ).length;
  }

  public async admitEventConnection(input: EventAdmissionInput): Promise<EventAdmissionResult> {
    if (this.eventConnections.isEdge())
      return { ok: false, status: 403, text: "Central authority required" };
    return this.eventAuthority.authenticate(input);
  }

  // Internal namespace RPCs. No HTTP route accepts a lease, shard or actor selector.
  public async pollEventShard(lease: string, shard: number, cursor?: string) {
    if (this.eventConnections.isEdge())
      throw new FeatureError(403, "AUTHORITY_REQUIRED", "Central authority required");
    return this.eventAuthority.poll(lease, shard, cursor);
  }
  public async eventForShard(lease: string, shard: number, eventId: string) {
    if (this.eventConnections.isEdge())
      throw new FeatureError(403, "AUTHORITY_REQUIRED", "Central authority required");
    return this.eventAuthority.event(lease, shard, eventId);
  }
  public async eventShardCommand(lease: string, shard: number, input: unknown) {
    if (this.eventConnections.isEdge())
      throw new FeatureError(403, "AUTHORITY_REQUIRED", "Central authority required");
    return this.eventAuthority.command(lease, shard, input);
  }
  public async releaseEventShard(lease: string, shard: number) {
    this.eventAuthority.release(lease, shard);
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    applyEnvConfig(env);
    this.sql = ctx.storage.sql;
    initializeSessionSchema(this.sql);
    this.db = drizzle(ctx.storage, { schema: sessionSchema });

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS session_channels (
        session_id TEXT NOT NULL,
        canonical_channel TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        PRIMARY KEY (session_id, canonical_channel)
      );

      CREATE INDEX IF NOT EXISTS idx_session_channels_chan
        ON session_channels(canonical_channel);

      CREATE TABLE IF NOT EXISTS session_monitors (
        session_id TEXT NOT NULL,
        target_nick TEXT NOT NULL,
        PRIMARY KEY (session_id, target_nick)
      );

      CREATE INDEX IF NOT EXISTS idx_session_monitors_target
        ON session_monitors(target_nick);

      CREATE TABLE IF NOT EXISTS session_invites (
        canon_nick TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (canon_nick, channel_name)
      );

      CREATE TABLE IF NOT EXISTS known_channels (
        canonical_channel TEXT PRIMARY KEY,
        channel_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS direct_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        peer_pair TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_account TEXT,
        sender_nick TEXT NOT NULL,
        sender_user TEXT NOT NULL,
        sender_host TEXT NOT NULL,
        target_nick TEXT NOT NULL,
        target_account TEXT,
        command TEXT NOT NULL DEFAULT 'PRIVMSG',
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '{}',
        multiline_json TEXT,
        redacted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dm_peer_pair
        ON direct_messages(peer_pair, sequence);

      CREATE TABLE IF NOT EXISTS whowas_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canon_nick TEXT NOT NULL,
        nickname TEXT NOT NULL,
        username TEXT NOT NULL,
        hostname TEXT NOT NULL,
        realname TEXT NOT NULL,
        account_name TEXT,
        left_at INTEGER NOT NULL
      );
    `);

    try {
      this.sql.exec("ALTER TABLE direct_messages ADD COLUMN target_account TEXT");
    } catch {}

    const dmColumns = this.sql
      .exec<{ name: string }>("PRAGMA table_info(direct_messages)")
      .toArray();
    for (const column of ["target_id", "multiline_json"])
      if (!dmColumns.some((c) => c.name === column))
        this.sql.exec(`ALTER TABLE direct_messages ADD COLUMN ${column} TEXT`);
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(session_invites)")
        .toArray()
        .some((c) => c.name === "target_user_id")
    )
      this.sql.exec("ALTER TABLE session_invites ADD COLUMN target_user_id TEXT");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS direct_message_edits (message_id TEXT PRIMARY KEY REFERENCES direct_messages(id) ON DELETE CASCADE, root_id TEXT NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS idx_dm_edit_root ON direct_message_edits(root_id);`);
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(direct_messages)")
        .toArray()
        .some((c) => c.name === "expires_at")
    )
      this.sql.exec("ALTER TABLE direct_messages ADD COLUMN expires_at INTEGER");
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_dm_expiry ON direct_messages(expires_at)");
    this.sql.exec(
      "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)",
      Date.now(),
    );

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        "PING :keepalive",
        `:${SERVER_CONFIG.serverName} PONG ${SERVER_CONFIG.serverName} :keepalive`,
      ),
    );

    const runtimeConfig = this.sql
      .exec<{ attachment_json: string }>(
        "SELECT attachment_json FROM session_state WHERE session_id = 'runtime-config'",
      )
      .toArray()[0];
    if (runtimeConfig)
      SERVER_CONFIG.zncMaxMessages = JSON.parse(runtimeConfig.attachment_json).zncMaxMessages;
    this.features = new SessionFeatureBridge(this, {
      storage: ctx.storage,
      sockets: () => ctx.getWebSockets("events"),
      waitUntil: (task) => ctx.waitUntil(task),
    });
    this.eventAuthority = new EventShardAuthority(this, ctx.storage);
    this.eventConnections = new EventShardConnections(this, ctx);
    // The identity comes from the namespace binding, never an HTTP selector.
    for (let shard = 0; shard < 16; shard++) {
      if (
        ctx.id.toString() ===
        env.SESSION.idFromName(shardName(SERVER_CONFIG.networkId, shard)).toString()
      ) {
        this.sql.exec(
          "INSERT OR REPLACE INTO session_topology(key,value) VALUES ('event-shard',?)",
          String(shard),
        );
        break;
      }
    }
    initializePrimaryKeyIntegrity(ctx.storage, sessionSchema, env);
    this.reconstructStateFromHibernation();
    if (!this.eventConnections.isEdge())
      ctx.waitUntil(
        Promise.all([this.features.recoverProfiles(), this.features.drainPush()]).catch(() =>
          this.scheduleAlarm(Date.now() + 5000),
        ),
      );
  }

  private ensureSessionsLoaded(): void {
    const sockets = this.ctx.getWebSockets();
    this.sessionsById.clear();
    this.sessionsByNick.clear();
    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as SessionAttachment | null;
      if (!attachment?.sessionId) continue;
      if (!this.acceptSessionAttachment(ws, attachment)) continue;
      this.sessionsById.set(attachment.sessionId, { ws, attachment });
      if (attachment.nickname) {
        this.sessionsByNick.set(canonicalizeIRCName(attachment.nickname), attachment.sessionId);
      }
    }
  }

  private reconstructStateFromHibernation(): void {
    this.sessionsById.clear();
    this.sessionsByNick.clear();

    const sockets = this.ctx.getWebSockets();
    const activeSessionIds = new Set<string>();

    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as SessionAttachment | null;
      if (!attachment?.sessionId) {
        continue;
      }
      if (!this.acceptSessionAttachment(ws, attachment)) continue;
      activeSessionIds.add(attachment.sessionId);
      this.sessionsById.set(attachment.sessionId, { ws, attachment });
      if (attachment.nickname) {
        this.sessionsByNick.set(canonicalizeIRCName(attachment.nickname), attachment.sessionId);
      }
    }

    const rows = this.sql
      .exec<{ session_id: string }>("SELECT DISTINCT session_id FROM session_channels")
      .toArray();
    for (const row of rows) {
      if (!activeSessionIds.has(row.session_id)) {
        this.sql.exec("DELETE FROM session_channels WHERE session_id = ?", row.session_id);
        this.sql.exec("DELETE FROM session_monitors WHERE session_id = ?", row.session_id);
      }
    }
  }

  public saveAttachment(ws: WebSocket, attachment: SessionAttachment): void {
    ws.serializeAttachment({
      ...attachment,
      readerWindow: ws.deserializeAttachment()?.readerWindow,
      readerClosed: ws.deserializeAttachment()?.readerClosed,
    });
    this.sessionsById.set(attachment.sessionId, { ws, attachment });
  }

  private acceptSessionAttachment(ws: WebSocket, attachment: SessionAttachment): boolean {
    if (
      (this.env.LOCAL_IRC_BRIDGE_SECRET || this.env.REQUEST_SOURCE === "cloudflare") &&
      !(attachment as SessionAttachment & { peerSource?: RequestSource }).peerSource
    ) {
      try {
        ws.close(1008, "Reconnect to establish peer source");
      } catch {}
      return false;
    }
    // Pre-hardening attachments have no credential version and may have been
    // created through the former EXTERNAL bypass. Require a fresh login.
    if (
      SERVER_CONFIG.requireAccounts &&
      ((attachment.registered && !attachment.authenticated) ||
        (attachment.authenticated &&
          (!Number.isSafeInteger(attachment.credentialVersion) ||
            attachment.credentialVersion! < 0)))
    ) {
      try {
        ws.close(1008, "Account login required");
      } catch {
        /* Already closed */
      }
      return false;
    }
    return true;
  }

  public setRuntimeConfig(config: { zncMaxMessages: number }): void {
    SERVER_CONFIG.zncMaxMessages = config.zncMaxMessages;
    this.sql.exec(
      "INSERT OR REPLACE INTO session_state (session_id, attachment_json, created_at, updated_at) VALUES ('runtime-config', ?, ?, ?)",
      JSON.stringify(config),
      Date.now(),
      Date.now(),
    );
  }

  public getChannelStub(channelName: string) {
    const canon = canonicalizeIRCName(channelName);
    const id = this.env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`);
    return this.env.CHANNELS.get(id);
  }

  public getAccountsStub() {
    const id = this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId);
    return this.env.ACCOUNTS.get(id);
  }

  public async bindSessionChannelGeneration(
    sessionId: string,
    channel: string,
    generation: string,
  ): Promise<void> {
    const client = this.sessionsById.get(sessionId);
    if (!client?.attachment.registered)
      throw new FeatureError(403, "MEMBERSHIP_REQUIRED", "Live session required");
    const stub = this.getChannelStub(channel);
    if (client.attachment.authenticated) {
      const actor = await this.features.actor(
        { ircSessionId: sessionId },
        "channel.read",
        canonicalizeIRCName(channel),
      );
      const snapshot = await stub.getAccessSnapshot(actor);
      if (!snapshot.isMember || snapshot.generation !== generation)
        throw new FeatureError(409, "STALE_GENERATION", "Channel generation changed");
    } else {
      if (
        SERVER_CONFIG.requireAccounts ||
        (await stub.getChannelGeneration(channel)) !== generation ||
        !(await stub.getMembers()).some((m) => m.sessionId === sessionId)
      )
        throw new FeatureError(403, "MEMBERSHIP_REQUIRED", "Channel membership required");
    }
    this.sql.exec(
      "UPDATE session_channels SET generation=? WHERE session_id=? AND canonical_channel=?",
      generation,
      sessionId,
      canonicalizeIRCName(channel),
    );
  }

  public async journalChannelMembership(input: {
    accountId: string;
    channel: string;
    generation: string;
    joined: boolean;
    operationId: string;
    revision: number;
    recipientAccountIds?: string[];
  }) {
    const account = await this.getAccountsStub().resolveConversationAccount(input.accountId);
    if (!account) return { applied: false };
    const current = await this.getAccountsStub().getAccountByUsername(account.username);
    if (!current || current.id !== input.accountId) return { applied: false };
    const snapshot = await this.getChannelStub(input.channel).getAccessSnapshot({
      ...current,
      credentialVersion: current.credentialVersion ?? 0,
    });
    if (snapshot.generation !== input.generation || snapshot.isMember !== input.joined)
      return { applied: false, stale: true };
    this.ctx.storage.transactionSync(() =>
      this.features.journal.append(
        {
          type: input.joined ? "channel.member_joined" : "channel.member_left",
          eventId: `membership:${input.generation}:${input.operationId}:${input.accountId}:${input.joined}`,
          timestamp: new Date().toISOString(),
          channelId: input.channel,
          channelGeneration: input.generation,
          operationId: input.operationId,
          data: {
            accountId: input.accountId,
            joined: input.joined,
            generation: input.generation,
            revision: input.revision,
          },
        },
        { kind: "channel", id: input.channel, generation: input.generation },
        input.recipientAccountIds ?? [],
        true,
      ),
    );
    if (!input.joined)
      this.ctx.storage.transactionSync(() =>
        this.features.journal.append(
          {
            type: "channel.member_left",
            eventId: `membership-self:${input.generation}:${input.operationId}:${input.accountId}`,
            timestamp: new Date().toISOString(),
            channelId: input.channel,
            channelGeneration: input.generation,
            ownerId: input.accountId,
            operationId: input.operationId,
            data: {
              accountId: input.accountId,
              joined: false,
              generation: input.generation,
              revision: input.revision,
            },
          },
          { kind: "account", id: input.accountId, ownerId: input.accountId },
        ),
      );
    this.features.notify();
    return { applied: true };
  }

  public async reconcileAccountChannel(input: {
    accountId: string;
    channel: string;
    generation: string;
    joined: boolean;
    operationId: string;
    recipientAccountIds?: string[];
  }) {
    const resolved = await this.getAccountsStub().resolveConversationAccount(input.accountId);
    if (!resolved) return { applied: false };
    const account = await this.getAccountsStub().getAccountByUsername(resolved.username);
    if (!account || account.id !== input.accountId) return { applied: false };
    const snapshot = await this.getChannelStub(input.channel).getAccessSnapshot({
      ...account,
      credentialVersion: account.credentialVersion ?? 0,
    });
    if (snapshot.generation !== input.generation || snapshot.isMember !== input.joined)
      return { applied: false, stale: true };
    this.sql.exec(
      "INSERT OR IGNORE INTO known_channels(canonical_channel,channel_name,created_at) VALUES (?,?,?)",
      canonicalizeIRCName(input.channel),
      input.channel,
      Date.now(),
    );
    this.ctx.storage.transactionSync(() =>
      this.features.journal.append(
        {
          type: input.joined ? "channel.member_joined" : "channel.member_left",
          eventId: `membership:${input.generation}:${input.operationId}:${input.accountId}:${input.joined}`,
          timestamp: new Date().toISOString(),
          channelId: input.channel,
          channelGeneration: input.generation,
          operationId: input.operationId,
          data: {
            accountId: input.accountId,
            joined: input.joined,
            generation: input.generation,
            revision: snapshot.revision,
          },
        },
        { kind: "channel", id: input.channel, generation: input.generation },
        input.recipientAccountIds ?? [],
        true,
      ),
    );
    this.features.notify();
    const clients = this.getLiveAccountSessions(input.accountId)
      .map((id) => this.sessionsById.get(id)!)
      .filter(Boolean);
    if (input.joined) {
      for (const client of clients) {
        if (
          this.getSessionChannels(client.attachment.sessionId).some(
            (c) =>
              c.canonicalChannel === canonicalizeIRCName(input.channel) &&
              c.generation === input.generation,
          )
        )
          continue;
        if (!(await this.getSessionActor(client.attachment.sessionId))) continue;
        await handleJoin(
          this,
          client.ws,
          client.attachment,
          { prefix: null, command: "JOIN", params: [input.channel], tags: {} },
          undefined,
          { [canonicalizeIRCName(input.channel)]: input.generation },
        );
      }
    } else {
      const sources = clients.filter((c) =>
        this.getSessionChannels(c.attachment.sessionId).some(
          (row) =>
            row.canonicalChannel === canonicalizeIRCName(input.channel) &&
            row.generation === input.generation,
        ),
      );
      for (const source of sources) {
        const line = encodeIRCMessage({
          prefix: this.getUserPrefix(source.attachment),
          command: "PART",
          params: [input.channel, "Account left channel"],
        });
        await this.broadcastLineToChannel(input.channel, line, input.generation, true);
        this.sql.exec(
          "DELETE FROM session_channels WHERE session_id=? AND canonical_channel=? AND generation=?",
          source.attachment.sessionId,
          canonicalizeIRCName(input.channel),
          input.generation,
        );
      }
    }
    return { applied: true, generation: input.generation };
  }

  public async invalidateChannelGeneration(input: {
    channel: string;
    previousGeneration: string;
    generation: string;
    operationId?: string;
    revision?: number;
    recipientAccountIds?: string[];
  }) {
    if (
      (await this.getChannelStub(input.channel).getChannelGeneration(input.channel)) !==
      input.generation
    )
      return { applied: false, stale: true };
    const recipients = new Set(input.recipientAccountIds ?? []);
    for (const row of this.sql
      .exec<{ session_id: string }>(
        "SELECT session_id FROM session_channels WHERE canonical_channel=? AND generation=?",
        canonicalizeIRCName(input.channel),
        input.previousGeneration,
      )
      .toArray()) {
      const account = this.sessionsById.get(row.session_id)?.attachment;
      if (account?.authenticated) recipients.add(account.userId);
    }
    this.ctx.storage.transactionSync(() => {
      for (const accountId of recipients)
        this.features.journal.append(
          {
            type: "channel.deleted",
            eventId: `deleted:${input.previousGeneration}:${input.generation}:${accountId}`,
            timestamp: new Date().toISOString(),
            ownerId: accountId,
            operationId: input.operationId,
            data: {
              channel: input.channel,
              previousGeneration: input.previousGeneration,
              generation: input.generation,
              revision: input.revision,
              resync: true,
            },
          },
          { kind: "account", id: accountId, ownerId: accountId },
        );
    });
    this.sql.exec(
      "DELETE FROM session_channels WHERE canonical_channel=? AND generation=?",
      canonicalizeIRCName(input.channel),
      input.previousGeneration,
    );
    for (const ws of this.ctx.getWebSockets("events")) {
      const attachment = ws.deserializeAttachment() as any;
      if (attachment?.subscriptions?.channels) {
        attachment.subscriptions.channels = attachment.subscriptions.channels.filter(
          (c: any) =>
            !(
              canonicalizeIRCName(c.channel) === canonicalizeIRCName(input.channel) &&
              c.generation === input.previousGeneration
            ),
        );
        ws.serializeAttachment(attachment);
      }
    }
    this.features.notify();
    return { applied: true };
  }

  public async notifyChannelInvitation(input: {
    channel: string;
    generation: string;
    targetAccountId: string;
    actorId: string;
    operationId: string;
    notifyIrc?: boolean;
  }) {
    const invite = await this.getChannelStub(input.channel).getInvitationSnapshot(
      input.targetAccountId,
    );
    if (invite.generation !== input.generation) return { applied: false, stale: true };
    const eventId = `invitation:${input.generation}:${input.operationId}:${input.targetAccountId}`;
    const event = {
      type: "channel.invited" as const,
      eventId,
      timestamp: new Date().toISOString(),
      channelId: input.channel,
      channelGeneration: input.generation,
      ownerId: input.targetAccountId,
      data: {
        channel: input.channel,
        generation: input.generation,
        invited: invite.invited,
        actorId: input.actorId,
        targetAccountId: input.targetAccountId,
      },
    };
    const inserted = this.ctx.storage.transactionSync(() =>
      this.features.journal.append(event, {
        kind: "account",
        id: input.targetAccountId,
        ownerId: input.targetAccountId,
      }),
    );
    if (inserted && invite.invited && input.notifyIrc !== false) {
      const actor = await this.getAccountsStub().resolveConversationAccount(input.actorId);
      for (const id of this.getLiveAccountSessions(input.targetAccountId)) {
        const client = this.sessionsById.get(id);
        if (!client || !(await this.getSessionActor(id))) continue;
        if (
          await this.getAccountsStub().isNetworkBanned(
            input.targetAccountId,
            this.getSourceHostmask(client.attachment),
          )
        )
          continue;
        this.sendLine(
          client.ws,
          client.attachment,
          encodeIRCMessage({
            prefix: `${actor?.username ?? "server"}!invite@${SERVER_CONFIG.serverName}`,
            command: "INVITE",
            params: [client.attachment.nickname!, input.channel],
          }),
        );
      }
    }
    this.features.notify();
    return { applied: true, invited: invite.invited };
  }

  public getSessionChannels(
    sessionId: string,
  ): Array<{ canonicalChannel: string; channelName: string; generation?: string }> {
    const rows = this.sql
      .exec<{ canonical_channel: string; channel_name: string; generation: string | null }>(
        "SELECT canonical_channel, channel_name, generation FROM session_channels WHERE session_id = ?",
        sessionId,
      )
      .toArray();
    return rows.map((r) => ({
      canonicalChannel: r.canonical_channel,
      channelName: r.channel_name,
      generation: r.generation ?? undefined,
    }));
  }

  public async adminRequest(token: string, operation: string, args: unknown[]): Promise<unknown> {
    const metadataGeneration =
      ["adminSetMetadata", "adminChannelKick", "adminChannelTopic", "adminChannelModes"].includes(
        operation,
      ) &&
      typeof args[0] === "string" &&
      /^[#&]/.test(args[0])
        ? await this.getChannelStub(args[0]).getExistingChannelGeneration()
        : undefined;
    const actor = await this.env.ACCOUNTS.get(
      this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).verifyApiSession(token);
    if (!actor?.roles.includes("admin")) throw new Error("Administrator authorization required");
    if (
      operation === "adminChannelKick" ||
      operation === "adminChannelTopic" ||
      operation === "adminChannelModes"
    ) {
      return this.adminChannelAction(
        token,
        actor.username,
        operation,
        args,
        metadataGeneration ?? undefined,
      );
    }
    const allowed = new Set<string>([
      "adminBroadcast",
      "adminDisconnectSession",
      "adminGetMetadata",
      "adminListChannels",
      "adminListSessions",
      "adminSetMetadata",
      "getStats",
      "invalidateAccountPermissions",
      "refreshAccountPermissions",
      "removeChannelRouting",
      "setRuntimeConfig",
    ]);
    if (!allowed.has(operation)) throw new Error("Unknown administrative operation");
    if (
      (operation === "adminSetMetadata" || operation === "adminGetMetadata") &&
      typeof args[0] === "string" &&
      !/^[#&]/.test(args[0]) &&
      !(await this.getAccountsStub().resolveConversationAccount(args[0]))
    ) {
      // Open-network guests have public IRC metadata, but no account profile.
      // Keep that existing capability limited to a currently connected guest;
      // never use it as a fallback for a registered account's authorization.
      this.ensureSessionsLoaded();
      const target = canonicalizeIRCName(args[0]);
      const guest =
        !SERVER_CONFIG.requireAccounts &&
        [...this.sessionsById.values()].find(
          ({ attachment }) =>
            attachment.registered &&
            !attachment.authenticated &&
            canonicalizeIRCName(attachment.nickname ?? "") === target,
        );
      if (!guest) throw new Error("Metadata target unavailable");
      const scope =
        operation === "adminSetMetadata" ? "admin.metadata.write" : "admin.metadata.read";
      if (!(await this.getAccountsStub().authorizeCredential(token, scope, target)))
        throw new Error("Administrator authorization required");
      if (operation === "adminGetMetadata") {
        const keys = args[1] as string[] | undefined;
        if (keys?.some((key) => key.toLowerCase().startsWith("private:")))
          throw new Error("Account access denied");
        return Object.fromEntries(
          Object.entries(await this.adminGetMetadata(target, keys)).filter(
            ([key]) => !key.startsWith("private:"),
          ),
        );
      }
      const key = String(args[1]).toLowerCase(),
        value = args[2] as string | null;
      if (key.startsWith("private:")) throw new Error("Account access denied");
      if (
        !/^[a-z0-9_.:/-]{1,64}$/.test(key) ||
        (value !== null && (typeof value !== "string" || value.length > 2048))
      )
        throw new Error("Invalid metadata");
      await this.adminSetMetadata(target, key, value);
      return;
    }
    if (operation === "adminSetMetadata" && typeof args[0] === "string" && !/^[#&]/.test(args[0])) {
      await this.getAccountsStub().adminMutateUserMetadata(
        token,
        args[0],
        String(args[1]),
        args[2] as string | null,
      );
      await this.features.recoverProfiles();
      return;
    }
    if (operation === "adminGetMetadata" && typeof args[0] === "string" && !/^[#&]/.test(args[0]))
      return (
        await this.getAccountsStub().getVisibleMetadata(
          actor.id,
          actor.credentialVersion ?? 0,
          args[0],
          args[1] as string[] | undefined,
        )
      ).metadata;
    if (operation === "adminSetMetadata")
      return this.adminSetMetadata(
        args[0] as string,
        args[1] as string,
        args[2] as string | null,
        metadataGeneration ?? undefined,
      );
    const method = (this as unknown as Record<string, (...values: unknown[]) => unknown>)[
      operation
    ];
    return method.apply(this, args);
  }

  public async clientRequest(
    token: string,
    operation: string,
    input: any,
    source?: RequestSource,
  ): Promise<any> {
    return this.features.execute({ token, source }, operation, input);
  }

  public async featureRequest(
    credential: SessionCredential,
    operation: string,
    input: any,
  ): Promise<any> {
    return this.features.execute(credential, operation, input);
  }

  public async publishProfileRevision(input: any): Promise<void> {
    await this.features.publishProfileRevision(input);
  }

  public async getEventForRecipient(eventId: string, accountId: string, credentialVersion: number) {
    const accounts = this.getAccountsStub();
    const account = await accounts.resolveConversationAccount(accountId);
    if (!account) return null;
    const current = await accounts.getAccountByUsername(account.username);
    if (
      !current ||
      current.id !== accountId ||
      current.credentialVersion !== credentialVersion ||
      !(await accounts.authorizeAccountActor(accountId, credentialVersion, "push.receive", "*"))
    )
      return null;
    this.features.journal.prune();
    const row = this.sql
      .exec<{
        resource_kind: string;
        resource_id: string;
        generation: string | null;
        owner_id: string | null;
        payload_json: string;
      }>("SELECT * FROM event_journal WHERE event_id=?", eventId)
      .toArray()[0];
    if (
      !row ||
      (row.owner_id && row.owner_id !== accountId) ||
      !this.sql
        .exec("SELECT 1 FROM event_audience WHERE event_id=? AND account_id=?", eventId, accountId)
        .toArray().length
    )
      return null;
    const payload = JSON.parse(row.payload_json);
    if (payload.messageId && row.resource_kind === "conversation") {
      try {
        if (
          this.features.conversations.message(accountId, payload.messageId, row.resource_id)
            .redacted
        )
          return null;
      } catch {
        return null;
      }
    }
    if (
      row.resource_kind === "conversation" &&
      !this.features.conversations.hasMember(row.resource_id, accountId)
    )
      return null;
    if (row.resource_kind === "account" && row.resource_id !== accountId) return null;
    if (row.resource_kind === "channel") {
      const access = await this.getChannelStub(row.resource_id).getAccessSnapshot({
        ...current,
        credentialVersion: current.credentialVersion ?? 0,
      });
      if (!access.canRead || access.generation !== row.generation) return null;
      if (payload.messageId && ["message.created", "message.updated"].includes(payload.type)) {
        const channel: any = this.getChannelStub(row.resource_id);
        if (
          !(await channel.validateJournalMessage({
            accountId,
            credentialVersion,
            generation: row.generation,
            messageId: payload.messageId,
          }))
        )
          return null;
      }
    }
    return JSON.parse(row.payload_json);
  }

  private async adminChannelAction(
    token: string,
    username: string,
    operation: "adminChannelKick" | "adminChannelTopic" | "adminChannelModes",
    args: unknown[],
    expectedGeneration?: string,
  ): Promise<unknown> {
    const [channel, value, extra] = args;
    if (
      typeof channel !== "string" ||
      !isValidChannelName(channel) ||
      typeof value !== "string" ||
      /[\r\n\0]/.test(value)
    )
      throw new Error("Invalid administrative channel action");
    const prefix = `${username}!admin@${SERVER_CONFIG.serverName}`;
    const stub = this.getChannelStub(channel);
    let result: any;
    let line: string | undefined;
    if (operation === "adminChannelKick") {
      if (typeof extra !== "string" || /[\r\n\0]/.test(extra))
        throw new Error("Invalid administrative kick reason");
      result = await (stub as any).adminRequest(
        token,
        "adminKickMember",
        [value, extra, channel],
        expectedGeneration,
      );
      if (result.ok && result.targetMember) {
        line = encodeIRCMessage({
          prefix,
          command: "KICK",
          params: [result.channelName, result.targetMember.nickname, extra],
        });
      }
    } else if (operation === "adminChannelTopic") {
      result = await (stub as any).adminRequest(
        token,
        "adminSetTopic",
        [value, username, channel],
        expectedGeneration,
      );
      if (result.ok)
        line = encodeIRCMessage({
          prefix,
          command: "TOPIC",
          params: [result.channelName, result.topic],
        });
    } else {
      if (!Array.isArray(extra) || extra.some((v) => typeof v !== "string" || /[\r\n\0]/.test(v)))
        throw new Error("Invalid administrative mode arguments");
      result = await (stub as any).adminRequest(
        token,
        "handleModeCommand",
        [
          {
            channelName: channel,
            actorSessionId: "admin",
            actorPrefix: prefix,
            modeString: value,
            modeArgs: extra,
            isOper: true,
          },
        ],
        expectedGeneration,
      );
      if (result.ok && result.appliedModeString)
        line = encodeIRCMessage({
          prefix,
          command: "MODE",
          params: [result.channelName, result.appliedModeString, ...(result.appliedModeArgs ?? [])],
        });
    }
    if (!expectedGeneration || (await stub.getExistingChannelGeneration()) !== expectedGeneration)
      return result;
    if (!line) return result;
    this.ensureSessionsLoaded();
    const canon = canonicalizeIRCName(result.channelName);
    const recipients = (result.recipientSessionIds as string[]).filter(
      (id) =>
        this.sql
          .exec(
            "SELECT 1 FROM session_channels WHERE session_id = ? AND canonical_channel = ?",
            id,
            canon,
          )
          .toArray().length > 0,
    );
    if (operation === "adminChannelKick" && result.targetMember) {
      this.sql.exec(
        "DELETE FROM session_channels WHERE session_id = ? AND canonical_channel = ?",
        result.targetMember.sessionId,
        canon,
      );
    }
    for (const id of recipients) {
      const client = this.sessionsById.get(id);
      if (client) this.sendLine(client.ws, client.attachment, line);
    }
    if (operation === "adminChannelTopic" || operation === "adminChannelModes") {
      await this.broadcastRealtimeEvent({
        type: operation === "adminChannelTopic" ? "channel.topic_changed" : "channel.updated",
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        channelId: result.channelName,
        channelGeneration: expectedGeneration,
        data:
          operation === "adminChannelTopic"
            ? { topic: result.topic, setBy: username }
            : {
                modes: result.appliedModeString,
                modeArgs: result.appliedModeArgs ?? [],
                actor: username,
              },
      });
    }
    return result;
  }

  public async getSessionActor(
    sessionId: string,
  ): Promise<{ id: string; username: string; isOper: boolean } | null> {
    this.ensureSessionsLoaded();
    const attachment = this.sessionsById.get(sessionId)?.attachment;
    if (!attachment?.registered) return null;
    if (!attachment.authenticated || !attachment.accountName)
      return SERVER_CONFIG.requireAccounts
        ? null
        : { id: attachment.userId, username: attachment.nickname ?? "", isOper: attachment.isOper };
    const account = await this.getAccountsStub().getAccountByUsername(attachment.accountName);
    if (
      !account ||
      account.id !== attachment.userId ||
      (account.credentialVersion ?? 0) !== (attachment.credentialVersion ?? 0) ||
      (await this.getAccountsStub().isNetworkBanned(
        account.id,
        this.getSourceHostmask(attachment),
      )) ||
      ((attachment as any).credentialSessionHash &&
        !(await this.getAccountsStub().verifySessionHash(
          (attachment as any).credentialSessionHash,
        )))
    )
      return null;
    return {
      id: account.id,
      username: account.username,
      isOper:
        attachment.isOper && account.roles.some((role) => role === "admin" || role === "oper"),
    };
  }

  public getLiveAccountSessions(userId: string): string[] {
    this.ensureSessionsLoaded();
    return Array.from(this.sessionsById.values())
      .filter(
        ({ attachment }) =>
          attachment.registered && attachment.authenticated && attachment.userId === userId,
      )
      .map(({ attachment }) => attachment.sessionId);
  }

  public getAllSessionsForNick(nickname: string): Array<{
    ws: WebSocket;
    attachment: SessionAttachment;
  }> {
    const canon = canonicalizeIRCName(nickname);
    const out: Array<{ ws: WebSocket; attachment: SessionAttachment }> = [];
    for (const entry of [...this.sessionsById.values()]) {
      if (
        entry.attachment.registered &&
        (!SERVER_CONFIG.requireAccounts || entry.attachment.authenticated) &&
        entry.attachment.nickname &&
        canonicalizeIRCName(entry.attachment.nickname) === canon
      ) {
        out.push(entry);
      }
    }
    return out;
  }

  public async broadcastRealtimeEvent(
    event: any,
    recipientAccountIds?: string[],
    restrictToAudience = false,
  ): Promise<void> {
    if (
      typeof event.channelId !== "string" ||
      !isValidChannelName(event.channelId) ||
      typeof event.channelGeneration !== "string"
    )
      return;
    const generation = await this.getChannelStub(event.channelId).getChannelGeneration(
      event.channelId,
    );
    if (generation !== event.channelGeneration) return;
    this.ctx.storage.transactionSync(() =>
      this.features.journal.append(
        event,
        { kind: "channel", id: canonicalizeIRCName(event.channelId), generation },
        recipientAccountIds ?? [],
        true,
        !restrictToAudience,
      ),
    );
    this.features.notify();
    await this.features.legacyObservation(event, recipientAccountIds ?? [], restrictToAudience);
  }

  public async deliverApiMessage(
    channelName: string,
    message: StoredChannelMessage,
    recipients: string[],
    expectedGeneration?: string,
    deliverySequence?: number,
  ): Promise<void> {
    if (
      !expectedGeneration ||
      (await this.getChannelStub(channelName).getChannelGeneration(channelName)) !==
        expectedGeneration
    )
      return;
    if (deliverySequence !== undefined) {
      if (!Number.isSafeInteger(deliverySequence) || deliverySequence < 1)
        throw new Error("Invalid channel delivery sequence");
      // One bounded receipt per channel, in the existing expiring operation
      // store. A lost RPC acknowledgement must not replay the IRC enqueue.
      const actor = `channel-irc:${canonicalizeIRCName(channelName)}`;
      const previous = this.sql
        .exec<{ fingerprint: string; result_json: string }>(
          "SELECT fingerprint,result_json FROM feature_operations WHERE actor_id=? AND operation_id='irc-channel-delivery'",
          actor,
        )
        .toArray()[0];
      if (
        previous?.fingerprint === expectedGeneration &&
        Number(previous.result_json) >= deliverySequence
      )
        return;
      this.sql.exec("DELETE FROM feature_operations WHERE expires_at<=?", Date.now());
      this.sql.exec(
        "INSERT INTO feature_operations(actor_id,operation_id,fingerprint,result_json,expires_at) VALUES(?,'irc-channel-delivery',?,?,?) ON CONFLICT(actor_id,operation_id) DO UPDATE SET fingerprint=excluded.fingerprint,result_json=excluded.result_json,expires_at=excluded.expires_at",
        actor,
        expectedGeneration,
        String(deliverySequence),
        Date.now() + SERVER_CONFIG.retentionMs,
      );
    }
    this.ensureSessionsLoaded();
    for (const id of recipients) {
      const client = this.sessionsById.get(id);
      if (
        !client ||
        !this.getSessionChannels(id).some(
          (c) =>
            c.canonicalChannel === canonicalizeIRCName(channelName) &&
            c.generation === expectedGeneration,
        )
      )
        continue;
      this.sendChannelLine(
        client.ws,
        client.attachment,
        encodeIRCMessage({
          tags: this.filterOutgoingTags(client.attachment, {
            ...message.tags,
            msgid: message.id,
            time: new Date(message.createdAt).toISOString(),
            ...(message.senderAccount ? { account: message.senderAccount } : {}),
          }),
          prefix: `${message.senderNick}!${message.senderUser}@${message.senderHost}`,
          command: message.command,
          params: [channelName, message.content],
        }),
        channelName,
        expectedGeneration,
      );
    }
  }

  public async broadcastLineToChannel(
    channelName: string,
    line: string,
    expectedGeneration?: string,
    control = false,
  ): Promise<void> {
    if (
      !expectedGeneration ||
      (await this.getChannelStub(channelName).getChannelGeneration(channelName)) !==
        expectedGeneration
    )
      return;
    const canon = canonicalizeIRCName(channelName);
    const sessions = this.sql
      .exec<{ session_id: string }>(
        "SELECT session_id FROM session_channels WHERE canonical_channel = ? AND generation = ?",
        canon,
        expectedGeneration,
      )
      .toArray();
    for (const row of sessions) {
      const sess = this.sessionsById.get(row.session_id);
      if (sess) {
        this.sendChannelLine(
          sess.ws,
          sess.attachment,
          line,
          channelName,
          expectedGeneration,
          control,
        );
      }
    }
  }

  public async alarm(): Promise<void> {
    this.alarms.fired();
    if (this.eventConnections.isEdge()) return this.eventConnections.alarm();
    let readerDeadline: number | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      const deadline = this.reader.inspect(
        ws,
        attachment?.sessionId ? "irc" : attachment?.eventProtocol === 2 ? "events-v2" : "events-v1",
      );
      if (deadline !== null) readerDeadline = Math.min(readerDeadline ?? Infinity, deadline);
    }
    this.ensureSessionsLoaded();
    let next: number | null = readerDeadline;
    try {
      await this.features.recoverProfiles();
      await this.features.drainPush();
    } catch {
      next = Math.min(next ?? Infinity, Date.now() + 5000);
    }
    for (const { ws, attachment } of [...this.sessionsById.values()]) {
      if (!attachment.registered) {
        const expires = attachment.connectedAt + 60_000;
        if (expires <= Date.now())
          await this.disconnectSession(ws, attachment, "Authentication timeout");
        else next = Math.min(next ?? expires, expires);
      }
    }
    const expired = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM direct_messages WHERE COALESCE(expires_at, created_at + ?) <= ? LIMIT 500",
        SERVER_CONFIG.retentionMs,
        Date.now(),
      )
      .toArray();
    for (const row of expired) this.sql.exec("DELETE FROM direct_messages WHERE id = ?", row.id);
    if (expired.length === 500) next = Math.min(next ?? Infinity, Date.now() + 5000);
    else if (this.sql.exec("SELECT id FROM direct_messages LIMIT 1").toArray().length)
      next = Math.min(next ?? Infinity, Date.now() + 24 * 60 * 60 * 1000);
    if (next !== null) await this.scheduleAlarm(next);
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/_internal/events-shard") return this.eventConnections.open(request);
    if (this.eventConnections.isEdge())
      return new Response("Invalid shard entrypoint", { status: 403 });
    const source = requestSource(request, this.env);
    if (!source) return new Response("Unverified request source", { status: 403 });
    const origin = request.headers.get("Origin");
    if (
      origin &&
      origin !== url.origin &&
      !(this.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((v) => v.trim())
        .includes(origin)
    )
      return new Response("Origin denied", { status: 403 });
    if (this.ctx.getWebSockets().length >= 2000)
      return new Response("Connection limit reached", { status: 429 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    if (["/api/v1/events", "/api/events"].includes(url.pathname)) {
      // Public routes call the admission RPC and upgrade the edge directly.
      // A central upgrade hop would retain an unnecessary nested WS tunnel.
      return new Response("Upgrade through the public event handler", { status: 400 });
    }

    const requestedProtocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    let negotiatedSubprotocol: Subprotocol = "text.ircv3.net";
    let responseProtocolHeader: string | null = null;

    for (const proto of requestedProtocols) {
      if (proto === "binary.ircv3.net" || proto === "text.ircv3.net") {
        negotiatedSubprotocol = proto as Subprotocol;
        responseProtocolHeader = proto;
        break;
      }
    }
    if (!responseProtocolHeader && requestedProtocols.length > 0) {
      responseProtocolHeader = requestedProtocols[0];
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const sessionId = crypto.randomUUID();
    const trustedGateway = Boolean(
      (this.env.WEBIRC_PASSWORD &&
        request.headers.get("x-gateway-token") === this.env.WEBIRC_PASSWORD) ||
        ((this.env as any).LOCAL_IRC_BRIDGE_SECRET &&
          request.headers.get("x-local-irc-bridge") === (this.env as any).LOCAL_IRC_BRIDGE_SECRET),
    );
    const forwardedIp =
      trustedGateway && url.searchParams.has("ip")
        ? normalizePeerAddress(url.searchParams.get("ip"))
        : null;
    if (trustedGateway && url.searchParams.has("ip") && !forwardedIp)
      return new Response("Invalid gateway peer", { status: 400 });
    const clientIp = forwardedIp ?? source.ip;

    const pendingFromIp = Array.from(this.sessionsById.values()).filter(
      ({ attachment }) => !attachment.registered && attachment.ip === clientIp,
    ).length;
    if (pendingFromIp >= 20) return new Response("Connection limit reached", { status: 429 });

    const attachment: SessionAttachment = {
      sessionId,
      userId: `guest:${sessionId}`,
      isDirectWebSocket: !trustedGateway || url.searchParams.get("tcp") !== "1",
      accountName: null,
      nickname: null,
      username: null,
      realname: null,
      hostname: clientIp,
      ip: clientIp,
      registered: false,
      authenticated: false,
      capNegotiating: false,
      capabilities: [],
      subprotocol: negotiatedSubprotocol,
      connectedAt: Date.now(),
      awayMessage: null,
      isOper: false,
      isBot: false,
      userModes: SERVER_CONFIG.defaultUserModes || "",
      metadataSubs: [],
      acceptList: [],
      languages: ["en"],
      lastActiveAt: Date.now(),
      vhost: null,
      saslMechanism: null,
      saslBuffer: "",
    };

    this.ctx.acceptWebSocket(server);
    (attachment as SessionAttachment & { peerSource?: RequestSource }).peerSource = {
      ...source,
      ip: clientIp,
    };
    this.saveAttachment(server, attachment);
    await this.scheduleAlarm(Date.now() + 60_000);

    const transport = attachment.isDirectWebSocket ? "Direct WebSocket" : "TCP (Bridge)";
    console.log(
      `[FlaRC SessionDO] Client connected [${transport}] session:${sessionId.slice(0, 8)} from ${clientIp}`,
    );

    const headers = new Headers();
    if (responseProtocolHeader) {
      headers.set("Sec-WebSocket-Protocol", responseProtocolHeader);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers,
    });
  }

  public async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (ws.deserializeAttachment()?.readerClosed) return;
    if (ws.deserializeAttachment()?.edgeLease) return this.eventConnections.message(ws, message);
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (!attachment?.sessionId) {
      await this.features.eventMessage(ws, message);
      return;
    }
    if (!this.acceptSessionAttachment(ws, attachment)) return;

    if (
      (typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength) >
      64 * 1024
    ) {
      await this.disconnectSession(ws, attachment, "Input frame too large");
      return;
    }
    let isInvalidUtf8 = false;
    let lines: string[];
    if (typeof message === "string") {
      try {
        lines = decodeWebSocketFrame(message);
      } catch {
        return;
      }
    } else {
      try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(message);
        lines = decodeWebSocketFrame(text);
      } catch {
        isInvalidUtf8 = true;
        const text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(message);
        lines = decodeWebSocketFrame(text);
      }
    }

    const frameBytes =
      typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    const backlog = this.queuedInput.get(attachment.sessionId) ?? { bytes: 0, frames: 0 };
    if (backlog.frames >= 64 || backlog.bytes + frameBytes > 256 * 1024) {
      await this.disconnectSession(ws, attachment, "Input queue limit reached");
      return;
    }
    backlog.bytes += frameBytes;
    backlog.frames++;
    this.queuedInput.set(attachment.sessionId, backlog);
    const prevTask = this.sessionMessageQueues.get(attachment.sessionId) ?? Promise.resolve();
    const currentTask = prevTask
      .then(async () => {
        this.reader.beginIRCResponse(ws);
        // If session was already disconnected/cleaned up, ignore further queued messages
        if (!this.sessionsById.has(attachment.sessionId)) {
          return;
        }

        // Re-read latest attachment state in case earlier queued commands modified it
        const currentAttachment =
          (ws.deserializeAttachment() as SessionAttachment | null) ?? attachment;
        this.sessionsById.set(currentAttachment.sessionId, { ws, attachment: currentAttachment });

        for (const rawLine of lines) {
          if (ws.deserializeAttachment()?.readerClosed) return;
          const commandStartedAt = Date.now();
          if (!this.commandRateLimiter.check(currentAttachment.sessionId, commandStartedAt)) {
            await this.disconnectSession(ws, currentAttachment, "Excess Flood");
            return;
          }
          if (rawLine.length > 8192) {
            this.sendLine(
              ws,
              currentAttachment,
              encodeIRCMessage({
                prefix: SERVER_CONFIG.serverName,
                command: "ERROR",
                params: ["Closing Link: Input line too long (Excess Flood)"],
              }),
            );
            await this.disconnectSession(ws, currentAttachment, "Input line too long");
            return;
          }

          let parsed: IRCMessage;
          try {
            parsed = parseIRCMessage(rawLine);
          } catch (err) {
            if (err instanceof IRCProtocolError && err.numeric) {
              this.sendNumeric(ws, currentAttachment, err.numeric, [err.message]);
            }
            continue;
          }

          if (isInvalidUtf8) {
            const cmd = parsed.command || "*";
            const label = parsed.tags?.label;
            const tags = label ? { label } : undefined;
            this.sendLine(
              ws,
              currentAttachment,
              encodeIRCMessage({
                tags,
                prefix: SERVER_CONFIG.serverName,
                command: "FAIL",
                params: [cmd, "INVALID_UTF8", "Line contained invalid UTF-8"],
              }),
            );
            continue;
          }

          if (parsed.command === "PONG") {
            const token = parsed.params.at(-1);
            if (token?.startsWith(IRC_READER_PREFIX)) {
              if (!this.reader.acknowledge(ws, token.slice(IRC_READER_PREFIX.length), "irc"))
                return;
              continue;
            }
          }

          if (parsed.command === "JOIN" || parsed.command === "PART") {
            // Keep the raw-command charge (including malformed commands), then
            // reserve all additional requested targets before any handler RPC.
            // Match the handlers' nonempty-target counting; validation stays there.
            const targets = (parsed.params[0] ?? "")
              .split(",")
              .filter((target) => target.trim().length > 0).length;
            if (
              targets > 1 &&
              !this.commandRateLimiter.charge(
                currentAttachment.sessionId,
                targets - 1,
                commandStartedAt,
              )
            ) {
              await this.disconnectSession(ws, currentAttachment, "Excess Flood");
              return;
            }
            // Reserve the whole requested batch against the authoritative stable
            // account before any handler can create/join/part a channel. JOIN 0
            // remains available for legitimate leave-all cleanup.
            if (
              targets > 0 &&
              !(parsed.command === "JOIN" && parsed.params[0] === "0") &&
              currentAttachment.registered &&
              currentAttachment.authenticated &&
              !(await this.getAccountsStub().chargeChannelTargetBudget(
                currentAttachment.userId,
                currentAttachment.credentialVersion!,
                targets,
              ))
            ) {
              await this.disconnectSession(ws, currentAttachment, "Excess Flood");
              return;
            }
          }

          try {
            await this.handleIRCCommand(ws, currentAttachment, parsed);
          } catch (error) {
            if (
              error instanceof FeatureError &&
              ["MESSAGE_FORBIDDEN", "MESSAGE_REDACTED"].includes(error.code) &&
              ["PRIVMSG", "NOTICE", "TAGMSG"].includes(parsed.command) &&
              !/^[#&]/.test(parsed.params[0] ?? "")
            ) {
              // A rejected DM edit is a protocol denial, not a server failure.
              // Missing, unrelated and redacted IDs share a safe response, and
              // NOTICE retains its no-automatic-error-reply semantics.
              if (parsed.command !== "NOTICE")
                this.sendNumeric(ws, currentAttachment, Numerics.ERR_CANNOTSENDTOCHAN, [
                  parsed.params[0] ?? "*",
                  "Cannot send to this user",
                ]);
            } else if (error instanceof IRCProtocolError && error.numeric) {
              this.saveAttachment(ws, currentAttachment);
              this.sendNumeric(ws, currentAttachment, error.numeric, [
                parsed.params[0] ?? "*",
                error.message,
              ]);
            } else {
              console.error("IRC command failed", parsed.command, error);
              this.sendLine(
                ws,
                currentAttachment,
                encodeIRCMessage({
                  prefix: SERVER_CONFIG.serverName,
                  command: "FAIL",
                  params: [parsed.command, "INTERNAL_ERROR", "Command could not be completed"],
                }),
              );
            }
          }
        }
      })
      .finally(() => this.reader.endIRCResponse(ws))
      .catch((err) => {
        console.error("Error processing IRC command:", err);
      });

    this.sessionMessageQueues.set(attachment.sessionId, currentTask);
    try {
      await currentTask;
    } finally {
      const pending = this.queuedInput.get(attachment.sessionId);
      if (pending) {
        pending.bytes -= frameBytes;
        if (--pending.frames === 0) this.queuedInput.delete(attachment.sessionId);
      }
      if (this.sessionMessageQueues.get(attachment.sessionId) === currentTask)
        this.sessionMessageQueues.delete(attachment.sessionId);
    }
  }

  public async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // Older compatibility dates require an explicit reciprocal Close frame,
    // including event sockets with no IRC attachment. Do this before async
    // cleanup; newer runtimes safely ignore closing an already closed socket.
    try {
      if (code === 1005 || code === 1006 || code === 1015) ws.close();
      else ws.close(code, reason);
    } catch {
      // The transport may already have completed or aborted the handshake.
    }
    if (ws.deserializeAttachment()?.edgeLease) return this.eventConnections.close(ws);
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (attachment?.sessionId) {
      console.log(
        `[FlaRC SessionDO] Client disconnected: ${attachment.nickname ?? "unregistered"} (session:${attachment.sessionId.slice(0, 8)}, code: ${code})`,
      );
      await this.cleanupSessionState(attachment, reason || "Client disconnected");
    }
  }

  public async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    if (ws.deserializeAttachment()?.edgeLease) return this.eventConnections.close(ws);
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (attachment?.sessionId) {
      console.log(
        `[FlaRC SessionDO] Client socket error: ${attachment.nickname ?? "unregistered"} (session:${attachment.sessionId.slice(0, 8)}, error: ${String(error)})`,
      );
      await this.cleanupSessionState(attachment, "Connection error");
    }
  }

  public sendChannelLine(
    ws: WebSocket,
    attachment: SessionAttachment,
    line: string,
    channel: string,
    generation?: string,
    control = false,
  ): void {
    if (!generation) return;
    this.sendLine(ws, attachment, line, {
      key: "",
      requested: true,
      channel,
      channelGeneration: generation,
      control,
      ...(control
        ? {
            controlRecipientSessionId: attachment.sessionId,
            controlRecipientUserId: attachment.userId,
          }
        : {}),
    });
  }

  public async sendDirectMessageLine(
    ws: WebSocket,
    attachment: SessionAttachment,
    line: string,
    messageId?: string,
  ): Promise<void> {
    if (!messageId) {
      this.sendLine(ws, attachment, line);
      return;
    }
    const message = this.sql
      .exec<{ conversation_id: string }>(
        "SELECT conversation_id FROM direct_messages WHERE id=?",
        messageId,
      )
      .toArray()[0];
    if (
      !message ||
      !this.features.conversations.hasMember(message.conversation_id, attachment.userId)
    )
      return;
    if (attachment.authenticated) {
      try {
        await this.features.actor(
          { ircSessionId: attachment.sessionId },
          "conversation.read",
          message.conversation_id,
        );
      } catch {
        return;
      }
    }
    this.sendLine(ws, attachment, line, { key: "", conversationId: message.conversation_id });
  }

  public sendLine(
    ws: WebSocket,
    attachment: SessionAttachment,
    line: string,
    metadata?: MetadataVisibility,
  ): void {
    if (!this.acceptSessionAttachment(ws, attachment)) return;
    if (SERVER_CONFIG.requireAccounts && attachment.registered) {
      const bytes = new TextEncoder().encode(line).byteLength;
      let queue = this.outboundQueues.get(ws);
      if (
        (queue?.frames.length ?? 0) >= 4096 ||
        (queue?.bytes ?? 0) + bytes > 8 * 1024 * 1024 ||
        this.outboundBytes + bytes > 16 * 1024 * 1024
      ) {
        try {
          ws.close(1008, "Output queue limit reached");
        } catch {
          /* Closed */
        }
        return;
      }
      const start = !queue;
      if (!queue) {
        queue = { frames: [], bytes: 0 };
        this.outboundQueues.set(ws, queue);
      }
      queue.frames.push({
        line,
        userId: attachment.userId,
        accountName: attachment.accountName!,
        version: attachment.credentialVersion!,
        metadata,
      });
      if (!queue.readerResponse && this.reader.hasIRCResponse(ws)) {
        queue.readerResponse = true;
        this.reader.beginIRCResponse(ws);
      }
      queue.bytes += bytes;
      this.outboundBytes += bytes;
      if (start) this.ctx.waitUntil(this.flushOutbound(ws, queue));
      return;
    }
    try {
      const frame = encodeWebSocketFrame(line, attachment.subprotocol);
      this.reader.send(ws, frame, "irc");
    } catch {
      // Socket may have closed concurrently
    }
  }

  private async flushOutbound(
    ws: WebSocket,
    queue: {
      frames: OutboundFrame[];
      bytes: number;
      readerResponse?: boolean;
    },
  ): Promise<void> {
    try {
      while (queue.frames.length) {
        const frames = queue.frames.splice(0);
        const current = ws.deserializeAttachment() as SessionAttachment;
        if (!this.acceptSessionAttachment(ws, current)) return;
        const account = current.accountName
          ? await this.getAccountsStub().getAccountByUsername(current.accountName)
          : null;
        if (
          !account ||
          account.id !== current.userId ||
          account.credentialVersion !== current.credentialVersion ||
          (await this.getAccountsStub().isNetworkBanned(
            account.id,
            this.getSourceHostmask(current),
          )) ||
          (current.credentialSessionHash &&
            !(await this.getAccountsStub().verifySessionHash(current.credentialSessionHash)))
        ) {
          await this.disconnectSession(ws, current, "Account credentials or permissions revoked");
          return;
        }
        // One authoritative check per channel in a delivery batch, not one RPC
        // per history line. No permanent timers or idle-object activity.
        const readable = new Map<string, boolean>();
        const channels = new Map<string, string>();
        for (const frame of frames) {
          if (frame.userId !== account.id || frame.version !== account.credentialVersion) continue;
          // Outbound lines have already been encoded. Do not apply inbound
          // parser limits to valid server replies or large history payloads.
          const message = frame.line.match(/^(?:@\S+ )?(?::\S+ )?(\S+)(?: (.*))?$/s);
          const command = message?.[1];
          const params = (message?.[2] ?? "").split(" ", 3);
          const raw = ["PRIVMSG", "NOTICE", "TAGMSG"].includes(command ?? "")
            ? params[0]
            : command === "BATCH" && params[0]?.startsWith("+")
              ? params[2]
              : undefined;
          const channel = raw?.replace(/^[~&@%+]+(?=[#&])/, "");
          if (channel && isValidChannelName(channel)) channels.set(frame.line, channel);
        }
        for (const frame of frames)
          if (frame.metadata?.channel) channels.set(frame.line, frame.metadata.channel);
        const generations = new Map<string, string>();
        for (const channel of new Set(channels.values())) {
          generations.set(
            channel,
            await this.getChannelStub(channel).getChannelGeneration(channel),
          );
          readable.set(
            channel,
            await this.getChannelStub(channel).canReadAccount({
              ...account,
              isAdmin:
                account.roles.includes("admin") ||
                Boolean(current.isOper && account.roles.includes("oper")),
            }),
          );
        }
        const latest = ws.deserializeAttachment() as SessionAttachment;
        if (
          latest.userId !== account.id ||
          latest.credentialVersion !== account.credentialVersion ||
          !latest.authenticated
        )
          continue;
        for (const frame of frames) {
          const bytes = new TextEncoder().encode(frame.line).byteLength;
          queue.bytes -= bytes;
          this.outboundBytes -= bytes;
          if (frame.userId !== latest.userId || frame.version !== latest.credentialVersion)
            continue;
          const control = Boolean(
            frame.metadata?.control &&
              frame.metadata.controlRecipientSessionId === latest.sessionId &&
              frame.metadata.controlRecipientUserId === latest.userId,
          );
          if (frame.metadata?.control && !control) continue;
          if (frame.metadata && !this.canDeliverMetadata(latest, frame.metadata)) continue;
          if (frame.metadata?.conversationId) {
            const credential = current.credentialSessionHash;
            if (
              !(credential
                ? await this.getAccountsStub().authorizeSessionHash(
                    credential,
                    "conversation.read",
                    frame.metadata.conversationId,
                  )
                : await this.getAccountsStub().authorizeAccountActor(
                    account.id,
                    account.credentialVersion ?? 0,
                    "conversation.read",
                    frame.metadata.conversationId,
                  ))
            )
              continue;
          }
          const channel = channels.get(frame.line);
          if (channel && !readable.get(channel) && !control) continue;
          if (
            frame.metadata?.channelGeneration &&
            generations.get(channel!) !== frame.metadata.channelGeneration
          )
            continue;
          if (
            current.credentialSessionHash &&
            frame.metadata?.key.startsWith("private:") &&
            !(await this.getAccountsStub().authorizeSessionHash(
              current.credentialSessionHash,
              "metadata.private.read",
              current.accountName!,
            ))
          )
            continue;
          if (
            current.credentialSessionHash &&
            !(await this.getAccountsStub().authorizeSessionHash(
              current.credentialSessionHash,
              channel && !control ? "channel.read" : "irc.receive",
              channel && !control ? canonicalizeIRCName(channel) : "*",
            ))
          )
            continue;
          if (!this.reader.send(ws, encodeWebSocketFrame(frame.line, latest.subprotocol), "irc"))
            return;
        }
      }
    } catch {
      try {
        ws.close(1008, "Session delivery could not be authorized");
      } catch {
        /* Closed */
      }
    } finally {
      this.outboundBytes -= queue.bytes;
      this.outboundQueues.delete(ws);
      if (queue.readerResponse) this.reader.endIRCResponse(ws);
    }
  }

  public sendNumeric(
    ws: WebSocket,
    attachment: SessionAttachment,
    numeric: string,
    params: string[],
    tags?: Record<string, string | true>,
    metadata?: MetadataVisibility,
  ): void {
    const target = attachment.nickname ?? "*";
    const line = encodeNumeric(numeric, target, params, this.filterOutgoingTags(attachment, tags));
    this.sendLine(ws, attachment, line, metadata);
  }

  private canDeliverMetadata(recipient: SessionAttachment, context: MetadataVisibility): boolean {
    if (context.conversationId)
      return this.features.conversations.hasMember(context.conversationId, recipient.userId);
    if (context.requested) {
      if (context.key.startsWith("private:") && context.sourceUserId !== recipient.userId)
        return false;
      return true;
    }
    const subs = recipient.metadataSubs ?? [];
    if (
      (!this.hasCap(recipient, "draft/metadata-3") &&
        !this.hasCap(recipient, "draft/metadata-2")) ||
      (!context.allowUnsubscribed && !subs.includes("*") && !subs.includes(context.key))
    )
      return false;
    if (context.channel)
      return this.getSessionChannels(recipient.sessionId).some(
        (ch) => ch.canonicalChannel === canonicalizeIRCName(context.channel!),
      );
    if (context.key.startsWith("private:") && context.sourceUserId !== recipient.userId)
      return false;
    if (!context.sourceSessionId && context.sourceUserId) {
      if (context.sourceUserId === recipient.userId) return true;
      const channels = new Set(
        this.getLiveAccountSessions(context.sourceUserId).flatMap((id) =>
          this.getSessionChannels(id).map((c) => `${c.canonicalChannel}:${c.generation}`),
        ),
      );
      return this.getSessionChannels(recipient.sessionId).some((c) =>
        channels.has(`${c.canonicalChannel}:${c.generation}`),
      );
    }
    const source = this.sessionsById.get(context.sourceSessionId ?? "")?.attachment;
    if (
      !source?.registered ||
      !source.authenticated ||
      source.userId !== context.sourceUserId ||
      source.nickname !== context.sourceNick
    )
      return false;
    if (source.userId === recipient.userId) return true;
    const sourceChannels = new Set(
      this.getSessionChannels(source.sessionId).map((ch) => ch.canonicalChannel),
    );
    return this.getSessionChannels(recipient.sessionId).some((ch) =>
      sourceChannels.has(ch.canonicalChannel),
    );
  }

  public sendAck(
    ws: WebSocket,
    attachment: SessionAttachment,
    labelTags?: Record<string, string | true>,
  ): void {
    if (!labelTags?.label || !this.hasCap(attachment, "labeled-response")) {
      return;
    }
    this.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: this.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "ACK",
      }),
    );
  }

  public hasCap(attachment: SessionAttachment, cap: string): boolean {
    const lc = cap.toLowerCase();
    if (attachment.capabilities.includes(lc)) return true;
    if (lc === "draft/metadata-3" || lc === "draft/metadata-3.2" || lc === "draft/metadata-2") {
      return (
        attachment.capabilities.includes("draft/metadata-3.2") ||
        attachment.capabilities.includes("draft/metadata-3") ||
        attachment.capabilities.includes("draft/metadata-2") ||
        attachment.capabilities.includes("draft/metadata-notify-2")
      );
    }
    return false;
  }

  public filterOutgoingTags(
    attachment: SessionAttachment,
    tags?: Record<string, string | true>,
  ): Record<string, string | true> | undefined {
    if (!tags) return undefined;
    const out: Record<string, string | true> = {};
    const hasMessageTags = this.hasCap(attachment, "message-tags");
    const allowAnyTags =
      hasMessageTags ||
      this.hasCap(attachment, "server-time") ||
      this.hasCap(attachment, "account-tag") ||
      this.hasCap(attachment, "msgid") ||
      this.hasCap(attachment, "batch") ||
      this.hasCap(attachment, "bot") ||
      this.hasCap(attachment, "draft/oper-tag") ||
      this.hasCap(attachment, "draft/multiline") ||
      this.hasCap(attachment, "draft/chathistory") ||
      this.hasCap(attachment, "chathistory") ||
      this.hasCap(attachment, "draft/relaymsg") ||
      this.hasCap(attachment, "labeled-response");

    if (!allowAnyTags) return undefined;

    for (const [k, v] of Object.entries(tags)) {
      if (k.startsWith("+")) {
        if (hasMessageTags) {
          out[k] = v;
        }
        continue;
      }
      if (k === "time" && !this.hasCap(attachment, "server-time") && !hasMessageTags) {
        continue;
      }
      if (k === "account" && !this.hasCap(attachment, "account-tag") && !hasMessageTags) {
        continue;
      }
      if (k === "msgid" && !this.hasCap(attachment, "msgid") && !hasMessageTags) {
        continue;
      }
      if (k === "batch" && !this.hasCap(attachment, "batch") && !hasMessageTags) {
        continue;
      }
      if (k === "bot" && !this.hasCap(attachment, "bot") && !hasMessageTags) {
        continue;
      }
      if (k === "draft/oper" && !this.hasCap(attachment, "draft/oper-tag") && !hasMessageTags) {
        continue;
      }
      if (
        k === "draft/multiline-concat" &&
        !this.hasCap(attachment, "draft/multiline") &&
        !hasMessageTags
      ) {
        continue;
      }
      if (k === "label" && !this.hasCap(attachment, "labeled-response")) {
        continue;
      }
      if (k === "draft/relaymsg" && !this.hasCap(attachment, "draft/relaymsg")) {
        continue;
      }
      out[k] = v;
    }

    return Object.keys(out).length > 0 ? out : undefined;
  }

  public getServiceDefinition(target: string): {
    name: "NickServ" | "ChanServ" | "HostServ" | "HistServ" | "F";
    realname: string;
  } | null {
    const canon = canonicalizeIRCName(target);
    if (canon === "nickserv" || canon === "ns") {
      return { name: "NickServ", realname: "Nickname registration service" };
    }
    if (canon === "chanserv" || canon === "cs") {
      return { name: "ChanServ", realname: "Channel registration service" };
    }
    if (canon === "hostserv" || canon === "hs") {
      return { name: "HostServ", realname: "VHost management service" };
    }
    if (canon === "histserv") {
      return { name: "HistServ", realname: "History management service" };
    }
    if (canon === "f" || canon === "flareserv" || canon === "q") {
      return { name: "F", realname: "FlareServ Channel Service Bot" };
    }
    return null;
  }

  public getSourceHostmask(attachment: SessionAttachment): string {
    const source = (attachment as SessionAttachment & { peerSource?: RequestSource }).peerSource;
    const ip =
      source?.ip ??
      (!this.env.LOCAL_IRC_BRIDGE_SECRET &&
      (!this.env.REQUEST_SOURCE || this.env.REQUEST_SOURCE === "development")
        ? "127.0.0.1"
        : "unknown");
    return `${attachment.nickname ?? "*"}!${attachment.username ?? "user"}@${ip}`;
  }

  public getUserPrefix(attachment: SessionAttachment): string {
    const nick = attachment.nickname ?? "*";
    const user = attachment.username ?? "user";
    const host = attachment.hostname || "irc.client";
    return `${nick}!${user}@${host}`;
  }

  public async storeDirectMessage(params: {
    sender: SessionAttachment;
    target: SessionAttachment;
    messageId: string;
    command: "PRIVMSG" | "NOTICE" | "TAGMSG";
    content: string;
    tags?: Record<string, string | true>;
    multilineLines?: Array<{ content: string; concat: boolean }>;
    displayNick?: string;
  }): Promise<StoredChannelMessage> {
    const sender = this.sessionsById.get(params.sender.sessionId)?.attachment;
    const target = this.sessionsById.get(params.target.sessionId)?.attachment;
    if (
      !sender?.registered ||
      !target?.registered ||
      sender.userId !== params.sender.userId ||
      target.userId !== params.target.userId ||
      (SERVER_CONFIG.requireAccounts && (!sender.authenticated || !target.authenticated))
    )
      throw new IRCProtocolError("Authenticated DM participants required", Numerics.ERR_NOSUCHNICK);
    if (sender.authenticated) {
      const pair = [sender.userId, target.userId].sort().join("<->");
      const conversation = this.sql
        .exec<{ id: string }>("SELECT id FROM conversations WHERE pair_key=?", pair)
        .toArray()[0];
      await this.features.actor(
        { ircSessionId: sender.sessionId },
        "conversation.write",
        conversation?.id ?? "*",
      );
    }
    const identity = (a: SessionAttachment) => ({
      id: a.userId,
      username: a.accountName ?? a.nickname!,
      nickname: a.nickname!,
      user: a.username!,
      host: a.hostname,
      roles: a.roles ?? [],
    });
    const result = this.ctx.storage.transactionSync(() =>
      this.features.conversations.append(identity(sender), identity(target), {
        id: params.messageId,
        command: params.command,
        content: params.content,
        tags: params.tags,
        multilineLines: params.multilineLines,
        displayNick: params.displayNick,
      }),
    );
    this.features.notify();
    return result;
  }

  public async storeOfflineDirectMessage(
    sender: SessionAttachment,
    targetName: string,
    command: "PRIVMSG" | "NOTICE" | "TAGMSG",
    content: string,
    tags?: Record<string, string | true>,
  ) {
    const identity = await this.features.actor({ ircSessionId: sender.sessionId }, "", "");
    const target = await this.features.account(targetName, true);
    if (!target) return null;
    const pair = [identity.id, target.id].sort().join("<->");
    const conversation = this.sql
      .exec<{ id: string }>("SELECT id FROM conversations WHERE pair_key=?", pair)
      .toArray()[0];
    const actor = await this.features.actor(
      { ircSessionId: sender.sessionId },
      "conversation.write",
      conversation?.id ?? "*",
    );
    const result = this.ctx.storage.transactionSync(() =>
      this.features.conversations.append(
        {
          id: actor.id,
          username: actor.username,
          nickname: sender.nickname!,
          user: sender.username!,
          host: sender.hostname,
          roles: actor.roles,
        },
        {
          id: target.id,
          username: target.username,
          nickname: target.username,
          user: target.username,
          host: "offline.flarc.local",
          roles: [],
        },
        { id: crypto.randomUUID(), command, content, tags },
      ),
    );
    this.features.notify();
    return result;
  }

  public async redactDirectMessage(
    messageId: string,
    authorId: string,
    sessionId?: string,
  ): Promise<boolean> {
    if (sessionId && this.sessionsById.get(sessionId)?.attachment.authenticated) {
      const row = this.sql
        .exec<{ conversation_id: string }>(
          "SELECT conversation_id FROM direct_messages WHERE id=?",
          messageId,
        )
        .toArray()[0];
      const actor = await this.features.actor(
        { ircSessionId: sessionId },
        "conversation.write",
        row?.conversation_id ?? "*",
      );
      if (actor.id !== authorId) return false;
    } else if (SERVER_CONFIG.requireAccounts)
      throw new FeatureError(403, "ACTOR_REQUIRED", "Authenticated IRC actor required");
    const result = this.ctx.storage.transactionSync(() =>
      this.features.conversations.redact(authorId, messageId),
    );
    if (result) this.features.notify();
    return result;
  }

  public getCanonicalDmPair(nick1: string, nick2: string): string {
    const c1 = canonicalizeIRCName(nick1);
    const c2 = canonicalizeIRCName(nick2);
    return c1 < c2 ? `${c1}<->${c2}` : `${c2}<->${c1}`;
  }

  private async handleIRCCommand(
    ws: WebSocket,
    attachment: SessionAttachment,
    msg: IRCMessage,
  ): Promise<void> {
    return dispatchIRCCommand(this, ws, attachment, msg);
  }

  public getIsupportTokens(): string[][] {
    return [
      [
        `NETWORK=${SERVER_CONFIG.networkId}`,
        "CHANTYPES=#&",
        "PREFIX=(qaohv)~&@%+",
        "CHANMODES=beIq,k,fl,BCEMRimnpsturuU",
        "STATUSMSG=~&@%+",
        `CASEMAPPING=${SERVER_CONFIG.caseMapping}`,
        "UTF8ONLY",
        `NICKLEN=${SERVER_CONFIG.maxNickLength}`,
        `CHANNELLEN=${SERVER_CONFIG.maxChannelLength}`,
        "TOPICLEN=390",
        "are supported by this server",
      ],
      [
        "AWAYLEN=300",
        "KICKLEN=390",
        `LINELEN=${SERVER_CONFIG.maxLineLength}`,
        "ELIST=MNU",
        "MAXTARGETS=4",
        "TARGMAX=NAMES:4,LIST:1,KICK:,WHOIS:1,PRIVMSG:4,NOTICE:4,TAGMSG:4",
        "MODES=4",
        "EXCEPTS=e",
        "INVEX=I",
        "EXTBAN=,m",
        "are supported by this server",
      ],
      [
        "ACCOUNTEXTBAN=a,account",
        "WHOX",
        "MONITOR=100",
        "BOT=B",
        `CHATHISTORY=${SERVER_CONFIG.maxHistoryLimit}`,
        "MSGREFTYPES=msgid,timestamp",
        "METADATA=32",
        "draft/ICON=http://127.0.0.1:8788/icon.svg",
        "CLIENTTAGDENY=*,-ircord/edit,-draft/channel-context,-draft/react,-draft/unreact,-typing,-reply",
        ...(SERVER_CONFIG.filehostEnabled
          ? ["draft/FILEHOST=/api/media/upload", "soju.im/FILEHOST=/api/media/upload"]
          : []),
        "are supported by this server",
      ],
    ];
  }

  public async tryCompleteRegistration(
    ws: WebSocket,
    attachment: SessionAttachment,
  ): Promise<void> {
    if (
      attachment.registered ||
      attachment.capNegotiating ||
      !attachment.nickname ||
      !attachment.username
    ) {
      return;
    }

    const pendingPass = this.pendingPassBySession.get(attachment.sessionId);
    this.pendingPassBySession.delete(attachment.sessionId);

    // Server-wide connection password: PASS must match exactly, else reject.
    if (SERVER_CONFIG.serverPassword) {
      if (pendingPass !== SERVER_CONFIG.serverPassword) {
        this.sendNumeric(ws, attachment, Numerics.ERR_PASSWDMISMATCH, ["Password incorrect"]);
        this.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            command: "ERROR",
            params: ["Password incorrect"],
          }),
        );
        await this.disconnectSession(ws, attachment, "Bad password");
        return;
      }
    } else if (pendingPass && !attachment.authenticated) {
      const colonIdx = pendingPass.indexOf(":");
      const authUser = colonIdx !== -1 ? pendingPass.slice(0, colonIdx) : attachment.nickname;
      const authPass = colonIdx !== -1 ? pendingPass.slice(colonIdx + 1) : pendingPass;

      const accountsStub = this.getAccountsStub();
      const exchanged =
        authUser === "token" ? await accountsStub.exchangeIrcCredential(authPass) : null;
      const res =
        authUser === "token"
          ? exchanged
            ? { ok: true as const, account: exchanged.account }
            : { ok: false as const }
          : await accountsStub.verifyCredentials(authUser, authPass);
      if (exchanged) attachment.credentialSessionHash = exchanged.sessionHash;
      if (res.ok) {
        attachment.authenticated = true;
        attachment.userId = res.account.id;
        attachment.credentialVersion = res.account.credentialVersion ?? 0;
        attachment.accountName = res.account.username;
        attachment.roles = res.account.roles;
        attachment.isOper =
          res.account.roles.includes("oper") || res.account.roles.includes("admin");
      } else {
        this.sendNumeric(ws, attachment, Numerics.ERR_PASSWDMISMATCH, ["Password incorrect"]);
        return;
      }
    }

    if (SERVER_CONFIG.requireAccounts && (!attachment.authenticated || !attachment.accountName)) {
      this.sendNumeric(ws, attachment, Numerics.ERR_NOTREGISTERED, [
        "Log in using SASL or PASS account:password before connecting",
      ]);
      return;
    }

    const accountsStub = this.getAccountsStub();
    if (await accountsStub.isNetworkBanned(attachment.userId, this.getSourceHostmask(attachment))) {
      await this.disconnectSession(ws, attachment, "Network access denied");
      return;
    }
    const nickOwnerId = await accountsStub.getNickOwner(attachment.nickname);
    if (nickOwnerId && nickOwnerId !== attachment.userId) {
      const rejectedNick = attachment.nickname;
      const rejectedCanon = canonicalizeIRCName(rejectedNick);
      if (this.sessionsByNick.get(rejectedCanon) === attachment.sessionId) {
        this.sessionsByNick.delete(rejectedCanon);
      }
      attachment.nickname = null;
      this.saveAttachment(ws, attachment);
      this.sendNumeric(ws, attachment, Numerics.ERR_NICKNAMEINUSE, [
        rejectedNick,
        "Nickname is registered to another account",
      ]);
      return;
    }

    attachment.registered = true;
    if (attachment.accountName) {
      const vhostInfo = await accountsStub.getVhostInfo(attachment.accountName);
      if (vhostInfo.enabled && vhostInfo.vhost) {
        attachment.vhost = vhostInfo.vhost;
        attachment.hostname = vhostInfo.vhost;
      }
    }
    this.saveAttachment(ws, attachment);

    const prefix = this.getUserPrefix(attachment);
    const transport = attachment.isDirectWebSocket ? "Direct WebSocket" : "TCP (Bridge)";
    console.log(
      `[FlaRC SessionDO] Client registered: ${attachment.nickname}!${attachment.username}@${attachment.hostname} [${transport} | account: ${attachment.accountName ?? "guest"}]`,
    );

    this.sendNumeric(ws, attachment, Numerics.RPL_WELCOME, [
      `Welcome to the ${SERVER_CONFIG.networkId} Internet Relay Chat Network ${prefix}`,
    ]);
    this.sendNumeric(ws, attachment, Numerics.RPL_YOURHOST, [
      `Your host is ${SERVER_CONFIG.serverName}, running version ${SERVER_CONFIG.version}`,
    ]);
    this.sendNumeric(ws, attachment, Numerics.RPL_CREATED, [
      `This server was created ${SERVER_CONFIG.createdAt}`,
    ]);
    this.sendNumeric(ws, attachment, Numerics.RPL_MYINFO, [
      SERVER_CONFIG.serverName,
      SERVER_CONFIG.version,
      "BZiowrTsER",
      "beIqkflBCEMRimnpsturuU",
      "kfl",
    ]);
    for (const row of this.getIsupportTokens()) {
      this.sendNumeric(ws, attachment, Numerics.RPL_ISUPPORT, row);
    }

    this.sendLusers(ws, attachment);
    this.sendMotd(ws, attachment);

    const umodes = `+${attachment.userModes ?? ""}${attachment.accountName ? "r" : ""}${attachment.isOper ? "o" : ""}`;
    if (umodes !== "+") {
      this.sendNumeric(ws, attachment, Numerics.RPL_UMODEIS, [umodes]);
    }
    if (attachment.vhost) {
      this.sendNumeric(ws, attachment, Numerics.RPL_HOSTHIDDEN, [
        attachment.vhost,
        "is now your hidden host",
      ]);
    }
    if (this.hasCap(attachment, "draft/whoami")) {
      this.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix,
          command: "SETNAME",
          params: [attachment.realname ?? attachment.username!],
        }),
      );
    }
    if (attachment.authenticated && this.hasCap(attachment, "draft/persistence")) {
      const isPersistent = await accountsStub.getPersistence(attachment.userId);
      this.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "PERSISTENCE",
          params: ["STATUS", "DEFAULT", isPersistent ? "ON" : "OFF"],
        }),
      );
    }

    // Burst pre-registration metadata if any was configured
    if (attachment.preRegMetadata && Object.keys(attachment.preRegMetadata).length > 0) {
      const metaKey = attachment.accountName ?? canonicalizeIRCName(attachment.nickname!);
      for (const [k, v] of Object.entries(attachment.preRegMetadata)) {
        if (attachment.authenticated)
          await this.features.execute({ ircSessionId: attachment.sessionId }, "metadata.update", {
            target: metaKey,
            key: k,
            value: v || null,
          });
        else if (!k.startsWith("private:")) await accountsStub.setMetadata(metaKey, k, v || null);
      }
      const batchId = crypto.randomUUID().slice(0, 8);
      const hasBatch = this.hasCap(attachment, "batch");
      if (hasBatch) {
        this.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            prefix: SERVER_CONFIG.serverName,
            command: "BATCH",
            params: [`+${batchId}`, "metadata", attachment.nickname!],
          }),
        );
      }
      for (const [k, v] of Object.entries(attachment.preRegMetadata)) {
        const batchTag = hasBatch ? { batch: batchId } : undefined;
        this.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: batchTag,
            prefix: SERVER_CONFIG.serverName,
            command: Numerics.RPL_KEYVALUE,
            params: [attachment.nickname!, attachment.nickname!, k, "*", v],
          }),
        );
      }
      if (hasBatch) {
        this.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            prefix: SERVER_CONFIG.serverName,
            command: "BATCH",
            params: [`-${batchId}`],
          }),
        );
      }
      delete attachment.preRegMetadata;
      this.saveAttachment(ws, attachment);
    }

    this.notifyMonitorsOnline(attachment);

    // Reattach to existing channels if another session of this user/account is already connected (multiclient)
    const otherSessions = this.getAllSessionsForNick(attachment.nickname);
    const existing = otherSessions.find((s) => s.attachment.sessionId !== attachment.sessionId);
    if (existing) {
      const existingChannels = this.getSessionChannels(existing.attachment.sessionId);
      for (const ch of existingChannels) {
        await handleJoin(
          this,
          ws,
          attachment,
          {
            tags: {},
            prefix: null,
            command: "JOIN",
            params: [ch.channelName],
          },
          undefined,
          ch.generation ? { [ch.canonicalChannel]: ch.generation } : {},
        );
      }
    }

    // Auto-join persisted channels when draft/auto-join or always-on persistence is enabled
    if (attachment.authenticated) {
      const isPersistent = await accountsStub.getPersistence(attachment.userId);
      if (this.hasCap(attachment, "draft/auto-join") || isPersistent) {
        const autoJoinChans = await accountsStub.getAutoJoinChannels(attachment.userId);
        const joinedSet = new Set(
          this.getSessionChannels(attachment.sessionId).map((c) => c.canonicalChannel),
        );
        const neededChans = autoJoinChans.filter(
          (c) => !joinedSet.has(canonicalizeIRCName(c.channel)),
        );
        if (neededChans.length > 0) {
          const names = neededChans.map((c) => c.channel).join(",");
          const keys = neededChans.map((c) => c.key ?? "").join(",");
          await handleJoin(
            this,
            ws,
            attachment,
            {
              tags: {},
              prefix: null,
              command: "JOIN",
              params: [names, keys],
            },
            undefined,
            Object.fromEntries(
              neededChans.map((c) => [canonicalizeIRCName(c.channel), c.generation]),
            ),
          );
        }
      }
    }
  }

  public sendLusers(ws: WebSocket, attachment: SessionAttachment): void {
    let registeredCount = 0;
    let unknownCount = 0;
    let operCount = 0;
    let invisibleCount = 0;

    for (const { attachment: a } of [...this.sessionsById.values()]) {
      if (a.registered) {
        registeredCount++;
        if (a.isOper) operCount++;
        if ((a.userModes ?? "").includes("i")) {
          invisibleCount++;
        }
      } else {
        unknownCount++;
      }
    }
    const visibleCount = registeredCount - invisibleCount;

    if (registeredCount > this.maxLocalUsers) {
      this.maxLocalUsers = registeredCount;
    }
    if (registeredCount > this.maxGlobalUsers) {
      this.maxGlobalUsers = registeredCount;
    }

    const activeChannels =
      this.sql
        .exec<{ cnt: number }>(
          "SELECT COUNT(DISTINCT canonical_channel) AS cnt FROM session_channels",
        )
        .toArray()[0]?.cnt ?? 0;

    this.sendNumeric(ws, attachment, Numerics.RPL_LUSERCLIENT, [
      `There are ${visibleCount} users and ${invisibleCount} invisible on 1 servers`,
    ]);
    this.sendNumeric(ws, attachment, Numerics.RPL_LUSEROP, [
      String(operCount),
      "operator(s) online",
    ]);
    if (unknownCount > 0) {
      this.sendNumeric(ws, attachment, Numerics.RPL_LUSERUNKNOWN, [
        String(unknownCount),
        "unknown connection(s)",
      ]);
    }
    this.sendNumeric(ws, attachment, Numerics.RPL_LUSERCHANNELS, [
      String(activeChannels),
      "channels formed",
    ]);
    this.sendNumeric(ws, attachment, Numerics.RPL_LUSERME, [
      `I have ${registeredCount} clients and 1 servers`,
    ]);
    this.sendNumeric(ws, attachment, Numerics.RPL_LOCALUSERS, [
      String(registeredCount),
      String(this.maxLocalUsers),
      `Current local users ${registeredCount}, max ${this.maxLocalUsers}`,
    ]);
    this.sendNumeric(ws, attachment, Numerics.RPL_GLOBALUSERS, [
      String(registeredCount),
      String(this.maxGlobalUsers),
      `Current global users ${registeredCount}, max ${this.maxGlobalUsers}`,
    ]);
  }

  public sendMotd(ws: WebSocket, attachment: SessionAttachment): void {
    this.sendNumeric(ws, attachment, Numerics.RPL_MOTDSTART, [
      `- ${SERVER_CONFIG.serverName} Message of the Day -`,
    ]);
    for (const line of SERVER_CONFIG.motd) {
      this.sendNumeric(ws, attachment, Numerics.RPL_MOTD, [`- ${line}`]);
    }
    this.sendNumeric(ws, attachment, Numerics.RPL_ENDOFMOTD, ["End of /MOTD command."]);
  }

  public notifyMonitorsOnline(attachment: SessionAttachment): void {
    if (!attachment.nickname) return;
    const canon = canonicalizeIRCName(attachment.nickname);
    const watchers = this.sql
      .exec<{ session_id: string }>(
        "SELECT session_id FROM session_monitors WHERE target_nick = ?",
        canon,
      )
      .toArray();

    const prefix = this.getUserPrefix(attachment);
    for (const w of watchers) {
      const sess = this.sessionsById.get(w.session_id);
      if (sess) {
        this.sendNumeric(sess.ws, sess.attachment, Numerics.RPL_MONONLINE, [prefix]);
      }
    }
  }

  public notifyMonitorsOffline(nickname: string): void {
    const canon = canonicalizeIRCName(nickname);
    if (this.getAllSessionsForNick(nickname).length > 0) return;

    const watchers = this.sql
      .exec<{ session_id: string }>(
        "SELECT session_id FROM session_monitors WHERE target_nick = ?",
        canon,
      )
      .toArray();

    for (const w of watchers) {
      const sess = this.sessionsById.get(w.session_id);
      if (sess) {
        this.sendNumeric(sess.ws, sess.attachment, Numerics.RPL_MONOFFLINE, [nickname]);
      }
    }
  }

  public async getSharedChannelSessions(sessionId: string): Promise<Set<string>> {
    const channels = this.getSessionChannels(sessionId);
    const shared = new Set<string>();
    for (const ch of channels) {
      const rows = this.sql
        .exec<{ session_id: string }>(
          "SELECT session_id FROM session_channels WHERE canonical_channel = ?",
          ch.canonicalChannel,
        )
        .toArray();
      for (const r of rows) {
        shared.add(r.session_id);
      }
    }
    return shared;
  }

  public async getSharedAndMonitoredSessions(
    attachment: SessionAttachment,
    requiredCap?: string,
  ): Promise<Set<string>> {
    const shared = await this.getSharedChannelSessions(attachment.sessionId);
    if (attachment.nickname) {
      const canon = canonicalizeIRCName(attachment.nickname);
      const watchers = this.sql
        .exec<{ session_id: string }>(
          "SELECT session_id FROM session_monitors WHERE target_nick = ?",
          canon,
        )
        .toArray();
      for (const w of watchers) {
        const sess = this.sessionsById.get(w.session_id);
        if (
          sess &&
          this.hasCap(sess.attachment, "extended-monitor") &&
          (!requiredCap || this.hasCap(sess.attachment, requiredCap))
        ) {
          shared.add(w.session_id);
        }
      }
    }
    return shared;
  }

  public async prepareAccountChange(
    attachment: SessionAttachment,
    newUserId: string,
  ): Promise<void> {
    if (attachment.registered && attachment.nickname && attachment.userId !== newUserId) {
      const owner = await this.getAccountsStub().getNickOwner(attachment.nickname);
      if (owner && owner !== newUserId)
        throw new IRCProtocolError(
          "Change nickname before switching accounts",
          Numerics.ERR_NICKNAMEINUSE,
        );
    }
    if (!attachment.authenticated || attachment.userId === newUserId) return;
    for (const channel of this.getSessionChannels(attachment.sessionId)) {
      const stub = this.getChannelStub(channel.channelName);
      const members = await stub.getMembers();
      await stub.part(attachment.sessionId, undefined, false, channel.generation);
      this.sql.exec(
        "DELETE FROM session_channels WHERE session_id = ? AND canonical_channel = ?",
        attachment.sessionId,
        channel.canonicalChannel,
      );
      const line = encodeIRCMessage({
        prefix: this.getUserPrefix(attachment),
        command: "PART",
        params: [channel.channelName, "Account changed"],
      });
      for (const member of members) {
        const client = this.sessionsById.get(member.sessionId);
        if (client) this.sendLine(client.ws, client.attachment, line);
      }
    }
  }

  public async broadcastAccountChange(attachment: SessionAttachment): Promise<void> {
    const channels = this.getSessionChannels(attachment.sessionId);
    const shared = await this.getSharedAndMonitoredSessions(attachment, "account-notify");
    for (const ch of channels) {
      const stub = this.getChannelStub(ch.channelName);
      const members = await stub.updateMemberAccount(
        attachment.sessionId,
        attachment.userId,
        attachment.accountName,
        ch.generation,
      );
      for (const sid of members) {
        shared.add(sid);
      }
    }

    const acctLine = encodeIRCMessage({
      prefix: this.getUserPrefix(attachment),
      command: "ACCOUNT",
      params: [attachment.accountName ?? "*"],
    });

    for (const sid of shared) {
      const sess = this.sessionsById.get(sid);
      if (sess && this.hasCap(sess.attachment, "account-notify")) {
        this.sendLine(sess.ws, sess.attachment, acctLine);
      }
    }
  }

  public async disconnectSession(
    ws: WebSocket,
    attachment: SessionAttachment,
    reason: string,
  ): Promise<void> {
    const cleanup = this.cleanupSessionState(attachment, reason);
    try {
      ws.close(1000, reason);
    } catch {
      /* Already closed. */
    }
    await cleanup;
  }

  public async cleanupSessionState(attachment: SessionAttachment, reason: string): Promise<void> {
    if (!this.sessionsById.has(attachment.sessionId)) {
      return;
    }
    this.sessionMessageQueues.delete(attachment.sessionId);
    this.queuedInput.delete(attachment.sessionId);
    this.pendingPassBySession.delete(attachment.sessionId);
    this.pendingBatchesBySession.delete(attachment.sessionId);
    this.activeBatchRefBySession.delete(attachment.sessionId);
    this.saslBuffersBySession.delete(attachment.sessionId);
    this.commandRateLimiter.reset(attachment.sessionId);
    this.sessionsById.delete(attachment.sessionId);

    this.sql.exec("DELETE FROM session_monitors WHERE session_id = ?", attachment.sessionId);

    if (attachment.nickname) {
      const canonNick = canonicalizeIRCName(attachment.nickname);
      const remaining = this.getAllSessionsForNick(attachment.nickname);
      if (this.sessionsByNick.get(canonNick) === attachment.sessionId) {
        if (remaining.length > 0) {
          this.sessionsByNick.set(canonNick, remaining[0].attachment.sessionId);
        } else {
          this.sessionsByNick.delete(canonNick);
        }
      }

      if (attachment.registered && remaining.length === 0) {
        this.sql.exec(
          `INSERT INTO whowas_history (canon_nick, nickname, username, hostname, realname, account_name, left_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          canonNick,
          attachment.nickname,
          attachment.username ?? "user",
          attachment.hostname,
          attachment.realname ?? attachment.username ?? "user",
          attachment.accountName,
          Date.now(),
        );
        this.notifyMonitorsOffline(attachment.nickname);
      }

      // If other sessions for this user/account remain, only clean up this session's channel memberships
      // and do not broadcast QUIT to channels/monitors.
      if (remaining.length > 0) {
        const channels = this.getSessionChannels(attachment.sessionId);
        this.sql.exec("DELETE FROM session_channels WHERE session_id = ?", attachment.sessionId);
        for (const ch of channels) {
          try {
            const stub = this.getChannelStub(ch.channelName);
            await stub.part(attachment.sessionId, undefined, false, ch.generation);
          } catch {
            // Ignore channel RPC failure
          }
        }
        return;
      }
    }

    if (attachment.authenticated) {
      const isPersistent = await this.getAccountsStub().getPersistence(attachment.userId);
      if (isPersistent) {
        return;
      }
    }

    const channels = this.getSessionChannels(attachment.sessionId);
    this.sql.exec("DELETE FROM session_channels WHERE session_id = ?", attachment.sessionId);

    const recipientSessionIds = new Set<string>();
    for (const ch of channels) {
      try {
        const stub = this.getChannelStub(ch.channelName);
        // A transport disconnect removes this session only. Another nickname on
        // the same authenticated account may still have a live channel session;
        // passing userId would delete that independent device's membership too.
        const res = await stub.part(attachment.sessionId, undefined, false, ch.generation);
        for (const sid of res.remainingSessionIds) {
          recipientSessionIds.add(sid);
        }
      } catch {
        // Tolerate individual channel RPC failure during disconnect
      }
    }

    if (attachment.registered && attachment.nickname) {
      const quitLine = encodeIRCMessage({
        prefix: this.getUserPrefix(attachment),
        command: "QUIT",
        params: [reason],
      });

      for (const sid of recipientSessionIds) {
        if (sid === attachment.sessionId) continue;
        const targetSess = this.sessionsById.get(sid);
        if (targetSess) {
          this.sendLine(targetSess.ws, targetSess.attachment, quitLine);
        }
      }
    }
  }

  public async getStats(): Promise<{
    activeConnections: number;
    registeredSessions: number;
    activeChannels: number;
    sessions: Array<{
      sessionId: string;
      nickname: string | null;
      accountName: string | null;
      hostname: string;
      connectedAt: number;
      registered: boolean;
      capabilities: string[];
    }>;
  }> {
    this.ensureSessionsLoaded();
    const activeChannels =
      this.sql
        .exec<{ cnt: number }>(
          "SELECT COUNT(DISTINCT canonical_channel) AS cnt FROM session_channels",
        )
        .toArray()[0]?.cnt ?? 0;

    const sessions = Array.from(this.sessionsById.values()).map(({ attachment: a }) => ({
      sessionId: a.sessionId,
      nickname: a.nickname,
      accountName: a.accountName,
      hostname: a.hostname,
      connectedAt: a.connectedAt,
      registered: a.registered,
      capabilities: a.capabilities,
    }));

    return {
      activeConnections: sessions.length,
      registeredSessions: sessions.filter((s) => s.registered).length,
      activeChannels,
      sessions,
    };
  }

  public async adminDisconnectSession(
    identifier: string,
    reason: string = "Disconnected by administrator",
  ): Promise<boolean> {
    this.ensureSessionsLoaded();
    let sess = this.sessionsById.get(identifier);
    if (!sess) {
      const canon = canonicalizeIRCName(identifier);
      for (const s of [...this.sessionsById.values()]) {
        if (s.attachment.nickname && canonicalizeIRCName(s.attachment.nickname) === canon) {
          sess = s;
          break;
        }
      }
    }
    if (!sess) return false;
    this.sendLine(
      sess.ws,
      sess.attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "ERROR",
        params: [`Closing Link: ${sess.attachment.hostname} (${reason})`],
      }),
    );
    await this.disconnectSession(sess.ws, sess.attachment, reason);
    return true;
  }

  public async adminBroadcast(
    text: string,
    options?: { sender?: string; isNotice?: boolean; isWallops?: boolean },
  ): Promise<{ sentCount: number }> {
    this.ensureSessionsLoaded();
    const sender = options?.sender ?? SERVER_CONFIG.serverName;
    let sentCount = 0;
    for (const sess of [...this.sessionsById.values()]) {
      if (options?.isWallops) {
        if (
          this.hasCap(sess.attachment, "draft/wallops") ||
          sess.attachment.isOper ||
          (sess.attachment.userModes ?? "").includes("w")
        ) {
          this.sendLine(
            sess.ws,
            sess.attachment,
            encodeIRCMessage({
              prefix: sender,
              command: "WALLOPS",
              params: [text],
            }),
          );
          sentCount++;
        }
      } else {
        this.sendLine(
          sess.ws,
          sess.attachment,
          encodeIRCMessage({
            prefix: sender,
            command: "NOTICE",
            params: [sess.attachment.nickname ?? "*", `*** ${text}`],
          }),
        );
        sentCount++;
      }
    }
    return { sentCount };
  }

  public async adminListSessions(): Promise<
    Array<{
      sessionId: string;
      nickname: string | null;
      username: string | null;
      hostname: string;
      realname: string | null;
      accountName: string | null;
      channels: string[];
      ip: string;
      connectedAt: number;
      secure: boolean;
      capabilities: string[];
    }>
  > {
    this.ensureSessionsLoaded();
    const list: any[] = [];
    for (const sess of [...this.sessionsById.values()]) {
      const chans = this.getSessionChannels(sess.attachment.sessionId).map((c) => c.channelName);
      list.push({
        sessionId: sess.attachment.sessionId,
        nickname: sess.attachment.nickname,
        username: sess.attachment.username,
        hostname: sess.attachment.hostname,
        realname: sess.attachment.realname,
        accountName: sess.attachment.accountName,
        channels: chans,
        ip: sess.attachment.ip ?? sess.attachment.hostname,
        connectedAt: sess.attachment.connectedAt,
        secure: sess.attachment.secure ?? false,
        capabilities: Array.from(sess.attachment.capabilities),
      });
    }
    return list;
  }

  public async removeChannelRouting(channelName: string, recipients: string[]): Promise<void> {
    const line = encodeIRCMessage({
      prefix: SERVER_CONFIG.serverName,
      command: "KICK",
      params: [channelName, "*", "Channel removed by administrator"],
    });
    for (const id of recipients) {
      const client = this.sessionsById.get(id);
      if (client)
        this.sendLine(
          client.ws,
          client.attachment,
          line.replace(" * ", ` ${client.attachment.nickname} `),
        );
    }
    this.sql.exec(
      "DELETE FROM session_channels WHERE canonical_channel = ?",
      canonicalizeIRCName(channelName),
    );
  }

  public async adminListChannels(): Promise<
    Array<{
      channelName: string;
      canonicalName: string;
      activeMemberCount: number;
    }>
  > {
    const known = this.sql
      .exec<{ canonical_channel: string; channel_name: string; generation: string | null }>(
        "SELECT canonical_channel, channel_name FROM known_channels",
      )
      .toArray();

    const activeCounts = new Map<string, number>();
    const sessionChans = this.sql
      .exec<{ canonical_channel: string; channel_name: string; generation: string | null }>(
        "SELECT canonical_channel, channel_name FROM session_channels",
      )
      .toArray();

    for (const sc of sessionChans) {
      activeCounts.set(sc.canonical_channel, (activeCounts.get(sc.canonical_channel) ?? 0) + 1);
    }

    const seenCanons = new Set<string>();
    const result: Array<{
      channelName: string;
      canonicalName: string;
      activeMemberCount: number;
    }> = [];

    for (const k of known) {
      seenCanons.add(k.canonical_channel);
      result.push({
        channelName: k.channel_name,
        canonicalName: k.canonical_channel,
        activeMemberCount: activeCounts.get(k.canonical_channel) ?? 0,
      });
    }

    for (const sc of sessionChans) {
      if (!seenCanons.has(sc.canonical_channel)) {
        seenCanons.add(sc.canonical_channel);
        result.push({
          channelName: sc.channel_name,
          canonicalName: sc.canonical_channel,
          activeMemberCount: activeCounts.get(sc.canonical_channel) ?? 0,
        });
      }
    }

    return result;
  }

  public async adminSetMetadata(
    target: string,
    key: string,
    value: string | null,
    expectedGeneration?: string,
  ): Promise<void> {
    this.ensureSessionsLoaded();
    const isChannel = target.startsWith("#") || target.startsWith("&");
    if (isChannel) {
      const chanStub = this.getChannelStub(target);
      await chanStub.setChannelMetadata(key, value, expectedGeneration);
      const members = await chanStub.getMembers();
      const cleanKey = key.toLowerCase();
      for (const m of members) {
        if (m.sessionId.startsWith("service:")) continue;
        const sess = this.sessionsById.get(m.sessionId);
        if (!sess) continue;
        if (
          !this.hasCap(sess.attachment, "draft/metadata-3") &&
          !this.hasCap(sess.attachment, "draft/metadata-2")
        ) {
          continue;
        }
        const subs = sess.attachment.metadataSubs ?? [];
        if (subs.length === 0 || subs.includes(cleanKey) || subs.includes("*")) {
          if (value) {
            this.sendNumeric(
              sess.ws,
              sess.attachment,
              Numerics.RPL_KEYVALUE,
              [target, key, "*", value],
              undefined,
              { key: cleanKey, channel: target, allowUnsubscribed: subs.length === 0 },
            );
          } else {
            this.sendNumeric(
              sess.ws,
              sess.attachment,
              Numerics.RPL_KEYNOTSET,
              [target, key, "Key is not set"],
              undefined,
              { key: cleanKey, channel: target, allowUnsubscribed: subs.length === 0 },
            );
          }
        }
      }
    } else {
      const accountsStub = this.getAccountsStub();
      await accountsStub.setMetadata(target, key, value);
      const cleanKey = key.toLowerCase();
      for (const sess of [...this.sessionsById.values()]) {
        if (
          !this.hasCap(sess.attachment, "draft/metadata-3") &&
          !this.hasCap(sess.attachment, "draft/metadata-2")
        ) {
          continue;
        }
        const subs = sess.attachment.metadataSubs ?? [];
        if (subs.length === 0 || subs.includes(cleanKey) || subs.includes("*")) {
          if (value) {
            this.sendNumeric(sess.ws, sess.attachment, Numerics.RPL_KEYVALUE, [
              target,
              key,
              "*",
              value,
            ]);
          } else {
            this.sendNumeric(sess.ws, sess.attachment, Numerics.RPL_KEYNOTSET, [
              target,
              key,
              "Key is not set",
            ]);
          }
        }
      }
    }
  }

  public async adminGetMetadata(target: string, keys?: string[]): Promise<Record<string, string>> {
    const isChannel = target.startsWith("#") || target.startsWith("&");
    if (isChannel) {
      return this.getChannelStub(target).getChannelMetadata(keys);
    }
    return this.getAccountsStub().getMetadata(target, keys);
  }

  public async refreshAccountPermissions(username: string): Promise<void> {
    this.ensureSessionsLoaded();
    const account = await this.getAccountsStub().getAccountByUsername(username);
    if (!account) {
      await this.invalidateAccountPermissions(username);
      return;
    }
    for (const { ws, attachment } of [...this.sessionsById.values()])
      if (attachment.userId === account.id) {
        const wasOper = attachment.isOper;
        attachment.roles = account.roles;
        attachment.isOper = Boolean(
          wasOper && (account.roles.includes("admin") || account.roles.includes("oper")),
        );
        this.saveAttachment(ws, attachment);
        if (wasOper && !attachment.isOper)
          this.sendLine(
            ws,
            attachment,
            encodeIRCMessage({
              prefix: this.getUserPrefix(attachment),
              command: "MODE",
              params: [attachment.nickname!, "-o"],
            }),
          );
      }
  }

  public async invalidateAccountPermissions(username: string): Promise<number> {
    this.ensureSessionsLoaded();
    const canonUser = canonicalizeIRCName(username);
    let affected = 0;
    for (const { ws, attachment } of [...this.sessionsById.values()]) {
      if (attachment.accountName && canonicalizeIRCName(attachment.accountName) === canonUser) {
        attachment.authenticated = false;
        attachment.accountName = null;
        attachment.isOper = false;
        this.saveAttachment(ws, attachment);
        // Revocation closes the actual transport independently of cross-object
        // metadata/membership reconciliation. Cleanup still runs and is idempotent.
        try {
          ws.close(1000, "Account credentials or permissions revoked");
        } catch {
          /* Already closed. */
        }
        try {
          await this.broadcastAccountChange(attachment);
        } catch {
          /* Stale generation cannot block logout. */
        } finally {
          await this.cleanupSessionState(attachment, "Account credentials or permissions revoked");
        }
        affected++;
      }
    }
    return affected;
  }

  public async verifyActiveUser(params: { nick?: string; sessionId?: string }): Promise<{
    active: boolean;
    authenticated: boolean;
    accountName: string | null;
    nickname: string | null;
  }> {
    this.ensureSessionsLoaded();
    if (params.sessionId) {
      const sess = this.sessionsById.get(params.sessionId);
      if (
        sess?.attachment.registered &&
        sess.attachment.authenticated &&
        (await this.getAccountsStub().getCredentialVersion(sess.attachment.userId)) ===
          (sess.attachment.credentialVersion ?? 0)
      ) {
        return {
          active: true,
          authenticated: Boolean(sess.attachment.authenticated),
          accountName: sess.attachment.accountName ?? null,
          nickname: sess.attachment.nickname ?? null,
        };
      }
    }
    if (params.nick) {
      const matches = this.getAllSessionsForNick(params.nick);
      if (matches.length > 0 && matches[0].attachment.registered) {
        const a = matches[0].attachment;
        return {
          active: true,
          authenticated: Boolean(a.authenticated),
          accountName: a.accountName ?? null,
          nickname: a.nickname ?? null,
        };
      }
    }
    return {
      active: false,
      authenticated: false,
      accountName: null,
      nickname: null,
    };
  }

  public async clientDirectMessages(
    token: string,
    user: string,
    target: string,
    limit: number,
    before?: string,
    after?: string,
  ): Promise<any> {
    const actor = await this.features.actor({ token }, "conversation.read", "*");
    const [first, second] = await Promise.all([
      this.features.account(user),
      this.features.account(target),
    ]);
    if (!first || !second || ![first.id, second.id].includes(actor.id))
      throw new FeatureError(403, "CONVERSATION_FORBIDDEN", "Conversation access denied");
    return this.getPaginatedDirectMessages(user, target, limit, before, after);
  }

  public async getPaginatedDirectMessages(
    user1: string,
    user2: string,
    limit = 50,
    before?: string,
    after?: string,
  ): Promise<{
    messages: any[];
    pagination: {
      count: number;
      limit: number;
      has_more: boolean;
      oldest_id: string | null;
      newest_id: string | null;
    };
  }> {
    const accounts = this.getAccountsStub();
    const [first, second] = await Promise.all([
      accounts.resolveConversationAccount(user1),
      accounts.resolveConversationAccount(user2),
    ]);
    const pair = this.getCanonicalDmPair(first?.id ?? "missing", second?.id ?? "missing");
    let sql =
      "SELECT * FROM direct_messages WHERE peer_pair = ? AND redacted = 0 AND COALESCE(expires_at, created_at + ?) > ?";
    const bindings: (string | number)[] = [pair, SERVER_CONFIG.retentionMs, Date.now()];
    for (const [reference, operator] of [
      [before, "<"],
      [after, ">"],
    ] as const) {
      if (!reference) continue;
      const row = this.sql
        .exec<{ sequence: number }>(
          "SELECT sequence FROM direct_messages WHERE id = ? AND peer_pair = ?",
          reference,
          pair,
        )
        .toArray()[0];
      if (row) {
        sql += ` AND sequence ${operator} ?`;
        bindings.push(row.sequence);
      } else {
        const timestamp = /^\d+$/.test(reference) ? Number(reference) : Date.parse(reference);
        if (!Number.isFinite(timestamp))
          return {
            messages: [],
            pagination: { count: 0, limit, has_more: false, oldest_id: null, newest_id: null },
          };
        sql += ` AND created_at ${operator} ?`;
        bindings.push(timestamp);
      }
    }
    const effectiveLimit = Math.min(Math.max(limit, 1), 100);
    sql += " ORDER BY sequence DESC LIMIT ?";
    bindings.push(effectiveLimit + 1);
    const rows = this.sql.exec<any>(sql, ...bindings).toArray();
    const messages = rows.slice(0, effectiveLimit).map((r) => ({
      id: r.id,
      sequence: r.sequence,
      senderId: r.sender_id,
      senderAccount: r.sender_account,
      senderNick: r.sender_nick,
      targetNick: r.target_nick,
      command: r.command,
      content: r.content,
      tags: r.tags_json ? JSON.parse(r.tags_json) : undefined,
      multilineLines: r.multiline_json ? JSON.parse(r.multiline_json) : undefined,
      redacted: Boolean(r.redacted),
      createdAt: r.created_at,
    }));

    return {
      messages,
      pagination: {
        count: messages.length,
        limit: effectiveLimit,
        has_more: rows.length > effectiveLimit,
        oldest_id: messages.length > 0 ? messages[messages.length - 1].id : null,
        newest_id: messages.length > 0 ? messages[0].id : null,
      },
    };
  }
}
