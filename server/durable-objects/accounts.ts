import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { hashPassword, verifyPassword } from "../core/authentication/passwords";
import { generateScramKeys, type ScramAccountData } from "../core/authentication/scram";
import { applyEnvConfig, SERVER_CONFIG } from "../core/config";
import { domainEvents } from "../core/events/emitter";
import { SlidingWindowRateLimiter } from "../core/permissions/rate-limits";
import type { AccountInfo, Env, UserProfile, UserProfileInput } from "../core/types";
import { canonicalizeIRCName } from "../protocol/irc/parser";
import { initializeAccountsSchema } from "../storage/migrations/init";
import * as accountsSchema from "../storage/schemas/accounts";

export class AccountsDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private db: ReturnType<typeof drizzle<typeof accountsSchema>>;
  private authLimiter = new SlidingWindowRateLimiter(
    SERVER_CONFIG.rateLimitWindowMs,
    SERVER_CONFIG.authRateLimitMaxAttempts,
  );

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    applyEnvConfig(env);
    this.sql = ctx.storage.sql;
    initializeAccountsSchema(this.sql);
    this.db = drizzle(ctx.storage, { schema: accountsSchema });
  }

  public async registerAccount(params: {
    username: string;
    password: string;
    displayName?: string;
    roles?: string[];
  }): Promise<{ ok: true; account: AccountInfo } | { ok: false; error: string }> {
    const canonUser = canonicalizeIRCName(params.username.trim());
    if (!canonUser || canonUser.length < 1 || canonUser.length > 32) {
      return { ok: false, error: "Invalid username" };
    }
    if (!params.password || params.password.length < 1) {
      return { ok: false, error: "Password cannot be empty" };
    }

    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canonUser)
      .toArray();
    if (existing.length > 0) {
      return { ok: false, error: "Account already exists" };
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await hashPassword(params.password);
    const rawUsername = params.username.trim();

    this.sql.exec(
      `INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      rawUsername,
      params.displayName ?? null,
      passwordHash,
      now,
      now,
    );

    const scram = await generateScramKeys(params.password);
    this.sql.exec(
      `INSERT OR REPLACE INTO scram_credentials (user_id, salt, iterations, stored_key, server_key)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      scram.salt,
      scram.iterations,
      scram.storedKey,
      scram.serverKey,
    );

    // Claim canonical nickname by default
    this.sql.exec(
      `INSERT OR IGNORE INTO registered_nicks (nickname, user_id, registered_at)
       VALUES (?, ?, ?)`,
      canonUser,
      id,
      now,
    );

    const roles = [...(params.roles ?? [])];
    if (SERVER_CONFIG.adminUsers.includes(canonUser) && !roles.includes("admin")) {
      roles.push("admin");
    }
    for (const role of roles) {
      this.sql.exec(`INSERT OR IGNORE INTO account_roles (user_id, role) VALUES (?, ?)`, id, role);
    }

    domainEvents.emit("auth.registered", {
      userId: id,
      username: rawUsername,
      roles,
    });

    return {
      ok: true,
      account: {
        id,
        username: rawUsername,
        displayName: params.displayName ?? null,
        roles,
        createdAt: now,
      },
    };
  }

  public async verifyCredentials(
    username: string,
    password: string,
  ): Promise<{ ok: true; account: AccountInfo } | { ok: false; error: string }> {
    const canonUser = canonicalizeIRCName(username.trim());
    if (!this.authLimiter.check(canonUser)) {
      return { ok: false, error: "Too many authentication attempts" };
    }

    const rows = this.sql
      .exec<{
        id: string;
        username: string;
        display_name: string | null;
        password_hash: string;
        created_at: number;
        disabled_at: number | null;
      }>(
        "SELECT id, username, display_name, password_hash, created_at, disabled_at FROM users WHERE LOWER(username) = ?",
        canonUser,
      )
      .toArray();

    if (rows.length === 0) {
      return { ok: false, error: "Invalid credentials" };
    }

    const user = rows[0];
    if (user.disabled_at !== null) {
      return { ok: false, error: "Account is disabled" };
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return { ok: false, error: "Invalid credentials" };
    }

    const roleRows = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", user.id)
      .toArray();

    return {
      ok: true,
      account: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        roles: roleRows.map((r) => r.role),
        createdAt: user.created_at,
      },
    };
  }

  public async getScramCredentials(username: string): Promise<
    | {
        ok: true;
        account: AccountInfo;
        scram: ScramAccountData;
      }
    | { ok: false; error: string }
  > {
    const canonUser = canonicalizeIRCName(username.trim());
    const rows = this.sql
      .exec<{
        id: string;
        username: string;
        display_name: string | null;
        created_at: number;
        disabled_at: number | null;
        salt: string;
        iterations: number;
        stored_key: string;
        server_key: string;
      }>(
        `SELECT u.id, u.username, u.display_name, u.created_at, u.disabled_at,
                s.salt, s.iterations, s.stored_key, s.server_key
         FROM users u
         JOIN scram_credentials s ON s.user_id = u.id
         WHERE LOWER(u.username) = ?`,
        canonUser,
      )
      .toArray();

    if (rows.length === 0) {
      return { ok: false, error: "User not found or no SCRAM credentials" };
    }

    const row = rows[0];
    if (row.disabled_at !== null) {
      return { ok: false, error: "Account is disabled" };
    }

    const roleRows = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", row.id)
      .toArray();

    return {
      ok: true,
      account: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        roles: roleRows.map((r) => r.role),
        createdAt: row.created_at,
      },
      scram: {
        salt: row.salt,
        iterations: row.iterations,
        storedKey: row.stored_key,
        serverKey: row.server_key,
      },
    };
  }

  public async getAccountByUsername(username: string): Promise<AccountInfo | null> {
    const canonUser = canonicalizeIRCName(username.trim());
    const rows = this.sql
      .exec<{
        id: string;
        username: string;
        display_name: string | null;
        created_at: number;
        disabled_at: number | null;
      }>(
        "SELECT id, username, display_name, created_at, disabled_at FROM users WHERE LOWER(username) = ?",
        canonUser,
      )
      .toArray();

    if (rows.length === 0 || rows[0].disabled_at !== null) {
      return null;
    }

    const user = rows[0];
    const roleRows = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", user.id)
      .toArray();

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      roles: roleRows.map((r) => r.role),
      createdAt: user.created_at,
    };
  }

  public async getNickOwner(nickname: string): Promise<string | null> {
    const canonNick = canonicalizeIRCName(nickname);
    const rows = this.sql
      .exec<{ user_id: string }>(
        "SELECT user_id FROM registered_nicks WHERE nickname = ?",
        canonNick,
      )
      .toArray();
    return rows.length > 0 ? rows[0].user_id : null;
  }

  public async registerNickname(userId: string, nickname: string): Promise<boolean> {
    const canonNick = canonicalizeIRCName(nickname);
    const existing = await this.getNickOwner(canonNick);
    if (existing && existing !== userId) {
      return false;
    }
    if (!existing) {
      this.sql.exec(
        "INSERT INTO registered_nicks (nickname, user_id, registered_at) VALUES (?, ?, ?)",
        canonNick,
        userId,
        Date.now(),
      );
    }
    return true;
  }

  public async disableAccount(username: string): Promise<boolean> {
    const canonUser = canonicalizeIRCName(username);
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return false;
    }
    const now = Date.now();
    this.sql.exec(
      "UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      existing[0].id,
    );
    return true;
  }

  public async listAccounts(): Promise<AccountInfo[]> {
    const users = this.sql
      .exec<{
        id: string;
        username: string;
        display_name: string | null;
        created_at: number;
      }>("SELECT id, username, display_name, created_at FROM users WHERE disabled_at IS NULL")
      .toArray();

    return users.map((u) => {
      const roles = this.sql
        .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", u.id)
        .toArray()
        .map((r) => r.role);
      return {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        roles,
        createdAt: u.created_at,
      };
    });
  }

  public async adminListAccounts(params?: {
    query?: string;
    role?: string;
    limit?: number;
  }): Promise<Array<AccountInfo & { disabled: boolean; disabledAt: number | null }>> {
    const limit = params?.limit ?? 100;
    let sql = "SELECT id, username, display_name, created_at, disabled_at FROM users";
    const conditions: string[] = [];
    const bindings: (string | number)[] = [];

    if (params?.query) {
      conditions.push("(LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)");
      const q = `%${params.query.toLowerCase()}%`;
      bindings.push(q, q);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    bindings.push(limit);

    const rows = this.sql
      .exec<{
        id: string;
        username: string;
        display_name: string | null;
        created_at: number;
        disabled_at: number | null;
      }>(sql, ...bindings)
      .toArray();

    const result: Array<AccountInfo & { disabled: boolean; disabledAt: number | null }> = [];
    for (const r of rows) {
      const roleRows = this.sql
        .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", r.id)
        .toArray();
      const roles = roleRows.map((x) => x.role);
      if (params?.role && !roles.includes(params.role)) {
        continue;
      }
      result.push({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        roles,
        createdAt: r.created_at,
        disabled: r.disabled_at !== null,
        disabledAt: r.disabled_at,
      });
    }
    return result;
  }

  public async getAccountDetails(username: string): Promise<{
    account: AccountInfo & { disabled: boolean; disabledAt: number | null };
    registeredNicks: string[];
    metadata: Record<string, string>;
  } | null> {
    const canonUser = canonicalizeIRCName(username.trim());
    const rows = this.sql
      .exec<{
        id: string;
        username: string;
        display_name: string | null;
        created_at: number;
        disabled_at: number | null;
      }>(
        "SELECT id, username, display_name, created_at, disabled_at FROM users WHERE LOWER(username) = ?",
        canonUser,
      )
      .toArray();

    if (rows.length === 0) return null;
    const user = rows[0];
    const roleRows = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", user.id)
      .toArray();
    const nicks = this.sql
      .exec<{ nickname: string }>(
        "SELECT nickname FROM registered_nicks WHERE user_id = ?",
        user.id,
      )
      .toArray()
      .map((n) => n.nickname);
    const metaRows = this.sql
      .exec<{ key: string; value: string }>(
        "SELECT key, value FROM user_metadata WHERE target_key = ?",
        canonUser,
      )
      .toArray();
    const metadata: Record<string, string> = {};
    for (const m of metaRows) {
      metadata[m.key] = m.value;
    }

    return {
      account: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        roles: roleRows.map((r) => r.role),
        createdAt: user.created_at,
        disabled: user.disabled_at !== null,
        disabledAt: user.disabled_at,
      },
      registeredNicks: nicks,
      metadata,
    };
  }

  public async updateAccount(
    username: string,
    updates: { displayName?: string | null; roles?: string[] },
  ): Promise<{ ok: true; account: AccountInfo } | { ok: false; error: string }> {
    const canonUser = canonicalizeIRCName(username.trim());
    const existing = this.sql
      .exec<{ id: string; username: string; display_name: string | null; created_at: number }>(
        "SELECT id, username, display_name, created_at FROM users WHERE LOWER(username) = ?",
        canonUser,
      )
      .toArray();
    if (existing.length === 0) {
      return { ok: false, error: "Account not found" };
    }
    const user = existing[0];
    const now = Date.now();

    if (updates.displayName !== undefined) {
      this.sql.exec(
        "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
        updates.displayName,
        now,
        user.id,
      );
    }
    if (updates.roles !== undefined) {
      this.sql.exec("DELETE FROM account_roles WHERE user_id = ?", user.id);
      for (const role of updates.roles) {
        this.sql.exec(
          "INSERT OR IGNORE INTO account_roles (user_id, role) VALUES (?, ?)",
          user.id,
          role,
        );
      }
    }

    const roleRows = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", user.id)
      .toArray();

    return {
      ok: true,
      account: {
        id: user.id,
        username: user.username,
        displayName: updates.displayName !== undefined ? updates.displayName : user.display_name,
        roles: roleRows.map((r) => r.role),
        createdAt: user.created_at,
      },
    };
  }

  public async adminResetPassword(
    username: string,
    newPassword: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const canonUser = canonicalizeIRCName(username.trim());
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return { ok: false, error: "Account not found" };
    }
    if (!newPassword || newPassword.length < 1) {
      return { ok: false, error: "Password cannot be empty" };
    }

    const userId = existing[0].id;
    const passwordHash = await hashPassword(newPassword);
    const scram = await generateScramKeys(newPassword);
    const now = Date.now();

    this.sql.exec(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
      passwordHash,
      now,
      userId,
    );
    this.sql.exec(
      `INSERT OR REPLACE INTO scram_credentials (user_id, salt, iterations, stored_key, server_key)
       VALUES (?, ?, ?, ?, ?)`,
      userId,
      scram.salt,
      scram.iterations,
      scram.storedKey,
      scram.serverKey,
    );

    return { ok: true };
  }

  public async enableAccount(username: string): Promise<boolean> {
    const canonUser = canonicalizeIRCName(username.trim());
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return false;
    }
    this.sql.exec(
      "UPDATE users SET disabled_at = NULL, updated_at = ? WHERE id = ?",
      Date.now(),
      existing[0].id,
    );
    return true;
  }

  public async deleteAccount(username: string): Promise<boolean> {
    const canonUser = canonicalizeIRCName(username.trim());
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return false;
    }
    const userId = existing[0].id;
    this.sql.exec("DELETE FROM users WHERE id = ?", userId);
    this.sql.exec("DELETE FROM registered_nicks WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM account_roles WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM scram_credentials WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM user_metadata WHERE target_key = ?", canonUser);
    return true;
  }

  // Metadata RPC (draft/metadata-2 & draft/metadata-3)
  public async setMetadata(targetKey: string, key: string, value: string | null): Promise<void> {
    const canonTarget = canonicalizeIRCName(targetKey);
    const canonKey = key.toLowerCase();
    if (value === null || value === "") {
      this.sql.exec(
        "DELETE FROM user_metadata WHERE target_key = ? AND key = ?",
        canonTarget,
        canonKey,
      );
      if (canonKey === "display-name") {
        this.sql.exec(
          "UPDATE users SET display_name = NULL WHERE LOWER(username) = ?",
          canonTarget,
        );
      }
    } else {
      this.sql.exec(
        `INSERT INTO user_metadata (target_key, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(target_key, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        canonTarget,
        canonKey,
        value,
        Date.now(),
      );
      if (canonKey === "display-name") {
        this.sql.exec(
          "UPDATE users SET display_name = ? WHERE LOWER(username) = ?",
          value,
          canonTarget,
        );
      }
    }
  }

  public async getMetadata(targetKey: string, keys?: string[]): Promise<Record<string, string>> {
    const canonTarget = canonicalizeIRCName(targetKey);
    const rows = this.sql
      .exec<{ key: string; value: string }>(
        "SELECT key, value FROM user_metadata WHERE target_key = ?",
        canonTarget,
      )
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

  public async clearMetadata(targetKey: string): Promise<string[]> {
    const canonTarget = canonicalizeIRCName(targetKey);
    const existing = this.sql
      .exec<{ key: string }>("SELECT key FROM user_metadata WHERE target_key = ?", canonTarget)
      .toArray()
      .map((r) => r.key);
    this.sql.exec("DELETE FROM user_metadata WHERE target_key = ?", canonTarget);
    return existing;
  }

  // Read Marker RPC (draft/read-marker)
  public async getReadMarker(userKey: string, target: string): Promise<string | null> {
    const canonUser = canonicalizeIRCName(userKey);
    const canonTarget = canonicalizeIRCName(target);
    const rows = this.sql
      .exec<{ timestamp: string }>(
        "SELECT timestamp FROM read_markers WHERE user_key = ? AND target = ?",
        canonUser,
        canonTarget,
      )
      .toArray();
    return rows.length > 0 ? rows[0].timestamp : null;
  }

  public async updateReadMarker(
    userKey: string,
    target: string,
    timestamp: string,
  ): Promise<string> {
    const canonUser = canonicalizeIRCName(userKey);
    const canonTarget = canonicalizeIRCName(target);
    const existing = await this.getReadMarker(canonUser, canonTarget);

    let effectiveTs = timestamp;
    if (existing) {
      const existingMs = Date.parse(existing);
      const nextMs = Date.parse(timestamp);
      if (!Number.isNaN(existingMs) && !Number.isNaN(nextMs) && existingMs > nextMs) {
        effectiveTs = existing;
      }
    }

    this.sql.exec(
      `INSERT INTO read_markers (user_key, target, timestamp, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_key, target) DO UPDATE SET timestamp = excluded.timestamp, updated_at = excluded.updated_at`,
      canonUser,
      canonTarget,
      effectiveTs,
      Date.now(),
    );
    return effectiveTs;
  }

  // Persistence & Auto-Join settings
  public async setPersistence(userId: string, enabled: boolean): Promise<void> {
    this.sql.exec(
      `INSERT INTO account_settings (user_id, persistence, auto_join_json)
       VALUES (?, ?, '[]')
       ON CONFLICT(user_id) DO UPDATE SET persistence = excluded.persistence`,
      userId,
      enabled ? 1 : 0,
    );
  }

  // Channel Notification Preferences
  public async setChannelNotification(
    userId: string,
    channelName: string,
    level: "all" | "mentions" | "nothing" = "mentions",
    mutedUntil?: number | null,
  ): Promise<{ ok: boolean; channel: string; level: string; mutedUntil: number | null }> {
    const canonChan = canonicalizeIRCName(channelName);
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO channel_notifications (user_id, channel_name, level, muted_until, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, channel_name) DO UPDATE SET
         level = excluded.level,
         muted_until = excluded.muted_until,
         updated_at = excluded.updated_at`,
      userId,
      canonChan,
      level,
      mutedUntil || null,
      now,
    );
    return {
      ok: true,
      channel: channelName,
      level,
      mutedUntil: mutedUntil || null,
    };
  }

  public async getChannelNotification(
    userId: string,
    channelName: string,
  ): Promise<{ level: "all" | "mentions" | "nothing"; muted: boolean; mutedUntil: number | null }> {
    const canonChan = canonicalizeIRCName(channelName);
    const rows = this.sql
      .exec<{ level: string; muted_until: number | null }>(
        "SELECT level, muted_until FROM channel_notifications WHERE user_id = ? AND channel_name = ?",
        userId,
        canonChan,
      )
      .toArray();

    if (rows.length === 0) {
      return { level: "mentions", muted: false, mutedUntil: null };
    }
    const r = rows[0];
    const now = Date.now();
    const isMuted = Boolean(r.muted_until && r.muted_until > now);
    return {
      level: (r.level as any) || "mentions",
      muted: isMuted,
      mutedUntil: r.muted_until,
    };
  }

  public async listChannelNotifications(
    userId: string,
  ): Promise<Array<{ channel: string; level: string; muted: boolean; mutedUntil: number | null }>> {
    const rows = this.sql
      .exec<{ channel_name: string; level: string; muted_until: number | null }>(
        "SELECT channel_name, level, muted_until FROM channel_notifications WHERE user_id = ?",
        userId,
      )
      .toArray();

    const now = Date.now();
    return rows.map((r) => ({
      channel: r.channel_name,
      level: r.level,
      muted: Boolean(r.muted_until && r.muted_until > now),
      mutedUntil: r.muted_until,
    }));
  }

  public async getPersistence(userId: string): Promise<boolean> {
    const rows = this.sql
      .exec<{ persistence: number }>(
        "SELECT persistence FROM account_settings WHERE user_id = ?",
        userId,
      )
      .toArray();
    if (rows.length > 0) {
      return rows[0].persistence === 1;
    }
    return (
      (this.env as any).ALWAYS_ON_DEFAULT === "1" ||
      (this.env as any).CFCORD_ALWAYS_ON_DEFAULT === "1"
    );
  }

  // Admin and Role management
  public async isUserAdmin(userIdOrUsername: string): Promise<boolean> {
    const canon = canonicalizeIRCName(userIdOrUsername.trim());
    if (SERVER_CONFIG.adminUsers.includes(canon)) {
      return true;
    }
    const rows = this.sql
      .exec<{ role: string }>(
        `SELECT ar.role FROM account_roles ar
         JOIN users u ON u.id = ar.user_id
         WHERE (u.id = ? OR LOWER(u.username) = ?) AND ar.role = 'admin'`,
        userIdOrUsername,
        canon,
      )
      .toArray();
    return rows.length > 0;
  }

  public async grantRole(username: string, role: string): Promise<boolean> {
    const canon = canonicalizeIRCName(username.trim());
    const user = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canon)
      .toArray()[0];
    if (!user) return false;
    this.sql.exec("INSERT OR IGNORE INTO account_roles (user_id, role) VALUES (?, ?)", user.id, role);
    return true;
  }

  public async revokeRole(username: string, role: string): Promise<boolean> {
    const canon = canonicalizeIRCName(username.trim());
    const user = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canon)
      .toArray()[0];
    if (!user) return false;
    this.sql.exec("DELETE FROM account_roles WHERE user_id = ? AND role = ?", user.id, role);
    return true;
  }

  public async getUserRoles(username: string): Promise<string[]> {
    const canon = canonicalizeIRCName(username.trim());
    const user = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canon)
      .toArray()[0];
    if (!user) return [];
    const roles = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", user.id)
      .toArray()
      .map((r) => r.role);
    if (SERVER_CONFIG.adminUsers.includes(canon) && !roles.includes("admin")) {
      roles.push("admin");
    }
    return roles;
  }

  public async changePassword(username: string, newPassword: string): Promise<boolean> {
    const canonUser = canonicalizeIRCName(username);
    if (!newPassword || newPassword.length < 6) {
      return false;
    }
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return false;
    }
    const passwordHash = await hashPassword(newPassword);
    this.sql.exec(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
      passwordHash,
      Date.now(),
      existing[0].id,
    );
    const scram = await generateScramKeys(newPassword);
    this.sql.exec(
      `INSERT OR REPLACE INTO scram_credentials (user_id, salt, iterations, stored_key, server_key)
       VALUES (?, ?, ?, ?, ?)`,
      existing[0].id,
      scram.salt,
      scram.iterations,
      scram.storedKey,
      scram.serverKey,
    );
    return true;
  }

  public async unregisterAccount(username: string): Promise<boolean> {
    const canonUser = canonicalizeIRCName(username);
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return false;
    }
    const userId = existing[0].id;
    this.sql.exec("DELETE FROM registered_nicks WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM account_roles WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM account_settings WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM user_metadata WHERE target_key = ?", canonUser);
    this.sql.exec("DELETE FROM users WHERE id = ?", userId);
    return true;
  }

  public async dropNickname(userId: string, nickname: string): Promise<boolean> {
    const canonNick = canonicalizeIRCName(nickname);
    const owner = await this.getNickOwner(canonNick);
    if (!owner || owner !== userId) {
      return false;
    }
    this.sql.exec(
      "DELETE FROM registered_nicks WHERE nickname = ? AND user_id = ?",
      canonNick,
      userId,
    );
    return true;
  }

  public async getAccountNicks(userId: string): Promise<string[]> {
    return this.sql
      .exec<{ nickname: string }>(
        "SELECT nickname FROM registered_nicks WHERE user_id = ? ORDER BY registered_at ASC",
        userId,
      )
      .toArray()
      .map((r) => r.nickname);
  }

  public async setVhost(username: string, vhost: string | null): Promise<boolean> {
    const acct = await this.getAccountByUsername(username);
    if (!acct) return false;
    const enabled = vhost ? 1 : 0;
    this.sql.exec(
      `INSERT INTO account_settings (user_id, persistence, auto_join_json, vhost, vhost_enabled)
       VALUES (?, 1, '[]', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET vhost = excluded.vhost, vhost_enabled = excluded.vhost_enabled`,
      acct.id,
      vhost,
      enabled,
    );
    return true;
  }

  public async setVhostEnabled(
    username: string,
    enabled: boolean,
  ): Promise<{ ok: boolean; vhost: string | null }> {
    const acct = await this.getAccountByUsername(username);
    if (!acct) return { ok: false, vhost: null };
    const info = await this.getVhostInfo(username);
    if (!info.vhost) return { ok: false, vhost: null };
    this.sql.exec(
      "UPDATE account_settings SET vhost_enabled = ? WHERE user_id = ?",
      enabled ? 1 : 0,
      acct.id,
    );
    return { ok: true, vhost: info.vhost };
  }

  public async getVhostInfo(username: string): Promise<{ vhost: string | null; enabled: boolean }> {
    const acct = await this.getAccountByUsername(username);
    if (!acct) return { vhost: null, enabled: false };
    const rows = this.sql
      .exec<{ vhost: string | null; vhost_enabled: number }>(
        "SELECT vhost, vhost_enabled FROM account_settings WHERE user_id = ?",
        acct.id,
      )
      .toArray();
    if (rows.length === 0) {
      return { vhost: null, enabled: false };
    }
    return {
      vhost: rows[0].vhost,
      enabled: rows[0].vhost_enabled === 1 && Boolean(rows[0].vhost),
    };
  }

  public async getAccountSettings(userId: string): Promise<Record<string, string>> {
    const rows = this.sql
      .exec<{ persistence: number; settings_json: string }>(
        "SELECT persistence, settings_json FROM account_settings WHERE user_id = ?",
        userId,
      )
      .toArray();
    const defaultPersistence =
      (this.env as any).ALWAYS_ON_DEFAULT === "1" ||
      (this.env as any).CFCORD_ALWAYS_ON_DEFAULT === "1";
    const defaults: Record<string, string> = {
      "always-on":
        rows.length > 0 && rows[0].persistence !== undefined
          ? rows[0].persistence === 1
            ? "on"
            : "off"
          : defaultPersistence
            ? "on"
            : "default",
      "auto-away": "default",
      "autoreplay-lines": "default",
      "autoreplay-missed": "default",
      "dm-history": "default",
      multiclient: "on",
      bouncer: "on",
    };
    if (rows.length > 0 && rows[0].settings_json) {
      try {
        const parsed = JSON.parse(rows[0].settings_json) as Record<string, string>;
        Object.assign(defaults, parsed);
      } catch {
        // ignore invalid json
      }
    }
    return defaults;
  }

  public async setAccountSetting(userId: string, key: string, value: string): Promise<boolean> {
    const current = await this.getAccountSettings(userId);
    const normKey = key.toLowerCase();
    current[normKey] = value.toLowerCase();
    const persistence =
      normKey === "always-on"
        ? value.toLowerCase() === "on" || value.toLowerCase() === "true"
          ? 1
          : 0
        : current["always-on"] === "on"
          ? 1
          : 0;
    this.sql.exec(
      `INSERT INTO account_settings (user_id, persistence, auto_join_json, settings_json)
       VALUES (?, ?, '[]', ?)
       ON CONFLICT(user_id) DO UPDATE SET persistence = excluded.persistence, settings_json = excluded.settings_json`,
      userId,
      persistence,
      JSON.stringify(current),
    );
    return true;
  }

  public async getAutoJoinChannels(
    userId: string,
  ): Promise<Array<{ channel: string; key?: string }>> {
    const rows = this.sql
      .exec<{ auto_join_json: string }>(
        "SELECT auto_join_json FROM account_settings WHERE user_id = ?",
        userId,
      )
      .toArray();
    if (rows.length === 0 || !rows[0].auto_join_json) {
      return [];
    }
    try {
      const parsed = JSON.parse(rows[0].auto_join_json);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // ignore invalid json
    }
    return [];
  }

  public async getUserAutoJoinChannels(username: string): Promise<string[]> {
    const canon = canonicalizeIRCName(username);
    const u = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE LOWER(username) = ?", canon)
      .toArray();
    if (u.length === 0) return [];
    const list = await this.getAutoJoinChannels(u[0].id);
    return list.map((item) => item.channel);
  }

  public async addAutoJoinChannel(
    userId: string,
    channelName: string,
    key?: string,
  ): Promise<void> {
    const existing = await this.getAutoJoinChannels(userId);
    const canon = canonicalizeIRCName(channelName);
    const filtered = existing.filter((e) => canonicalizeIRCName(e.channel) !== canon);
    filtered.push({ channel: channelName, ...(key ? { key } : {}) });
    const defaultPersistence =
      (this.env as any).ALWAYS_ON_DEFAULT === "1" ||
      (this.env as any).CFCORD_ALWAYS_ON_DEFAULT === "1"
        ? 1
        : 0;
    this.sql.exec(
      `INSERT INTO account_settings (user_id, persistence, auto_join_json)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET auto_join_json = excluded.auto_join_json`,
      userId,
      defaultPersistence,
      JSON.stringify(filtered),
    );
  }

  public async removeAutoJoinChannel(userId: string, channelName: string): Promise<void> {
    const existing = await this.getAutoJoinChannels(userId);
    const canon = canonicalizeIRCName(channelName);
    const filtered = existing.filter((e) => canonicalizeIRCName(e.channel) !== canon);
    const defaultPersistence =
      (this.env as any).ALWAYS_ON_DEFAULT === "1" ||
      (this.env as any).CFCORD_ALWAYS_ON_DEFAULT === "1"
        ? 1
        : 0;
    this.sql.exec(
      `INSERT INTO account_settings (user_id, persistence, auto_join_json)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET auto_join_json = excluded.auto_join_json`,
      userId,
      defaultPersistence,
      JSON.stringify(filtered),
    );
  }

  public async registerWebpush(
    userKey: string,
    endpoint: string,
    keysStr: string = "",
  ): Promise<void> {
    const canon = canonicalizeIRCName(userKey);
    this.sql.exec(
      `INSERT INTO webpush_subscriptions (user_key, endpoint, keys_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_key, endpoint) DO UPDATE SET keys_json = excluded.keys_json, created_at = excluded.created_at`,
      canon,
      endpoint,
      keysStr,
      Date.now(),
    );
  }

  public async unregisterWebpush(userKey: string, endpoint: string): Promise<boolean> {
    const canon = canonicalizeIRCName(userKey);
    this.sql.exec(
      "DELETE FROM webpush_subscriptions WHERE user_key = ? AND endpoint = ?",
      canon,
      endpoint,
    );
    return true;
  }

  public async listWebpush(userKey: string): Promise<string[]> {
    const canon = canonicalizeIRCName(userKey);
    return this.sql
      .exec<{ endpoint: string }>(
        "SELECT endpoint FROM webpush_subscriptions WHERE user_key = ? ORDER BY created_at ASC",
        canon,
      )
      .toArray()
      .map((r) => r.endpoint);
  }

  // Canonical User Profiles
  public async getUserProfile(username: string): Promise<UserProfile | null> {
    const canonUser = canonicalizeIRCName(username);
    const users = this.sql
      .exec<{ id: string; username: string; display_name: string | null; created_at: number }>(
        "SELECT id, username, display_name, created_at FROM users WHERE LOWER(username) = ?",
        canonUser,
      )
      .toArray();
    if (users.length === 0) return null;
    const u = users[0];
    const roles = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", u.id)
      .toArray()
      .map((r) => r.role);

    const metaRows = this.sql
      .exec<{ key: string; value: string }>(
        "SELECT key, value FROM user_metadata WHERE target_key = ?",
        canonUser,
      )
      .toArray();
    const meta: Record<string, string> = {};
    for (const r of metaRows) {
      meta[r.key] = r.value;
    }

    const isBot = meta["bot"] === "true" || meta["bot"] === "1" || roles.includes("bot");

    return {
      username: u.username,
      displayName: meta["display-name"] ?? u.display_name ?? null,
      avatar: meta["avatar"] ?? null,
      pronouns: meta["pronouns"] ?? null,
      bio: meta["bio"] ?? null,
      bot: isBot,
      color: meta["color"] ?? null,
      customStatus: meta["custom-status"] ?? meta["status"] ?? null,
      timezone: meta["timezone"] ?? null,
      roles,
      createdAt: u.created_at,
    };
  }

  public async setUserProfile(
    username: string,
    updates: UserProfileInput,
  ): Promise<UserProfile | null> {
    const canonUser = canonicalizeIRCName(username);
    const users = this.sql
      .exec<{ id: string; username: string; display_name: string | null; created_at: number }>(
        "SELECT id, username, display_name, created_at FROM users WHERE LOWER(username) = ?",
        canonUser,
      )
      .toArray();
    if (users.length === 0) return null;

    if (updates.displayName !== undefined) {
      const val = updates.displayName ? updates.displayName.trim().slice(0, 64) : null;
      this.sql.exec("UPDATE users SET display_name = ? WHERE LOWER(username) = ?", val, canonUser);
      await this.setMetadata(canonUser, "display-name", val);
    }
    if (updates.avatar !== undefined) {
      const val = updates.avatar ? updates.avatar.trim().slice(0, 2048) : null;
      await this.setMetadata(canonUser, "avatar", val);
    }
    if (updates.pronouns !== undefined) {
      const val = updates.pronouns ? updates.pronouns.trim().slice(0, 64) : null;
      await this.setMetadata(canonUser, "pronouns", val);
    }
    if (updates.bio !== undefined) {
      const val = updates.bio ? updates.bio.trim().slice(0, 2048) : null;
      await this.setMetadata(canonUser, "bio", val);
    }
    if (updates.bot !== undefined) {
      const isBot = updates.bot === true || updates.bot === "true" || updates.bot === "1";
      await this.setMetadata(canonUser, "bot", isBot ? "true" : null);
    }
    if (updates.color !== undefined) {
      const val = updates.color ? updates.color.trim().slice(0, 32) : null;
      await this.setMetadata(canonUser, "color", val);
    }
    if (updates.customStatus !== undefined) {
      const val = updates.customStatus ? updates.customStatus.trim().slice(0, 256) : null;
      await this.setMetadata(canonUser, "custom-status", val);
    }
    if (updates.timezone !== undefined) {
      const val = updates.timezone ? updates.timezone.trim().slice(0, 64) : null;
      await this.setMetadata(canonUser, "timezone", val);
    }

    return this.getUserProfile(username);
  }

  // Media Storage (Fallback when R2 is not configured)
  public async storeMedia(file: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    data: ArrayBuffer;
  }): Promise<void> {
    this.sql.exec(
      `INSERT INTO media_uploads (id, filename, mime_type, size, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET filename = excluded.filename, mime_type = excluded.mime_type, size = excluded.size, data = excluded.data, created_at = excluded.created_at`,
      file.id,
      file.filename,
      file.mimeType,
      file.size,
      file.data,
      Date.now(),
    );
  }

  public async getMedia(id: string): Promise<{
    filename: string;
    mimeType: string;
    size: number;
    data: ArrayBuffer;
  } | null> {
    const rows = this.sql
      .exec<{
        filename: string;
        mime_type: string;
        size: number;
        data: ArrayBuffer;
      }>("SELECT filename, mime_type, size, data FROM media_uploads WHERE id = ?", id)
      .toArray();
    if (rows.length === 0) return null;
    return {
      filename: rows[0].filename,
      mimeType: rows[0].mime_type,
      size: rows[0].size,
      data: rows[0].data,
    };
  }
}
