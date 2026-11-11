import { DurableObject } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { applyEnvConfig, SERVER_CONFIG } from "../core/config";
import { domainEvents } from "../core/events/emitter";
import {
  hasChannelFounder,
  hasChannelOp,
  hasChannelVoiceOrOp,
  isMuteExtban,
  matchesBanMask,
} from "../core/permissions/authorization";
import { isValidChannelName } from "../core/permissions/validation";
import type {
  ChannelInfo,
  ChannelMemberInfo,
  ChannelStateSummary,
  Env,
  StoredChannelMessage,
} from "../core/types";
import { encodeIRCMessage } from "../protocol/irc/encoder";
import { canEditMessage, extractEditTag } from "../protocol/irc/extensions/ircord-edit";
import { Numerics } from "../protocol/irc/numerics";
import { canonicalizeIRCName } from "../protocol/irc/parser";
import { allowedOutboundUrl } from "../services/outbound";
import { initializeChannelSchema } from "../storage/migrations/init";
import * as channelsSchema from "../storage/schemas/channels";

export interface JoinChannelResult {
  ok: boolean;
  numeric?: string;
  errorText?: string;
  forwardChannel?: string;
  channelName: string;
  topic: string | null;
  topicSetBy: string | null;
  topicSetAt: number | null;
  modes: string;
  createdAt: number;
  members: ChannelMemberInfo[];
  memberModes: string;
  isReattach?: boolean;
  fBotWelcome?: string | null;
}

export interface SendMessageResult {
  ok: boolean;
  numeric?: string;
  errorText?: string;
  message?: StoredChannelMessage;
  recipientSessionIds?: string[];
}

