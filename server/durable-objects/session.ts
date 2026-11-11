import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { hashSessionToken } from "../core/authentication/tokens";
import { applyEnvConfig, SERVER_CONFIG } from "../core/config";
import { IRCProtocolError } from "../core/errors";
import { SlidingWindowRateLimiter } from "../core/permissions/rate-limits";
import { isValidChannelName } from "../core/permissions/validation";
import type { Env, SessionAttachment, StoredChannelMessage, Subprotocol } from "../core/types";
import { handleJoin } from "../protocol/irc/commands/channel";
import { dispatchIRCCommand } from "../protocol/irc/commands/dispatcher";
import type { ISessionDO, PendingMultilineBatch } from "../protocol/irc/commands/types";
import { encodeIRCMessage, encodeNumeric, encodeWebSocketFrame } from "../protocol/irc/encoder";
import { Numerics } from "../protocol/irc/numerics";
import { canonicalizeIRCName, decodeWebSocketFrame, parseIRCMessage } from "../protocol/irc/parser";
import type { IRCMessage } from "../protocol/irc/types";
import { initializeSessionSchema } from "../storage/migrations/init";
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
      frames: Array<{ line: string; userId: string; accountName: string; version: number }>;
      bytes: number;
    }
  >();
  private outboundBytes = 0;
  public saslBuffersBySession = new Map<string, string>();
  public maxLocalUsers = 0;
  public maxGlobalUsers = 0;

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
    this.reconstructStateFromHibernation();
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
    ws.serializeAttachment(attachment);
    this.sessionsById.set(attachment.sessionId, { ws, attachment });
  }

  private acceptSessionAttachment(ws: WebSocket, attachment: SessionAttachment): boolean {
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

  public getSessionChannels(
    sessionId: string,
  ): Array<{ canonicalChannel: string; channelName: string }> {
    const rows = this.sql
      .exec<{ canonical_channel: string; channel_name: string }>(
        "SELECT canonical_channel, channel_name FROM session_channels WHERE session_id = ?",
        sessionId,
      )
      .toArray();
    return rows.map((r) => ({
      canonicalChannel: r.canonical_channel,
      channelName: r.channel_name,
    }));
  }

  public async adminRequest(token: string, operation: string, args: unknown[]): Promise<unknown> {
    const actor = await this.env.ACCOUNTS.get(
      this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).verifyApiSession(token);
    if (!actor?.roles.includes("admin")) throw new Error("Administrator authorization required");
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
    const method = (this as unknown as Record<string, (...values: unknown[]) => unknown>)[
      operation
    ];
    return method.apply(this, args);
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
      (account.credentialVersion ?? 0) !== (attachment.credentialVersion ?? 0)
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
    for (const entry of this.sessionsById.values()) {
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

  public async broadcastRealtimeEvent(event: any): Promise<void> {
    if (typeof event.channelId !== "string" || !isValidChannelName(event.channelId)) return;
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets("events")) {
      const auth = ws.deserializeAttachment() as { eventSessionHash?: string } | null;
      if (!auth?.eventSessionHash) continue;
      const account = await this.getAccountsStub().verifySessionHash(auth.eventSessionHash);
      if (!account) {
        ws.close(1008, "Session expired");
        continue;
      }
      if (
        !(await this.getChannelStub(event.channelId).canReadAccount({
          ...account,
          isAdmin: account.roles.includes("admin"),
        }))
      )
        continue;
      try {
        ws.send(payload);
      } catch {
        /* Closed socket */
      }
    }
  }

  public async deliverApiMessage(
    channelName: string,
    message: StoredChannelMessage,
    recipients: string[],
  ): Promise<void> {
    for (const id of recipients) {
      const client = this.sessionsById.get(id);
      if (!client) continue;
      this.sendLine(
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
      );
    }
  }

  public async broadcastLineToChannel(channelName: string, line: string): Promise<void> {
    const canon = canonicalizeIRCName(channelName);
    const sessions = this.sql
      .exec<{ session_id: string }>(
        "SELECT session_id FROM session_channels WHERE canonical_channel = ?",
        canon,
      )
      .toArray();
    for (const row of sessions) {
      const sess = this.sessionsById.get(row.session_id);
      if (sess) {
        this.sendLine(sess.ws, sess.attachment, line);
      }
    }
  }

  public async alarm(): Promise<void> {
    this.ensureSessionsLoaded();
    let next: number | null = null;
    for (const { ws, attachment } of this.sessionsById.values()) {
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
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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

    if (url.pathname === "/api/v1/events") {
      const peerIp = request.headers.get("CF-Connecting-IP") ?? "local";
      if (!(await this.getAccountsStub().checkRequestLimit(`event-handshake:${peerIp}`, 30)))
        return new Response("Handshake limit reached", { status: 429 });
      const bearer = request.headers.get("Authorization");
      const ticket = url.searchParams.get("ticket");
      const accounts = this.getAccountsStub();
      const sessionHash = ticket
        ? await accounts.consumeEventTicket(ticket)
        : bearer?.startsWith("Bearer ") && (await accounts.verifyApiSession(bearer.slice(7)))
          ? await hashSessionToken(bearer.slice(7))
          : null;
      if (!sessionHash || !(await accounts.verifySessionHash(sessionHash)))
        return new Response("A logged-in API session is required", { status: 401 });
      const eventAccount = await accounts.verifySessionHash(sessionHash);
      const subscriptions = this.ctx
        .getWebSockets("events")
        .filter((socket) => socket.deserializeAttachment()?.accountId === eventAccount?.id);
      if (subscriptions.length >= 5)
        return new Response("Subscription limit reached", { status: 429 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, ["events"]);
      server.serializeAttachment({ eventSessionHash: sessionHash, accountId: eventAccount!.id });
      console.log(
        `[FlaRC SessionDO] Real-time events subscriber connected [IP: ${request.headers.get("CF-Connecting-IP") ?? "127.0.0.1"}]`,
      );
      return new Response(null, { status: 101, webSocket: client } as any);
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
      this.env.WEBIRC_PASSWORD &&
        request.headers.get("x-gateway-token") === this.env.WEBIRC_PASSWORD,
    );
    const clientIp = trustedGateway
      ? (url.searchParams.get("ip") ?? "irc.client")
      : (request.headers.get("CF-Connecting-IP") ?? "irc.client");

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
    this.saveAttachment(server, attachment);
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > Date.now() + 60_000)
      await this.ctx.storage.setAlarm(Date.now() + 60_000);

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
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (!attachment?.sessionId) {
      ws.close(1008, "This socket does not accept IRC commands");
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
        // If session was already disconnected/cleaned up, ignore further queued messages
        if (!this.sessionsById.has(attachment.sessionId)) {
          return;
        }

        // Re-read latest attachment state in case earlier queued commands modified it
        const currentAttachment =
          (ws.deserializeAttachment() as SessionAttachment | null) ?? attachment;
        this.sessionsById.set(currentAttachment.sessionId, { ws, attachment: currentAttachment });

        for (const rawLine of lines) {
          if (!this.commandRateLimiter.check(currentAttachment.sessionId)) {
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

          try {
            await this.handleIRCCommand(ws, currentAttachment, parsed);
          } catch (error) {
            if (error instanceof IRCProtocolError && error.numeric) {
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
    _code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (attachment?.sessionId) {
      console.log(
        `[FlaRC SessionDO] Client disconnected: ${attachment.nickname ?? "unregistered"} (session:${attachment.sessionId.slice(0, 8)}, reason: ${reason || "Client closed socket"})`,
      );
      await this.cleanupSessionState(attachment, reason || "Client disconnected");
    }
  }

  public async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (attachment?.sessionId) {
      console.log(
        `[FlaRC SessionDO] Client socket error: ${attachment.nickname ?? "unregistered"} (session:${attachment.sessionId.slice(0, 8)}, error: ${String(error)})`,
      );
      await this.cleanupSessionState(attachment, "Connection error");
    }
  }

  public sendLine(ws: WebSocket, attachment: SessionAttachment, line: string): void {
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
      });
      queue.bytes += bytes;
      this.outboundBytes += bytes;
      if (start) this.ctx.waitUntil(this.flushOutbound(ws, queue));
      return;
    }
    try {
      const frame = encodeWebSocketFrame(line, attachment.subprotocol);
      ws.send(frame);
    } catch {
      // Socket may have closed concurrently
    }
  }

  private async flushOutbound(
    ws: WebSocket,
    queue: {
      frames: Array<{ line: string; userId: string; accountName: string; version: number }>;
      bytes: number;
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
          account.credentialVersion !== current.credentialVersion
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
        for (const channel of new Set(channels.values())) {
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
          const channel = channels.get(frame.line);
          if (channel && !readable.get(channel)) continue;
          ws.send(encodeWebSocketFrame(frame.line, latest.subprotocol));
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
    }
  }

  public sendNumeric(
    ws: WebSocket,
    attachment: SessionAttachment,
    numeric: string,
    params: string[],
    tags?: Record<string, string | true>,
  ): void {
    const target = attachment.nickname ?? "*";
    const line = encodeNumeric(numeric, target, params, this.filterOutgoingTags(attachment, tags));
    this.sendLine(ws, attachment, line);
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

  public getUserPrefix(attachment: SessionAttachment): string {
    const nick = attachment.nickname ?? "*";
    const user = attachment.username ?? "user";
    const host = attachment.hostname || "irc.client";
    return `${nick}!${user}@${host}`;
  }

  public storeDirectMessage(params: {
    sender: SessionAttachment;
    target: SessionAttachment;
    messageId: string;
    command: "PRIVMSG" | "NOTICE" | "TAGMSG";
    content: string;
    tags?: Record<string, string | true>;
    multilineLines?: Array<{ content: string; concat: boolean }>;
    displayNick?: string;
  }): StoredChannelMessage {
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
    const pair = this.getCanonicalDmPair(sender.userId, target.userId);
    const now = Date.now();
    const tags = { ...params.tags };
    delete tags["+role"];
    delete tags["+badge"];
    tags["+role"] =
      sender.roles?.includes("admin") || sender.roles?.includes("oper")
        ? "admin"
        : (sender.roles?.[0] ?? "member");
    tags["+badge"] = tags["+role"];
    const editId = tags["+ircord/edit"] ?? tags["+draft/edit"] ?? tags["+edit"];
    let root: string | null = null;
    let expiresAt = now + SERVER_CONFIG.retentionMs;
    let originalTags: Record<string, string | true> = {};
    if (typeof editId === "string") {
      const original = this.sql
        .exec<{
          sender_id: string;
          peer_pair: string;
          redacted: number;
          created_at: number;
          tags_json: string;
        }>(
          "SELECT sender_id, peer_pair, redacted, created_at, tags_json FROM direct_messages WHERE id = ?",
          editId,
        )
        .toArray()[0];
      if (
        !original ||
        original.sender_id !== sender.userId ||
        original.peer_pair !== pair ||
        original.redacted ||
        original.created_at <= now - SERVER_CONFIG.retentionMs
      )
        throw new IRCProtocolError(
          "You can only edit your own messages in this conversation",
          Numerics.ERR_CANNOTSENDTOCHAN,
        );
      root =
        this.sql
          .exec<{ root_id: string }>(
            "SELECT root_id FROM direct_message_edits WHERE message_id = ?",
            editId,
          )
          .toArray()[0]?.root_id ?? editId;
      const rootRow = this.sql
        .exec<{ created_at: number }>("SELECT created_at FROM direct_messages WHERE id = ?", root)
        .toArray()[0];
      expiresAt = (rootRow?.created_at ?? original.created_at) + SERVER_CONFIG.retentionMs;
      if (expiresAt <= now)
        throw new IRCProtocolError("Message has expired", Numerics.ERR_CANNOTSENDTOCHAN);
      originalTags = JSON.parse(original.tags_json || "{}");
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO direct_messages (id, peer_pair, sender_id, sender_account, sender_nick, sender_user, sender_host, target_nick, target_account, target_id, command, content, tags_json, multiline_json, redacted, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        params.messageId,
        pair,
        sender.userId,
        sender.accountName,
        params.displayNick ?? sender.nickname!,
        sender.username!,
        sender.hostname,
        target.nickname!,
        target.accountName,
        target.userId,
        params.command,
        params.content,
        JSON.stringify(tags),
        params.multilineLines ? JSON.stringify(params.multilineLines) : null,
        now,
        expiresAt,
      );
      if (root && typeof editId === "string") {
        this.sql.exec(
          "INSERT INTO direct_message_edits (message_id, root_id) VALUES (?, ?)",
          params.messageId,
          root,
        );
        this.sql.exec(
          "UPDATE direct_messages SET content = ?, tags_json = ?, multiline_json = NULL WHERE id = ?",
          params.content,
          JSON.stringify({ ...originalTags, ...tags, edited_at: new Date(now).toISOString() }),
          editId,
        );
      }
    });
    return {
      id: params.messageId,
      sequence: 0,
      senderId: sender.userId,
      senderAccount: sender.accountName,
      senderNick: params.displayNick ?? sender.nickname!,
      senderUser: sender.username!,
      senderHost: sender.hostname,
      command: params.command,
      content: params.content,
      tags,
      multilineLines: params.multilineLines,
      createdAt: now,
      expiresAt,
    };
  }

  public redactDirectMessage(messageId: string, authorId: string): boolean {
    const message = this.sql
      .exec<{ sender_id: string }>("SELECT sender_id FROM direct_messages WHERE id = ?", messageId)
      .toArray()[0];
    if (!message || message.sender_id !== authorId) return false;
    const root =
      this.sql
        .exec<{ root_id: string }>(
          "SELECT root_id FROM direct_message_edits WHERE message_id = ?",
          messageId,
        )
        .toArray()[0]?.root_id ?? messageId;
    this.sql.exec(
      "UPDATE direct_messages SET redacted = 1, content = '', tags_json = '{}', multiline_json = NULL WHERE id = ? OR id IN (SELECT message_id FROM direct_message_edits WHERE root_id = ?)",
      root,
      root,
    );
    return true;
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
      const res = await accountsStub.verifyCredentials(authUser, authPass);
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
        await accountsStub.setMetadata(metaKey, k, v || null);
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
        await handleJoin(this, ws, attachment, {
          tags: {},
          prefix: null,
          command: "JOIN",
          params: [ch.channelName],
        });
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
          await handleJoin(this, ws, attachment, {
            tags: {},
            prefix: null,
            command: "JOIN",
            params: [names, keys],
          });
        }
      }
    }
  }

  public sendLusers(ws: WebSocket, attachment: SessionAttachment): void {
    let registeredCount = 0;
    let unknownCount = 0;
    let operCount = 0;
    let invisibleCount = 0;

    for (const { attachment: a } of this.sessionsById.values()) {
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
      await stub.part(attachment.sessionId);
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
    await this.cleanupSessionState(attachment, reason);
    try {
      ws.close(1000, reason);
    } catch {
      // Ignore if already closed
    }
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
            await stub.part(attachment.sessionId);
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
        const res = await stub.part(attachment.sessionId, attachment.userId);
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
      for (const s of this.sessionsById.values()) {
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
    for (const sess of this.sessionsById.values()) {
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
    for (const sess of this.sessionsById.values()) {
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
      .exec<{ canonical_channel: string; channel_name: string }>(
        "SELECT canonical_channel, channel_name FROM known_channels",
      )
      .toArray();

    const activeCounts = new Map<string, number>();
    const sessionChans = this.sql
      .exec<{ canonical_channel: string; channel_name: string }>(
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

  public async adminSetMetadata(target: string, key: string, value: string | null): Promise<void> {
    this.ensureSessionsLoaded();
    const isChannel = target.startsWith("#") || target.startsWith("&");
    if (isChannel) {
      const chanStub = this.getChannelStub(target);
      await chanStub.setChannelMetadata(key, value);
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
    } else {
      const accountsStub = this.getAccountsStub();
      await accountsStub.setMetadata(target, key, value);
      const cleanKey = key.toLowerCase();
      for (const sess of this.sessionsById.values()) {
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
    for (const { ws, attachment } of this.sessionsById.values())
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
    for (const { ws, attachment } of this.sessionsById.values()) {
      if (attachment.accountName && canonicalizeIRCName(attachment.accountName) === canonUser) {
        attachment.authenticated = false;
        attachment.accountName = null;
        attachment.isOper = false;
        this.saveAttachment(ws, attachment);
        await this.broadcastAccountChange(attachment);
        this.saveAttachment(ws, attachment);
        await this.disconnectSession(ws, attachment, "Account credentials or permissions revoked");
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
    const actor = await this.getAccountsStub().verifyApiSession(token);
    if (
      !actor ||
      ![user, target].some(
        (name) => canonicalizeIRCName(name) === canonicalizeIRCName(actor.username),
      )
    )
      throw new Error("Conversation access denied");
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
