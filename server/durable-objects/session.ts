import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { decodeSaslPlain } from "../core/authentication/passwords";
import {
  base64ToUint8Array,
  hmacSha256,
  parseClientFinalMessage,
  parseClientFirstMessage,
  sha256,
  uint8ArrayToBase64,
  xorBytes,
} from "../core/authentication/scram";
import { applyEnvConfig, SERVER_CONFIG } from "../core/config";
import { IRCProtocolError } from "../core/errors";
import { domainEvents } from "../core/events/emitter";
import {
  formatMemberPrefix,
  hasChannelOp,
  matchesWildcard,
} from "../core/permissions/authorization";
import { SlidingWindowRateLimiter } from "../core/permissions/rate-limits";
import {
  isValidChannelName,
  isValidNickname,
  isValidUsername,
} from "../core/permissions/validation";
import type {
  ChannelMemberInfo,
  ChannelStateSummary,
  Env,
  SessionAttachment,
  StoredChannelMessage,
  Subprotocol,
} from "../core/types";
import { formatCapabilitiesList, isSupportedCapability } from "../protocol/irc/capabilities";
import { handleJoin } from "../protocol/irc/commands/channel";
import { dispatchIRCCommand } from "../protocol/irc/commands/dispatcher";
import type { ISessionDO, PendingMultilineBatch } from "../protocol/irc/commands/types";
import { encodeIRCMessage, encodeNumeric, encodeWebSocketFrame } from "../protocol/irc/encoder";
import { parseSearchCommand } from "../protocol/irc/extensions/search";
import { Numerics } from "../protocol/irc/numerics";
import { canonicalizeIRCName, decodeWebSocketFrame, parseIRCMessage } from "../protocol/irc/parser";
import type { IRCMessage } from "../protocol/irc/types";
import { initializeSessionSchema } from "../storage/migrations/init";
import * as sessionSchema from "../storage/schemas/session";

function truncateUtf8(str: string, maxBytes: number): string {
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

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        "PING :keepalive",
        `:${SERVER_CONFIG.serverName} PONG ${SERVER_CONFIG.serverName} :keepalive`,
      ),
    );

    this.reconstructStateFromHibernation();
  }

  private ensureSessionsLoaded(): void {
    const sockets = this.ctx.getWebSockets();
    this.sessionsById.clear();
    this.sessionsByNick.clear();
    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as SessionAttachment | null;
      if (!attachment || !attachment.sessionId) continue;
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
      if (!attachment || !attachment.sessionId) {
        continue;
      }
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

  public getAllSessionsForNick(nickname: string): Array<{
    ws: WebSocket;
    attachment: SessionAttachment;
  }> {
    const canon = canonicalizeIRCName(nickname);
    const out: Array<{ ws: WebSocket; attachment: SessionAttachment }> = [];
    for (const entry of this.sessionsById.values()) {
      if (entry.attachment.nickname && canonicalizeIRCName(entry.attachment.nickname) === canon) {
        out.push(entry);
      }
    }
    return out;
  }

  public async broadcastRealtimeEvent(event: any): Promise<void> {
    const sockets = this.ctx.getWebSockets("events");
    const payload = JSON.stringify(event);
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // socket may be closed
      }
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

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    if (url.pathname === "/api/v1/events") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, ["events"]);
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
    const clientIp =
      url.searchParams.get("ip") ??
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      url.searchParams.get("host") ??
      "irc.client";

    const attachment: SessionAttachment = {
      sessionId,
      userId: `guest:${sessionId}`,
      isDirectWebSocket: url.searchParams.get("tcp") !== "1",
      accountName: null,
      nickname: null,
      username: null,
      realname: null,
      hostname: clientIp,
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
    if (!attachment) {
      ws.close(1008, "Missing session state");
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

        const isSaslNegotiating = Boolean(currentAttachment.saslMechanism);
        if (!isSaslNegotiating && !this.commandRateLimiter.check(currentAttachment.sessionId)) {
          this.sendLine(
            ws,
            currentAttachment,
            encodeIRCMessage({
              prefix: SERVER_CONFIG.serverName,
              command: "ERROR",
              params: ["Closing Link: Excess Flood"],
            }),
          );
          await this.disconnectSession(ws, currentAttachment, "Excess Flood");
          return;
        }

        for (const rawLine of lines) {
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

          await this.handleIRCCommand(ws, currentAttachment, parsed);
        }
      })
      .catch((err) => {
        console.error("Error processing IRC command:", err);
      });

    this.sessionMessageQueues.set(attachment.sessionId, currentTask);
    await currentTask;
  }

  public async webSocketClose(
    ws: WebSocket,
    _code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (attachment) {
      console.log(
        `[FlaRC SessionDO] Client disconnected: ${attachment.nickname ?? "unregistered"} (session:${attachment.sessionId.slice(0, 8)}, reason: ${reason || "Client closed socket"})`,
      );
      await this.cleanupSessionState(attachment, reason || "Client disconnected");
    }
  }

  public async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as SessionAttachment | null;
    if (attachment) {
      console.log(
        `[FlaRC SessionDO] Client socket error: ${attachment.nickname ?? "unregistered"} (session:${attachment.sessionId.slice(0, 8)}, error: ${String(error)})`,
      );
      await this.cleanupSessionState(attachment, "Connection error");
    }
  }

  public sendLine(ws: WebSocket, attachment: SessionAttachment, line: string): void {
    try {
      const frame = encodeWebSocketFrame(line, attachment.subprotocol);
      ws.send(frame);
    } catch {
      // Socket may have closed concurrently
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
        attachment.accountName = res.account.username;
        attachment.roles = res.account.roles;
        attachment.isOper =
          res.account.roles.includes("oper") || res.account.roles.includes("admin");
      } else {
        this.sendNumeric(ws, attachment, Numerics.ERR_PASSWDMISMATCH, ["Password incorrect"]);
        return;
      }
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

  public async invalidateAccountPermissions(username: string): Promise<number> {
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
      if (sess && sess.attachment.registered) {
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
    const pair = this.getCanonicalDmPair(user1, user2);
    let sql = "SELECT * FROM direct_messages WHERE peer_pair = ?";
    const bindings: (string | number)[] = [pair];

    if (before) {
      const bRow = this.sql
        .exec<{ created_at: number }>("SELECT created_at FROM direct_messages WHERE id = ?", before)
        .toArray()[0];
      const bTs = bRow?.created_at ?? Number(before) ?? Date.parse(before);
      if (bTs && !Number.isNaN(bTs)) {
        sql += " AND created_at < ?";
        bindings.push(bTs);
      }
    }
    if (after) {
      const aRow = this.sql
        .exec<{ created_at: number }>("SELECT created_at FROM direct_messages WHERE id = ?", after)
        .toArray()[0];
      const aTs = aRow?.created_at ?? Number(after) ?? Date.parse(after);
      if (aTs && !Number.isNaN(aTs)) {
        sql += " AND created_at > ?";
        bindings.push(aTs);
      }
    }

    const effectiveLimit = Math.min(Math.max(limit, 1), 100);
    sql += " ORDER BY created_at DESC LIMIT ?";
    bindings.push(effectiveLimit);

    const rows = this.sql.exec<any>(sql, ...bindings).toArray();
    const messages = rows.map((r) => ({
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
        has_more: messages.length >= effectiveLimit,
        oldest_id: messages.length > 0 ? messages[messages.length - 1].id : null,
        newest_id: messages.length > 0 ? messages[0].id : null,
      },
    };
  }
}