export class ChannelDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private db: ReturnType<typeof drizzle<typeof channelsSchema>>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    applyEnvConfig(env);
    this.sql = ctx.storage.sql;
    initializeChannelSchema(this.sql);
    this.db = drizzle(ctx.storage, { schema: channelsSchema });
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS webhook_limits (hook_id TEXT PRIMARY KEY REFERENCES channel_webhooks(id) ON DELETE CASCADE, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)",
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS message_edits (message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, root_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_message_edit_root ON message_edits(root_id);`,
    );
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(channel_invites)")
        .toArray()
        .some((c) => c.name === "target_user_id")
    )
      this.sql.exec("ALTER TABLE channel_invites ADD COLUMN target_user_id TEXT");
    this.sql.exec(`CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages WHEN new.redacted = 0 BEGIN
      INSERT INTO messages_fts (message_id, sender_nick, content) VALUES (new.id, new.sender_nick, new.content); END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
      INSERT INTO messages_fts (message_id, sender_nick, content) SELECT new.id, new.sender_nick, new.content WHERE new.redacted = 0; END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id; END;`);
    if (this.getMeta("fts_integrity_version") !== "1") {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM messages_fts");
        this.sql.exec(
          "INSERT INTO messages_fts (message_id, sender_nick, content) SELECT id, sender_nick, content FROM messages WHERE redacted = 0",
        );
        this.setMeta("fts_integrity_version", "1");
      });
    }
  }

  public clientHistory(
    limit = 50,
    before?: string,
    after?: string,
    around?: string,
  ): StoredChannelMessage[] {
    const maximum = Math.min(Math.max(limit, 1), 100) + 1;
    const clauses = ["redacted = 0", "expires_at > ?"];
    const bindings: (string | number)[] = [Date.now()];
    for (const [reference, operator] of [
      [before, "<"],
      [after, ">"],
    ] as const) {
      if (!reference) continue;
      const row = this.sql
        .exec<{ sequence: number }>("SELECT sequence FROM messages WHERE id = ?", reference)
        .toArray()[0];
      if (row) {
        clauses.push(`sequence ${operator} ?`);
        bindings.push(row.sequence);
      } else {
        const time = /^\d+$/.test(reference) ? Number(reference) : Date.parse(reference);
        if (!Number.isFinite(time)) return [];
        clauses.push(`created_at ${operator} ?`);
        bindings.push(time);
      }
    }
    if (around) {
      const row = this.sql
        .exec<{ sequence: number }>("SELECT sequence FROM messages WHERE id = ?", around)
        .toArray()[0];
      if (!row) return [];
      return this.sql
        .exec<any>(
          "SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? ORDER BY ABS(sequence - ?), sequence DESC LIMIT ?",
          Date.now(),
          row.sequence,
          maximum,
        )
        .toArray()
        .sort((a, b) => b.sequence - a.sequence)
        .map((r) => this.rowToStoredMessage(r));
    }
    return this.sql
      .exec<any>(
        `SELECT * FROM messages WHERE ${clauses.join(" AND ")} ORDER BY sequence DESC LIMIT ?`,
        ...bindings,
        maximum,
      )
      .toArray()
      .map((r) => this.rowToStoredMessage(r));
  }

  /** The only client-facing domain facade. Identity and privilege come from AccountsDO, never input fields. */
  public async adminRequest(token: string, operation: string, args: unknown[]): Promise<unknown> {
    const actor = await this.env.ACCOUNTS.get(
      this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).verifyApiSession(token);
    if (!actor?.roles.includes("admin")) throw new Error("Administrator authorization required");
    const allowed = new Set<string>([
      "adminDestroyChannel",
      "adminKickMember",
      "adminRedactMessage",
      "adminRegister",
      "adminSetTopic",
      "adminUnregister",
      "getBotConfig",
      "getChannelFullDetails",
      "getChannelInfo",
      "getMessagesForAdmin",
      "handleModeCommand",
      "purgeMessages",
      "setBotConfig",
      "setChannelInfo",
    ]);
    if (!allowed.has(operation)) throw new Error("Unknown administrative operation");
    const method = (this as unknown as Record<string, (...values: unknown[]) => unknown>)[
      operation
    ];
    return method.apply(this, args);
  }

  public async clientRequest(token: string, operation: string, input: any = {}): Promise<any> {
    const account = await this.env.ACCOUNTS.get(
      this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).verifyApiSession(token);
    if (!account) throw new Error("Authentication required");
    this.ensureInitialized(input.channelName);
    const actor = { ...account, isAdmin: account.roles.includes("admin") };
    if (!(await this.canReadAccount(actor))) throw new Error("Channel access denied");
    const member = await this.getAccountMember(actor.id);
    const roleOperation = [
      "role.create",
      "role.update",
      "role.delete",
      "role.assign",
      "role.remove",
    ].includes(operation);
    const manageOperation =
      roleOperation ||
      [
        "info.update",
        "webhook.create",
        "webhook.delete",
        "webhook.list",
        "outgoing.create",
        "outgoing.delete",
        "outgoing.list",
      ].includes(operation);
    if (manageOperation && !(await this.canManageAccount(actor)))
      throw new Error("Channel management denied");
    if (
      roleOperation &&
      !actor.isAdmin &&
      !this.sql
        .exec(
          "SELECT user_id FROM channel_permissions WHERE user_id = ? AND permission = 'q'",
          actor.id,
        )
        .toArray().length
    )
      throw new Error("Only the founder can manage roles");
    switch (operation) {
      case "info":
        return this.getChannelInfo();
      case "history":
        return this.clientHistory(input.limit, input.before, input.after, input.around);
      case "search":
        return this.searchMessages(input.query, input.options);
      case "unread":
        if (canonicalizeIRCName(input.username) !== canonicalizeIRCName(actor.username))
          throw new Error("Account access denied");
        return this.getUnreadSummary(actor.username, input.lastReadMs);
      case "roles":
        return this.getRoleGroups();
      case "info.update":
        return this.setChannelInfo(input.updates, undefined, actor.username);
      case "role.create":
        return this.createRoleGroup(input.group);
      case "role.update":
        return this.updateRoleGroup(input.id, input.updates);
      case "role.delete":
        return this.deleteRoleGroup(input.id);
      case "role.assign": {
        const exists = await this.env.ACCOUNTS.get(
          this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
        ).accountIdExists(input.userId);
        if (!exists) throw new Error("Unknown role target");
        if (
          !this.sql
            .exec("SELECT id FROM channel_role_groups WHERE id = ?", input.roleGroupId)
            .toArray().length
        )
          throw new Error("Unknown role group");
        return this.assignUserRole(input.userId, input.roleGroupId);
      }
      case "role.remove":
        return this.removeUserRole(input.userId, input.roleGroupId);
      case "webhook.create":
        return this.createWebhook(input.name, actor.username, input.avatar);
      case "webhook.delete":
        return this.deleteWebhook(input.id);
      case "webhook.list":
        return this.getWebhooks();
      case "outgoing.create":
        if (
          !allowedOutboundUrl(input.url, (this.env.OUTGOING_WEBHOOK_ALLOWED_HOSTS ?? "").split(","))
        )
          throw new Error("Destination denied");
        return this.createOutgoingWebhook(input.url, input.secret, input.events);
      case "outgoing.delete":
        return this.deleteOutgoingWebhook(input.id);
      case "outgoing.list":
        return this.getOutgoingWebhooks();
      case "send": {
        let messageId: string | undefined;
        if (input.idempotencyKey) {
          const key = `${this.ctx.id}:${actor.id}:${input.idempotencyKey}`;
          const hash = new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
          );
          const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
          messageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
        }
        if (!member) throw new Error("Channel membership required");
        return this.appendMessage({
          messageId,
          sessionId: member.sessionId,
          userId: actor.id,
          accountName: actor.username,
          nickname: member.nickname,
          username: member.username,
          hostname: member.hostname,
          command: "PRIVMSG",
          content: input.content,
          tags: input.tags,
          isOper: false,
        });
      }
      case "edit":
        if (!member) throw new Error("Channel membership required");
        return this.editMessage(input.id, actor.id, input.content);
      case "redact":
        return this.redactMessage({
          actorSessionId: member?.sessionId ?? "api",
          actorUserId: actor.id,
          actorAccount: actor.username,
          actorNick: member?.nickname ?? actor.username,
          targetMsgId: input.id,
          isOper: actor.isAdmin,
        });
      default:
        throw new Error("Unknown client operation");
    }
  }

  private async emitChannelEvent(
    type: string,
    data: Record<string, any>,
    messageId?: string,
  ): Promise<void> {
    const channelId = this.getMeta("name");
    if (!channelId) return;
    const event = {
      type,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      channelId,
      messageId,
      data,
    };
    // A committed message remains committed if a live subscriber disconnects. History is the recovery source.
    this.ctx.waitUntil(
      this.env.SESSION.get(
        this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
      ).broadcastRealtimeEvent(event),
    );
  }

  private hasCustomPermission(userId: string, permission: string): boolean {
    return this.sql
      .exec<{ permissions_json: string }>(
        "SELECT g.permissions_json FROM channel_role_groups g JOIN channel_user_roles r ON r.group_id = g.id WHERE r.user_id = ?",
        userId,
      )
      .toArray()
      .some((row) => {
        const permissions = JSON.parse(row.permissions_json);
        return Array.isArray(permissions) && permissions.includes(permission);
      });
  }

  private getMeta(key: string): string | null {
    const rows = this.sql
      .exec<{ value: string }>("SELECT value FROM channel_metadata WHERE key = ?", key)
      .toArray();
    return rows.length > 0 ? rows[0].value : null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO channel_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private deleteMeta(key: string): void {
    this.sql.exec("DELETE FROM channel_metadata WHERE key = ?", key);
  }

  private ensureInitialized(channelName?: string): {
    name: string;
    canonicalName: string;
    modes: string;
    createdAt: number;
  } {
    if (this.getMeta("rename_pending")) throw new Error("Channel rename in progress");
    let name = this.getMeta("name");
    let canonicalName = this.getMeta("canonical_name");
    let modes = this.getMeta("modes");
    let createdAtStr = this.getMeta("created_at");

    const effectiveName =
      channelName && channelName !== "#unknown"
        ? channelName
        : name && name !== "#unknown"
          ? name
          : (channelName ?? "#unknown");

    if (
      !name ||
      name === "#unknown" ||
      !canonicalName ||
      canonicalName === "#unknown" ||
      !createdAtStr
    ) {
      name = effectiveName;
      const canon = canonicalizeIRCName(effectiveName);
      canonicalName = canon;
      modes = modes ?? "nt";
      const now = Date.now();
      createdAtStr = createdAtStr ?? String(now);
      this.setMeta("name", name);
      this.setMeta("canonical_name", canon);
      this.setMeta("modes", modes);
      this.setMeta("created_at", createdAtStr);
      if (!this.getMeta("next_sequence")) {
        this.setMeta("next_sequence", "1");
      }
    }

    return {
      name,
      canonicalName,
      modes: modes ?? "nt",
      createdAt: parseInt(createdAtStr, 10),
    };
  }

  private async ensureCleanupAlarmScheduled(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }
  }

  public async alarm(): Promise<void> {
    await this.cleanupExpiredMessages(Date.now());
  }

  public async cleanupExpiredMessages(now: number = Date.now()): Promise<number> {
    const expiredRows = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM messages WHERE expires_at <= ? LIMIT ?",
        now,
        SERVER_CONFIG.cleanupBatchSize,
      )
      .toArray();

    if (expiredRows.length === 0) {
      if (this.sql.exec("SELECT id FROM messages LIMIT 1").toArray().length)
        await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
      return 0;
    }

    for (const row of expiredRows) {
      this.sql.exec("DELETE FROM messages WHERE id = ?", row.id);
    }

    const remaining =
      this.sql
        .exec<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM messages WHERE expires_at <= ?", now)
        .toArray()[0]?.cnt ?? 0;

    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 5_000);
    } else {
      const totalMessages =
        this.sql.exec<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM messages").toArray()[0]?.cnt ??
        0;
      if (totalMessages > 0) {
        await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
      }
    }

    return expiredRows.length;
  }

  private isFBotActive(): boolean {
    return this.getMeta("registered") === "1" && this.getMeta("f_bot_enabled") === "1";
  }

  private baseMemberModes(sessionId: string): string {
    return (
      this.sql
        .exec<{ modes: string }>(
          "SELECT modes FROM channel_members WHERE session_id = ?",
          sessionId,
        )
        .toArray()[0]?.modes ?? ""
    );
  }

  private privilegeRank(modes: string): number {
    return Math.max(
      0,
      ...Array.from(modes, (mode) => ({ q: 5, a: 4, o: 3, h: 2, v: 1 })[mode] ?? 0),
    );
  }

  private effectiveMemberModes(userId: string, modes: string): string {
    const roles = this.sql
      .exec<{ irc_mode: string | null }>(
        "SELECT g.irc_mode FROM channel_role_groups g JOIN channel_user_roles r ON r.group_id = g.id WHERE r.user_id = ?",
        userId,
      )
      .toArray();
    const flags = new Set(modes.split(""));
    for (const role of roles)
      if (role.irc_mode && "qaohv".includes(role.irc_mode)) flags.add(role.irc_mode);
    return Array.from(flags).join("");
  }

  public getMembers(): ChannelMemberInfo[] {
    const rows = this.sql
      .exec<{
        session_id: string;
        user_id: string;
        account_name: string | null;
        nickname: string;
        username: string;
        hostname: string;
        realname: string;
        modes: string;
        joined_at: number;
        is_persistent?: number;
      }>("SELECT * FROM channel_members ORDER BY joined_at ASC")
      .toArray();

    const members: ChannelMemberInfo[] = rows.map((r) => ({
      sessionId: r.session_id,
      userId: r.user_id,
      accountName: r.account_name,
      nickname: r.nickname,
      username: r.username,
      hostname: r.hostname,
      realname: r.realname,
      modes: this.effectiveMemberModes(r.user_id, r.modes),
      joinedAt: r.joined_at,
      isPersistent: Boolean(r.is_persistent),
    }));

    if (this.isFBotActive()) {
      const regAtStr = this.getMeta("registered_at");
      const createdAtStr = this.getMeta("created_at");
      const botJoinedAt = regAtStr
        ? parseInt(regAtStr, 10)
        : createdAtStr
          ? parseInt(createdAtStr, 10)
          : Date.now();
      members.push({
        sessionId: "service:F",
        userId: "service:F",
        accountName: "F",
        nickname: "F",
        username: "services",
        hostname: SERVER_CONFIG.serverName,
        realname: "FlareServ Channel Service Bot",
        modes: "q",
        joinedAt: botJoinedAt,
        isPersistent: true,
      });
    }

    return members;
  }

  public isMember(userOrNick: string): boolean {
    const canon = canonicalizeIRCName(userOrNick);
    const row = this.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) as count FROM channel_members WHERE LOWER(nickname) = ? OR LOWER(COALESCE(account_name, '')) = ?",
        canon,
        canon,
      )
      .toArray()[0];
    return Boolean(row && row.count > 0);
  }

  public async canReadAccount(user: {
    id: string;
    username: string;
    isAdmin: boolean;
  }): Promise<boolean> {
    if (user.isAdmin) return true;
    if (this.getMeta("archived") === "1" || this.getMeta("rename_pending")) return false;
    const live = await this.env.SESSION.get(
      this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
    ).getLiveAccountSessions(user.id);
    const members = this.getMembers().filter(
      (m) =>
        m.userId === user.id && m.accountName && (m.isPersistent || live.includes(m.sessionId)),
    );
    const modes = this.getMeta("modes") ?? "nt";
    const mask = members[0]
      ? `${members[0].nickname}!${members[0].username}@${members[0].hostname}`
      : `${user.username}!api@gateway.api`;
    if (this.isBanned(mask, user.username)) return false;
    const founder =
      this.sql
        .exec(
          "SELECT user_id FROM channel_permissions WHERE user_id = ? AND permission = 'q'",
          user.id,
        )
        .toArray().length > 0;
    return !/[spik]/.test(modes) || members.length > 0 || founder;
  }

  public isAccountFounder(id: string): boolean {
    return (
      this.sql
        .exec("SELECT user_id FROM channel_permissions WHERE user_id = ? AND permission = 'q'", id)
        .toArray().length > 0
    );
  }

  public async canManageAccount(user: {
    id: string;
    username: string;
    isAdmin: boolean;
  }): Promise<boolean> {
    if (user.isAdmin) return true;
    const founder =
      this.sql
        .exec(
          "SELECT user_id FROM channel_permissions WHERE user_id = ? AND permission = 'q'",
          user.id,
        )
        .toArray().length > 0;
    return Boolean(
      founder ||
        /[qao]/.test((await this.getAccountMember(user.id))?.modes ?? "") ||
        this.hasCustomPermission(user.id, "manage_channel"),
    );
  }

  public async getAccountMember(userId: string): Promise<ChannelMemberInfo | null> {
    const live = await this.env.SESSION.get(
      this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
    ).getLiveAccountSessions(userId);
    return (
      this.getMembers().find(
        (m) =>
          m.userId === userId && m.accountName && (m.isPersistent || live.includes(m.sessionId)),
      ) ?? null
    );
  }

  private getMemberBySession(sessionId: string): ChannelMemberInfo | null {
    if (sessionId === "service:F" && this.isFBotActive()) {
      const regAtStr = this.getMeta("registered_at");
      const createdAtStr = this.getMeta("created_at");
      const botJoinedAt = regAtStr
        ? parseInt(regAtStr, 10)
        : createdAtStr
          ? parseInt(createdAtStr, 10)
          : Date.now();
      return {
        sessionId: "service:F",
        userId: "service:F",
        accountName: "F",
        nickname: "F",
        username: "services",
        hostname: SERVER_CONFIG.serverName,
        realname: "FlareServ Channel Service Bot",
        modes: "q",
        joinedAt: botJoinedAt,
        isPersistent: true,
      };
    }

    const rows = this.sql
      .exec<{
        session_id: string;
        user_id: string;
        account_name: string | null;
        nickname: string;
        username: string;
        hostname: string;
        realname: string;
        modes: string;
        joined_at: number;
        is_persistent?: number;
      }>("SELECT * FROM channel_members WHERE session_id = ?", sessionId)
      .toArray();

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      sessionId: r.session_id,
      userId: r.user_id,
      accountName: r.account_name,
      nickname: r.nickname,
      username: r.username,
      hostname: r.hostname,
      realname: r.realname,
      modes: this.effectiveMemberModes(r.user_id, r.modes),
      joinedAt: r.joined_at,
      isPersistent: Boolean(r.is_persistent),
    };
  }

  private getMemberByUserId(userId: string): ChannelMemberInfo | null {
    const rows = this.sql
      .exec<{
        session_id: string;
        user_id: string;
        account_name: string | null;
        nickname: string;
        username: string;
        hostname: string;
        realname: string;
        modes: string;
        joined_at: number;
        is_persistent?: number;
      }>("SELECT * FROM channel_members WHERE user_id = ?", userId)
      .toArray();

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      sessionId: r.session_id,
      userId: r.user_id,
      accountName: r.account_name,
      nickname: r.nickname,
      username: r.username,
      hostname: r.hostname,
      realname: r.realname,
      modes: this.effectiveMemberModes(r.user_id, r.modes),
      joinedAt: r.joined_at,
      isPersistent: Boolean(r.is_persistent),
    };
  }

  public async setMemberPersistence(userId: string, isPersistent: boolean): Promise<void> {
    try {
      this.sql.exec(
        "UPDATE channel_members SET is_persistent = ? WHERE user_id = ?",
        isPersistent ? 1 : 0,
        userId,
      );
    } catch {
      // ignore
    }
  }

  private getMemberByNick(nickname: string): ChannelMemberInfo | null {
    const canon = canonicalizeIRCName(nickname);
    const members = this.getMembers();
    return members.find((m) => canonicalizeIRCName(m.nickname) === canon) ?? null;
  }

  private getListModeEntries(mode: "b" | "e" | "I" | "q"): Array<{
    mask: string;
    createdBy: string;
    createdAt: number;
  }> {
    if (mode === "b") {
      // Combine legacy channel_bans + channel_list_modes('b')
      const legacy = this.sql
        .exec<{ mask: string; created_by: string; created_at: number }>(
          "SELECT mask, created_by, created_at FROM channel_bans",
        )
        .toArray();
      const modern = this.sql
        .exec<{ mask: string; created_by: string; created_at: number }>(
          "SELECT mask, created_by, created_at FROM channel_list_modes WHERE mode = 'b'",
        )
        .toArray();
      const map = new Map<string, { mask: string; createdBy: string; createdAt: number }>();
      for (const r of [...legacy, ...modern]) {
        map.set(r.mask, { mask: r.mask, createdBy: r.created_by, createdAt: r.created_at });
      }
      return Array.from(map.values());
    }

    const rows = this.sql
      .exec<{ mask: string; created_by: string; created_at: number }>(
        "SELECT mask, created_by, created_at FROM channel_list_modes WHERE mode = ?",
        mode,
      )
      .toArray();
    return rows.map((r) => ({
      mask: r.mask,
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  }

  private isBanned(fullMask: string, accountName?: string | null): boolean {
    const bans = this.getListModeEntries("b");
    const isMatchedBan = bans.some(
      (b) => !isMuteExtban(b.mask) && matchesBanMask(b.mask, fullMask, accountName),
    );
    if (!isMatchedBan) return false;

    const excepts = this.getListModeEntries("e");
    const isExcepted = excepts.some((e) => matchesBanMask(e.mask, fullMask, accountName));
    return !isExcepted;
  }

  private isMuted(fullMask: string, accountName?: string | null): boolean {
    const bans = this.getListModeEntries("b");
    const isMatchedMute = bans.some(
      (b) => isMuteExtban(b.mask) && matchesBanMask(b.mask, fullMask, accountName),
    );
    if (!isMatchedMute) return false;

    const excepts = this.getListModeEntries("e");
    const isExcepted = excepts.some((e) => matchesBanMask(e.mask, fullMask, accountName));
    return !isExcepted;
  }

  private isQuieted(fullMask: string, accountName?: string | null): boolean {
    const quiets = this.getListModeEntries("q");
    return quiets.some((q) => matchesBanMask(q.mask, fullMask, accountName));
  }

  private hasInviteException(fullMask: string, accountName?: string | null): boolean {
    const invex = this.getListModeEntries("I");
    return invex.some((i) => matchesBanMask(i.mask, fullMask, accountName));
  }

  public async join(params: {
    channelName: string;
    sessionId: string;
    userId: string;
    accountName: string | null;
    nickname: string;
    username: string;
    hostname: string;
    realname: string;
    key?: string;
    isOper?: boolean;
    isPersistent?: boolean;
    activeSessionIds?: string[];
  }): Promise<JoinChannelResult> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("archived") === "1" || this.getMeta("rename_pending"))
      return {
        ok: false,
        numeric: Numerics.ERR_NOSUCHCHANNEL,
        errorText: "No such channel",
        channelName: meta.name,
        topic: null,
        topicSetBy: null,
        topicSetAt: null,
        modes: meta.modes,
        createdAt: meta.createdAt,
        members: [],
        memberModes: "",
      };
    const fullMask = `${params.nickname}!${params.username}@${params.hostname}`;
    const access = this.sql
      .exec<{ permission: string }>(
        "SELECT permission FROM channel_permissions WHERE user_id = ?",
        params.userId,
      )
      .toArray();
    const founderAccess = access.some((r) => r.permission === "q");
    if (params.activeSessionIds) {
      const active = new Set(params.activeSessionIds);
      for (const member of this.getMembers())
        if (
          !member.isPersistent &&
          !member.sessionId.startsWith("service:") &&
          !active.has(member.sessionId)
        )
          this.sql.exec("DELETE FROM channel_members WHERE session_id = ?", member.sessionId);
    }

    const existingMember =
      this.getMemberBySession(params.sessionId) ||
      (params.userId && !params.userId.startsWith("guest:")
        ? this.getMemberByUserId(params.userId)
        : null);
    if (existingMember) {
      const reattachModes = this.baseMemberModes(existingMember.sessionId);
      if (!params.isOper && this.isBanned(fullMask, params.accountName))
        return {
          ok: false,
          numeric: Numerics.ERR_BANNEDFROMCHAN,
          errorText: "Cannot join channel (+b)",
          channelName: meta.name,
          topic: null,
          topicSetBy: null,
          topicSetAt: null,
          modes: meta.modes,
          createdAt: meta.createdAt,
          members: [],
          memberModes: "",
        };
      if (existingMember.sessionId !== params.sessionId) {
        if (
          params.activeSessionIds &&
          !params.activeSessionIds.includes(existingMember.sessionId)
        ) {
          this.sql.exec(
            "DELETE FROM channel_members WHERE session_id = ?",
            existingMember.sessionId,
          );
        }
        this.sql.exec(
          `INSERT OR REPLACE INTO channel_members (session_id, user_id, account_name, nickname, username, hostname, realname, modes, joined_at, is_persistent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params.sessionId,
          params.userId,
          params.accountName,
          params.nickname,
          params.username,
          params.hostname,
          params.realname,
          reattachModes,
          Date.now(),
          params.isPersistent ? 1 : existingMember.isPersistent ? 1 : 0,
        );
      }
      return {
        ok: true,
        channelName: meta.name,
        topic: this.getMeta("topic"),
        topicSetBy: this.getMeta("topic_set_by"),
        topicSetAt: this.getMeta("topic_set_at")
          ? parseInt(this.getMeta("topic_set_at")!, 10)
          : null,
        modes: meta.modes,
        createdAt: meta.createdAt,
        members: this.getMembers(),
        memberModes: existingMember.modes,
        isReattach: true,
      };
    }

    const _canonNick = canonicalizeIRCName(params.nickname);
    const isInvited =
      this.sql
        .exec<{ target_nick: string }>(
          "SELECT target_nick FROM channel_invites WHERE target_user_id = ? AND created_at > ?",
          params.userId,
          Date.now() - 24 * 60 * 60 * 1000,
        )
        .toArray().length > 0;

    if (!params.isOper) {
      const forwardChannel = meta.modes.includes("f")
        ? (this.getMeta("forward") ?? undefined)
        : undefined;

      // Check registered-only (+R)
      if (meta.modes.includes("R") && !params.accountName) {
        return {
          ok: false,
          numeric: Numerics.ERR_NEEDREGGEDNICK,
          errorText: "Cannot join channel (+R) - you need to be identified to a registered account",
          forwardChannel,
          channelName: meta.name,
          topic: null,
          topicSetBy: null,
          topicSetAt: null,
          modes: meta.modes,
          createdAt: meta.createdAt,
          members: [],
          memberModes: "",
        };
      }

      // Check channel key (+k)
      if (meta.modes.includes("k")) {
        const requiredKey = this.getMeta("key");
        if (requiredKey && params.key !== requiredKey && !founderAccess) {
          return {
            ok: false,
            numeric: Numerics.ERR_BADCHANNELKEY,
            errorText: "Cannot join channel (+k) - bad key",
            forwardChannel,
            channelName: meta.name,
            topic: null,
            topicSetBy: null,
            topicSetAt: null,
            modes: meta.modes,
            createdAt: meta.createdAt,
            members: [],
            memberModes: "",
          };
        }
      }

      // Check user limit (+l)
      if (meta.modes.includes("l") && !isInvited) {
        const limitStr = this.getMeta("limit");
        const limit = limitStr ? parseInt(limitStr, 10) : 0;
        const currentCount = this.getMembers().length;
        if (limit > 0 && currentCount >= limit) {
          return {
            ok: false,
            numeric: Numerics.ERR_CHANNELISFULL,
            errorText: "Cannot join channel (+l) - channel is full",
            forwardChannel,
            channelName: meta.name,
            topic: null,
            topicSetBy: null,
            topicSetAt: null,
            modes: meta.modes,
            createdAt: meta.createdAt,
            members: [],
            memberModes: "",
          };
        }
      }

      // Check invite-only (+i)
      if (
        meta.modes.includes("i") &&
        access.length === 0 &&
        !isInvited &&
        !this.hasInviteException(fullMask, params.accountName)
      ) {
        return {
          ok: false,
          numeric: Numerics.ERR_INVITEONLYCHAN,
          errorText: "Cannot join channel (+i) - must be invited",
          forwardChannel,
          channelName: meta.name,
          topic: null,
          topicSetBy: null,
          topicSetAt: null,
          modes: meta.modes,
          createdAt: meta.createdAt,
          members: [],
          memberModes: "",
        };
      }

      // Check bans (+b) unless invited
      if (!isInvited && this.isBanned(fullMask, params.accountName)) {
        return {
          ok: false,
          numeric: Numerics.ERR_BANNEDFROMCHAN,
          errorText: "Cannot join channel (+b) - you are banned",
          forwardChannel,
          channelName: meta.name,
          topic: null,
          topicSetBy: null,
          topicSetAt: null,
          modes: meta.modes,
          createdAt: meta.createdAt,
          members: [],
          memberModes: "",
        };
      }
    }

    // Consume invitation if present
    this.sql.exec("DELETE FROM channel_invites WHERE target_user_id = ?", params.userId);

    // Determine initial modes:
    const currentMembers = this.getMembers();
    const _canonAcct = params.accountName ? canonicalizeIRCName(params.accountName) : null;
    const permRows = this.sql
      .exec<{ permission: string }>(
        "SELECT permission FROM channel_permissions WHERE user_id = ?",
        params.userId,
      )
      .toArray();
    const persistedPerms = new Set(permRows.map((p) => p.permission));

    let memberModes = "";
    if (this.getMeta("registered") === "1" && persistedPerms.size > 0) {
      for (const m of ["q", "a", "o", "h", "v"]) {
        if (persistedPerms.has(m)) {
          memberModes += m;
        }
      }
      if (memberModes.includes("q") && !memberModes.includes("o")) {
        memberModes += "o";
      }
    } else if (
      this.getMeta("registered") !== "1" &&
      (currentMembers.length === 0 || params.isOper)
    ) {
      memberModes = "o";
      this.setMeta("has_founder", "1");
    }

    const now = Date.now();
    this.sql.exec(
      `INSERT INTO channel_members (session_id, user_id, account_name, nickname, username, hostname, realname, modes, joined_at, is_persistent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params.sessionId,
      params.userId,
      params.accountName,
      params.nickname,
      params.username,
      params.hostname,
      params.realname,
      memberModes,
      now,
      params.isPersistent ? 1 : 0,
    );

    if (
      SERVER_CONFIG.autoRegisterChannels &&
      params.accountName &&
      this.getMeta("registered") !== "1" &&
      memberModes.includes("o")
    ) {
      await this.csRegister({
        channelName: meta.name,
        actorSessionId: params.sessionId,
        actorUserId: params.userId,
        actorAccount: params.accountName,
      });
      memberModes = this.getMemberBySession(params.sessionId)!.modes;
    }

    const topic = this.getMeta("topic");
    const topicSetBy = this.getMeta("topic_set_by");
    const topicSetAtStr = this.getMeta("topic_set_at");
    const welcome = this.getMeta("f_bot_welcome");
    const fBotWelcome = this.isFBotActive() && welcome ? welcome : null;

    return {
      ok: true,
      channelName: meta.name,
      topic,
      topicSetBy,
      topicSetAt: topicSetAtStr ? parseInt(topicSetAtStr, 10) : null,
      modes: meta.modes,
      createdAt: meta.createdAt,
      members: this.getMembers(),
      memberModes,
      fBotWelcome,
    };
  }

  public async part(
    sessionId: string,
    userId?: string,
    renameCoordinator = false,
  ): Promise<{
    ok: boolean;
    channelName: string;
    remainingSessionIds: string[];
  }> {
    if (this.getMeta("rename_pending") && !renameCoordinator)
      throw new Error("Channel rename in progress");
    const name = this.getMeta("name") ?? "";
    const member =
      this.getMemberBySession(sessionId) || (userId ? this.getMemberByUserId(userId) : null);
    if (!member) {
      return { ok: false, channelName: name, remainingSessionIds: [] };
    }
    const metaModes = this.getMeta("modes") ?? "";
    const isAuditorium = metaModes.includes("u");
    const isPrivileged = /[vhoaq]/.test(member.modes ?? "");

    if (userId) {
      this.sql.exec(
        "DELETE FROM channel_members WHERE session_id = ? OR user_id = ?",
        sessionId,
        userId,
      );
    } else {
      this.sql.exec("DELETE FROM channel_members WHERE session_id = ?", sessionId);
    }
    const remaining = this.getMembers()
      .filter((m) => !isAuditorium || isPrivileged || /[vhoaq]/.test(m.modes))
      .map((m) => m.sessionId);
    return {
      ok: true,
      channelName: name,
      remainingSessionIds: remaining,
    };
  }

  public async updateMemberNick(sessionId: string, newNick: string): Promise<string[]> {
    const member = this.getMemberBySession(sessionId);
    if (!member) return [];
    this.sql.exec(
      "UPDATE channel_members SET nickname = ? WHERE session_id = ?",
      newNick,
      sessionId,
    );
    return this.getMembers().map((m) => m.sessionId);
  }

  public async updateMemberRealname(sessionId: string, newRealname: string): Promise<string[]> {
    const member = this.getMemberBySession(sessionId);
    if (!member) return [];
    this.sql.exec(
      "UPDATE channel_members SET realname = ? WHERE session_id = ?",
      newRealname,
      sessionId,
    );
    return this.getMembers().map((m) => m.sessionId);
  }

  public async updateMemberHost(
    sessionId: string,
    newUsername: string,
    newHostname: string,
  ): Promise<string[]> {
    const member = this.getMemberBySession(sessionId);
    if (!member) return [];
    this.sql.exec(
      "UPDATE channel_members SET username = ?, hostname = ? WHERE session_id = ?",
      newUsername,
      newHostname,
      sessionId,
    );
    return this.getMembers().map((m) => m.sessionId);
  }

  public async updateMemberAccount(
    sessionId: string,
    userId: string,
    accountName: string | null,
  ): Promise<string[]> {
    const member = this.getMemberBySession(sessionId);
    if (!member) return [];
    this.sql.exec(
      "UPDATE channel_members SET user_id = ?, account_name = ? WHERE session_id = ?",
      userId,
      accountName,
      sessionId,
    );
    return this.getMembers().map((m) => m.sessionId);
  }

  private rowToStoredMessage(r: {
    id: string;
    sequence: number;
    sender_id: string;
    sender_account: string | null;
    sender_nick: string;
    sender_user: string;
    sender_host: string;
    command: "PRIVMSG" | "NOTICE" | "TAGMSG" | "TOPIC" | "MODE" | "JOIN" | "PART" | "KICK";
    content: string;
    tags_json?: string;
    multiline_json?: string | null;
    redacted?: number;
    created_at: number;
    expires_at: number;
  }): StoredChannelMessage {
    let tags: Record<string, string | true> | undefined;
    if (r.tags_json && r.tags_json !== "{}") {
      try {
        tags = JSON.parse(r.tags_json);
      } catch {
        tags = undefined;
      }
    }
    let multilineLines: Array<{ content: string; concat: boolean }> | undefined;
    if (r.multiline_json) {
      try {
        multilineLines = JSON.parse(r.multiline_json);
      } catch {
        multilineLines = undefined;
      }
    }
    return {
      id: r.id,
      sequence: r.sequence,
      senderId: r.sender_id,
      senderAccount: r.sender_account,
      senderNick: r.sender_nick,
      senderUser: r.sender_user,
      senderHost: r.sender_host,
      command: r.command,
      content: r.content,
      tags,
      multilineLines,
      redacted: Boolean(r.redacted),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    };
  }

  private getRecipientsForMessage(senderSessionId: string, statusPrefix?: string): string[] {
    const allMembers = this.getMembers();
    const metaModes = this.getMeta("modes") ?? "";
    const isOpModerated = metaModes.includes("U");
    let senderPrivileged = false;
    if (isOpModerated) {
      const sender = allMembers.find((m) => m.sessionId === senderSessionId);
      senderPrivileged = Boolean(sender && /[qaohv]/.test(sender.modes));
    }

    if (!statusPrefix && !isOpModerated) {
      return allMembers.map((m) => m.sessionId);
    }
    const STATUS_PREFIX_RANKS: Record<string, number> = {
      "~": 5,
      "&": 4,
      "@": 3,
      "%": 2,
      "+": 1,
    };
    const MODE_RANKS: Record<string, number> = {
      q: 5,
      a: 4,
      o: 3,
      h: 2,
      v: 1,
    };
    let minRank = 5;
    if (statusPrefix) {
      for (const char of statusPrefix) {
        const r = STATUS_PREFIX_RANKS[char];
        if (r !== undefined && r < minRank) {
          minRank = r;
        }
      }
    }

    return allMembers
      .filter((m) => {
        if (m.sessionId === senderSessionId) {
          return true;
        }
        if (isOpModerated && !senderPrivileged && !/[qaoh]/.test(m.modes)) {
          return false;
        }
        if (!statusPrefix) {
          return true;
        }
        let highest = 0;
        for (const modeChar of m.modes) {
          const r = MODE_RANKS[modeChar] ?? 0;
          if (r > highest) highest = r;
        }
        return highest >= minRank;
      })
      .map((m) => m.sessionId);
  }

  public async appendMessage(params: {
    channelName?: string;
    messageId?: string;
    sessionId: string;
    userId: string;
    accountName: string | null;
    nickname: string;
    username: string;
    hostname: string;
    command: "PRIVMSG" | "NOTICE" | "TAGMSG";
    content: string;
    tags?: Record<string, string | true>;
    multilineLines?: Array<{ content: string; concat: boolean }>;
    persist?: boolean;
    isOper?: boolean;
    requireRoleplayMode?: boolean;
    requireChanop?: boolean;
    statusPrefix?: string;
  }): Promise<SendMessageResult> {
    if (this.getMeta("archived") === "1" || this.getMeta("rename_pending"))
      return { ok: false, errorText: "Channel is unavailable" };
    if (params.content.includes("\x00"))
      return { ok: false, errorText: "NUL is not valid IRC content" };
    if (new TextEncoder().encode(params.content).byteLength > SERVER_CONFIG.maxMessageLength)
      return { ok: false, errorText: "Message exceeds the byte limit" };
    if (params.accountName) {
      const account = await this.env.ACCOUNTS.get(
        this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
      ).getAccountByUsername(params.accountName);
      if (!account || account.id !== params.userId)
        return { ok: false, errorText: "Authenticated message identity required" };
      const tags = { ...params.tags };
      delete tags["+role"];
      delete tags["+badge"];
      tags["+role"] =
        account.roles.includes("admin") || account.roles.includes("oper")
          ? "admin"
          : (account.roles[0] ?? "member");
      tags["+badge"] = tags["+role"];
      params.tags = tags;
    }
    const meta = this.ensureInitialized(params.channelName);
    const member = this.getMemberBySession(params.sessionId);
    const fullMask = `${params.nickname}!${params.username}@${params.hostname}`;

    if (params.requireRoleplayMode && !meta.modes.includes("E")) {
      return {
        ok: false,
        numeric: Numerics.ERR_CANNOTSENDRP,
        errorText: "Target does not have roleplaying mode (+E) set",
      };
    }

    if (params.requireChanop && !hasChannelOp(member?.modes ?? "", params.isOper)) {
      return {
        ok: false,
        numeric: Numerics.ERR_CHANOPRIVSNEEDED,
        errorText: "You cannot relay messages to this channel",
      };
    }

    if (
      (this.getMeta("modes") ?? "").includes("r") &&
      this.sql
        .exec<{ value: string }>("SELECT value FROM channel_kv_metadata WHERE key = 'read-only'")
        .toArray()[0]?.value === "true" &&
      !hasChannelOp(member?.modes ?? "", params.isOper)
    ) {
      return { ok: false, errorText: "This channel is read-only" };
    }

    if (!params.isOper) {
      // Check +n (no external messages)
      if (meta.modes.includes("n") && !member) {
        return {
          ok: false,
          numeric: Numerics.ERR_CANNOTSENDTOCHAN,
          errorText: "Cannot send to channel (+n)",
        };
      }

      // Check bans (+b), quiets (+q), and mute extbans
      if (
        (this.isBanned(fullMask, params.accountName) ||
          this.isQuieted(fullMask, params.accountName) ||
          this.isMuted(fullMask, params.accountName)) &&
        (!member || !hasChannelVoiceOrOp(member.modes))
      ) {
        return {
          ok: false,
          numeric: Numerics.ERR_CANNOTSENDTOCHAN,
          errorText: "Cannot send to channel (+b/+q)",
        };
      }

      // Check +m (moderated)
      if (
        meta.modes.includes("m") &&
        (!member ||
          (!hasChannelVoiceOrOp(member.modes) &&
            !this.hasCustomPermission(params.userId, "send_messages")))
      ) {
        return {
          ok: false,
          numeric: Numerics.ERR_CANNOTSENDTOCHAN,
          errorText: "Cannot send to channel (+m)",
        };
      }

      // Check +M (registered-only speak)
      if (
        meta.modes.includes("M") &&
        !params.accountName &&
        (!member || !hasChannelVoiceOrOp(member.modes))
      ) {
        return {
          ok: false,
          numeric: Numerics.ERR_CANNOTSENDTOCHAN,
          errorText: "Cannot send to channel (+M)",
        };
      }

      // Check +C (no CTCP except ACTION)
      if (
        meta.modes.includes("C") &&
        params.content.startsWith("\x01") &&
        !params.content.toUpperCase().startsWith("\x01ACTION ") &&
        params.content.toUpperCase() !== "\x01ACTION\x01" &&
        (!member || !hasChannelOp(member.modes))
      ) {
        return {
          ok: false,
          numeric: Numerics.ERR_CANNOTSENDTOCHAN,
          errorText: "Cannot send to channel (+C)",
        };
      }
    }

    if (this.getMeta("modes")?.includes("r") && !params.accountName && !params.isOper) {
      return { ok: false, errorText: "An authenticated account is required" };
    }
    let editExpiresAt: number | undefined;
    const requestedEdit = extractEditTag(params.tags);
    if (requestedEdit.isEdit) {
      const original = this.sql
        .exec<{ sender_id: string; redacted: number; expires_at: number }>(
          "SELECT sender_id, redacted, expires_at FROM messages WHERE id = ?",
          requestedEdit.originalMessageId!,
        )
        .toArray()[0];
      if (
        !original ||
        original.redacted ||
        original.expires_at <= Date.now() ||
        original.sender_id !== params.userId
      ) {
        return { ok: false, errorText: "You can only edit your own existing messages" };
      }
      const root =
        this.sql
          .exec<{ root_id: string }>(
            "SELECT root_id FROM message_edits WHERE message_id = ?",
            requestedEdit.originalMessageId!,
          )
          .toArray()[0]?.root_id ?? requestedEdit.originalMessageId!;
      editExpiresAt =
        this.sql
          .exec<{ expires_at: number }>("SELECT expires_at FROM messages WHERE id = ?", root)
          .toArray()[0]?.expires_at ?? original.expires_at;
      if (editExpiresAt <= Date.now()) return { ok: false, errorText: "Message has expired" };
    }

    const msgId = params.messageId ?? crypto.randomUUID();
    const now = Date.now();
    const expiresAt = Math.min(now + SERVER_CONFIG.retentionMs, editExpiresAt ?? Infinity);

    // If ephemeral TAGMSG (e.g. +typing), do not persist in SQLite history
    if (params.persist === false) {
      return {
        ok: true,
        message: {
          id: msgId,
          sequence: 0,
          senderId: params.userId,
          senderAccount: params.accountName,
          senderNick: params.nickname,
          senderUser: params.username,
          senderHost: params.hostname,
          command: params.command,
          content: params.content,
          tags: params.tags,
          multilineLines: params.multilineLines,
          createdAt: now,
          expiresAt,
        },
        recipientSessionIds: this.getRecipientsForMessage(params.sessionId, params.statusPrefix),
      };
    }

    // Idempotency check if messageId already committed
    const existing = this.sql
      .exec<{
        id: string;
        sequence: number;
        sender_id: string;
        sender_account: string | null;
        sender_nick: string;
        sender_user: string;
        sender_host: string;
        command: "PRIVMSG" | "NOTICE" | "TAGMSG";
        content: string;
        tags_json: string;
        multiline_json: string | null;
        redacted: number;
        created_at: number;
        expires_at: number;
      }>("SELECT * FROM messages WHERE id = ?", msgId)
      .toArray();

    if (existing.length > 0) {
      if (
        existing[0].sender_id !== params.userId ||
        existing[0].content !== params.content ||
        existing[0].redacted
      )
        return { ok: false, errorText: "Idempotency key conflicts with an existing message" };
      return {
        ok: true,
        message: this.rowToStoredMessage(existing[0]),
        recipientSessionIds: [],
      };
    }

    const nextSeq = parseInt(this.getMeta("next_sequence") ?? "1", 10);
    this.setMeta("next_sequence", String(nextSeq + 1));

    const tagsJson = params.tags ? JSON.stringify(params.tags) : "{}";
    const multilineJson = params.multilineLines ? JSON.stringify(params.multilineLines) : null;

    this.sql.exec(
      `INSERT INTO messages (id, sequence, sender_id, sender_account, sender_nick, sender_user, sender_host, command, content, tags_json, multiline_json, redacted, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      msgId,
      nextSeq,
      params.userId,
      params.accountName,
      params.nickname,
      params.username,
      params.hostname,
      params.command,
      params.content,
      tagsJson,
      multilineJson,
      now,
      expiresAt,
    );

    // Support IRCord Message Edit Protocol (+ircord/edit, +draft/edit, +edit)
    const editInfo = extractEditTag(params.tags);

    if (editInfo.isEdit && editInfo.originalMessageId) {
      const origRows = this.sql
        .exec<any>("SELECT * FROM messages WHERE id = ?", editInfo.originalMessageId)
        .toArray();
      if (origRows.length > 0) {
        const orig = origRows[0];
        const allowed = canEditMessage(
          {
            senderSessionId: orig.sender_id,
            senderAccount: orig.sender_account,
            senderNick: orig.sender_nick,
          },
          {
            sessionId: params.userId,
            accountName: params.accountName,
            nickname: params.nickname,
            isOper: params.isOper,
          },
        );

        if (allowed) {
          const root =
            this.sql
              .exec<{ root_id: string }>(
                "SELECT root_id FROM message_edits WHERE message_id = ?",
                orig.id,
              )
              .toArray()[0]?.root_id ?? orig.id;
          this.sql.exec(
            "INSERT INTO message_edits (message_id, root_id) VALUES (?, ?)",
            msgId,
            root,
          );
          const origTags = JSON.parse(orig.tags_json || "{}");
          origTags["+ircord/edit"] = editInfo.originalMessageId;
          origTags["+draft/edit"] = editInfo.originalMessageId;
          origTags["+edit"] = editInfo.originalMessageId;
          origTags.edited_at = new Date(now).toISOString();

          this.sql.exec(
            "UPDATE messages SET content = ?, tags_json = ?, multiline_json = NULL WHERE id = ?",
            params.content,
            JSON.stringify(origTags),
            editInfo.originalMessageId,
          );

          const channelName = (await this.getChannelInfo()).channel;
          const editEvt = {
            channel: channelName,
            messageId: editInfo.originalMessageId,
            newContent: params.content,
            editor: params.nickname,
            editMessageId: msgId,
          };
          domainEvents.emit("message.updated", editEvt);
          try {
            const sessionStub = this.env.SESSION.get(
              this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
            );
            await sessionStub.broadcastRealtimeEvent({
              type: "message.updated",
              eventId: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              channelId: channelName,
              messageId: editInfo.originalMessageId,
              data: editEvt,
            });
          } catch {}
        }
      }
    }

    await this.ensureCleanupAlarmScheduled();
    await this.emitChannelEvent(
      "message.created",
      {
        id: msgId,
        senderId: params.userId,
        senderAccount: params.accountName,
        senderNick: params.nickname,
        content: params.content,
        tags: params.tags ?? {},
        createdAt: now,
      },
      msgId,
    );
    this.dispatchOutgoingWebhooks("message.created", {
      id: msgId,
      senderId: params.userId,
      senderAccount: params.accountName,
      content: params.content,
      channel: meta.name,
    });

    const stored: StoredChannelMessage = {
      id: msgId,
      sequence: nextSeq,
      senderId: params.userId,
      senderAccount: params.accountName,
      senderNick: params.nickname,
      senderUser: params.username,
      senderHost: params.hostname,
      command: params.command,
      content: params.content,
      tags: params.tags,
      multilineLines: params.multilineLines,
      redacted: false,
      createdAt: now,
      expiresAt,
    };

    return {
      ok: true,
      message: stored,
      recipientSessionIds: this.getRecipientsForMessage(params.sessionId, params.statusPrefix),
    };
  }

  private scrubMessageChain(messageId: string): void {
    const root =
      this.sql
        .exec<{ root_id: string }>(
          "SELECT root_id FROM message_edits WHERE message_id = ?",
          messageId,
        )
        .toArray()[0]?.root_id ?? messageId;
    this.sql.exec(
      "UPDATE messages SET redacted = 1, content = '', tags_json = '{}', multiline_json = NULL WHERE id = ? OR id IN (SELECT message_id FROM message_edits WHERE root_id = ?)",
      root,
      root,
    );
  }

  public async redactMessage(params: {
    channelName?: string;
    actorSessionId: string;
    actorUserId: string;
    actorAccount: string | null;
    actorNick: string;
    targetMsgId: string;
    reason?: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    errorCode?: string;
    errorMessage?: string;
    channelName: string;
    recipientSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    const member = this.getMemberBySession(params.actorSessionId);

    if (!member && !params.isOper) {
      return {
        ok: false,
        errorCode: "INVALID_TARGET",
        errorMessage: "You are not on that channel",
        channelName: meta.name,
      };
    }

    const rows = this.sql
      .exec<{
        id: string;
        sender_id: string;
        sender_account: string | null;
        sender_nick: string;
        redacted: number;
      }>(
        "SELECT id, sender_id, sender_account, sender_nick, redacted FROM messages WHERE id = ?",
        params.targetMsgId,
      )
      .toArray();

    if (rows.length === 0 || rows[0].redacted) {
      return {
        ok: false,
        errorCode: "UNKNOWN_MSGID",
        errorMessage: "Message does not exist or has already been redacted",
        channelName: meta.name,
      };
    }

    const msg = rows[0];
    const isAuthor =
      msg.sender_id === params.actorUserId ||
      (params.actorAccount &&
        msg.sender_account &&
        canonicalizeIRCName(params.actorAccount) === canonicalizeIRCName(msg.sender_account));

    const isChanMod = hasChannelOp(member?.modes ?? "", params.isOper);

    if (!isAuthor && !isChanMod) {
      return {
        ok: false,
        errorCode: "REDACT_FORBIDDEN",
        errorMessage: "You are not authorized to redact this message",
        channelName: meta.name,
      };
    }

    this.scrubMessageChain(params.targetMsgId);
    await this.emitChannelEvent("message.deleted", { id: params.targetMsgId }, params.targetMsgId);
    return {
      ok: true,
      channelName: meta.name,
      recipientSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async setTopic(params: {
    channelName?: string;
    sessionId: string;
    nickname: string;
    topic: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    numeric?: string;
    errorText?: string;
    channelName: string;
    topic?: string;
    messageId?: string;
    createdAt?: number;
    recipientSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMembers().length === 0) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOSUCHCHANNEL,
        errorText: "No such channel",
        channelName: params.channelName ?? "channel",
      };
    }
    const member = this.getMemberBySession(params.sessionId);
    if (!member && !params.isOper) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOTONCHANNEL,
        errorText: "You're not on that channel",
        channelName: meta.name,
      };
    }

    if (
      meta.modes.includes("t") &&
      !hasChannelOp(member?.modes ?? "", params.isOper) &&
      !this.hasCustomPermission(member?.userId ?? "", "change_topic")
    ) {
      return {
        ok: false,
        numeric: Numerics.ERR_CHANOPRIVSNEEDED,
        errorText: "You're not channel operator",
        channelName: meta.name,
      };
    }

    const now = Date.now();
    if (params.topic === "") {
      this.deleteMeta("topic");
      this.deleteMeta("topic_set_by");
      this.deleteMeta("topic_set_at");
    } else {
      this.setMeta("topic", params.topic);
      this.setMeta("topic_set_by", params.nickname);
      this.setMeta("topic_set_at", String(now));
    }

    // Persist TOPIC event in messages for draft/event-playback
    const nextSeq = parseInt(this.getMeta("next_sequence") ?? "1", 10);
    this.setMeta("next_sequence", String(nextSeq + 1));
    const msgId = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO messages (id, sequence, sender_id, sender_account, sender_nick, sender_user, sender_host, command, content, tags_json, multiline_json, redacted, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'TOPIC', ?, '{}', NULL, 0, ?, ?)`,
      msgId,
      nextSeq,
      member?.userId ?? params.sessionId,
      member?.accountName ?? null,
      params.nickname,
      member?.username ?? "user",
      member?.hostname ?? "irc.client",
      params.topic,
      now,
      now + SERVER_CONFIG.retentionMs,
    );

    return {
      ok: true,
      channelName: meta.name,
      topic: params.topic,
      messageId: msgId,
      createdAt: now,
      recipientSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async getTopicInfo(channelName?: string): Promise<{
    channelName: string;
    topic: string | null;
    topicSetBy: string | null;
    topicSetAt: number | null;
  }> {
    const meta = this.ensureInitialized(channelName);
    return {
      channelName: meta.name,
      topic: this.getMeta("topic"),
      topicSetBy: this.getMeta("topic_set_by"),
      topicSetAt: this.getMeta("topic_set_at") ? parseInt(this.getMeta("topic_set_at")!, 10) : null,
    };
  }

  public async kickMember(params: {
    channelName?: string;
    actorSessionId: string;
    targetNick: string;
    reason: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    numeric?: string;
    errorText?: string;
    channelName: string;
    kickedSessionId?: string;
    kickedNick?: string;
    recipientSessionIds?: string[];
  }> {
    if (this.getMembers().length === 0) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOSUCHCHANNEL,
        errorText: "No such channel",
        channelName: params.channelName ?? "channel",
      };
    }
    const channelName = this.ensureInitialized(params.channelName).name;
    const actor = this.getMemberBySession(params.actorSessionId);
    if (!actor && !params.isOper) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOTONCHANNEL,
        errorText: "You're not on that channel",
        channelName,
      };
    }
    if (
      !hasChannelOp(actor?.modes ?? "", params.isOper) &&
      !this.hasCustomPermission(actor?.userId ?? "", "kick_members")
    ) {
      return {
        ok: false,
        numeric: Numerics.ERR_CHANOPRIVSNEEDED,
        errorText: "You're not channel operator",
        channelName,
      };
    }

    if (canonicalizeIRCName(params.targetNick) === "f") {
      return {
        ok: false,
        numeric: Numerics.ERR_RESTRICTED,
        errorText: "You cannot kick network service bots",
        channelName,
      };
    }

    const target = this.getMemberByNick(params.targetNick);
    if (!target) {
      return {
        ok: false,
        numeric: Numerics.ERR_USERNOTINCHANNEL,
        errorText: "They aren't on that channel",
        channelName,
      };
    }

    const recipientsBeforeKick = this.getMembers().map((m) => m.sessionId);
    this.sql.exec("DELETE FROM channel_members WHERE session_id = ?", target.sessionId);

    return {
      ok: true,
      channelName,
      kickedSessionId: target.sessionId,
      kickedNick: target.nickname,
      recipientSessionIds: recipientsBeforeKick,
    };
  }

  public async inviteUser(params: {
    channelName?: string;
    actorSessionId: string;
    actorNick: string;
    targetNick: string;
    targetUserId: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    numeric?: string;
    errorText?: string;
    channelName: string;
    memberSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    const actor = this.getMemberBySession(params.actorSessionId);
    if (!actor && !params.isOper) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOTONCHANNEL,
        errorText: "You're not on that channel",
        channelName: meta.name,
      };
    }
    if (meta.modes.includes("i") && !hasChannelOp(actor?.modes ?? "", params.isOper)) {
      return {
        ok: false,
        numeric: Numerics.ERR_CHANOPRIVSNEEDED,
        errorText: "You're not channel operator",
        channelName: meta.name,
      };
    }
    if (this.getMemberByNick(params.targetNick)) {
      return {
        ok: false,
        numeric: Numerics.ERR_USERONCHANNEL,
        errorText: "is already on channel",
        channelName: meta.name,
      };
    }

    const canonTarget = canonicalizeIRCName(params.targetNick);
    this.sql.exec(
      `INSERT INTO channel_invites (target_nick, invited_by, created_at, target_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(target_nick) DO UPDATE SET invited_by = excluded.invited_by, created_at = excluded.created_at, target_user_id = excluded.target_user_id`,
      canonTarget,
      params.actorNick,
      Date.now(),
      params.targetUserId,
    );

    return {
      ok: true,
      channelName: meta.name,
      memberSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async uninviteUser(params: {
    channelName?: string;
    actorSessionId: string;
    targetNick: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    numeric?: string;
    errorText?: string;
    channelName: string;
  }> {
    const meta = this.ensureInitialized(params.channelName);
    const actor = this.getMemberBySession(params.actorSessionId);
    if (!actor && !params.isOper) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOTONCHANNEL,
        errorText: "You're not on that channel",
        channelName: meta.name,
      };
    }
    if (meta.modes.includes("i") && !hasChannelOp(actor?.modes ?? "", params.isOper)) {
      return {
        ok: false,
        numeric: Numerics.ERR_CHANOPRIVSNEEDED,
        errorText: "You're not channel operator",
        channelName: meta.name,
      };
    }
    const canonTarget = canonicalizeIRCName(params.targetNick);
    this.sql.exec("DELETE FROM channel_invites WHERE target_nick = ?", canonTarget);
    return {
      ok: true,
      channelName: meta.name,
    };
  }

  public async handleModeCommand(params: {
    channelName?: string;
    actorSessionId: string;
    actorPrefix: string;
    modeString?: string;
    modeArgs: string[];
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    numeric?: string;
    errorText?: string;
    channelName: string;
    currentModes?: string;
    modeParams?: string[];
    createdAt?: number;
    listModeType?: "b" | "e" | "I" | "q";
    banList?: Array<{ mask: string; createdBy: string; createdAt: number }>;
    errorParams?: string[];
    errorTarget?: string;
    appliedModeString?: string;
    appliedModeArgs?: string[];
    recipientSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    const channelName = meta.name;
    if (
      /[spik]/.test(meta.modes) &&
      !this.getMemberBySession(params.actorSessionId) &&
      !params.isOper
    ) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOTONCHANNEL,
        errorText: "Channel access denied",
        channelName,
      };
    }

    if (!params.modeString) {
      const modeParams: string[] = [];
      if (meta.modes.includes("k")) {
        const k = this.getMeta("key");
        if (k) modeParams.push(k);
      }
      if (meta.modes.includes("l")) {
        const l = this.getMeta("limit");
        if (l) modeParams.push(l);
      }
      if (meta.modes.includes("f")) {
        const f = this.getMeta("forward");
        if (f) modeParams.push(f);
      }
      return {
        ok: true,
        channelName,
        currentModes: `+${meta.modes}`,
        modeParams,
        createdAt: meta.createdAt,
      };
    }

    // List mode query (+b, +e, +I, +q without args)
    const stripped = params.modeString.replace(/^\+/, "");
    if (
      params.modeArgs.length === 0 &&
      (stripped === "b" || stripped === "e" || stripped === "I" || stripped === "q")
    ) {
      const listModeType = stripped as "b" | "e" | "I" | "q";
      return {
        ok: true,
        channelName,
        listModeType,
        banList: this.getListModeEntries(listModeType),
      };
    }

    if (this.getMembers().length === 0 && this.getMeta("registered") !== "1") {
      return {
        ok: false,
        numeric: Numerics.ERR_NOSUCHCHANNEL,
        errorText: "No such channel",
        channelName,
      };
    }

    const actor = this.getMemberBySession(params.actorSessionId);
    if (!actor && !params.isOper) {
      return {
        ok: false,
        numeric: Numerics.ERR_NOTONCHANNEL,
        errorText: "You're not on that channel",
        channelName,
      };
    }
    if (
      !hasChannelOp(actor?.modes ?? "", params.isOper) &&
      !(
        this.hasCustomPermission(actor?.userId ?? "", "ban_members") &&
        /^[+\-beI]+$/.test(params.modeString ?? "")
      )
    ) {
      return {
        ok: false,
        numeric: Numerics.ERR_CHANOPRIVSNEEDED,
        errorText: "You're not channel operator",
        channelName,
      };
    }

    let adding = true;
    let argIdx = 0;
    const channelModes = new Set(meta.modes.split("").filter(Boolean));
    const appliedChanges: Array<{ sign: "+" | "-"; mode: string; arg?: string }> = [];

    for (const ch of params.modeString) {
      if (ch === "+") {
        adding = true;
        continue;
      }
      if (ch === "-") {
        adding = false;
        continue;
      }

      if (["n", "t", "i", "m", "p", "s", "R", "M", "C", "E", "r", "u", "U"].includes(ch)) {
        if (adding && !channelModes.has(ch)) {
          channelModes.add(ch);
          appliedChanges.push({ sign: "+", mode: ch });
        } else if (!adding && channelModes.has(ch)) {
          channelModes.delete(ch);
          appliedChanges.push({ sign: "-", mode: ch });
        }
      } else if (ch === "f") {
        if (adding) {
          const forwardChan = params.modeArgs[argIdx++];
          if (!forwardChan?.startsWith("#")) continue;
          channelModes.add("f");
          this.setMeta("forward", forwardChan);
          appliedChanges.push({ sign: "+", mode: "f", arg: forwardChan });
        } else {
          if (channelModes.has("f")) {
            channelModes.delete("f");
            this.deleteMeta("forward");
            appliedChanges.push({ sign: "-", mode: "f" });
          }
        }
      } else if (ch === "k") {
        if (adding) {
          const key = params.modeArgs[argIdx++];
          if (!key) continue;
          if (/\s/.test(key)) {
            return {
              ok: false,
              numeric: Numerics.ERR_INVALIDMODEPARAM,
              errorText: "Invalid channel key",
              channelName,
              errorParams: [channelName, "k", "*", "Invalid channel key"],
            };
          }
          channelModes.add("k");
          this.setMeta("key", key);
          appliedChanges.push({ sign: "+", mode: "k", arg: key });
        } else {
          if (channelModes.has("k")) {
            channelModes.delete("k");
            this.deleteMeta("key");
            appliedChanges.push({ sign: "-", mode: "k", arg: "*" });
          }
        }
      } else if (ch === "l") {
        if (adding) {
          const limitRaw = params.modeArgs[argIdx++];
          const limit = limitRaw ? parseInt(limitRaw, 10) : NaN;
          if (!Number.isFinite(limit) || limit <= 0) continue;
          channelModes.add("l");
          this.setMeta("limit", String(limit));
          appliedChanges.push({ sign: "+", mode: "l", arg: String(limit) });
        } else {
          if (channelModes.has("l")) {
            channelModes.delete("l");
            this.deleteMeta("limit");
            appliedChanges.push({ sign: "-", mode: "l" });
          }
        }
      } else if (
        ch === "b" ||
        ch === "e" ||
        ch === "I" ||
        (ch === "q" &&
          params.modeArgs[argIdx] &&
          (params.modeArgs[argIdx].includes("!") ||
            params.modeArgs[argIdx].includes("@") ||
            params.modeArgs[argIdx].startsWith("$") ||
            params.modeArgs[argIdx].startsWith("~")))
      ) {
        const mask = params.modeArgs[argIdx++];
        if (!mask) continue;
        if (adding) {
          this.sql.exec(
            `INSERT INTO channel_list_modes (mode, mask, created_by, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(mode, mask) DO NOTHING`,
            ch,
            mask,
            params.actorPrefix,
            Date.now(),
          );
          if (ch === "b") {
            this.sql.exec(
              `INSERT INTO channel_bans (mask, created_by, created_at)
               VALUES (?, ?, ?)
               ON CONFLICT(mask) DO NOTHING`,
              mask,
              params.actorPrefix,
              Date.now(),
            );
          }
          appliedChanges.push({ sign: "+", mode: ch, arg: mask });
        } else {
          const existingList = this.getListModeEntries(ch);
          const found = existingList.find(
            (e) =>
              e.mask.toLowerCase() === mask.toLowerCase() ||
              canonicalizeIRCName(e.mask) === canonicalizeIRCName(mask),
          );
          const deleteMask = found ? found.mask : mask;
          this.sql.exec(
            "DELETE FROM channel_list_modes WHERE mode = ? AND (mask = ? OR mask = ?)",
            ch,
            mask,
            deleteMask,
          );
          if (ch === "b") {
            this.sql.exec("DELETE FROM channel_bans WHERE mask = ? OR mask = ?", mask, deleteMask);
          }
          appliedChanges.push({ sign: "-", mode: ch, arg: mask });
        }
      } else if (["q", "a", "o", "h", "v"].includes(ch)) {
        const targetNick = params.modeArgs[argIdx++];
        if (!targetNick) continue;
        const target = this.getMemberByNick(targetNick);
        if (!target) {
          return {
            ok: false,
            numeric: Numerics.ERR_USERNOTINCHANNEL,
            errorText: "They aren't on that channel",
            channelName,
            errorTarget: targetNick,
          };
        }
        const hierarchy = "qaohv";
        const actorRank = hierarchy.split("").findIndex((m) => actor?.modes.includes(m));
        const targetRank = hierarchy.split("").findIndex((m) => target.modes.includes(m));
        if (
          !params.isOper &&
          (actorRank < 0 ||
            hierarchy.indexOf(ch) < actorRank ||
            (targetRank >= 0 && targetRank < actorRank))
        ) {
          return {
            ok: false,
            numeric: Numerics.ERR_CHANOPRIVSNEEDED,
            errorText: "Cannot change higher channel privileges",
            channelName,
          };
        }
        const memberModeSet = new Set(
          this.baseMemberModes(target.sessionId).split("").filter(Boolean),
        );
        if (
          adding &&
          target.modes.includes(ch) &&
          !this.baseMemberModes(target.sessionId).includes(ch)
        )
          continue; // A derived role flag is not a new live grant.
        if (adding) memberModeSet.add(ch);
        else memberModeSet.delete(ch);
        const updatedModes = Array.from(memberModeSet).join("");
        this.sql.exec(
          "UPDATE channel_members SET modes = ? WHERE session_id = ?",
          updatedModes,
          target.sessionId,
        );
        appliedChanges.push({ sign: adding ? "+" : "-", mode: ch, arg: target.nickname });
      } else {
        return {
          ok: false,
          numeric: Numerics.ERR_UNKNOWNMODE,
          errorText: `${ch} :is unknown mode char to me`,
          channelName,
        };
      }
    }

    const updatedChannelModes = Array.from(channelModes).join("");
    this.setMeta("modes", updatedChannelModes);

    let modeStrOut = "";
    let lastSign: "+" | "-" | null = null;
    const modeArgsOut: string[] = [];
    for (const change of appliedChanges) {
      if (change.sign !== lastSign) {
        modeStrOut += change.sign;
        lastSign = change.sign;
      }
      modeStrOut += change.mode;
      if (change.arg !== undefined) {
        modeArgsOut.push(change.arg);
      }
    }

    return {
      ok: true,
      channelName,
      appliedModeString: modeStrOut,
      appliedModeArgs: modeArgsOut,
      recipientSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async getLatestMessageTime(): Promise<{ timestamp: string; createdAt: number } | null> {
    const rows = this.sql
      .exec<{ created_at: number }>(
        "SELECT created_at FROM messages WHERE redacted = 0 ORDER BY sequence DESC LIMIT 1",
      )
      .toArray();
    if (rows.length === 0) return null;
    return {
      timestamp: new Date(rows[0].created_at).toISOString(),
      createdAt: rows[0].created_at,
    };
  }

  public async queryHistory(params: {
    channelName?: string;
    sessionId: string;
    nickname: string;
    username: string;
    hostname: string;
    accountName?: string | null;
    subcommand: string; // LATEST, BEFORE, AFTER, AROUND, BETWEEN
    reference1?: string; // timestamp=... or msgid=... or *
    reference2?: string;
    limit: number;
    isOper?: boolean;
    includeEvents?: boolean;
  }): Promise<{
    ok: boolean;
    errorCode?: string;
    errorMessage?: string;
    messages: StoredChannelMessage[];
    isEnd?: boolean;
  }> {
    const _meta = this.ensureInitialized(params.channelName);
    const member = this.getMemberBySession(params.sessionId);
    const fullMask = `${params.nickname}!${params.username}@${params.hostname}`;

    // Nonexistent channel or unjoined non-oper client cannot retrieve channel history
    if (!params.isOper) {
      if (!member) {
        return {
          ok: false,
          errorCode: "INVALID_TARGET",
          errorMessage: "Messages could not be retrieved",
          messages: [],
        };
      }
      if (this.isBanned(fullMask, params.accountName)) {
        return {
          ok: false,
          errorCode: "ACCOUNT_REQUIRED",
          errorMessage: "Banned users cannot retrieve channel history",
          messages: [],
        };
      }
    } else if (this.getMembers().length === 0 && this.getMeta("registered") !== "1") {
      return {
        ok: false,
        errorCode: "INVALID_TARGET",
        errorMessage: "Messages could not be retrieved",
        messages: [],
      };
    }

    const boundedLimit = Math.min(
      Math.max(1, params.limit || SERVER_CONFIG.defaultHistoryLimit),
      SERVER_CONFIG.maxHistoryLimit,
    );
    const now = Date.now();
    const sub = params.subcommand.toUpperCase();

    const resolveSequenceOrTimestamp = (
      ref: string | undefined,
    ): { type: "seq" | "ts" | "wildcard"; val: number } | null => {
      if (!ref || ref === "*") {
        return { type: "wildcard", val: 0 };
      }
      if (ref.startsWith("msgid=")) {
        const id = ref.slice("msgid=".length);
        const rows = this.sql
          .exec<{ sequence: number }>("SELECT sequence FROM messages WHERE id = ?", id)
          .toArray();
        if (rows.length === 0) return null;
        return { type: "seq", val: rows[0].sequence };
      }
      if (ref.startsWith("timestamp=")) {
        const tsStr = ref.slice("timestamp=".length);
        const parsed = Date.parse(tsStr);
        if (Number.isNaN(parsed)) return null;
        return { type: "ts", val: parsed };
      }
      return null;
    };

    type MsgRow = {
      id: string;
      sequence: number;
      sender_id: string;
      sender_account: string | null;
      sender_nick: string;
      sender_user: string;
      sender_host: string;
      command: "PRIVMSG" | "NOTICE" | "TAGMSG" | "TOPIC" | "MODE" | "JOIN" | "PART" | "KICK";
      content: string;
      tags_json: string;
      multiline_json: string | null;
      redacted: number;
      created_at: number;
      expires_at: number;
    };

    const cmdClause = params.includeEvents ? "" : " AND command IN ('PRIVMSG', 'NOTICE')";

    let rows: MsgRow[] = [];
    const fetchLimit = boundedLimit + 1; // +1 to detect if we reached the end of available history

    if (sub === "LATEST") {
      const ref = resolveSequenceOrTimestamp(params.reference1);
      if (!ref) {
        return {
          ok: false,
          errorCode: "INVALID_PARAMS",
          errorMessage: "Invalid reference",
          messages: [],
        };
      }
      if (ref.type === "wildcard") {
        rows = this.sql
          .exec<MsgRow>(
            `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ?${cmdClause} ORDER BY sequence DESC LIMIT ?`,
            now,
            fetchLimit,
          )
          .toArray();
      } else if (ref.type === "seq") {
        rows = this.sql
          .exec<MsgRow>(
            `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND sequence > ?${cmdClause} ORDER BY sequence DESC LIMIT ?`,
            now,
            ref.val,
            fetchLimit,
          )
          .toArray();
      } else {
        rows = this.sql
          .exec<MsgRow>(
            `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND created_at > ?${cmdClause} ORDER BY sequence DESC LIMIT ?`,
            now,
            ref.val,
            fetchLimit,
          )
          .toArray();
      }
      const isEnd = rows.length <= boundedLimit;
      rows = rows.slice(0, boundedLimit).reverse();
      return {
        ok: true,
        messages: rows.map((r) => this.rowToStoredMessage(r)),
        isEnd,
      };
    } else if (sub === "BEFORE") {
      const ref = resolveSequenceOrTimestamp(params.reference1);
      if (!ref || ref.type === "wildcard") {
        return {
          ok: false,
          errorCode: "INVALID_PARAMS",
          errorMessage: "Invalid BEFORE reference",
          messages: [],
        };
      }
      if (ref.type === "seq") {
        rows = this.sql
          .exec<MsgRow>(
            `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND sequence < ?${cmdClause} ORDER BY sequence DESC LIMIT ?`,
            now,
            ref.val,
            fetchLimit,
          )
          .toArray();
      } else {
        rows = this.sql
          .exec<MsgRow>(
            `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND created_at < ?${cmdClause} ORDER BY sequence DESC LIMIT ?`,
            now,
            ref.val,
            fetchLimit,
          )
          .toArray();
      }
      const isEnd = rows.length <= boundedLimit;
      rows = rows.slice(0, boundedLimit).reverse();
      return {
        ok: true,
        messages: rows.map((r) => this.rowToStoredMessage(r)),
        isEnd,
      };
    } else if (sub === "AFTER") {
      const ref = resolveSequenceOrTimestamp(params.reference1);
      if (!ref || ref.type === "wildcard") {
        return {
          ok: false,
          errorCode: "INVALID_PARAMS",
          errorMessage: "Invalid AFTER reference",
          messages: [],
        };
      }
      if (ref.type === "seq") {
        rows = this.sql
          .exec<MsgRow>(
            `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND sequence > ?${cmdClause} ORDER BY sequence ASC LIMIT ?`,
            now,
            ref.val,
            fetchLimit,
          )
          .toArray();
      } else {
        rows = this.sql
          .exec<MsgRow>(
            `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND created_at > ?${cmdClause} ORDER BY sequence ASC LIMIT ?`,
            now,
            ref.val,
            fetchLimit,
          )
          .toArray();
      }
      const isEnd = rows.length <= boundedLimit;
      rows = rows.slice(0, boundedLimit);
      return {
        ok: true,
        messages: rows.map((r) => this.rowToStoredMessage(r)),
        isEnd,
      };
    } else if (sub === "AROUND") {
      const ref = resolveSequenceOrTimestamp(params.reference1);
      if (!ref || ref.type === "wildcard") {
        return {
          ok: false,
          errorCode: "INVALID_PARAMS",
          errorMessage: "Invalid AROUND reference",
          messages: [],
        };
      }
      const beforeCount = Math.floor((boundedLimit - 1) / 2) + 1; // includes center
      const beforeRows =
        ref.type === "seq"
          ? this.sql
              .exec<MsgRow>(
                `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND sequence <= ?${cmdClause} ORDER BY sequence DESC LIMIT ?`,
                now,
                ref.val,
                beforeCount,
              )
              .toArray()
              .reverse()
          : this.sql
              .exec<MsgRow>(
                `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND created_at <= ?${cmdClause} ORDER BY sequence DESC LIMIT ?`,
                now,
                ref.val,
                beforeCount,
              )
              .toArray()
              .reverse();
      const afterCount = boundedLimit - beforeRows.length;
      const afterRows =
        afterCount <= 0
          ? []
          : ref.type === "seq"
            ? this.sql
                .exec<MsgRow>(
                  `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND sequence > ?${cmdClause} ORDER BY sequence ASC LIMIT ?`,
                  now,
                  ref.val,
                  afterCount,
                )
                .toArray()
            : this.sql
                .exec<MsgRow>(
                  `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ? AND created_at > ?${cmdClause} ORDER BY sequence ASC LIMIT ?`,
                  now,
                  ref.val,
                  afterCount,
                )
                .toArray();

      rows = [...beforeRows, ...afterRows];
      return {
        ok: true,
        messages: rows.map((r) => this.rowToStoredMessage(r)),
        isEnd: rows.length < boundedLimit,
      };
    } else if (sub === "BETWEEN") {
      const ref1 = resolveSequenceOrTimestamp(params.reference1);
      const ref2 = resolveSequenceOrTimestamp(params.reference2);
      if (!ref1 || !ref2) {
        return {
          ok: false,
          errorCode: "INVALID_PARAMS",
          errorMessage: "Invalid BETWEEN references",
          messages: [],
        };
      }
      const allRows = this.sql
        .exec<MsgRow>(
          `SELECT * FROM messages WHERE redacted = 0 AND expires_at > ?${cmdClause} ORDER BY sequence ASC`,
          now,
        )
        .toArray();

      const v1 = ref1.val;
      const v2 = ref2.val;
      const isForward = ref1.type === "wildcard" || ref2.type === "wildcard" ? true : v1 <= v2;
      const minVal = Math.min(v1, v2);
      const maxVal = Math.max(v1, v2);

      const inRange = allRows.filter((r) => {
        const val = ref1.type === "seq" ? r.sequence : r.created_at;
        const lowerOk =
          ref1.type === "wildcard" || ref2.type === "wildcard"
            ? ref1.type === "wildcard"
              ? true
              : val > ref1.val
            : val > minVal;
        const upperOk =
          ref1.type === "wildcard" || ref2.type === "wildcard"
            ? ref2.type === "wildcard"
              ? true
              : val < ref2.val
            : val < maxVal;
        return lowerOk && upperOk;
      });

      if (isForward) {
        rows = inRange.slice(0, boundedLimit);
      } else {
        rows = inRange.slice(-boundedLimit);
      }
      const isEnd = inRange.length <= boundedLimit;
      return {
        ok: true,
        messages: rows.map((r) => this.rowToStoredMessage(r)),
        isEnd,
      };
    } else {
      return {
        ok: false,
        errorCode: "UNKNOWN_COMMAND",
        errorMessage: `Unsupported CHATHISTORY subcommand: ${sub}`,
        messages: [],
      };
    }
  }

  public async getChannelSummary(channelName?: string): Promise<ChannelStateSummary> {
    const meta = this.ensureInitialized(channelName);
    const members = this.getMembers();
    const topicSetAtStr = this.getMeta("topic_set_at");
    const regAtStr = this.getMeta("registered_at");
    return {
      name: meta.name,
      canonicalName: meta.canonicalName,
      topic: this.getMeta("topic"),
      topicSetBy: this.getMeta("topic_set_by"),
      topicSetAt: topicSetAtStr ? parseInt(topicSetAtStr, 10) : null,
      modes: meta.modes,
      registered: this.getMeta("registered") === "1",
      founder: this.getMeta("founder"),
      registeredAt: regAtStr ? parseInt(regAtStr, 10) : null,
      memberCount: members.length,
      members,
      createdAt: meta.createdAt,
    };
  }

  public async validateForwardTarget(
    actorSessionId: string,
    isOper: boolean,
  ): Promise<{
    exists: boolean;
    isOp: boolean;
  }> {
    const members = this.getMembers();
    const exists = members.length > 0 || this.getMeta("registered") === "1";
    const member = members.find((m) => m.sessionId === actorSessionId);
    const isOp = isOper || hasChannelOp(member?.modes ?? "", isOper);
    return { exists, isOp };
  }

  // Channel Metadata RPC (draft/metadata-2 & draft/metadata-3)
  public async setChannelMetadata(key: string, value: string | null): Promise<void> {
    if (this.getMeta("rename_pending")) throw new Error("Channel rename in progress");
    const canonKey = key.toLowerCase();
    if (value === null || value === "") {
      this.sql.exec("DELETE FROM channel_kv_metadata WHERE key = ?", canonKey);
    } else {
      this.sql.exec(
        `INSERT INTO channel_kv_metadata (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        canonKey,
        value,
        Date.now(),
      );
    }
  }

  public async getChannelMetadata(keys?: string[]): Promise<Record<string, string>> {
    const rows = this.sql
      .exec<{ key: string; value: string }>("SELECT key, value FROM channel_kv_metadata")
      .toArray();
    const out: Record<string, string> = {};
    const filterSet = keys ? new Set(keys.map((k) => k.toLowerCase())) : null;
    for (const r of rows) {
      if (!filterSet || filterSet.has(r.key)) {
        out[r.key] = r.value;
      }
    }
    return out;
  }

  public async clearChannelMetadata(): Promise<string[]> {
    const keys = this.sql
      .exec<{ key: string }>("SELECT key FROM channel_kv_metadata")
      .toArray()
      .map((r) => r.key);
    this.sql.exec("DELETE FROM channel_kv_metadata");
    return keys;
  }

  // Modern Channel Info & Categories
  public async getChannelInfo(channelName?: string): Promise<ChannelInfo> {
    const meta = this.ensureInitialized(channelName);
    const kv = await this.getChannelMetadata();
    const regAtStr = this.getMeta("registered_at");
    const topicInfo = await this.getTopicInfo(meta.name);
    const memberCount = this.getMembers().length;

    let tags: string[] = [];
    if (kv.tags) {
      try {
        tags = JSON.parse(kv.tags);
      } catch {
        tags = kv.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    const nsfw = kv.nsfw === "true" || kv.nsfw === "1";

    return {
      channel: meta.name,
      canonicalName: meta.canonicalName,
      topic: topicInfo.topic,
      topicSetBy: topicInfo.topicSetBy,
      topicSetAt: topicInfo.topicSetAt,
      modes: meta.modes,
      registered: this.getMeta("registered") === "1",
      founder: this.getMeta("founder"),
      registeredAt: regAtStr ? parseInt(regAtStr, 10) : null,
      avatar: kv.avatar ?? null,
      description: kv.description ?? null,
      category: kv.category ?? null,
      color: kv.color ?? null,
      readOnly: kv["read-only"] === "true" || kv.readonly === "true",
      memberCount,
      createdAt: meta.createdAt,
      tags,
      nsfw,
    };
  }

  public async setChannelInfo(
    updates: {
      avatar?: string | null;
      description?: string | null;
      category?: string | null;
      color?: string | null;
      readOnly?: boolean | string | null;
      topic?: string | null;
      tags?: string[] | null;
      nsfw?: boolean | string | null;
    },
    channelName?: string,
    actor?: string,
  ): Promise<ChannelInfo> {
    this.ensureInitialized(channelName);
    if (updates.avatar !== undefined) {
      await this.setChannelMetadata(
        "avatar",
        updates.avatar ? updates.avatar.trim().slice(0, 2048) : null,
      );
    }
    if (updates.description !== undefined) {
      await this.setChannelMetadata(
        "description",
        updates.description ? updates.description.trim().slice(0, 2048) : null,
      );
    }
    if (updates.category !== undefined) {
      await this.setChannelMetadata(
        "category",
        updates.category ? updates.category.trim().slice(0, 128) : null,
      );
    }
    if (updates.color !== undefined) {
      await this.setChannelMetadata(
        "color",
        updates.color ? updates.color.trim().slice(0, 32) : null,
      );
    }
    if (updates.readOnly !== undefined) {
      const isRo =
        updates.readOnly === true || updates.readOnly === "true" || updates.readOnly === "1";
      await this.setChannelMetadata("read-only", isRo ? "true" : null);
    }
    if (updates.tags !== undefined) {
      await this.setChannelMetadata(
        "tags",
        Array.isArray(updates.tags) ? JSON.stringify(updates.tags) : null,
      );
    }
    if (updates.nsfw !== undefined) {
      const isNsfw = updates.nsfw === true || updates.nsfw === "true" || updates.nsfw === "1";
      await this.setChannelMetadata("nsfw", isNsfw ? "true" : null);
    }
    if (updates.topic !== undefined) {
      await this.adminSetTopic(updates.topic ?? "", actor ?? "admin");
    }
    return this.getChannelInfo();
  }

  private serializeRole(row: any): Record<string, any> {
    const prefixes: Record<string, string> = { q: "~", a: "&", o: "@", h: "%", v: "+" };
    return {
      id: row.id,
      name: row.name,
      color: row.color ?? null,
      ircMode: row.irc_mode ?? null,
      ircPrefix: prefixes[row.irc_mode] ?? null,
      priority: row.position ?? row.priority ?? 0,
      permissions: JSON.parse(row.permissions_json ?? "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }

  public async getRoleGroups(): Promise<any[]> {
    return this.sql
      .exec("SELECT * FROM channel_role_groups ORDER BY position ASC")
      .toArray()
      .map((row) => this.serializeRole(row));
  }

  public async createRoleGroup(group: {
    id?: string;
    name: string;
    color?: string | null;
    position?: number;
    priority?: number;
    ircMode?: string | null;
    ircPrefix?: string | null;
    permissions?: any;
  }): Promise<any> {
    const id = group.id || crypto.randomUUID();
    const now = Date.now();
    const pos = group.position ?? group.priority ?? 0;
    this.sql.exec(
      `INSERT INTO channel_role_groups (id, name, color, position, irc_mode, permissions_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      group.name,
      group.color ?? null,
      pos,
      group.ircMode ?? null,
      JSON.stringify(group.permissions ?? {}),
      now,
      now,
    );
    const info = await this.getChannelInfo();
    const roleEvt = {
      channel: info.channel,
      roleGroupId: id,
      name: group.name,
      ircMode: group.ircMode ?? null,
    };
    domainEvents.emit("channel.role_created", roleEvt);
    try {
      const sessionStub = this.env.SESSION.get(
        this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
      );
      await sessionStub.broadcastRealtimeEvent({
        type: "channel.role_created",
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        channelId: info.channel,
        data: roleEvt,
      });
    } catch {}
    return this.serializeRole(
      this.sql.exec("SELECT * FROM channel_role_groups WHERE id = ?", id).toArray()[0],
    );
  }

  public async updateRoleGroup(
    id: string,
    updates: {
      name?: string;
      color?: string;
      position?: number;
      ircMode?: string | null;
      priority?: number;
      permissions?: string[];
    },
  ): Promise<any> {
    const existing = this.sql
      .exec<any>("SELECT * FROM channel_role_groups WHERE id = ?", id)
      .toArray()[0];
    if (!existing) return null;
    const now = Date.now();
    const name = updates.name ?? existing.name;
    const color = updates.color !== undefined ? updates.color : existing.color;
    const position = updates.position ?? updates.priority ?? existing.position;
    const ircMode = updates.ircMode !== undefined ? updates.ircMode : existing.irc_mode;
    const permissionsJson = updates.permissions
      ? JSON.stringify(updates.permissions)
      : existing.permissions_json;

    this.sql.exec(
      `UPDATE channel_role_groups SET name = ?, color = ?, position = ?, irc_mode = ?, permissions_json = ?, updated_at = ? WHERE id = ?`,
      name,
      color,
      position,
      ircMode,
      permissionsJson,
      now,
      id,
    );
    return this.serializeRole(
      this.sql.exec("SELECT * FROM channel_role_groups WHERE id = ?", id).toArray()[0],
    );
  }

  public async deleteRoleGroup(id: string): Promise<boolean> {
    return (
      this.sql.exec("DELETE FROM channel_role_groups WHERE id = ? RETURNING id", id).toArray()
        .length > 0
    );
  }

  public async assignUserRole(userId: string, roleGroupId: string): Promise<boolean> {
    const now = Date.now();
    this.db
      .insert(channelsSchema.channelUserRoles)
      .values({ userId, groupId: roleGroupId, assignedAt: now })
      .onConflictDoNothing()
      .run();
    return true;
  }

  public async removeUserRole(userId: string, roleGroupId: string): Promise<boolean> {
    return (
      this.db
        .delete(channelsSchema.channelUserRoles)
        .where(
          and(
            eq(channelsSchema.channelUserRoles.userId, userId),
            eq(channelsSchema.channelUserRoles.groupId, roleGroupId),
          ),
        )
        .returning({ id: channelsSchema.channelUserRoles.userId })
        .all().length > 0
    );
  }

  public async getUserRoles(userId: string): Promise<any[]> {
    return this.sql
      .exec(
        `SELECT g.* FROM channel_role_groups g
       JOIN channel_user_roles r ON g.id = r.group_id
       WHERE r.user_id = ? ORDER BY g.position ASC`,
        userId,
      )
      .toArray();
  }

  public async editMessage(
    messageId: string,
    actorUserId: string,
    newContent: string,
  ): Promise<{ ok: boolean; error?: string; message?: Record<string, any> }> {
    const rows = this.sql.exec<any>("SELECT * FROM messages WHERE id = ?", messageId).toArray();
    if (rows.length === 0) {
      return { ok: false, error: "Message not found" };
    }
    const msg = rows[0];
    if (msg.sender_id !== actorUserId || msg.redacted || msg.expires_at <= Date.now()) {
      return { ok: false, error: "You can only edit your own messages" };
    }
    const now = Date.now();
    const tags = JSON.parse(msg.tags_json || "{}");
    tags["+ircord/edit"] = messageId;
    tags["+draft/edit"] = messageId;
    tags["+edit"] = messageId;
    tags.edited_at = new Date(now).toISOString();
    tags.time = new Date(now).toISOString();

    this.sql.exec(
      "UPDATE messages SET content = ?, tags_json = ?, multiline_json = NULL WHERE id = ?",
      newContent,
      JSON.stringify(tags),
      messageId,
    );

    const channelName = (await this.getChannelInfo()).channel;
    const msgEvt = {
      channel: channelName,
      messageId,
      newContent,
      editor: msg.sender_nick,
    };
    domainEvents.emit("message.updated", msgEvt);
    try {
      const sessionStub = this.env.SESSION.get(
        this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
      );
      await sessionStub.broadcastRealtimeEvent({
        type: "message.updated",
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        channelId: channelName,
        messageId,
        data: msgEvt,
      });
    } catch {}

    return {
      ok: true,
      message: {
        id: messageId,
        content: newContent,
        tags,
        editedAt: now,
      },
    };
  }

  public async getUnreadSummary(
    userKey: string,
    lastReadTimestampMs = 0,
  ): Promise<{
    unreadCount: number;
    mentionCount: number;
    lastMessageId: string | null;
    lastMessageTime: number | null;
  }> {
    const canonUser = canonicalizeIRCName(userKey);
    const lastRow = this.sql
      .exec<{ id: string; created_at: number }>(
        `SELECT id, created_at FROM messages WHERE redacted = 0 AND expires_at > ${Date.now()} ORDER BY sequence DESC LIMIT 1`,
      )
      .toArray();

    const lastMessageId = lastRow.length > 0 ? lastRow[0].id : null;
    const lastMessageTime = lastRow.length > 0 ? lastRow[0].created_at : null;

    if (lastReadTimestampMs >= (lastMessageTime ?? 0)) {
      return {
        unreadCount: 0,
        mentionCount: 0,
        lastMessageId,
        lastMessageTime,
      };
    }

    const unreadRows = this.sql
      .exec<{ content: string }>(
        `SELECT content FROM messages WHERE redacted = 0 AND expires_at > ${Date.now()} AND created_at > ?`,
        lastReadTimestampMs,
      )
      .toArray();

    const unreadCount = unreadRows.length;
    let mentionCount = 0;
    const escapedUser = canonUser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionPattern = new RegExp(`(^|[^a-zA-Z0-9_-])@?${escapedUser}([: ,]|$)`, "i");

    for (const r of unreadRows) {
      if (mentionPattern.test(r.content)) {
        mentionCount++;
      }
    }

    return {
      unreadCount,
      mentionCount,
      lastMessageId,
      lastMessageTime,
    };
  }

  // Ergo ChanServ (CS) RPC methods
  public async csInfo(channelName?: string): Promise<{
    channelName: string;
    registered: boolean;
    founder: string | null;
    registeredAt: number | null;
  }> {
    const meta = this.ensureInitialized(channelName);
    const regAtStr = this.getMeta("registered_at");
    return {
      channelName: meta.name,
      registered: this.getMeta("registered") === "1",
      founder: this.getMeta("founder"),
      registeredAt: regAtStr ? parseInt(regAtStr, 10) : null,
    };
  }

  public async csRegister(params: {
    channelName?: string;
    actorSessionId: string;
    actorUserId: string;
    actorAccount: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    message: string;
    channelName: string;
    appliedModes?: string;
    appliedNick?: string;
    recipientSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("registered") === "1") {
      return {
        ok: false,
        message: `Channel ${meta.name} is already registered`,
        channelName: meta.name,
      };
    }

    const member = this.getMemberBySession(params.actorSessionId);
    if (!member && !params.isOper) {
      return {
        ok: false,
        message: `You must be on ${meta.name} to register it`,
        channelName: meta.name,
      };
    }
    if (!hasChannelOp(member?.modes ?? "", params.isOper)) {
      return {
        ok: false,
        message: "You must be a channel operator to register this channel",
        channelName: meta.name,
      };
    }

    const now = Date.now();
    const canonAcct = canonicalizeIRCName(params.actorAccount);
    this.setMeta("registered", "1");
    this.setMeta("founder", params.actorAccount);
    this.setMeta("registered_at", String(now));
    this.setMeta("has_founder", "1");
    if (SERVER_CONFIG.fBotAutoJoin) {
      this.setMeta("f_bot_enabled", "1");
    }

    const modeSet = new Set(meta.modes.split("").filter(Boolean));
    modeSet.add("r");
    this.setMeta("modes", Array.from(modeSet).join(""));

    // Grant founder (+q) persistent mode (single mode per account for Ergo AMODE compatibility)
    this.sql.exec(
      "DELETE FROM channel_permissions WHERE user_id = ? OR account_name = ?",
      params.actorUserId,
      canonAcct,
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO channel_permissions (user_id, account_name, permission) VALUES (?, ?, 'q')",
      params.actorUserId,
      canonAcct,
    );

    if (member) {
      const mSet = new Set(this.baseMemberModes(member.sessionId).split("").filter(Boolean));
      mSet.add("q");
      this.sql.exec(
        "UPDATE channel_members SET modes = ? WHERE session_id = ?",
        Array.from(mSet).join(""),
        member.sessionId,
      );
    }

    return {
      ok: true,
      message: `Channel ${meta.name} successfully registered`,
      channelName: meta.name,
      appliedModes: "+q",
      appliedNick: member?.nickname,
      recipientSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async csAmode(params: {
    channelName?: string;
    actorSessionId: string;
    actorUserId: string;
    actorAccount: string | null;
    modeChange?: string;
    targetAccount?: string;
    targetUserId?: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    lines: string[];
    appliedModeString?: string;
    appliedModeNick?: string;
    recipientSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("registered") !== "1") {
      return { ok: false, lines: ["Channel is not registered"] };
    }

    const rankOrder = ["q", "a", "o", "h", "v"];

    // List persistent modes if no modeChange is given
    if (!params.modeChange) {
      const rows = this.sql
        .exec<{ user_id: string; account_name: string | null; permission: string }>(
          "SELECT user_id, account_name, permission FROM channel_permissions WHERE account_name IS NOT NULL ORDER BY account_name ASC",
        )
        .toArray();

      // Deduplicate by account_name, keeping highest single mode in qaohv
      const byAccount = new Map<string, string>();
      const founder = this.getMeta("founder");
      if (founder) {
        byAccount.set(canonicalizeIRCName(founder), "q");
      }
      for (const r of rows) {
        if (!r.account_name || !rankOrder.includes(r.permission)) continue;
        const acctKey = canonicalizeIRCName(r.account_name);
        const existing = byAccount.get(acctKey);
        if (!existing || rankOrder.indexOf(r.permission) < rankOrder.indexOf(existing)) {
          byAccount.set(acctKey, r.permission);
        }
      }

      const lines: string[] = [`Channel ${meta.name} has ${byAccount.size} persistent modes set`];
      for (const [acct, perm] of byAccount.entries()) {
        lines.push(`Account ${acct} receives mode +${perm}`);
      }
      return { ok: true, lines };
    }

    const member = this.getMemberBySession(params.actorSessionId);
    const founder = this.getMeta("founder");
    const isFounderAcct =
      founder &&
      params.actorAccount &&
      canonicalizeIRCName(founder) === canonicalizeIRCName(params.actorAccount);
    if (!hasChannelOp(member?.modes ?? "", params.isOper) && !isFounderAcct) {
      return {
        ok: false,
        lines: ["You do not have sufficient privileges to change persistent modes"],
      };
    }

    if (!params.isOper && !isFounderAcct && /[qa]/.test(params.modeChange ?? "")) {
      return { ok: false, lines: ["Only the founder can change owner or administrator access"] };
    }

    if (!params.targetAccount || !params.targetUserId) {
      return { ok: false, lines: ["Account does not exist"] };
    }

    const canonTargetAcct = canonicalizeIRCName(params.targetAccount);
    let adding = true;
    const modeChars: Array<{ sign: "+" | "-"; mode: string }> = [];
    for (const ch of params.modeChange) {
      if (ch === "+") adding = true;
      else if (ch === "-") adding = false;
      else if (rankOrder.includes(ch)) {
        modeChars.push({ sign: adding ? "+" : "-", mode: ch });
      }
    }

    if (modeChars.length === 0) {
      return { ok: false, lines: ["No changes were made"] };
    }

    if (!params.isOper && !isFounderAcct) {
      const actorRank = this.privilegeRank(member?.modes ?? "");
      const targetAccess = this.sql
        .exec<{ permission: string }>(
          "SELECT permission FROM channel_permissions WHERE user_id = ?",
          params.targetUserId,
        )
        .toArray()
        .map((row) => row.permission)
        .join("");
      const targetModes = this.getMembers()
        .filter((m) => m.userId === params.targetUserId)
        .map((m) => m.modes)
        .join("");
      if (
        this.privilegeRank(targetAccess + targetModes) > actorRank ||
        modeChars.some((change) => this.privilegeRank(change.mode) > actorRank)
      )
        return { ok: false, lines: ["Cannot change higher channel privileges"] };
    }

    for (const mc of modeChars) {
      if (mc.sign === "+") {
        this.sql.exec(
          "DELETE FROM channel_permissions WHERE user_id = ? OR account_name = ?",
          params.targetUserId,
          canonTargetAcct,
        );
        this.sql.exec(
          "INSERT OR IGNORE INTO channel_permissions (user_id, account_name, permission) VALUES (?, ?, ?)",
          params.targetUserId,
          canonTargetAcct,
          mc.mode,
        );
      } else {
        this.sql.exec(
          "DELETE FROM channel_permissions WHERE (user_id = ? OR account_name = ?) AND permission = ?",
          params.targetUserId,
          canonTargetAcct,
          mc.mode,
        );
      }
    }

    // Also update live channel member if currently joined
    const liveMembers = this.getMembers().filter(
      (m) =>
        m.userId === params.targetUserId ||
        (m.accountName && canonicalizeIRCName(m.accountName) === canonTargetAcct),
    );
    let appliedModeString: string | undefined;
    let appliedModeNick: string | undefined;
    for (const liveMember of liveMembers) {
      const mSet = new Set(this.baseMemberModes(liveMember.sessionId).split("").filter(Boolean));
      for (const mc of modeChars) {
        if (mc.sign === "+") {
          for (const r of ["a", "o", "h", "v"]) {
            mSet.delete(r);
          }
          mSet.add(mc.mode);
        } else {
          mSet.delete(mc.mode);
        }
      }
      this.sql.exec(
        "UPDATE channel_members SET modes = ? WHERE session_id = ?",
        Array.from(mSet).join(""),
        liveMember.sessionId,
      );
      appliedModeString = params.modeChange;
      appliedModeNick ??= liveMember.nickname;
    }

    return {
      ok: true,
      lines: [
        `Successfully set persistent mode ${params.modeChange} for ${params.targetAccount} on ${meta.name}`,
      ],
      appliedModeString,
      appliedModeNick,
      recipientSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async csUnregister(params: {
    channelName?: string;
    actorSessionId: string;
    actorAccount: string | null;
    code?: string;
    isOper?: boolean;
  }): Promise<{ ok: boolean; lines: string[] }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("registered") !== "1") {
      return { ok: false, lines: ["Channel is not registered"] };
    }

    const founder = this.getMeta("founder");
    const isFounder =
      params.isOper ||
      (founder &&
        params.actorAccount &&
        canonicalizeIRCName(founder) === canonicalizeIRCName(params.actorAccount));

    if (!isFounder) {
      return { ok: false, lines: ["Insufficient privileges"] };
    }

    const expectedCode = this.getMeta("unregister_code");
    if (!params.code) {
      const newCode = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      this.setMeta("unregister_code", newCode);
      return {
        ok: true,
        lines: [`To confirm, run this command: /CS UNREGISTER ${meta.name} ${newCode}`],
      };
    }

    if (params.code !== expectedCode) {
      return { ok: false, lines: ["Invalid confirmation code"] };
    }

    this.deleteMeta("registered");
    this.deleteMeta("founder");
    this.deleteMeta("registered_at");
    this.deleteMeta("unregister_code");
    this.deleteMeta("has_founder");
    this.deleteMeta("f_bot_enabled");
    this.deleteMeta("f_bot_welcome");
    const modeSet = new Set(meta.modes.split("").filter(Boolean));
    modeSet.delete("r");
    this.setMeta("modes", Array.from(modeSet).join(""));
    this.sql.exec("DELETE FROM channel_permissions");

    return { ok: true, lines: [`Channel ${meta.name} is now unregistered`] };
  }

  private syncFounderModes(newFounderId: string): void {
    for (const member of this.getMembers()) {
      const modes = new Set(this.baseMemberModes(member.sessionId).split(""));
      if (member.userId === newFounderId) {
        modes.add("q");
        modes.add("o");
      } else modes.delete("q");
      this.sql.exec(
        "UPDATE channel_members SET modes = ? WHERE session_id = ?",
        Array.from(modes).join(""),
        member.sessionId,
      );
    }
  }

  public async csTransfer(params: {
    channelName?: string;
    actorAccount: string | null;
    targetAccount: string;
    targetUserId: string;
    code?: string;
    isAccept?: boolean;
    isOper?: boolean;
  }): Promise<{ ok: boolean; lines: string[] }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("registered") !== "1") {
      return { ok: false, lines: ["Channel is not registered"] };
    }

    if (params.isAccept) {
      const pendingTarget = this.getMeta("transfer_target");
      if (
        !pendingTarget ||
        !params.actorAccount ||
        canonicalizeIRCName(pendingTarget) !== canonicalizeIRCName(params.actorAccount)
      ) {
        return { ok: false, lines: ["Invalid channel transfer"] };
      }
      const prevFounder = this.getMeta("founder");
      if (prevFounder) {
        this.sql.exec(
          "DELETE FROM channel_permissions WHERE account_name = ? AND permission = 'q'",
          canonicalizeIRCName(prevFounder),
        );
      }
      this.setMeta("founder", params.actorAccount);
      this.deleteMeta("transfer_target");
      this.deleteMeta("transfer_code");
      this.sql.exec(
        "DELETE FROM channel_permissions WHERE user_id = ? OR account_name = ?",
        params.targetUserId,
        canonicalizeIRCName(params.actorAccount),
      );
      this.sql.exec(
        "INSERT OR IGNORE INTO channel_permissions (user_id, account_name, permission) VALUES (?, ?, 'q')",
        params.targetUserId,
        canonicalizeIRCName(params.actorAccount),
      );
      this.syncFounderModes(params.targetUserId);
      return {
        ok: true,
        lines: [`Successfully transferred channel ${meta.name} to account ${params.actorAccount}`],
      };
    }

    const founder = this.getMeta("founder");
    const isFounder =
      params.isOper ||
      (founder &&
        params.actorAccount &&
        canonicalizeIRCName(founder) === canonicalizeIRCName(params.actorAccount));

    if (!isFounder) {
      return { ok: false, lines: ["Insufficient privileges"] };
    }

    const expectedCode = this.getMeta("transfer_code");
    if (!params.code) {
      const newCode = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      this.setMeta("transfer_code", newCode);
      this.setMeta("transfer_target", params.targetAccount);
      return {
        ok: true,
        lines: [
          `To confirm, run this command: /CS TRANSFER ${meta.name} ${params.targetAccount} ${newCode}`,
        ],
      };
    }

    if (params.code !== expectedCode) {
      return { ok: false, lines: ["Invalid confirmation code"] };
    }

    if (founder) {
      this.sql.exec(
        "DELETE FROM channel_permissions WHERE account_name = ? AND permission = 'q'",
        canonicalizeIRCName(founder),
      );
    }
    this.setMeta("founder", params.targetAccount);
    this.deleteMeta("transfer_code");
    this.deleteMeta("transfer_target");
    this.sql.exec(
      "DELETE FROM channel_permissions WHERE user_id = ? OR account_name = ?",
      params.targetUserId,
      canonicalizeIRCName(params.targetAccount),
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO channel_permissions (user_id, account_name, permission) VALUES (?, ?, 'q')",
      params.targetUserId,
      canonicalizeIRCName(params.targetAccount),
    );

    this.syncFounderModes(params.targetUserId);
    return {
      ok: true,
      lines: [`Successfully transferred channel ${meta.name} to account ${params.targetAccount}`],
    };
  }

  public async csOpDeop(params: {
    channelName?: string;
    actorSessionId: string;
    actorAccount: string | null;
    targetNick: string;
    adding: boolean;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    lines: string[];
    appliedModeString?: string;
    appliedModeNick?: string;
    recipientSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("registered") !== "1") {
      return { ok: false, lines: ["Channel is not registered"] };
    }
    const actor = this.getMemberBySession(params.actorSessionId);
    const founder = this.getMeta("founder");
    const isFounder =
      founder &&
      params.actorAccount &&
      canonicalizeIRCName(founder) === canonicalizeIRCName(params.actorAccount);
    const canonAcct = params.actorAccount ? canonicalizeIRCName(params.actorAccount) : "";
    const perms = this.sql
      .exec<{ permission: string }>(
        "SELECT permission FROM channel_permissions WHERE account_name = ?",
        canonAcct,
      )
      .toArray()
      .map((r) => r.permission);
    const hasPersistentOp = isFounder || perms.some((p) => ["q", "a", "o", "h"].includes(p));

    if (!params.isOper && !hasChannelOp(actor?.modes ?? "") && !hasPersistentOp) {
      return { ok: false, lines: ["Insufficient privileges"] };
    }

    if (canonicalizeIRCName(params.targetNick) === "f" && !params.adding) {
      return { ok: false, lines: ["Cannot remove operator status from network service bots"] };
    }

    const target = this.getMemberByNick(params.targetNick);
    if (!target) {
      return { ok: false, lines: [`Client ${params.targetNick} is not on channel ${meta.name}`] };
    }

    const actorRank = isFounder ? 5 : this.privilegeRank((actor?.modes ?? "") + perms.join(""));
    if (!params.isOper && (actorRank < 3 || this.privilegeRank(target.modes) > actorRank))
      return { ok: false, lines: ["Cannot change higher channel privileges"] };

    const mSet = new Set(this.baseMemberModes(target.sessionId).split("").filter(Boolean));
    if (params.adding) {
      mSet.add("o");
    } else {
      mSet.delete("o");
    }
    this.sql.exec(
      "UPDATE channel_members SET modes = ? WHERE session_id = ?",
      Array.from(mSet).join(""),
      target.sessionId,
    );
    const modeStr = params.adding ? "+o" : "-o";
    return {
      ok: true,
      lines: [
        `Successfully ${params.adding ? "opped" : "deopped"} ${target.nickname} on ${meta.name}`,
      ],
      appliedModeString: modeStr,
      appliedModeNick: target.nickname,
      recipientSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async csClear(params: {
    channelName?: string;
    actorSessionId: string;
    actorAccount: string | null;
    target: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    lines: string[];
    kickedMembers?: Array<{ sessionId: string; nickname: string }>;
    recipientSessionIds?: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("registered") !== "1") {
      return { ok: false, lines: ["Channel is not registered"] };
    }
    const actor = this.getMemberBySession(params.actorSessionId);
    const founder = this.getMeta("founder");
    const isFounder =
      params.isOper ||
      (founder &&
        params.actorAccount &&
        canonicalizeIRCName(founder) === canonicalizeIRCName(params.actorAccount)) ||
      hasChannelFounder(actor?.modes ?? "", params.isOper);

    if (!isFounder) {
      return { ok: false, lines: ["Insufficient privileges"] };
    }

    const sub = params.target.toLowerCase();
    if (sub === "access") {
      const founderCanon = founder ? canonicalizeIRCName(founder) : "";
      for (const member of this.getMembers()) {
        if (member.accountName && canonicalizeIRCName(member.accountName) === founderCanon)
          continue;
        const removed = this.sql
          .exec<{ permission: string }>(
            "SELECT permission FROM channel_permissions WHERE user_id = ?",
            member.userId,
          )
          .toArray();
        const modes = new Set(this.baseMemberModes(member.sessionId));
        for (const row of removed) modes.delete(row.permission);
        this.sql.exec(
          "UPDATE channel_members SET modes = ? WHERE session_id = ?",
          Array.from(modes).join(""),
          member.sessionId,
        );
      }
      this.sql.exec(
        "DELETE FROM channel_permissions WHERE account_name IS NULL OR account_name != ?",
        founderCanon,
      );
      return {
        ok: true,
        lines: [`Successfully cleared access list for ${meta.name}`],
      };
    }
    if (sub === "users") {
      const members = this.getMembers();
      const recipients = members.map((m) => m.sessionId);
      const kicked: Array<{ sessionId: string; nickname: string }> = [];
      for (const m of members) {
        if (m.sessionId === params.actorSessionId) continue;
        this.sql.exec("DELETE FROM channel_members WHERE session_id = ?", m.sessionId);
        kicked.push({ sessionId: m.sessionId, nickname: m.nickname });
      }
      return {
        ok: true,
        lines: [`Successfully cleared users from ${meta.name}`],
        kickedMembers: kicked,
        recipientSessionIds: recipients,
      };
    }
    return {
      ok: false,
      lines: ["Invalid CLEAR target (valid targets: users, access)"],
    };
  }

  public async csGetSet(params: {
    channelName?: string;
    actorSessionId: string;
    actorAccount: string | null;
    subcmd: "GET" | "SET";
    setting?: string;
    value?: string;
    isOper?: boolean;
  }): Promise<{ ok: boolean; lines: string[] }> {
    const meta = this.ensureInitialized(params.channelName);
    if (this.getMeta("registered") !== "1") {
      return { ok: false, lines: ["Channel is not registered"] };
    }
    const actor = this.getMemberBySession(params.actorSessionId);
    const founder = this.getMeta("founder");
    const isFounder =
      params.isOper ||
      (founder &&
        params.actorAccount &&
        canonicalizeIRCName(founder) === canonicalizeIRCName(params.actorAccount)) ||
      hasChannelOp(actor?.modes ?? "", params.isOper);

    if (!isFounder) {
      return { ok: false, lines: ["Insufficient privileges"] };
    }

    const key = (params.setting ?? "history").toLowerCase();
    if (params.subcmd === "GET") {
      const val = this.getMeta(`setting_${key}`) ?? "default";
      return {
        ok: true,
        lines: [`Channel ${meta.name} has setting ${key}=${val}`],
      };
    }
    const val = (params.value ?? "default").toLowerCase();
    this.setMeta(`setting_${key}`, val);
    return {
      ok: true,
      lines: [`Successfully changed channel setting ${key}=${val} for ${meta.name}`],
    };
  }

  public async histServDelete(
    channelName: string,
    msgid: string,
  ): Promise<{ ok: boolean; channelName: string; recipientSessionIds: string[] }> {
    const meta = this.ensureInitialized(channelName);
    const rows = this.sql
      .exec<{ id: string }>("SELECT id FROM messages WHERE id = ?", msgid)
      .toArray();
    if (rows.length === 0) {
      return { ok: false, channelName: meta.name, recipientSessionIds: [] };
    }
    this.sql.exec(
      "UPDATE messages SET redacted = 1, content = '', tags_json = '{}', multiline_json = NULL WHERE id = ?",
      msgid,
    );
    return {
      ok: true,
      channelName: meta.name,
      recipientSessionIds: this.getMembers().map((m) => m.sessionId),
    };
  }

  public async histServForget(
    channelName: string,
    accountOrNick: string,
  ): Promise<{ ok: boolean; count: number }> {
    this.ensureInitialized(channelName);
    const count = this.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM messages WHERE sender_id = ?",
        accountOrNick,
      )
      .toArray()[0].count;
    this.sql.exec("DELETE FROM messages WHERE sender_id = ?", accountOrNick);
    return { ok: true, count };
  }

  private readonly renameTables = [
    "channel_metadata",
    "channel_kv_metadata",
    "channel_permissions",
    "channel_bans",
    "channel_list_modes",
    "channel_invites",
    "channel_role_groups",
    "channel_user_roles",
    "channel_members",
    "messages",
    "message_edits",
    "channel_webhooks",
    "webhook_limits",
    "channel_outgoing_webhooks",
  ];

  public async exportChannelStateForRename(actorSessionId: string, destination: string) {
    const actor = await this.env.SESSION.get(
      this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
    ).getSessionActor(actorSessionId);
    const member = this.getMemberBySession(actorSessionId);
    if (!actor || (!actor.isOper && !hasChannelOp(member?.modes ?? "")))
      throw new Error("Channel operator permission required");
    if (this.getMeta("archived") === "1" || this.getMeta("rename_pending"))
      throw new Error("Channel is unavailable for rename");
    if (!isValidChannelName(destination)) throw new Error("Invalid destination");
    const tables = this.renameTables.map((name) => ({
      name,
      rows: this.sql
        .exec<Record<string, string | number | null>>(`SELECT * FROM ${name} LIMIT 5001`)
        .toArray(),
    }));
    if (
      tables.some((table) => table.rows.length > 5000) ||
      new TextEncoder().encode(JSON.stringify(tables)).byteLength > 4 * 1024 * 1024
    )
      throw new Error("Channel is too large for an online rename");
    const nonce = crypto.randomUUID();
    this.setMeta("rename_pending", nonce);
    this.setMeta("rename_destination", destination);
    return { nonce, source: this.getMeta("name")!, resourceId: this.getResourceId(), tables };
  }

  public importChannelStateFromRename(
    newChannelName: string,
    state: {
      nonce: string;
      source: string;
      resourceId: string;
      tables: Array<{ name: string; rows: Record<string, string | number | null>[] }>;
    },
  ): void {
    if (this.getMeta("name")) throw new Error("Destination channel already exists");
    if (!isValidChannelName(newChannelName) || state.tables.length !== this.renameTables.length)
      throw new Error("Invalid rename snapshot");
    this.ctx.storage.transactionSync(() => {
      for (let i = 0; i < this.renameTables.length; i++) {
        const table = state.tables[i];
        if (table.name !== this.renameTables[i]) throw new Error("Invalid rename table");
        for (const row of table.rows) {
          const columns = Object.keys(row);
          // Column names come from a server-created SQLite snapshot, never a client body.
          if (columns.some((column) => !/^[a-z_]+$/.test(column)))
            throw new Error("Invalid column");
          this.sql.exec(
            `INSERT OR REPLACE INTO ${table.name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            ...Object.values(row),
          );
        }
      }
      this.setMeta("name", newChannelName);
      this.setMeta("canonical_name", canonicalizeIRCName(newChannelName));
      this.setMeta("resource_id", state.resourceId);
      this.setMeta("rename_pending", state.nonce);
      this.setMeta("rename_source", state.source);
    });
  }

  public hasRenameSnapshot(nonce: string): boolean {
    return this.getMeta("rename_pending") === nonce;
  }

  public cancelChannelRename(nonce: string): void {
    if (this.getMeta("rename_pending") !== nonce) return;
    this.sql.exec(
      "DELETE FROM channel_metadata WHERE key IN ('rename_pending', 'rename_destination')",
    );
  }

  public completeChannelRename(nonce: string, destination: boolean): void {
    if (this.getMeta("rename_pending") !== nonce) throw new Error("Rename state mismatch");
    this.ctx.storage.transactionSync(() => {
      if (destination) {
        this.sql.exec(
          "DELETE FROM channel_metadata WHERE key IN ('rename_pending', 'rename_source', 'rename_destination')",
        );
      } else {
        // Destination has committed the bounded snapshot. Clear the old generation so
        // reusing its name cannot expose the moved history, hooks, roles or media.
        for (const table of [...this.renameTables].reverse()) this.sql.exec(`DELETE FROM ${table}`);
      }
    });
  }

  private getResourceId(): string {
    let id = this.getMeta("resource_id");
    if (!id) {
      id = crypto.randomUUID();
      this.setMeta("resource_id", id);
    }
    return id;
  }

  public async getMediaScope(user: {
    id: string;
    username: string;
    isAdmin: boolean;
  }): Promise<string | null> {
    if (!(await this.canReadAccount(user)) || !(await this.getAccountMember(user.id))) return null;
    return this.getResourceId();
  }

  public async canReadMedia(
    user: { id: string; username: string; isAdmin: boolean },
    generation: string,
  ): Promise<boolean> {
    return this.getMeta("resource_id") === generation && this.canReadAccount(user);
  }

  // F Bot & Admin REST API RPC methods
  public async getBotConfig(): Promise<{
    enabled: boolean;
    channelRegistered: boolean;
    welcomeMessage: string | null;
  }> {
    return {
      enabled: this.getMeta("f_bot_enabled") === "1",
      channelRegistered: this.getMeta("registered") === "1",
      welcomeMessage: this.getMeta("f_bot_welcome"),
    };
  }

  public async setBotConfig(config: {
    enabled?: boolean;
    welcomeMessage?: string | null;
  }): Promise<{
    enabled: boolean;
    welcomeMessage: string | null;
    recipientSessionIds: string[];
  }> {
    if (config.enabled !== undefined) {
      if (config.enabled) {
        this.setMeta("f_bot_enabled", "1");
      } else {
        this.setMeta("f_bot_enabled", "0");
      }
    }
    if (config.welcomeMessage !== undefined) {
      if (config.welcomeMessage === null || config.welcomeMessage === "") {
        this.deleteMeta("f_bot_welcome");
      } else {
        this.setMeta("f_bot_welcome", config.welcomeMessage);
      }
    }
    return {
      enabled: this.getMeta("f_bot_enabled") === "1",
      welcomeMessage: this.getMeta("f_bot_welcome"),
      recipientSessionIds: this.getMembers()
        .filter((m) => !m.sessionId.startsWith("service:"))
        .map((m) => m.sessionId),
    };
  }

  public async adminRegister(
    founder: string,
    channelName?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const meta = this.ensureInitialized(channelName);
    if (this.getMeta("archived") === "1")
      return { ok: false, message: "Archived channel names are reserved to protect retained data" };
    const account = await this.env.ACCOUNTS.get(
      this.env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).getAccountByUsername(founder);
    if (!account) return { ok: false, message: "Founder account does not exist" };
    if (this.getMeta("registered") === "1")
      return { ok: false, message: "Channel is already registered" };
    this.sql.exec(
      "INSERT INTO channel_permissions (user_id, account_name, permission) VALUES (?, ?, 'q')",
      account.id,
      canonicalizeIRCName(account.username),
    );
    const now = Date.now();
    this.setMeta("registered", "1");
    this.setMeta("founder", founder);
    this.setMeta("registered_at", String(now));
    this.setMeta("has_founder", "1");
    if (SERVER_CONFIG.fBotAutoJoin) {
      this.setMeta("f_bot_enabled", "1");
    }
    const modeSet = new Set(meta.modes.split("").filter(Boolean));
    modeSet.add("r");
    this.setMeta("modes", Array.from(modeSet).join(""));
    return {
      ok: true,
      message: `Channel ${meta.name} successfully registered with founder ${founder}`,
    };
  }

  public async adminUnregister(channelName?: string): Promise<{ ok: boolean; message: string }> {
    const meta = this.ensureInitialized(channelName);
    this.deleteMeta("registered");
    this.deleteMeta("founder");
    this.deleteMeta("registered_at");
    this.deleteMeta("has_founder");
    this.deleteMeta("f_bot_enabled");
    this.deleteMeta("f_bot_welcome");
    this.deleteMeta("unregister_code");
    const modeSet = new Set(meta.modes.split("").filter(Boolean));
    modeSet.delete("r");
    this.setMeta("modes", Array.from(modeSet).join(""));
    this.sql.exec("DELETE FROM channel_permissions");
    return { ok: true, message: `Channel ${meta.name} is now unregistered` };
  }

  public async adminSetTopic(
    topic: string,
    setBy = "Administrator",
    channelName?: string,
  ): Promise<{
    ok: boolean;
    channelName: string;
    topic: string;
    setBy: string;
    setAt: number;
    recipientSessionIds: string[];
  }> {
    const meta = this.ensureInitialized(channelName);
    const now = Date.now();
    this.setMeta("topic", topic);
    this.setMeta("topic_set_by", setBy);
    this.setMeta("topic_set_at", String(now));
    return {
      ok: true,
      channelName: meta.name,
      topic,
      setBy,
      setAt: now,
      recipientSessionIds: this.getMembers()
        .filter((m) => !m.sessionId.startsWith("service:"))
        .map((m) => m.sessionId),
    };
  }

  public async adminKickMember(
    targetNickname: string,
    _reason = "Kicked by administrator",
    channelName?: string,
  ): Promise<{
    ok: boolean;
    channelName: string;
    targetMember?: ChannelMemberInfo;
    recipientSessionIds: string[];
    errorText?: string;
  }> {
    const meta = this.ensureInitialized(channelName);
    const canonNick = canonicalizeIRCName(targetNickname);
    if (canonNick === "f") {
      return {
        ok: false,
        channelName: meta.name,
        recipientSessionIds: [],
        errorText: "Cannot kick network service bots",
      };
    }
    const target = this.getMemberByNick(targetNickname);
    if (!target) {
      return {
        ok: false,
        channelName: meta.name,
        recipientSessionIds: [],
        errorText: "User not in channel",
      };
    }
    const recipients = this.getMembers()
      .filter((m) => !m.sessionId.startsWith("service:"))
      .map((m) => m.sessionId);
    this.sql.exec("DELETE FROM channel_members WHERE session_id = ?", target.sessionId);
    return {
      ok: true,
      channelName: meta.name,
      targetMember: target,
      recipientSessionIds: recipients,
    };
  }

  public async purgeMessages(params: {
    all?: boolean;
    beforeTimestamp?: number;
    beforeMsgId?: string;
  }): Promise<{ purgedCount: number }> {
    if (params.all) {
      const cnt =
        this.sql.exec<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM messages").toArray()[0]?.cnt ??
        0;
      this.sql.exec("DELETE FROM messages");
      return { purgedCount: cnt };
    }
    if (params.beforeTimestamp) {
      const cnt =
        this.sql
          .exec<{ cnt: number }>(
            "SELECT COUNT(*) AS cnt FROM messages WHERE created_at < ?",
            params.beforeTimestamp,
          )
          .toArray()[0]?.cnt ?? 0;
      this.sql.exec("DELETE FROM messages WHERE created_at < ?", params.beforeTimestamp);
      return { purgedCount: cnt };
    }
    if (params.beforeMsgId) {
      const target = this.sql
        .exec<{ created_at: number }>(
          "SELECT created_at FROM messages WHERE id = ?",
          params.beforeMsgId,
        )
        .toArray()[0];
      if (target) {
        const cnt =
          this.sql
            .exec<{ cnt: number }>(
              "SELECT COUNT(*) AS cnt FROM messages WHERE created_at <= ?",
              target.created_at,
            )
            .toArray()[0]?.cnt ?? 0;
        this.sql.exec("DELETE FROM messages WHERE created_at <= ?", target.created_at);
        return { purgedCount: cnt };
      }
    }
    return { purgedCount: 0 };
  }

  public async adminDestroyChannel(
    purgeMessages = true,
    channelName?: string,
  ): Promise<{
    channelName: string;
    recipientSessionIds: string[];
    purgedCount: number;
  }> {
    const meta = this.ensureInitialized(channelName);
    const recipients = this.getMembers()
      .filter((m) => !m.sessionId.startsWith("service:"))
      .map((m) => m.sessionId);
    let purgedCount = 0;
    this.ctx.storage.transactionSync(() => {
      for (const table of [
        "channel_members",
        "channel_metadata",
        "channel_kv_metadata",
        "channel_permissions",
        "channel_invites",
        "channel_bans",
        "channel_list_modes",
        "channel_user_roles",
        "channel_role_groups",
        "channel_webhooks",
        "channel_outgoing_webhooks",
      ])
        this.sql.exec(`DELETE FROM ${table}`);
      if (purgeMessages) {
        purgedCount = this.sql
          .exec<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM messages")
          .toArray()[0].cnt;
        this.sql.exec("DELETE FROM messages");
      }
      this.setMeta("name", meta.name);
      this.setMeta("canonical_name", meta.canonicalName);
      this.setMeta("created_at", String(meta.createdAt));
      this.setMeta("modes", "si");
      this.setMeta("archived", "1");
      this.setMeta("fts_integrity_version", "1");
    });
    return {
      channelName: meta.name,
      recipientSessionIds: recipients,
      purgedCount,
    };
  }

  public async getChannelFullDetails(channelName?: string): Promise<{
    name: string;
    canonicalName: string;
    modes: string;
    topic: string | null;
    topicSetBy: string | null;
    topicSetAt: number | null;
    createdAt: number;
    registered: boolean;
    founder: string | null;
    registeredAt: number | null;
    memberCount: number;
    bot: { enabled: boolean; welcomeMessage: string | null };
    members: ChannelMemberInfo[];
    metadata: Record<string, string>;
    bans: Array<{ mask: string; setBy: string; setAt: number }>;
    messageCount: number;
  }> {
    const meta = this.ensureInitialized(channelName);
    const regAtStr = this.getMeta("registered_at");
    const topicSetAtStr = this.getMeta("topic_set_at");
    const members = this.getMembers();
    const kv = await this.getChannelMetadata();
    const bans = this.sql
      .exec<{ mask: string; created_by: string; created_at: number }>(
        "SELECT mask, created_by, created_at FROM channel_bans",
      )
      .toArray()
      .map((b) => ({
        mask: b.mask,
        setBy: b.created_by,
        setAt: b.created_at,
      }));
    const msgCount =
      this.sql.exec<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM messages").toArray()[0]?.cnt ?? 0;

    return {
      name: meta.name,
      canonicalName: meta.canonicalName,
      modes: meta.modes,
      topic: this.getMeta("topic"),
      topicSetBy: this.getMeta("topic_set_by"),
      topicSetAt: topicSetAtStr ? parseInt(topicSetAtStr, 10) : null,
      createdAt: meta.createdAt,
      registered: this.getMeta("registered") === "1",
      founder: this.getMeta("founder"),
      registeredAt: regAtStr ? parseInt(regAtStr, 10) : null,
      memberCount: members.length,
      bot: {
        enabled: this.getMeta("f_bot_enabled") === "1",
        welcomeMessage: this.getMeta("f_bot_welcome"),
      },
      members,
      metadata: kv,
      bans,
      messageCount: msgCount,
    };
  }

  private mapMessageRow(r: any): StoredChannelMessage {
    return {
      id: r.id,
      sequence: r.sequence,
      senderId: r.sender_id,
      senderAccount: r.sender_account,
      senderNick: r.sender_nick,
      senderUser: r.sender_user,
      senderHost: r.sender_host,
      command: r.command,
      content: r.content,
      tags: r.tags_json ? JSON.parse(r.tags_json) : undefined,
      multilineLines: r.multiline_json ? JSON.parse(r.multiline_json) : undefined,
      redacted: Boolean(r.redacted),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    };
  }

  public async getMessagesForAdmin(
    limit = 50,
    before?: string,
    after?: string,
    around?: string,
  ): Promise<StoredChannelMessage[]> {
    let sql = "SELECT * FROM messages";
    const conds: string[] = [];
    const bindings: (string | number)[] = [];

    const resolveTimestamp = (val: string): number | null => {
      const row = this.sql
        .exec<{ created_at: number }>("SELECT created_at FROM messages WHERE id = ?", val)
        .toArray()[0];
      if (row) return row.created_at;
      const num = Number(val);
      if (!Number.isNaN(num) && num > 0) return num;
      const parsed = Date.parse(val);
      if (!Number.isNaN(parsed)) return parsed;
      return null;
    };

    if (around) {
      const aroundTs = resolveTimestamp(around);
      if (aroundTs) {
        const half = Math.max(1, Math.floor(limit / 2));
        const older = this.sql
          .exec<any>(
            "SELECT * FROM messages WHERE created_at <= ? ORDER BY created_at DESC LIMIT ?",
            aroundTs,
            half + 1,
          )
          .toArray();
        const newer = this.sql
          .exec<any>(
            "SELECT * FROM messages WHERE created_at > ? ORDER BY created_at ASC LIMIT ?",
            aroundTs,
            half,
          )
          .toArray();
        const combined = [...older, ...newer].sort((a, b) => b.created_at - a.created_at);
        return combined.map((r) => this.mapMessageRow(r));
      }
    }

    if (before) {
      const bTs = resolveTimestamp(before);
      if (bTs !== null) {
        conds.push("created_at < ?");
        bindings.push(bTs);
      }
    }
    if (after) {
      const aTs = resolveTimestamp(after);
      if (aTs !== null) {
        conds.push("created_at > ?");
        bindings.push(aTs);
      }
    }
    if (conds.length > 0) {
      sql += ` WHERE ${conds.join(" AND ")}`;
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    bindings.push(Math.min(limit, 100));

    const rows = this.sql.exec<any>(sql, ...bindings).toArray();
    return rows.map((r) => this.mapMessageRow(r));
  }

  public async adminRedactMessage(msgid: string): Promise<boolean> {
    const row = this.sql
      .exec<{ id: string }>("SELECT id FROM messages WHERE id = ?", msgid)
      .toArray()[0];
    if (!row) return false;
    this.scrubMessageChain(row.id);
    return true;
  }

  public async setMemberModes(params: {
    channelName: string;
    actorSessionId: string;
    targetNick: string;
    add: boolean;
    mode: string;
    isOper?: boolean;
  }): Promise<{
    ok: boolean;
    errorText?: string;
    channelName: string;
    targetNick: string;
    newModes: string;
    recipientSessionIds: string[];
  }> {
    const meta = this.ensureInitialized(params.channelName);
    const actor = this.getMemberBySession(params.actorSessionId);
    if (!params.isOper && !hasChannelOp(actor?.modes ?? "")) {
      return {
        ok: false,
        errorText: "You're not channel operator",
        channelName: meta.name,
        targetNick: params.targetNick,
        newModes: "",
        recipientSessionIds: [],
      };
    }
    if (canonicalizeIRCName(params.targetNick) === "f") {
      return {
        ok: false,
        errorText: "Cannot modify service bot modes",
        channelName: meta.name,
        targetNick: params.targetNick,
        newModes: "q",
        recipientSessionIds: [],
      };
    }
    const target = this.getMemberByNick(params.targetNick);
    if (!target) {
      return {
        ok: false,
        errorText: "User not in channel",
        channelName: meta.name,
        targetNick: params.targetNick,
        newModes: "",
        recipientSessionIds: [],
      };
    }
    const mSet = new Set(this.baseMemberModes(target.sessionId).split("").filter(Boolean));
    if (params.add) {
      mSet.add(params.mode);
    } else {
      mSet.delete(params.mode);
    }
    const updated = Array.from(mSet).join("");
    if (!target.sessionId.startsWith("service:")) {
      this.sql.exec(
        "UPDATE channel_members SET modes = ? WHERE session_id = ?",
        updated,
        target.sessionId,
      );
    }
    return {
      ok: true,
      channelName: meta.name,
      targetNick: target.nickname,
      newModes: updated,
      recipientSessionIds: this.getMembers()
        .filter((m) => !m.sessionId.startsWith("service:"))
        .map((m) => m.sessionId),
    };
  }

  public async searchMessages(
    query?: string,
    options?: {
      limit?: number;
      sender?: string;
      from?: string[];
      mentions?: string[];
      has?: Array<
        | "link"
        | "image"
        | "gif"
        | "video"
        | "file"
        | "embed"
        | "reaction"
        | "reply"
        | "code"
        | "quote"
        | "sound"
        | "pinned"
      >;
      before?: string | number;
      after?: string | number;
      on?: string;
      author?: "user" | "bot";
      tags?: Array<{ key: string; value?: string }>;
      pinned?: boolean;
      cursor?: { at: string | number; id: string };
    },
  ): Promise<StoredChannelMessage[]> {
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 101);
    const sanitizedQuery = (query || "").trim().replace(/['"]/g, "");

    let sqlQuery: string;
    const queryParams: any[] = [];

    if (sanitizedQuery) {
      sqlQuery = `
        SELECT m.* FROM messages m
        JOIN messages_fts f ON m.id = f.message_id
        WHERE messages_fts MATCH ? AND m.redacted = 0
      `;
      queryParams.push(sanitizedQuery);
    } else {
      sqlQuery = "SELECT m.* FROM messages m WHERE m.redacted = 0";
    }

    sqlQuery += " AND m.expires_at > ?";
    queryParams.push(Date.now());

    // 1. from / sender filters
    const senders = [...(options?.from ?? []), ...(options?.sender ? [options.sender] : [])].filter(
      Boolean,
    );

    if (senders.length > 0) {
      const placeholders = senders.map(() => "LOWER(?)").join(", ");
      sqlQuery += ` AND (LOWER(m.sender_nick) IN (${placeholders}) OR LOWER(COALESCE(m.sender_account, '')) IN (${placeholders}))`;
      queryParams.push(...senders, ...senders);
    }

    // 2. mentions filters
    if (options?.mentions && options.mentions.length > 0) {
      for (const m of options.mentions) {
        sqlQuery += " AND (m.content LIKE ? OR m.content LIKE ? OR m.content LIKE ?)";
        queryParams.push(`%@${m}%`, `%${m}:%`, `%${m},%`);
      }
    }

    // 3. has filters (link, image, gif, video, file, embed, reaction, reply, code, quote, sound, pinned)
    if (options?.has && options.has.length > 0) {
      for (const h of options.has) {
        switch (h) {
          case "link":
            sqlQuery += " AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%')";
            break;
          case "image":
            sqlQuery += ` AND (
              m.content LIKE '%.png%' OR m.content LIKE '%.jpg%' OR m.content LIKE '%.jpeg%' OR
              m.content LIKE '%.webp%' OR m.content LIKE '%.avif%' OR m.content LIKE '%.gif%' OR
              m.content LIKE '%/api/v1/media/%' OR m.tags_json LIKE '%+file%'
            )`;
            break;
          case "gif":
            sqlQuery += ` AND (
              m.content LIKE '%.gif%' OR m.content LIKE '%tenor.com%' OR m.content LIKE '%giphy.com%'
            )`;
            break;
          case "video":
            sqlQuery += ` AND (
              m.content LIKE '%.mp4%' OR m.content LIKE '%.webm%' OR m.content LIKE '%.mov%' OR
              m.content LIKE '%youtube.com%' OR m.content LIKE '%youtu.be%' OR m.content LIKE '%vimeo.com%'
            )`;
            break;
          case "file":
            sqlQuery += " AND (m.content LIKE '%/api/v1/media/%' OR m.tags_json LIKE '%+file%')";
            break;
          case "embed":
            sqlQuery +=
              " AND (m.tags_json LIKE '%+draft/embed%' OR m.content LIKE '%http://%' OR m.content LIKE '%https://%')";
            break;
          case "reaction":
            sqlQuery += " AND m.tags_json LIKE '%+draft/react%'";
            break;
          case "reply":
            sqlQuery += " AND m.tags_json LIKE '%+draft/reply%'";
            break;
          case "code":
            sqlQuery += " AND (m.content LIKE '%```%' OR m.content LIKE '%`%')";
            break;
          case "quote":
            sqlQuery += " AND (m.content LIKE '> %' OR m.content LIKE '%\n> %')";
            break;
          case "sound":
            sqlQuery +=
              " AND (m.content LIKE '%.mp3%' OR m.content LIKE '%.wav%' OR m.content LIKE '%.ogg%' OR m.content LIKE '%.m4a%' OR m.content LIKE '%.flac%')";
            break;
          case "pinned":
            sqlQuery +=
              ' AND (m.tags_json LIKE \'%"+pinned":true%\' OR m.tags_json LIKE \'%"+pinned":"true"%\' OR m.tags_json LIKE \'%"pinned":true%\')';
            break;
        }
      }
    }

    // 4. date filters (before, after, on)
    if (options?.on) {
      const startMs = new Date(`${options.on}T00:00:00Z`).getTime();
      const endMs = startMs + 24 * 60 * 60 * 1000;
      if (!Number.isNaN(startMs)) {
        sqlQuery += " AND m.created_at >= ? AND m.created_at < ?";
        queryParams.push(startMs, endMs);
      }
    } else {
      if (options?.before) {
        const beforeMs =
          typeof options.before === "number"
            ? options.before
            : options.before.includes("T")
              ? new Date(options.before).getTime()
              : new Date(`${options.before}T00:00:00Z`).getTime();
        if (!Number.isNaN(beforeMs)) {
          sqlQuery += " AND m.created_at < ?";
          queryParams.push(beforeMs);
        }
      }
      if (options?.after) {
        const afterMs =
          typeof options.after === "number"
            ? options.after
            : options.after.includes("T")
              ? new Date(options.after).getTime()
              : new Date(`${options.after}T23:59:59Z`).getTime();
        if (!Number.isNaN(afterMs)) {
          sqlQuery += " AND m.created_at > ?";
          queryParams.push(afterMs);
        }
      }
    }

    // 5. author filter (bot vs user)
    if (options?.author === "bot") {
      sqlQuery += ` AND (
        m.tags_json LIKE '%+badge=bot%' OR
        m.tags_json LIKE '%+role=webhook%' OR
        m.sender_user = 'webhook'
      )`;
    } else if (options?.author === "user") {
      sqlQuery += ` AND (
        m.tags_json NOT LIKE '%+badge=bot%' AND
        m.tags_json NOT LIKE '%+role=webhook%' AND
        m.sender_user != 'webhook'
      )`;
    }

    // 6. pinned filter
    if (options?.pinned !== undefined) {
      if (options.pinned) {
        sqlQuery +=
          ' AND (m.tags_json LIKE \'%"+pinned":true%\' OR m.tags_json LIKE \'%"+pinned":"true"%\' OR m.tags_json LIKE \'%"pinned":true%\')';
      } else {
        sqlQuery +=
          ' AND (m.tags_json NOT LIKE \'%"+pinned":true%\' AND m.tags_json NOT LIKE \'%"+pinned":"true"%\' AND m.tags_json NOT LIKE \'%"pinned":true%\')';
      }
    }

    // 7. tag filter
    if (options?.tags && options.tags.length > 0) {
      for (const t of options.tags) {
        const key = t.key;
        const altKey = key.startsWith("+") ? key.slice(1) : `+${key}`;
        if (t.value !== undefined) {
          if (t.value === "true") {
            sqlQuery +=
              " AND (m.tags_json LIKE ? OR m.tags_json LIKE ? OR m.tags_json LIKE ? OR m.tags_json LIKE ?)";
            queryParams.push(
              `%"${key}":true%`,
              `%"${altKey}":true%`,
              `%"${key}":"true"%`,
              `%"${altKey}":"true"%`,
            );
          } else if (t.value === "false") {
            sqlQuery +=
              " AND (m.tags_json LIKE ? OR m.tags_json LIKE ? OR m.tags_json LIKE ? OR m.tags_json LIKE ?)";
            queryParams.push(
              `%"${key}":false%`,
              `%"${altKey}":false%`,
              `%"${key}":"false"%`,
              `%"${altKey}":"false"%`,
            );
          } else {
            sqlQuery +=
              " AND (m.tags_json LIKE ? OR m.tags_json LIKE ? OR m.tags_json LIKE ? OR m.tags_json LIKE ?)";
            queryParams.push(
              `%"${key}":"${t.value}"%`,
              `%"${altKey}":"${t.value}"%`,
              `%"${key}":${t.value}%`,
              `%"${altKey}":${t.value}%`,
            );
          }
        } else {
          sqlQuery += " AND (m.tags_json LIKE ? OR m.tags_json LIKE ?)";
          queryParams.push(`%"${key}"%`, `%"${altKey}"%`);
        }
      }
    }

    // 8. cursor pagination
    if (options?.cursor) {
      const cursorMs =
        typeof options.cursor.at === "number"
          ? options.cursor.at
          : new Date(options.cursor.at).getTime();
      if (!Number.isNaN(cursorMs)) {
        sqlQuery += " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))";
        queryParams.push(cursorMs, cursorMs, options.cursor.id);
      }
    }

    sqlQuery += " ORDER BY m.created_at DESC, m.id DESC LIMIT ?";
    queryParams.push(limit);

    const rows = this.sql.exec<any>(sqlQuery, ...queryParams).toArray();
    return rows.map((r) => this.rowToStoredMessage(r));
  }

  public async createWebhook(
    name: string,
    createdBy: string,
    avatarUrl?: string,
  ): Promise<{ ok: boolean; webhook: any }> {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID().replace(/-/g, "");
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO channel_webhooks (id, name, token, avatar_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      name,
      token,
      avatarUrl ?? null,
      createdBy,
      now,
    );
    return {
      ok: true,
      webhook: {
        id,
        name,
        token,
        avatarUrl: avatarUrl ?? null,
        createdBy,
        createdAt: now,
      },
    };
  }

  public async getWebhooks(): Promise<any[]> {
    return this.sql.exec<any>("SELECT * FROM channel_webhooks ORDER BY created_at DESC").toArray();
  }

  public async deleteWebhook(id: string): Promise<{ ok: boolean }> {
    this.sql.exec("DELETE FROM channel_webhooks WHERE id = ?", id);
    return { ok: true };
  }

  public async executeWebhook(
    token: string,
    payload: {
      content?: string;
      username?: string;
      avatar_url?: string;
      embeds?: Array<{
        title?: string;
        description?: string;
        url?: string;
        color?: number;
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
        author?: { name?: string; icon_url?: string; url?: string };
        footer?: { text?: string; icon_url?: string };
        image?: { url: string };
        thumbnail?: { url: string };
      }>;
    },
    expectedId?: string,
  ): Promise<{ ok: boolean; error?: string; messageId?: string }> {
    const hooks = this.sql
      .exec<any>("SELECT * FROM channel_webhooks WHERE token = ?", token)
      .toArray();
    if (hooks.length === 0 || (expectedId && hooks[0].id !== expectedId)) {
      return { ok: false, error: "Invalid webhook token" };
    }
    const hook = hooks[0];
    const budget = this.sql
      .exec<{ count: number; reset_at: number }>(
        "SELECT count, reset_at FROM webhook_limits WHERE hook_id = ?",
        hook.id,
      )
      .toArray()[0];
    const requestTime = Date.now();
    if (budget && budget.reset_at > requestTime && budget.count >= 60)
      return { ok: false, error: "Webhook rate limit reached" };
    this.sql.exec(
      "INSERT OR REPLACE INTO webhook_limits (hook_id, count, reset_at) VALUES (?, ?, ?)",
      hook.id,
      budget && budget.reset_at > requestTime ? budget.count + 1 : 1,
      budget && budget.reset_at > requestTime ? budget.reset_at : requestTime + 10_000,
    );
    const displayName = payload.username || hook.name;
    const nickname = `hook_${displayName.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 32);
    const channelName = (await this.getChannelInfo()).channel;
    const msgId = crypto.randomUUID();
    const now = Date.now();

    let effectiveContent = payload.content?.trim() || "";
    if (!effectiveContent && payload.embeds && payload.embeds.length > 0) {
      const parts: string[] = [];
      for (const embed of payload.embeds) {
        if (embed.author?.name) parts.push(`[${embed.author.name}]`);
        if (embed.title)
          parts.push(embed.url ? `**${embed.title}** (${embed.url})` : `**${embed.title}**`);
        if (embed.description) parts.push(embed.description);
        if (embed.fields && embed.fields.length > 0) {
          for (const f of embed.fields) {
            parts.push(`• ${f.name}: ${f.value}`);
          }
        }
        if (embed.image?.url) parts.push(embed.image.url);
        if (embed.footer?.text) parts.push(`_${embed.footer.text}_`);
      }
      effectiveContent = parts.join(" \n ");
    }
    if (!effectiveContent) {
      effectiveContent = "(empty webhook message)";
    }

    const tags: Record<string, string | true> = {
      "+role": "webhook",
      "+badge": "bot",
      "+display-name": displayName,
      bot: true,
      ...(payload.avatar_url || hook.avatar_url
        ? { "+avatar": payload.avatar_url || hook.avatar_url }
        : {}),
      ...(payload.embeds && payload.embeds.length > 0
        ? { "+draft/embed": JSON.stringify(payload.embeds) }
        : {}),
    };

    const res = await this.appendMessage({
      messageId: msgId,
      sessionId: `webhook:${hook.id}`,
      userId: `webhook:${hook.id}`,
      accountName: null,
      nickname,
      username: "webhook",
      hostname: "discord.bot",
      command: "PRIVMSG",
      content: effectiveContent,
      tags,
      isOper: true,
    });

    if (!res.ok) {
      return { ok: false, error: res.errorText };
    }

    try {
      const sessionStub = this.env.SESSION.get(
        this.env.SESSION.idFromName(SERVER_CONFIG.networkId),
      );
      await sessionStub.broadcastLineToChannel(
        channelName,
        encodeIRCMessage({
          tags: {
            time: new Date(now).toISOString(),
            msgid: msgId,
            ...tags,
          },
          prefix: `${nickname}!webhook@discord.bot`,
          command: "PRIVMSG",
          params: [channelName, effectiveContent],
        }),
      );
    } catch (error) {
      console.error("Webhook IRC delivery failed after commit", error);
    }

    return { ok: true, messageId: msgId };
  }

  // Outgoing Webhook management
  public async createOutgoingWebhook(
    targetUrl: string,
    secret?: string,
    events: string[] = ["message.created"],
  ): Promise<{ ok: boolean; webhook: any }> {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO channel_outgoing_webhooks (id, target_url, secret, events_json, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      targetUrl,
      secret || null,
      JSON.stringify(events),
      now,
    );
    return {
      ok: true,
      webhook: {
        id,
        target_url: targetUrl,
        events,
        created_at: now,
      },
    };
  }

  public async getOutgoingWebhooks(): Promise<any[]> {
    return this.sql
      .exec<any>("SELECT * FROM channel_outgoing_webhooks ORDER BY created_at DESC")
      .toArray()
      .map((w) => ({
        id: w.id,
        target_url: w.target_url,
        events: JSON.parse(w.events_json || '["message.created"]'),
        created_at: w.created_at,
      }));
  }

  public async deleteOutgoingWebhook(id: string): Promise<{ ok: boolean }> {
    this.sql.exec("DELETE FROM channel_outgoing_webhooks WHERE id = ?", id);
    return { ok: true };
  }

  public dispatchOutgoingWebhooks(eventName: string, data: any): void {
    try {
      const hooks = this.sql.exec<any>("SELECT * FROM channel_outgoing_webhooks").toArray();
      for (const hook of hooks) {
        const events: string[] = JSON.parse(hook.events_json || '["message.created"]');
        if (events.includes(eventName) || events.includes("*")) {
          const body = JSON.stringify({
            event: eventName,
            timestamp: new Date().toISOString(),
            data,
          });
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "FlaRC-Webhook-Dispatcher/1.0",
          };
          if (hook.secret) {
            headers["X-FlaRC-Secret"] = hook.secret;
          }
          this.ctx.waitUntil(
            (allowedOutboundUrl(
              hook.target_url,
              (this.env.OUTGOING_WEBHOOK_ALLOWED_HOSTS ?? "").split(","),
            )
              ? fetch(hook.target_url, {
                  method: "POST",
                  headers,
                  body,
                  redirect: "error",
                  signal: AbortSignal.timeout(5000),
                }).then(async (response) => {
                  await response.body?.cancel();
                })
              : Promise.resolve()
            ).catch(() => {}),
          );
        }
      }
    } catch {}
  }
}
