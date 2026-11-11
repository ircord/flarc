import { DurableObject } from "cloudflare:workers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { hashPassword, verifyPassword } from "../core/authentication/passwords";
import { generateScramKeys, type ScramAccountData } from "../core/authentication/scram";
import { hashSessionToken, newSessionToken } from "../core/authentication/tokens";
import { applyEnvConfig, SERVER_CONFIG } from "../core/config";
import { domainEvents } from "../core/events/emitter";
import { isReservedServiceNickname, isValidNickname } from "../core/permissions/validation";
import type { AccountInfo, Env, UserProfile, UserProfileInput } from "../core/types";
import { canonicalizeIRCName } from "../protocol/irc/parser";
import { WebPushSubscribeSchema } from "../schemas/notifications";
import { initializeAccountsSchema } from "../storage/migrations/init";
import * as accountsSchema from "../storage/schemas/accounts";

export class AccountsDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private db: ReturnType<typeof drizzle<typeof accountsSchema>>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    applyEnvConfig(env);
    this.sql = ctx.storage.sql;
    initializeAccountsSchema(this.sql);
    this.db = drizzle(ctx.storage, { schema: accountsSchema });
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(users)").toArray();
    if (!columns.some((c) => c.name === "canonical_username")) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("ALTER TABLE users ADD COLUMN canonical_username TEXT");
        for (const user of this.sql
          .exec<{ id: string; username: string }>("SELECT id, username FROM users")
          .toArray()) {
          this.sql.exec(
            "UPDATE users SET canonical_username = ? WHERE id = ?",
            canonicalizeIRCName(user.username),
            user.id,
          );
        }
        // Fail explicitly on ambiguous legacy identities; never merge accounts or their data.
        this.sql.exec("CREATE UNIQUE INDEX idx_users_canonical ON users(canonical_username)");
      });
    }
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(users)")
        .toArray()
        .some((c) => c.name === "credential_version")
    ) {
      this.sql.exec("ALTER TABLE users ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0");
    }
    const mediaColumns = this.sql
      .exec<{ name: string }>("PRAGMA table_info(media_uploads)")
      .toArray();
    for (const [name, type] of [
      ["owner_id", "TEXT"],
      ["scope_kind", "TEXT NOT NULL DEFAULT 'private'"],
      ["scope_target", "TEXT"],
      ["scope_generation", "TEXT"],
      ["storage_kind", "TEXT NOT NULL DEFAULT 'sqlite'"],
    ]) {
      if (!mediaColumns.some((c) => c.name === name))
        this.sql.exec(`ALTER TABLE media_uploads ADD COLUMN ${name} ${type}`);
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS security_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS account_tombstones (canonical_username TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS api_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_api_sessions_user ON api_sessions(user_id);
      CREATE TABLE IF NOT EXISTS event_tickets (ticket_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES api_sessions(token_hash) ON DELETE CASCADE, expires_at INTEGER NOT NULL);`);
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(account_tombstones)")
        .toArray()
        .some((c) => c.name === "user_id")
    )
      this.sql.exec("ALTER TABLE account_tombstones ADD COLUMN user_id TEXT");
    if (
      this.sql.exec("SELECT user_id FROM account_roles WHERE role = 'admin' LIMIT 1").toArray()
        .length
    ) {
      this.sql.exec(
        "INSERT OR IGNORE INTO security_settings (key, value) VALUES ('bootstrap_completed', '1')",
      );
    }
    this.sql.exec(
      "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)",
      Date.now(),
    );
  }

  public async registerAccount(params: {
    username: string;
    password: string;
    displayName?: string;
    roles?: string[];
    bootstrapToken?: string;
    signupToken?: string;
    registrationPolicyBypass?: boolean;
  }): Promise<{ ok: true; account: AccountInfo } | { ok: false; error: string }> {
    if (!this.checkRequestLimit("signup:global", 50, 60_000))
      return { ok: false, error: "Too many signup attempts" };
    const rawUsername = params.username.trim();
    const canonUser = canonicalizeIRCName(rawUsername);
    if (!isValidNickname(rawUsername) || isReservedServiceNickname(rawUsername)) {
      return { ok: false, error: "Invalid or reserved username" };
    }
    if (
      !params.password ||
      params.password.length < this.getRuntimeConfig().minPasswordLength ||
      params.password.length > 1024
    ) {
      return { ok: false, error: "Password does not meet the configured length policy" };
    }
    const bootstrapSecret =
      this.env.ADMIN_TOKEN || this.env.ADMIN_API_KEY || this.env.CFCORD_ADMIN_TOKEN;
    const bootstrap = Boolean(
      bootstrapSecret &&
        params.bootstrapToken === bootstrapSecret &&
        SERVER_CONFIG.adminUsers.includes(canonUser),
    );
    const signupPolicy = this.getRuntimeConfig().signupPolicy;
    if (
      !params.registrationPolicyBypass &&
      !bootstrap &&
      signupPolicy !== "open" &&
      !(
        signupPolicy === "invite" &&
        this.env.SIGNUP_TOKEN &&
        params.signupToken === this.env.SIGNUP_TOKEN
      )
    ) {
      return { ok: false, error: "Account signup is restricted by this server" };
    }
    const roles = [...new Set(params.roles ?? [])];
    if (SERVER_CONFIG.adminUsers.includes(canonUser) && !roles.includes("admin")) {
      const bootstrapSecret =
        this.env.ADMIN_TOKEN || this.env.ADMIN_API_KEY || this.env.CFCORD_ADMIN_TOKEN;
      if (!bootstrapSecret || params.bootstrapToken !== bootstrapSecret) {
        return { ok: false, error: "This account name is reserved for administrator provisioning" };
      }
      roles.push("admin");
    }
    // Derive credentials before entering the synchronous transaction. Recheck uniqueness after awaits.
    const passwordHash = await hashPassword(params.password);
    const scram = await generateScramKeys(params.password);
    const id = crypto.randomUUID();
    const now = Date.now();
    const inserted = this.ctx.storage.transactionSync(() => {
      if (
        bootstrap &&
        this.sql
          .exec("SELECT key FROM security_settings WHERE key = 'bootstrap_completed'")
          .toArray().length
      )
        return false;
      if (
        this.sql
          .exec(
            "SELECT canonical_username FROM account_tombstones WHERE canonical_username = ?",
            canonUser,
          )
          .toArray().length ||
        this.sql.exec("SELECT id FROM users WHERE canonical_username = ?", canonUser).toArray()
          .length ||
        this.sql
          .exec("SELECT user_id FROM registered_nicks WHERE nickname = ?", canonUser)
          .toArray().length
      )
        return false;
      this.sql.exec(
        `INSERT INTO users (id, username, canonical_username, display_name, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        rawUsername,
        canonUser,
        params.displayName ?? null,
        passwordHash,
        now,
        now,
      );
      this.sql.exec(
        `INSERT INTO scram_credentials (user_id, salt, iterations, stored_key, server_key)
        VALUES (?, ?, ?, ?, ?)`,
        id,
        scram.salt,
        scram.iterations,
        scram.storedKey,
        scram.serverKey,
      );
      this.sql.exec(
        "INSERT INTO registered_nicks (nickname, user_id, registered_at) VALUES (?, ?, ?)",
        canonUser,
        id,
        now,
      );
      for (const role of roles)
        this.sql.exec("INSERT INTO account_roles (user_id, role) VALUES (?, ?)", id, role);
      if (roles.includes("admin"))
        this.sql.exec(
          "INSERT OR REPLACE INTO security_settings (key, value) VALUES ('bootstrap_completed', '1')",
        );
      return true;
    });
    if (!inserted) return { ok: false, error: "Account or nickname already exists" };

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

  public checkRequestLimit(key: string, maximum: number, windowMs = 10_000): boolean {
    const now = Date.now();
    this.sql.exec("DELETE FROM request_limits WHERE reset_at <= ?", now);
    const row = this.sql
      .exec<{ count: number }>("SELECT count FROM request_limits WHERE key = ?", key)
      .toArray()[0];
    if ((row?.count ?? 0) >= maximum) return false;
    this.sql.exec(
      "INSERT INTO request_limits (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
      key,
      now + windowMs,
    );
    return true;
  }

  public getRuntimeConfig(): {
    filehostEnabled: boolean;
    filehostRequireRegistration: boolean;
    zncMaxMessages: number;
    signupPolicy: string;
    minPasswordLength: number;
  } {
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM security_settings WHERE key = 'runtime_config'")
      .toArray()[0];
    return {
      signupPolicy: this.env.SIGNUP_POLICY ?? "closed",
      minPasswordLength: SERVER_CONFIG.minPasswordLength,
      filehostEnabled: SERVER_CONFIG.filehostEnabled,
      filehostRequireRegistration: true,
      zncMaxMessages: SERVER_CONFIG.zncMaxMessages,
      ...(row ? JSON.parse(row.value) : {}),
    };
  }

  public setRuntimeConfig(updates: Partial<ReturnType<AccountsDO["getRuntimeConfig"]>>) {
    const config = { ...this.getRuntimeConfig(), ...updates, filehostRequireRegistration: true };
    this.sql.exec(
      "INSERT INTO security_settings (key, value) VALUES ('runtime_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(config),
    );
    return config;
  }

  public accountIdExists(id: string): boolean {
    return (
      this.sql.exec("SELECT id FROM users WHERE id = ? AND disabled_at IS NULL", id).toArray()
        .length > 0
    );
  }

  public async adminRequest(token: string, operation: string, args: unknown[]): Promise<unknown> {
    const actor = await this.verifyApiSession(token);
    if (!actor?.roles.includes("admin")) throw new Error("Administrator authorization required");
    const allowed = new Set<string>([
      "adminListAccounts",
      "adminResetPassword",
      "deleteAccount",
      "disableAccount",
      "enableAccount",
      "getAccountDetails",
      "getUserProfile",
      "getUserRoles",
      "grantRole",
      "registerAccount",
      "revokeRole",
      "setRuntimeConfig",
      "setUserProfile",
      "updateAccount",
    ]);
    if (!allowed.has(operation)) throw new Error("Unknown administrative operation");
    const method = (this as unknown as Record<string, (...values: unknown[]) => unknown>)[
      operation
    ];
    return method.apply(this, args);
  }

  public async clientRequest(token: string, operation: string, input: any): Promise<any> {
    const actor = await this.verifyApiSession(token);
    if (!actor) throw new Error("Authentication required");
    if (operation === "profile.get") return this.getUserProfile(input.username);
    if (canonicalizeIRCName(actor.username) !== canonicalizeIRCName(input.username))
      throw new Error("Account access denied");
    switch (operation) {
      case "profile.update":
        return this.setUserProfile(actor.username, input.updates);
      case "push.list":
        return this.listWebpush(actor.username);
      case "push.register":
        return this.registerWebpush(actor.username, input.endpoint, input.keys);
      case "push.remove":
        return this.unregisterWebpush(actor.username, input.endpoint);
      case "notifications.list":
        return this.listChannelNotifications(actor.id);
      case "notifications.update":
        return this.setChannelNotification(actor.id, input.channel, input.level, input.mutedUntil);
      default:
        throw new Error("Unknown client operation");
    }
  }

  public getCredentialVersion(userId: string): number {
    return (
      this.sql
        .exec<{ credential_version: number }>(
          "SELECT credential_version FROM users WHERE id = ? AND disabled_at IS NULL",
          userId,
        )
        .toArray()[0]?.credential_version ?? -1
    );
  }

  public async createApiSession(userId: string): Promise<{ token: string; expiresAt: number }> {
    const token = newSessionToken();
    const tokenHash = await hashSessionToken(token);
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;
    this.sql.exec("DELETE FROM api_sessions WHERE expires_at <= ?", now);
    // Bound active credentials per account.
    this.sql.exec(
      "DELETE FROM api_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM api_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 19)",
      userId,
      userId,
    );
    this.sql.exec(
      "INSERT INTO api_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      tokenHash,
      userId,
      expiresAt,
      now,
    );
    return { token, expiresAt };
  }

  public async verifyApiSession(token: string): Promise<AccountInfo | null> {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = await hashSessionToken(token);
    const row = this.db
      .select({ username: accountsSchema.users.username })
      .from(accountsSchema.apiSessions)
      .innerJoin(
        accountsSchema.users,
        eq(accountsSchema.apiSessions.userId, accountsSchema.users.id),
      )
      .where(
        and(
          eq(accountsSchema.apiSessions.tokenHash, hash),
          gt(accountsSchema.apiSessions.expiresAt, Date.now()),
          isNull(accountsSchema.users.disabledAt),
        ),
      )
      .get();
    return row ? this.getAccountByUsername(row.username) : null;
  }

  public async verifySessionHash(hash: string): Promise<AccountInfo | null> {
    const row = this.sql
      .exec<{ username: string }>(
        `SELECT u.username FROM api_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
        hash,
        Date.now(),
      )
      .toArray()[0];
    return row ? this.getAccountByUsername(row.username) : null;
  }

  public async createEventTicket(token: string): Promise<string | null> {
    if (!(await this.verifyApiSession(token))) return null;
    const ticket = newSessionToken();
    const hash = await hashSessionToken(ticket);
    const sessionHash = await hashSessionToken(token);
    if (!(await this.verifySessionHash(sessionHash))) return null;
    this.sql.exec("DELETE FROM event_tickets WHERE expires_at <= ?", Date.now());
    this.sql.exec(
      "INSERT INTO event_tickets (ticket_hash, session_hash, expires_at) VALUES (?, ?, ?)",
      hash,
      sessionHash,
      Date.now() + 30_000,
    );
    return ticket;
  }

  public async consumeEventTicket(ticket: string): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(ticket)) return null;
    const hash = await hashSessionToken(ticket);
    return this.ctx.storage.transactionSync(() => {
      const row = this.sql
        .exec<{ session_hash: string }>(
          "SELECT session_hash FROM event_tickets WHERE ticket_hash = ? AND expires_at > ?",
          hash,
          Date.now(),
        )
        .toArray()[0];
      this.sql.exec("DELETE FROM event_tickets WHERE ticket_hash = ?", hash);
      return row?.session_hash ?? null;
    });
  }

  public async revokeApiSession(token: string): Promise<void> {
    this.sql.exec("DELETE FROM api_sessions WHERE token_hash = ?", await hashSessionToken(token));
  }

  public async verifyCredentials(
    username: string,
    password: string,
  ): Promise<{ ok: true; account: AccountInfo } | { ok: false; error: string }> {
    const canonUser = canonicalizeIRCName(username.trim());
    if (
      !this.checkRequestLimit(`login:${canonUser}`, 10) ||
      !this.checkRequestLimit("login:global", 200)
    ) {
      return { ok: false, error: "Too many authentication attempts" };
    }

    const rows = this.sql
      .exec<{
        id: string;
        username: string;
        display_name: string | null;
        password_hash: string;
        credential_version: number;
        created_at: number;
        disabled_at: number | null;
      }>(
        "SELECT id, username, display_name, password_hash, credential_version, created_at, disabled_at FROM users WHERE canonical_username = ?",
        canonUser,
      )
      .toArray();

    if (rows.length === 0) {
      await hashPassword(password);
      return { ok: false, error: "Invalid credentials" };
    }

    const user = rows[0];
    if (user.disabled_at !== null) {
      return { ok: false, error: "Invalid credentials" };
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return { ok: false, error: "Invalid credentials" };
    }

    const current = this.sql
      .exec<{ password_hash: string; disabled_at: number | null }>(
        "SELECT password_hash, disabled_at FROM users WHERE id = ?",
        user.id,
      )
      .toArray()[0];
    if (!current || current.disabled_at !== null || current.password_hash !== user.password_hash)
      return { ok: false, error: "Invalid credentials" };

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
        credentialVersion: user.credential_version,
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
        credential_version: number;
        salt: string;
        iterations: number;
        stored_key: string;
        server_key: string;
      }>(
        `SELECT u.id, u.username, u.display_name, u.created_at, u.disabled_at, u.credential_version,
                s.salt, s.iterations, s.stored_key, s.server_key
         FROM users u
         JOIN scram_credentials s ON s.user_id = u.id
         WHERE u.canonical_username = ?`,
        canonUser,
      )
      .toArray();

    if (rows.length === 0) {
      return { ok: false, error: "User not found or no SCRAM credentials" };
    }

    const row = rows[0];
    if (row.disabled_at !== null) {
      return { ok: false, error: "Invalid credentials" };
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
        credentialVersion: row.credential_version,
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
        credential_version: number;
      }>(
        "SELECT id, username, display_name, created_at, disabled_at, credential_version FROM users WHERE canonical_username = ?",
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
      credentialVersion: user.credential_version,
    };
  }

  public async resolveConversationAccount(
    username: string,
  ): Promise<{ id: string; username: string } | null> {
    // Resolving a historical peer is not authenticating that peer. Disabling an
    // account must not hide the surviving participant's retained conversation.
    const account = this.sql
      .exec<{ id: string; username: string }>(
        "SELECT id, username FROM users WHERE canonical_username = ?",
        canonicalizeIRCName(username),
      )
      .toArray()[0];
    if (account) return account;
    const deleted = this.sql
      .exec<{ user_id: string | null }>(
        "SELECT user_id FROM account_tombstones WHERE canonical_username = ?",
        canonicalizeIRCName(username),
      )
      .toArray()[0];
    return deleted?.user_id ? { id: deleted.user_id, username } : null;
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
    if (!isValidNickname(nickname) || isReservedServiceNickname(nickname)) return false;
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
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return false;
    }
    const now = Date.now();
    this.sql.exec("DELETE FROM api_sessions WHERE user_id = ?", existing[0].id);
    this.sql.exec(
      "UPDATE users SET disabled_at = ?, updated_at = ?, credential_version = credential_version + 1 WHERE id = ?",
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
      conditions.push("(canonical_username LIKE ? OR LOWER(display_name) LIKE ?)");
      const q = `%${params.query.toLowerCase()}%`;
      bindings.push(q, q);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
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
        "SELECT id, username, display_name, created_at, disabled_at FROM users WHERE canonical_username = ?",
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
        "SELECT id, username, display_name, created_at FROM users WHERE canonical_username = ?",
        canonUser,
      )
      .toArray();
    if (existing.length === 0) {
      return { ok: false, error: "Account not found" };
    }
    const user = existing[0];
    const now = Date.now();

    this.ctx.storage.transactionSync(() => {
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
    });

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
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return { ok: false, error: "Account not found" };
    }
    if (!newPassword || newPassword.length < this.getRuntimeConfig().minPasswordLength) {
      return { ok: false, error: "Password cannot be empty" };
    }

    const userId = existing[0].id;
    if (newPassword.length > 1024) return { ok: false, error: "Password too long" };
    const passwordHash = await hashPassword(newPassword);
    const scram = await generateScramKeys(newPassword);
    const now = Date.now();

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "UPDATE users SET password_hash = ?, updated_at = ?, credential_version = credential_version + 1 WHERE id = ?",
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

      this.sql.exec("DELETE FROM api_sessions WHERE user_id = ?", userId);
    });
    return { ok: true };
  }

  public async enableAccount(username: string): Promise<boolean> {
    const canonUser = canonicalizeIRCName(username.trim());
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canonUser)
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
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canonUser)
      .toArray();
    if (existing.length === 0) {
      return false;
    }
    const userId = existing[0].id;
    this.sql.exec("DELETE FROM api_sessions WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM read_markers WHERE user_key = ?", canonUser);
    this.sql.exec("DELETE FROM webpush_subscriptions WHERE user_key = ?", canonUser);
    this.sql.exec(
      "INSERT OR IGNORE INTO account_tombstones (canonical_username, user_id) VALUES (?, ?)",
      canonUser,
      userId,
    );
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
          "UPDATE users SET display_name = NULL WHERE canonical_username = ?",
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
          "UPDATE users SET display_name = ? WHERE canonical_username = ?",
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
    const rows = this.sql
      .exec<{ role: string }>(
        `SELECT ar.role FROM account_roles ar
         JOIN users u ON u.id = ar.user_id
         WHERE (u.id = ? OR u.canonical_username = ?) AND ar.role = 'admin'`,
        userIdOrUsername,
        canon,
      )
      .toArray();
    return rows.length > 0;
  }

  public async grantRole(username: string, role: string): Promise<boolean> {
    const canon = canonicalizeIRCName(username.trim());
    const user = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canon)
      .toArray()[0];
    if (!user) return false;
    this.sql.exec(
      "INSERT OR IGNORE INTO account_roles (user_id, role) VALUES (?, ?)",
      user.id,
      role,
    );
    return true;
  }

  public async revokeRole(username: string, role: string): Promise<boolean> {
    const canon = canonicalizeIRCName(username.trim());
    const user = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canon)
      .toArray()[0];
    if (!user) return false;
    this.sql.exec("DELETE FROM account_roles WHERE user_id = ? AND role = ?", user.id, role);
    return true;
  }

  public async getUserRoles(username: string): Promise<string[]> {
    const canon = canonicalizeIRCName(username.trim());
    const user = this.sql
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canon)
      .toArray()[0];
    if (!user) return [];
    const roles = this.sql
      .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", user.id)
      .toArray()
      .map((r) => r.role);
    return roles;
  }

  public async changePassword(username: string, newPassword: string): Promise<boolean> {
    return (await this.adminResetPassword(username, newPassword)).ok;
  }

  public async unregisterAccount(username: string): Promise<boolean> {
    return this.deleteAccount(username);
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
      .exec<{ id: string }>("SELECT id FROM users WHERE canonical_username = ?", canon)
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
    // IRC and REST share validation and storage limits at the owning object.
    WebPushSubscribeSchema.pick({ endpoint: true }).parse({ endpoint });
    if (keysStr.length > 1024) throw new Error("Push keys exceed the size limit");
    const canon = canonicalizeIRCName(userKey);
    const rows = this.sql
      .exec<{ endpoint: string }>(
        "SELECT endpoint FROM webpush_subscriptions WHERE user_key = ?",
        canon,
      )
      .toArray();
    if (rows.length >= 20 && !rows.some((row) => row.endpoint === endpoint))
      throw new Error("Push subscription limit reached");
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
        "SELECT id, username, display_name, created_at FROM users WHERE canonical_username = ?",
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

    const isBot = meta.bot === "true" || meta.bot === "1" || roles.includes("bot");

    return {
      username: u.username,
      displayName: meta["display-name"] ?? u.display_name ?? null,
      avatar: meta.avatar ?? null,
      pronouns: meta.pronouns ?? null,
      bio: meta.bio ?? null,
      bot: isBot,
      color: meta.color ?? null,
      customStatus: meta["custom-status"] ?? meta.status ?? null,
      timezone: meta.timezone ?? null,
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
        "SELECT id, username, display_name, created_at FROM users WHERE canonical_username = ?",
        canonUser,
      )
      .toArray();
    if (users.length === 0) return null;

    if (updates.displayName !== undefined) {
      const val = updates.displayName ? updates.displayName.trim().slice(0, 64) : null;
      this.sql.exec(
        "UPDATE users SET display_name = ? WHERE canonical_username = ?",
        val,
        canonUser,
      );
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

  public async storePrivateMedia(
    token: string,
    file: {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      data: ArrayBuffer;
      storageKind: "r2" | "sqlite";
    },
    scope: { kind: "private" | "channel" | "dm"; target?: string },
  ): Promise<void> {
    const account = await this.verifyApiSession(token);
    if (!account) throw new Error("Authentication required");
    let target = scope.target ?? null;
    let generation: string | null = null;
    if (scope.kind === "channel") {
      if (!target) throw new Error("Channel required");
      const channel = this.env.CHANNELS.get(
        this.env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canonicalizeIRCName(target)}`),
      );
      generation = await channel.getMediaScope({ ...account, isAdmin: false });
      if (!generation) throw new Error("Channel membership required");
      target = canonicalizeIRCName(target);
    } else if (scope.kind === "dm") {
      const other = target ? await this.getAccountByUsername(target) : null;
      if (!other) throw new Error("Recipient required");
      target = JSON.stringify([account.id, other.id].sort());
    } else if (scope.kind !== "private") throw new Error("Invalid scope");
    this.ctx.storage.transactionSync(() => {
      const used = this.sql
        .exec<{ size: number }>(
          "SELECT COALESCE(SUM(size), 0) AS size FROM media_uploads WHERE owner_id = ?",
          account.id,
        )
        .toArray()[0].size;
      if (used + file.size > 100 * 1024 * 1024) throw new Error("Account media quota exceeded");
      this.sql.exec(
        `INSERT INTO media_uploads (id, filename, mime_type, size, data, created_at, owner_id, scope_kind, scope_target, scope_generation, storage_kind)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        file.id,
        file.filename,
        file.mimeType,
        file.size,
        file.data,
        Date.now(),
        account.id,
        scope.kind,
        target,
        generation,
        file.storageKind,
      );
    });
  }

  public rebindChannelMedia(source: string, destination: string, generation: string): void {
    // Internal rename coordinator only; neither names nor generation come from client claims.
    this.sql.exec(
      "UPDATE media_uploads SET scope_target = ? WHERE scope_kind = 'channel' AND scope_target = ? AND scope_generation = ?",
      canonicalizeIRCName(destination),
      canonicalizeIRCName(source),
      generation,
    );
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "UPDATE OR REPLACE read_markers SET target = ? WHERE target = ?",
        canonicalizeIRCName(destination),
        canonicalizeIRCName(source),
      );
      this.sql.exec(
        "UPDATE OR REPLACE channel_notifications SET channel_name = ? WHERE channel_name = ?",
        canonicalizeIRCName(destination),
        canonicalizeIRCName(source),
      );
    });
  }

  public async getPrivateMedia(
    token: string,
    id: string,
  ): Promise<(Awaited<ReturnType<AccountsDO["getMedia"]>> & { storageKind: string }) | null> {
    const account = await this.verifyApiSession(token);
    if (!account) return null;
    const row = this.sql
      .exec<{
        owner_id: string | null;
        scope_kind: string;
        scope_target: string | null;
        scope_generation: string | null;
        storage_kind: string;
      }>(
        "SELECT owner_id, scope_kind, scope_target, scope_generation, storage_kind FROM media_uploads WHERE id = ?",
        id,
      )
      .toArray()[0];
    if (!row?.owner_id) return null; // Unowned legacy media is quarantined, never made public.
    let allowed = row.owner_id === account.id;
    if (row.scope_kind === "channel" && row.scope_target) {
      const channel = this.env.CHANNELS.get(
        this.env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${row.scope_target}`),
      );
      allowed =
        Boolean(row.scope_generation) &&
        (await channel.canReadMedia({ ...account, isAdmin: false }, row.scope_generation!));
    } else if (row.scope_kind === "dm") {
      allowed = JSON.parse(row.scope_target ?? "[]").includes(account.id);
    }
    if (!allowed) return null;
    const media = await this.getMedia(id);
    return media ? { ...media, storageKind: row.storage_kind } : null;
  }

  public async deletePrivateMedia(token: string, id: string): Promise<boolean> {
    const account = await this.verifyApiSession(token);
    if (!account) return false;
    const row = this.sql
      .exec<{ storage_kind: string }>(
        "SELECT storage_kind FROM media_uploads WHERE id = ? AND owner_id = ?",
        id,
        account.id,
      )
      .toArray()[0];
    if (!row) return false;
    if (row.storage_kind === "r2") {
      if (!this.env.MEDIA_BUCKET) throw new Error("Media storage unavailable");
      await this.env.MEDIA_BUCKET.delete(id);
    }
    this.sql.exec("DELETE FROM media_uploads WHERE id = ? AND owner_id = ?", id, account.id);
    return true;
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
