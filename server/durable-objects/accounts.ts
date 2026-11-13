import { DurableObject } from "cloudflare:workers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { hashPassword, verifyPassword } from "../core/authentication/passwords";
import { generateScramKeys, type ScramAccountData } from "../core/authentication/scram";
import { hashSessionToken, newSessionToken } from "../core/authentication/tokens";
import { applyEnvConfig, filehostMaxUploadBytes, SERVER_CONFIG } from "../core/config";
import { MAX_REALTIME_EVENT_ID_LENGTH } from "../core/event-identifiers";
import { domainEvents } from "../core/events/emitter";
import { isReservedServiceNickname, isValidNickname } from "../core/permissions/validation";
import type { AccountInfo, Env, UserProfile, UserProfileInput } from "../core/types";
import { canonicalizeIRCName } from "../protocol/irc/parser";
import { WebPushSubscribeSchema } from "../schemas/notifications";
import { UserProfileInputSchema } from "../schemas/profiles";
import { allowedOutboundUrl } from "../services/outbound";
import { outboundHosts } from "../services/outbound-policy";
import { encryptWebPush, vapidAuthorization } from "../services/push/encryption";
import { initializeAccountFeatures } from "../storage/migrations/accounts-features";
import { initializeAccountsSchema } from "../storage/migrations/init";
import { initializePrimaryKeyIntegrity } from "../storage/migrations/schema-integrity";
import * as accountsSchema from "../storage/schemas/accounts";

const MEDIA_CHUNK_BYTES = 512 * 1024;
const MEDIA_LEASE_MS = 15 * 60 * 1000;
const MEDIA_SWEEP_MS = 5 * 60 * 1000;
async function mediaDigest(data: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class AccountsDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private db: ReturnType<typeof drizzle<typeof accountsSchema>>;
  private mediaPrefix: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    applyEnvConfig(env);
    this.sql = ctx.storage.sql;
    initializeAccountsSchema(this.sql);
    initializeAccountFeatures(this.sql);
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
      ["upload_state", "TEXT NOT NULL DEFAULT 'ready'"],
      ["data_layout", "TEXT NOT NULL DEFAULT 'inline'"],
      ["data_sha256", "TEXT"],
      ["object_key", "TEXT"],
      ["lease_until", "INTEGER"],
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
    this.mediaPrefix = "";
    if (this.env.MEDIA_BUCKET) {
      this.sql.exec(
        "INSERT OR IGNORE INTO security_settings (key, value) VALUES ('media_storage_namespace', ?)",
        crypto.randomUUID(),
      );
      const namespace = this.sql
        .exec<{ value: string }>(
          "SELECT value FROM security_settings WHERE key = 'media_storage_namespace'",
        )
        .toArray()[0].value;
      this.mediaPrefix = `flarc/${namespace}/uploads/`;
    }
    this.sql.exec(
      "UPDATE media_uploads SET lease_until = created_at + ? WHERE storage_kind = 'r2' AND upload_state = 'pending' AND lease_until IS NULL",
      MEDIA_LEASE_MS,
    );
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
    initializePrimaryKeyIntegrity(ctx.storage, accountsSchema, env);
    this.ctx.blockConcurrencyWhile(async () => this.scheduleMaintenanceAlarm());
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
    return this.ctx.storage.transactionSync(() =>
      this.reserveRequestLimit(key, maximum, windowMs, 1),
    );
  }

  // SessionDO supplies the authenticated attachment identity, never a client
  // account parameter. Recheck its credential generation in the reservation's
  // transaction so concurrent devices/recreated objects share one durable quota.
  public chargeChannelTargetBudget(
    accountId: string,
    credentialVersion: number,
    targets: number,
  ): boolean {
    return this.ctx.storage.transactionSync(() => {
      const account = this.sql
        .exec<{ credential_version: number }>(
          "SELECT credential_version FROM users WHERE id = ? AND disabled_at IS NULL",
          accountId,
        )
        .toArray()[0];
      if (!account || account.credential_version !== credentialVersion) return false;
      return this.reserveRequestLimit(
        `irc-targets:${accountId}`,
        SERVER_CONFIG.rateLimitMaxCommands,
        SERVER_CONFIG.rateLimitWindowMs,
        targets,
      );
    });
  }

  private reserveRequestLimit(
    key: string,
    maximum: number,
    windowMs: number,
    cost: number,
  ): boolean {
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > maximum) return false;
    const now = Date.now();
    this.sql.exec("DELETE FROM request_limits WHERE reset_at <= ?", now);
    const row = this.sql
      .exec<{ count: number }>("SELECT count FROM request_limits WHERE key = ?", key)
      .toArray()[0];
    if ((row?.count ?? 0) + cost > maximum) return false;
    this.sql.exec(
      "INSERT INTO request_limits (key, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = count + excluded.count",
      key,
      cost,
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
    const target = typeof args[0] === "string" ? args[0] : "*";
    if (!(await this.authorizeCredential(token, `admin.rpc.${operation.toLowerCase()}`, target)))
      throw new Error("Administrator authorization required");
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
    const resource =
      operation === "profile.update"
        ? actor.id
        : typeof input?.username === "string"
          ? canonicalizeIRCName(input.username)
          : "*";
    if (!(await this.authorizeCredential(token, operation, resource)))
      throw new Error("Account access denied");
    if (operation === "profile.get") return this.getUserProfile(input.username);
    if (canonicalizeIRCName(actor.username) !== canonicalizeIRCName(input.username))
      throw new Error("Account access denied");
    switch (operation) {
      case "profile.update": {
        const result = await this.updateProfileForActor(
          actor.id,
          actor.credentialVersion ?? 0,
          input.updates,
          input.expectedRevision,
          input.clientOperationId,
          await hashSessionToken(token),
        );
        return result.result
          ? { ...result.result, revision: result.revision, replayed: result.replayed }
          : null;
      }
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
    if (this.isNetworkBanned(userId, "")) return -1;
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
    this.sql.exec(
      "INSERT INTO api_session_details (session_id, token_hash) VALUES (?, ?)",
      crypto.randomUUID(),
      tokenHash,
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
    if (!row) return null;
    const actor = await this.getAccountByUsername(row.username);
    return actor && !this.isNetworkBanned(actor.id, "") ? actor : null;
  }

  public async verifySessionHash(hash: string): Promise<AccountInfo | null> {
    const row = this.sql
      .exec<{ username: string }>(
        `SELECT u.username FROM api_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
        hash,
        Date.now(),
      )
      .toArray()[0];
    if (!row) return null;
    const actor = await this.getAccountByUsername(row.username);
    return actor && !this.isNetworkBanned(actor.id, "") ? actor : null;
  }

  /** Verify account bans and optional IRC hostmask using only durable current state. */
  public isNetworkBanned(userId: string, hostmask: string): boolean {
    const now = Date.now();
    const bans = this.sql
      .exec<{ kind: string; value: string }>(
        "SELECT kind, value FROM network_bans WHERE expires_at IS NULL OR expires_at > ?",
        now,
      )
      .toArray();
    return bans.some((ban) => {
      if (ban.kind === "account") return ban.value === userId;
      if (!hostmask) return false;
      // Greedy glob matching avoids exponential regular-expression backtracking.
      const pattern = canonicalizeIRCName(ban.value),
        text = canonicalizeIRCName(hostmask);
      let i = 0,
        j = 0,
        star = -1,
        retry = 0;
      while (j < text.length) {
        if (i < pattern.length && (pattern[i] === "?" || pattern[i] === text[j])) {
          i++;
          j++;
        } else if (pattern[i] === "*") {
          star = i++;
          retry = j;
        } else if (star >= 0) {
          i = star + 1;
          j = ++retry;
        } else return false;
      }
      while (pattern[i] === "*") i++;
      return i === pattern.length;
    });
  }

  public async listAccountSessions(token: string, userId?: string) {
    const actor = await this.verifyApiSession(token);
    if (!actor || (userId && userId !== actor.id && !actor.roles.includes("admin")))
      throw new Error("Account access denied");
    const target = userId ?? actor.id;
    if (!(await this.authorizeCredential(token, "session.list", target)))
      throw new Error("Account access denied");
    if (
      target !== actor.id &&
      !(await this.authorizeCredential(token, "admin.sessions.list", target))
    )
      throw new Error("Account access denied");
    const currentHash = await hashSessionToken(token);
    const rows = this.sql
      .exec<{ token_hash: string; created_at: number; expires_at: number }>(
        "SELECT token_hash, created_at, expires_at FROM api_sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at",
        target,
        Date.now(),
      )
      .toArray();
    return rows.map((row) => {
      this.sql.exec(
        "INSERT OR IGNORE INTO api_session_details (session_id, token_hash) VALUES (?, ?)",
        crypto.randomUUID(),
        row.token_hash,
      );
      const detail = this.sql
        .exec<{ session_id: string }>(
          "SELECT session_id FROM api_session_details WHERE token_hash = ?",
          row.token_hash,
        )
        .toArray()[0];
      const policy = this.sql
        .exec<{ label: string }>(
          "SELECT label FROM credential_policies WHERE token_hash = ?",
          row.token_hash,
        )
        .toArray()[0];
      const scopes = policy
        ? this.sql
            .exec<{ operation: string; resource: string }>(
              "SELECT operation, resource FROM credential_scopes WHERE token_hash = ? ORDER BY operation, resource",
              row.token_hash,
            )
            .toArray()
        : [];
      return {
        id: detail.session_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        current: row.token_hash === currentHash,
        kind: policy ? "integration" : "session",
        label: policy?.label ?? null,
        scopes,
      };
    });
  }

  public async revokeAccountSession(token: string, sessionId: string): Promise<boolean> {
    const actor = await this.verifyApiSession(token);
    if (!actor) throw new Error("Authentication required");
    const row = this.sql
      .exec<{ user_id: string; token_hash: string }>(
        "SELECT s.user_id, s.token_hash FROM api_sessions s JOIN api_session_details d ON d.token_hash = s.token_hash WHERE d.session_id = ?",
        sessionId,
      )
      .toArray()[0];
    if (!row) return false;
    if (row.user_id !== actor.id && !actor.roles.includes("admin"))
      throw new Error("Account access denied");
    if (!(await this.authorizeCredential(token, "session.revoke", sessionId)))
      throw new Error("Account access denied");
    if (
      row.user_id !== actor.id &&
      !(await this.authorizeCredential(token, "admin.sessions.revoke", row.user_id))
    )
      throw new Error("Account access denied");
    this.sql.exec("DELETE FROM api_sessions WHERE token_hash = ?", row.token_hash);
    return true;
  }

  public async setSessionCsrf(token: string, csrf: string): Promise<void> {
    if (!(await this.verifyApiSession(token)) || !/^[a-f0-9]{64}$/.test(csrf))
      throw new Error("Authentication required");
    this.sql.exec(
      "UPDATE api_session_details SET csrf_hash = ? WHERE token_hash = ?",
      await hashSessionToken(csrf),
      await hashSessionToken(token),
    );
  }

  public async verifySessionCsrf(token: string, csrf: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(csrf) || !(await this.verifyApiSession(token))) return false;
    const expected = this.sql
      .exec<{ csrf_hash: string | null }>(
        "SELECT csrf_hash FROM api_session_details WHERE token_hash = ?",
        await hashSessionToken(token),
      )
      .toArray()[0]?.csrf_hash;
    return !!expected && expected === (await hashSessionToken(csrf));
  }

  /** Only finite vocabulary and bounded non-secret resource categories may be logged. */
  public appendAudit(
    actorId: string | null,
    action: string,
    target: string,
    outcome: string,
    transport: string,
  ): void {
    if ((this.env as any).AUDIT_LOG_ENABLED !== "true") return;
    if (
      !/^[a-z0-9_.:-]{1,80}$/.test(action) ||
      !/^[a-z0-9_.:-]{1,80}$/.test(target) ||
      !["allowed", "denied", "error"].includes(outcome) ||
      !["rest", "irc", "service", "websocket"].includes(transport)
    )
      throw new Error("Invalid audit record");
    this.sql.exec(
      "INSERT INTO security_audit (id, actor_id, action, target, outcome, transport, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      crypto.randomUUID(),
      actorId,
      action,
      target,
      outcome,
      transport,
      Date.now(),
    );
  }

  public async listNetworkBans(token: string) {
    const actor = await this.verifyApiSession(token);
    if (
      !actor?.roles.includes("admin") ||
      !(await this.authorizeCredential(token, "admin.bans.list", "*"))
    )
      throw new Error("Administrator authorization required");
    return this.sql
      .exec(
        "SELECT id, kind, value, created_by, created_at, expires_at FROM network_bans ORDER BY created_at, id",
      )
      .toArray();
  }

  public async createNetworkBan(
    token: string,
    kind: "account" | "hostmask",
    value: string,
    expiresAt: number | null,
  ) {
    const actor = await this.verifyApiSession(token);
    if (
      !actor?.roles.includes("admin") ||
      !(await this.authorizeCredential(token, "admin.bans.create", "*"))
    )
      throw new Error("Administrator authorization required");
    if (
      !value ||
      value.length > 256 ||
      /[\x00-\x20\x7f]/.test(value) ||
      (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()))
    )
      throw new Error("Invalid network ban");
    if (kind === "account" && !this.accountIdExists(value)) throw new Error("Account not found");
    if (kind !== "account" && kind !== "hostmask") throw new Error("Invalid network ban");
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO network_bans (id, kind, value, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      kind,
      value,
      actor.id,
      Date.now(),
      expiresAt,
    );
    return { id, kind, value, expiresAt };
  }

  public async deleteNetworkBan(token: string, id: string): Promise<boolean> {
    const actor = await this.verifyApiSession(token);
    if (
      !actor?.roles.includes("admin") ||
      !(await this.authorizeCredential(token, "admin.bans.delete", "*"))
    )
      throw new Error("Administrator authorization required");
    const present =
      this.sql.exec("SELECT id FROM network_bans WHERE id = ?", id).toArray().length > 0;
    if (present) this.sql.exec("DELETE FROM network_bans WHERE id = ?", id);
    return present;
  }

  public async queryAudit(token: string, limit = 100) {
    const actor = await this.verifyApiSession(token);
    if (
      !actor?.roles.includes("admin") ||
      !(await this.authorizeCredential(token, "admin.audit.read", "*"))
    )
      throw new Error("Administrator authorization required");
    return this.sql
      .exec(
        "SELECT id, actor_id, action, target, outcome, transport, created_at FROM security_audit ORDER BY created_at DESC LIMIT ?",
        Math.min(500, Math.max(1, Math.trunc(limit) || 100)),
      )
      .toArray();
  }

  public async authorizeAccountActor(
    accountId: string,
    credentialVersion: number,
    operation: string,
    resource: string,
  ): Promise<boolean> {
    if (this.getCredentialVersion(accountId) !== credentialVersion || credentialVersion < 0)
      return false;
    if (!operation.startsWith("admin.")) return true;
    if (
      !this.sql
        .exec("SELECT 1 FROM account_roles WHERE user_id = ? AND role = 'admin'", accountId)
        .toArray().length
    )
      return false;
    if (
      !this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", accountId).toArray()
        .length
    )
      return true;
    return (
      this.sql
        .exec(
          "SELECT 1 FROM admin_scope_grants WHERE user_id = ? AND operation IN (?, '*') AND resource IN (?, '*')",
          accountId,
          operation,
          resource,
        )
        .toArray().length > 0
    );
  }

  public async authorizeSessionHash(
    hash: string,
    operation: string,
    resource: string,
  ): Promise<boolean> {
    const actor = await this.verifySessionHash(hash);
    if (
      !actor ||
      !(await this.authorizeAccountActor(
        actor.id,
        actor.credentialVersion ?? 0,
        operation,
        resource,
      ))
    )
      return false;
    const policy = this.sql
      .exec<{ can_admin: number }>(
        "SELECT can_admin FROM credential_policies WHERE token_hash = ?",
        hash,
      )
      .toArray()[0];
    if (!policy) return true;
    if (operation.startsWith("admin.") && !policy.can_admin) return false;
    return (
      this.sql
        .exec(
          "SELECT 1 FROM credential_scopes WHERE token_hash = ? AND operation IN (?, '*') AND resource IN (?, '*')",
          hash,
          operation,
          resource,
        )
        .toArray().length > 0
    );
  }

  public async exchangeIrcCredential(
    token: string,
  ): Promise<{ account: AccountInfo; sessionHash: string } | null> {
    const account = await this.verifyApiSession(token);
    if (!account || !(await this.authorizeCredential(token, "irc.connect", "*"))) return null;
    const sessionHash = await hashSessionToken(token);
    const current = await this.verifySessionHash(sessionHash);
    return current?.id === account.id ? { account: current, sessionHash } : null;
  }

  public async authorizeCredential(
    token: string,
    operation: string,
    resource: string,
  ): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    return this.authorizeSessionHash(await hashSessionToken(token), operation, resource);
  }

  public async isRestrictedCredential(token: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(token)) return true;
    return (
      this.sql
        .exec(
          "SELECT 1 FROM credential_policies WHERE token_hash = ?",
          await hashSessionToken(token),
        )
        .toArray().length > 0
    );
  }

  public async getAdminScopes(token: string, userId: string) {
    const actor = await this.verifyApiSession(token);
    if (
      !actor?.roles.includes("admin") ||
      !(await this.authorizeCredential(token, "admin.scopes.read", userId))
    )
      throw new Error("Administrator authorization required");
    const restricted =
      this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", userId).toArray()
        .length > 0;
    const scopes = this.sql
      .exec<{ operation: string; resource: string }>(
        "SELECT operation, resource FROM admin_scope_grants WHERE user_id = ? ORDER BY operation, resource",
        userId,
      )
      .toArray();
    return { restricted, scopes };
  }

  public async setAdminScopes(
    token: string,
    userId: string,
    scopes: { operation: string; resource: string }[],
  ): Promise<void> {
    const actor = await this.verifyApiSession(token);
    if (
      !actor?.roles.includes("admin") ||
      !(await this.authorizeCredential(token, "admin.scopes.write", userId))
    )
      throw new Error("Administrator authorization required");
    if (!this.accountIdExists(userId) || scopes.length > 128)
      throw new Error("Invalid scope policy");
    for (const scope of scopes) {
      if (
        !/^(?:\*|[a-z][a-z0-9_.-]{0,63})$/.test(scope.operation) ||
        !scope.resource ||
        scope.resource.length > 128 ||
        /[\x00-\x20\x7f]/.test(scope.resource)
      )
        throw new Error("Invalid scope policy");
      if (
        !(await this.authorizeCredential(
          token,
          scope.operation === "*" ? "admin.scopes.write" : scope.operation,
          scope.resource,
        ))
      )
        throw new Error("Scope exceeds authority");
      if (scope.operation === "*" && !(await this.authorizeCredential(token, "*", scope.resource)))
        throw new Error("Scope exceeds authority");
      if (
        scope.operation === "*" &&
        this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actor.id).toArray()
          .length
      )
        throw new Error("Scope exceeds authority");
    }
    const issuerHash = await hashSessionToken(token);
    this.ctx.storage.transactionSync(() => {
      if (
        this.getCredentialVersion(actor.id) !== (actor.credentialVersion ?? 0) ||
        !this.sql
          .exec("SELECT 1 FROM account_roles WHERE user_id = ? AND role = 'admin'", actor.id)
          .toArray().length ||
        !this.sessionScopeAtCommit(issuerHash, actor.id, "admin.scopes.write", userId) ||
        (this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actor.id).toArray()
          .length > 0 &&
          !this.sql
            .exec(
              "SELECT 1 FROM admin_scope_grants WHERE user_id = ? AND operation IN ('admin.scopes.write', '*') AND resource IN (?, '*')",
              actor.id,
              userId,
            )
            .toArray().length)
      )
        throw new Error("Administrator authorization required");
      for (const scope of scopes) {
        if (!this.sessionScopeAtCommit(issuerHash, actor.id, scope.operation, scope.resource))
          throw new Error("Scope exceeds authority");
        if (
          scope.operation === "*" &&
          this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actor.id).toArray()
            .length
        )
          throw new Error("Scope exceeds authority");
        if (
          scope.operation.startsWith("admin.") &&
          this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actor.id).toArray()
            .length &&
          !this.sql
            .exec(
              "SELECT 1 FROM admin_scope_grants WHERE user_id = ? AND operation IN (?, '*') AND resource IN (?, '*')",
              actor.id,
              scope.operation,
              scope.resource,
            )
            .toArray().length
        )
          throw new Error("Scope exceeds authority");
      }
      this.sql.exec("INSERT OR IGNORE INTO admin_scope_policies (user_id) VALUES (?)", userId);
      this.sql.exec("DELETE FROM admin_scope_grants WHERE user_id = ?", userId);
      for (const scope of scopes)
        this.sql.exec(
          "INSERT OR IGNORE INTO admin_scope_grants (user_id, operation, resource) VALUES (?, ?, ?)",
          userId,
          scope.operation,
          scope.resource,
        );
    });
  }

  public async createScopedCredential(
    token: string,
    label: string,
    scopes: { operation: string; resource: string }[],
    expiresAt: number,
  ) {
    const actor = await this.verifyApiSession(token);
    const issuerHash = await hashSessionToken(token);
    if (
      !actor ||
      this.sql.exec("SELECT 1 FROM credential_policies WHERE token_hash = ?", issuerHash).toArray()
        .length
    )
      throw new Error("Account access denied");
    if (
      !label ||
      label.length > 64 ||
      !Array.isArray(scopes) ||
      scopes.length < 1 ||
      scopes.length > 32 ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + 86400000 * 30
    )
      throw new Error("Invalid credential request");
    for (const scope of scopes) {
      if (
        !/^(?:\*|[a-z][a-z0-9_.-]{0,63})$/.test(scope.operation) ||
        !scope.resource ||
        scope.resource.length > 128 ||
        /[\x00-\x20\x7f]/.test(scope.resource)
      )
        throw new Error("Invalid credential scope");
      if (
        scope.operation === "*" &&
        this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actor.id).toArray()
          .length
      )
        throw new Error("Scope exceeds authority");
      if (
        scope.operation.startsWith("admin.") &&
        !(await this.authorizeCredential(token, scope.operation, scope.resource))
      )
        throw new Error("Scope exceeds authority");
    }
    const credential = newSessionToken(),
      hash = await hashSessionToken(credential),
      now = Date.now(),
      sessionId = crypto.randomUUID();
    this.ctx.storage.transactionSync(() => {
      if (
        this.getCredentialVersion(actor.id) !== (actor.credentialVersion ?? 0) ||
        !this.sessionScopeAtCommit(issuerHash, actor.id, "credential.create", actor.id) ||
        this.sql
          .exec("SELECT 1 FROM credential_policies WHERE token_hash = ?", issuerHash)
          .toArray().length
      )
        throw new Error("Account access denied");
      const roles = this.sql
        .exec<{ role: string }>("SELECT role FROM account_roles WHERE user_id = ?", actor.id)
        .toArray()
        .map((row) => row.role);
      const restrictedAdmin =
        this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actor.id).toArray()
          .length > 0;
      for (const scope of scopes) {
        if (scope.operation === "*" && restrictedAdmin) throw new Error("Scope exceeds authority");
        if (
          scope.operation.startsWith("admin.") &&
          (!roles.includes("admin") ||
            (restrictedAdmin &&
              !this.sql
                .exec(
                  "SELECT 1 FROM admin_scope_grants WHERE user_id = ? AND operation IN (?, '*') AND resource IN (?, '*')",
                  actor.id,
                  scope.operation,
                  scope.resource,
                )
                .toArray().length))
        )
          throw new Error("Scope exceeds authority");
      }
      this.sql.exec(
        "INSERT INTO api_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        hash,
        actor.id,
        expiresAt,
        now,
      );
      this.sql.exec(
        "INSERT INTO api_session_details (session_id, token_hash) VALUES (?, ?)",
        sessionId,
        hash,
      );
      this.sql.exec(
        "INSERT INTO credential_policies (token_hash, label, can_admin, can_oper) VALUES (?, ?, ?, ?)",
        hash,
        label,
        roles.includes("admin") ? 1 : 0,
        roles.includes("admin") || roles.includes("oper") ? 1 : 0,
      );
      for (const scope of scopes)
        this.sql.exec(
          "INSERT OR IGNORE INTO credential_scopes (token_hash, operation, resource) VALUES (?, ?, ?)",
          hash,
          scope.operation,
          scope.resource,
        );
    });
    return { id: sessionId, token: credential, expiresAt };
  }

  public async createEventTicket(token: string): Promise<string | null> {
    if (!(await this.authorizeCredential(token, "events.connect", "*"))) return null;
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
    if (user.disabled_at !== null || this.isNetworkBanned(user.id, "")) {
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
    if (
      !current ||
      current.disabled_at !== null ||
      current.password_hash !== user.password_hash ||
      this.isNetworkBanned(user.id, "")
    )
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
    const byId = this.sql
      .exec<{ id: string; username: string }>(
        "SELECT id, username FROM users WHERE id = ?",
        username,
      )
      .toArray()[0];
    if (byId) return byId;
    const byNick = this.sql
      .exec<{ id: string; username: string }>(
        "SELECT u.id, u.username FROM registered_nicks n JOIN users u ON u.id = n.user_id WHERE n.nickname = ?",
        canonicalizeIRCName(username),
      )
      .toArray()[0];
    if (byNick) return byNick;
    const deletedId = this.sql
      .exec<{ user_id: string; canonical_username: string }>(
        "SELECT user_id, canonical_username FROM account_tombstones WHERE user_id = ?",
        username,
      )
      .toArray()[0];
    if (deletedId?.user_id)
      return { id: deletedId.user_id, username: deletedId.canonical_username };
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

  private mutationRevision<T>(
    userId: string,
    credentialVersion: number,
    expectedRevision: number | undefined,
    operationId: string | undefined,
    requestHash: string,
    apply: () => T,
    event: (result: T, revision: number, eventId: string) => Record<string, unknown>,
    guard?: () => boolean,
  ): { result: T; revision: number; replayed: boolean } {
    const now = Date.now();
    if (operationId !== undefined) {
      const match = /^(\d{13})\.([0-9a-f-]{36})$/i.exec(operationId);
      const timestamp = match ? Number(match[1]) : 0;
      if (!match || timestamp < now - 86400000 || timestamp > now + 300000)
        throw new Error("Invalid client operation id");
    }
    return this.ctx.storage.transactionSync(() => {
      if (this.getCredentialVersion(userId) !== credentialVersion || (guard && !guard()))
        throw new Error("Authentication required");
      this.sql.exec("DELETE FROM account_operation_results WHERE created_at < ?", now - 86400000);
      if (operationId) {
        const old = this.sql
          .exec<{ request_hash: string; result_json: string; revision: number }>(
            "SELECT request_hash, result_json, revision FROM account_operation_results WHERE user_id = ? AND operation_id = ?",
            userId,
            operationId,
          )
          .toArray()[0];
        if (old) {
          if (old.request_hash !== requestHash) throw new Error("Client operation id conflict");
          return {
            result: JSON.parse(old.result_json) as T,
            revision: old.revision,
            replayed: true,
          };
        }
      }
      if (
        operationId &&
        (this.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM account_operation_results WHERE user_id = ?",
            userId,
          )
          .toArray()[0]?.count ?? 0) >= 4096
      )
        throw new Error("Client operation ledger full");
      const current =
        this.sql
          .exec<{ revision: number }>(
            "SELECT revision FROM account_revisions WHERE user_id = ?",
            userId,
          )
          .toArray()[0]?.revision ?? 0;
      if (expectedRevision !== undefined && current !== expectedRevision)
        throw new Error("Revision conflict");
      if (
        (this.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM account_event_outbox")
          .toArray()[0]?.count ?? 0) >= 10000
      )
        throw new Error("Account event outbox full");
      const result = apply(),
        revision = current + 1;
      const eventId = crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO account_event_outbox(event_id,user_id,revision,payload_json,created_at) VALUES(?,?,?,?,?)",
        eventId,
        userId,
        revision,
        JSON.stringify(event(result, revision, eventId)),
        now,
      );
      this.sql.exec(
        "INSERT INTO account_revisions(user_id, revision) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision",
        userId,
        revision,
      );
      if (operationId)
        this.sql.exec(
          "INSERT INTO account_operation_results(user_id, operation_id, request_hash, result_json, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          userId,
          operationId,
          requestHash,
          JSON.stringify(result),
          revision,
          now,
        );
      return { result, revision, replayed: false };
    });
  }

  private sessionScopeAtCommit(
    hash: string | null | undefined,
    actorId: string,
    operation: string,
    resource: string,
  ): boolean {
    if (!hash) return true; // Password/SASL IRC sessions carry no token-derived credential.
    if (
      !this.sql
        .exec(
          "SELECT 1 FROM api_sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?",
          hash,
          actorId,
          Date.now(),
        )
        .toArray().length
    )
      return false;
    const restricted =
      this.sql.exec("SELECT 1 FROM credential_policies WHERE token_hash = ?", hash).toArray()
        .length > 0;
    return (
      !restricted ||
      this.sql
        .exec(
          "SELECT 1 FROM credential_scopes WHERE token_hash = ? AND operation IN (?, '*') AND resource IN (?, '*')",
          hash,
          operation,
          resource,
        )
        .toArray().length > 0
    );
  }

  /** Trusted SessionDO consumes and deduplicates these intents before acknowledging. */
  public getPendingProfileEvents(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
    return this.sql
      .exec<{ payload_json: string }>(
        "SELECT payload_json FROM account_event_outbox ORDER BY user_id, revision, event_id LIMIT ?",
        safeLimit,
      )
      .toArray()
      .map((row) => JSON.parse(row.payload_json));
  }

  public ackProfileEvent(eventId: string): void {
    this.sql.exec("DELETE FROM account_event_outbox WHERE event_id = ?", eventId);
  }

  public async getVisibleMetadata(
    actorId: string,
    credentialVersion: number,
    target: string,
    keys?: string[],
  ) {
    if (!(await this.authorizeAccountActor(actorId, credentialVersion, "metadata.read", target)))
      throw new Error("Authentication required");
    const resolved = await this.resolveConversationAccount(target);
    if (!resolved) throw new Error("Account not found");
    const metadata = await this.getMetadata(resolved.username, keys);
    if (resolved.id !== actorId)
      for (const key of Object.keys(metadata)) if (key.startsWith("private:")) delete metadata[key];
    const revision =
      this.sql
        .exec<{ revision: number }>(
          "SELECT revision FROM account_revisions WHERE user_id = ?",
          resolved.id,
        )
        .toArray()[0]?.revision ?? 0;
    return { metadata, revision };
  }

  public async mutateUserMetadata(
    actorId: string,
    credentialVersion: number,
    target: string,
    key: string,
    value: string | null,
    expectedRevision?: number,
    clientOperationId?: string,
    sessionHash?: string | null,
  ) {
    const operation = key.toLowerCase().startsWith("private:")
      ? "metadata.private.write"
      : "metadata.write";
    if (!(await this.authorizeAccountActor(actorId, credentialVersion, operation, target)))
      throw new Error("Authentication required");
    const resolved = await this.resolveConversationAccount(target);
    if (!resolved || resolved.id !== actorId) throw new Error("Account access denied");
    const canonKey = key.toLowerCase();
    if (!/^[a-z0-9_.:/-]{1,64}$/.test(canonKey) || (value !== null && value.length > 2048))
      throw new Error("Invalid metadata");
    const digest = await hashSessionToken(JSON.stringify(["metadata", actorId, canonKey, value]));
    return this.mutationRevision(
      actorId,
      credentialVersion,
      expectedRevision,
      clientOperationId,
      digest,
      () => {
        const canonTarget = canonicalizeIRCName(resolved.username);
        if (value === null || value === "")
          this.sql.exec(
            "DELETE FROM user_metadata WHERE target_key = ? AND key = ?",
            canonTarget,
            canonKey,
          );
        else
          this.sql.exec(
            "INSERT INTO user_metadata (target_key,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(target_key,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            canonTarget,
            canonKey,
            value,
            Date.now(),
          );
        if (canonKey === "display-name")
          this.sql.exec("UPDATE users SET display_name = ? WHERE id = ?", value || null, actorId);
        return { key: canonKey, value: value || null, username: resolved.username };
      },
      (result, revision, eventId) => ({
        eventId,
        accountId: actorId,
        username: resolved.username,
        revision,
        profile: this.readUserProfile(resolved.username),
        changedKeys: [canonKey],
        visibility: canonKey.startsWith("private:") ? "private" : "public",
        operationId: clientOperationId ?? null,
        metadata: { [canonKey]: result.value },
      }),
      () => this.sessionScopeAtCommit(sessionHash, actorId, operation, target),
    );
  }

  public async adminMutateUserMetadata(
    token: string,
    target: string,
    key: string,
    value: string | null,
    expectedRevision?: number,
    clientOperationId?: string,
  ) {
    const actor = await this.verifyApiSession(token);
    const resolved = await this.resolveConversationAccount(target);
    if (
      !actor?.roles.includes("admin") ||
      !resolved ||
      !(await this.authorizeCredential(
        token,
        "admin.metadata.write",
        canonicalizeIRCName(resolved.username),
      ))
    )
      throw new Error("Administrator authorization required");
    const canonKey = key.toLowerCase();
    if (!/^[a-z0-9_.:/-]{1,64}$/.test(canonKey) || (value !== null && value.length > 2048))
      throw new Error("Invalid metadata");
    if (canonKey.startsWith("private:") && resolved.id !== actor.id)
      throw new Error("Account access denied");
    const targetVersion = this.getCredentialVersion(resolved.id);
    if (targetVersion < 0) throw new Error("Account not found");
    const sessionHash = await hashSessionToken(token);
    const digest = await hashSessionToken(
      JSON.stringify(["admin-metadata", actor.id, resolved.id, canonKey, value]),
    );
    const resource = canonicalizeIRCName(resolved.username);
    return this.mutationRevision(
      resolved.id,
      targetVersion,
      expectedRevision,
      clientOperationId,
      digest,
      () => {
        if (value === null || value === "")
          this.sql.exec(
            "DELETE FROM user_metadata WHERE target_key = ? AND key = ?",
            resource,
            canonKey,
          );
        else
          this.sql.exec(
            "INSERT INTO user_metadata (target_key,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(target_key,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            resource,
            canonKey,
            value,
            Date.now(),
          );
        if (canonKey === "display-name")
          this.sql.exec(
            "UPDATE users SET display_name = ? WHERE id = ?",
            value || null,
            resolved.id,
          );
        return { key: canonKey, value: value || null, username: resolved.username };
      },
      (result, revision, eventId) => ({
        eventId,
        accountId: resolved.id,
        username: resolved.username,
        revision,
        profile: this.readUserProfile(resolved.username),
        changedKeys: [canonKey],
        visibility: canonKey.startsWith("private:") ? "private" : "public",
        operationId: clientOperationId ?? null,
        metadata: { [canonKey]: result.value },
      }),
      () => {
        if (this.getCredentialVersion(actor.id) !== (actor.credentialVersion ?? 0)) return false;
        if (
          !this.sql
            .exec(
              "SELECT 1 FROM api_sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?",
              sessionHash,
              actor.id,
              Date.now(),
            )
            .toArray().length
        )
          return false;
        if (
          !this.sql
            .exec("SELECT 1 FROM account_roles WHERE user_id = ? AND role = 'admin'", actor.id)
            .toArray().length
        )
          return false;
        const restricted =
          this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actor.id).toArray()
            .length > 0;
        if (
          restricted &&
          !this.sql
            .exec(
              "SELECT 1 FROM admin_scope_grants WHERE user_id = ? AND operation IN ('admin.metadata.write','*') AND resource IN (?, '*')",
              actor.id,
              resource,
            )
            .toArray().length
        )
          return false;
        const policy = this.sql
          .exec<{ can_admin: number }>(
            "SELECT can_admin FROM credential_policies WHERE token_hash = ?",
            sessionHash,
          )
          .toArray()[0];
        return (
          !policy ||
          (policy.can_admin === 1 &&
            this.sql
              .exec(
                "SELECT 1 FROM credential_scopes WHERE token_hash = ? AND operation IN ('admin.metadata.write','*') AND resource IN (?, '*')",
                sessionHash,
                resource,
              )
              .toArray().length > 0)
        );
      },
    );
  }

  public async mutateUserMetadataAsOperator(
    actorId: string,
    credentialVersion: number,
    sessionHash: string | null,
    target: string,
    key: string,
    value: string | null,
    expectedRevision?: number,
    clientOperationId?: string,
  ) {
    const roleRows = this.sql
      .exec<{ role: string }>(
        "SELECT role FROM account_roles WHERE user_id = ? AND role IN ('admin','oper')",
        actorId,
      )
      .toArray();
    const isAdmin = roleRows.some((row) => row.role === "admin");
    if (!isAdmin && !roleRows.some((row) => row.role === "oper"))
      throw new Error("Operator authorization required");
    const resolved = await this.resolveConversationAccount(target);
    if (!resolved) throw new Error("Account not found");
    const resource = canonicalizeIRCName(resolved.username),
      action = isAdmin ? "admin.metadata.write" : "service.metadata.write";
    if (!(await this.authorizeAccountActor(actorId, credentialVersion, action, resource)))
      throw new Error("Operator authorization required");
    if (sessionHash) {
      const current = await this.verifySessionHash(sessionHash);
      if (
        current?.id !== actorId ||
        !(await this.authorizeSessionHash(sessionHash, action, resource))
      )
        throw new Error("Operator authorization required");
    }
    const canonKey = key.toLowerCase();
    if (!/^[a-z0-9_.:/-]{1,64}$/.test(canonKey) || (value !== null && value.length > 2048))
      throw new Error("Invalid metadata");
    if (canonKey.startsWith("private:") && resolved.id !== actorId)
      throw new Error("Account access denied");
    const targetVersion = this.getCredentialVersion(resolved.id);
    if (targetVersion < 0) throw new Error("Account not found");
    const digest = await hashSessionToken(
      JSON.stringify(["operator-metadata", actorId, resolved.id, canonKey, value]),
    );
    return this.mutationRevision(
      resolved.id,
      targetVersion,
      expectedRevision,
      clientOperationId,
      digest,
      () => {
        if (value === null || value === "")
          this.sql.exec(
            "DELETE FROM user_metadata WHERE target_key = ? AND key = ?",
            resource,
            canonKey,
          );
        else
          this.sql.exec(
            "INSERT INTO user_metadata (target_key,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(target_key,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            resource,
            canonKey,
            value,
            Date.now(),
          );
        if (canonKey === "display-name")
          this.sql.exec(
            "UPDATE users SET display_name = ? WHERE id = ?",
            value || null,
            resolved.id,
          );
        return { key: canonKey, value: value || null, username: resolved.username };
      },
      (result, revision, eventId) => ({
        eventId,
        accountId: resolved.id,
        username: resolved.username,
        revision,
        profile: this.readUserProfile(resolved.username),
        changedKeys: [canonKey],
        visibility: canonKey.startsWith("private:") ? "private" : "public",
        operationId: clientOperationId ?? null,
        metadata: { [canonKey]: result.value },
      }),
      () => {
        if (this.getCredentialVersion(actorId) !== credentialVersion) return false;
        const expectedRole = isAdmin ? "admin" : "oper";
        if (
          !this.sql
            .exec(
              "SELECT 1 FROM account_roles WHERE user_id = ? AND role = ?",
              actorId,
              expectedRole,
            )
            .toArray().length
        )
          return false;
        if (
          isAdmin &&
          this.sql.exec("SELECT 1 FROM admin_scope_policies WHERE user_id = ?", actorId).toArray()
            .length &&
          !this.sql
            .exec(
              "SELECT 1 FROM admin_scope_grants WHERE user_id = ? AND operation IN (?, '*') AND resource IN (?, '*')",
              actorId,
              action,
              resource,
            )
            .toArray().length
        )
          return false;
        if (!sessionHash) return true;
        if (
          !this.sql
            .exec(
              "SELECT 1 FROM api_sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?",
              sessionHash,
              actorId,
              Date.now(),
            )
            .toArray().length
        )
          return false;
        const policy = this.sql
          .exec<{ can_admin: number; can_oper: number }>(
            "SELECT can_admin,can_oper FROM credential_policies WHERE token_hash = ?",
            sessionHash,
          )
          .toArray()[0];
        return (
          !policy ||
          ((isAdmin ? policy.can_admin : policy.can_oper) === 1 &&
            this.sql
              .exec(
                "SELECT 1 FROM credential_scopes WHERE token_hash = ? AND operation IN (?, '*') AND resource IN (?, '*')",
                sessionHash,
                action,
                resource,
              )
              .toArray().length > 0)
        );
      },
    );
  }

  public async updateProfileForActor(
    actorId: string,
    credentialVersion: number,
    updates: UserProfileInput,
    expectedRevision?: number,
    clientOperationId?: string,
    sessionHash?: string | null,
  ) {
    if (!(await this.authorizeAccountActor(actorId, credentialVersion, "profile.update", actorId)))
      throw new Error("Authentication required");
    const parsed = UserProfileInputSchema.strict().parse(updates);
    const user = this.sql
      .exec<{ username: string }>(
        "SELECT username FROM users WHERE id = ? AND disabled_at IS NULL",
        actorId,
      )
      .toArray()[0];
    if (!user) throw new Error("Authentication required");
    const digest = await hashSessionToken(JSON.stringify(["profile", actorId, parsed]));
    return this.mutationRevision(
      actorId,
      credentialVersion,
      expectedRevision,
      clientOperationId,
      digest,
      () => {
        const map: Record<string, string> = {
          displayName: "display-name",
          avatar: "avatar",
          pronouns: "pronouns",
          bio: "bio",
          bot: "bot",
          color: "color",
          customStatus: "custom-status",
          timezone: "timezone",
        };
        for (const [field, raw] of Object.entries(parsed)) {
          const key = map[field];
          const value =
            field === "bot"
              ? raw === true || raw === "true" || raw === "1"
                ? "true"
                : null
              : typeof raw === "string"
                ? raw.trim() || null
                : null;
          if (value === null)
            this.sql.exec(
              "DELETE FROM user_metadata WHERE target_key = ? AND key = ?",
              canonicalizeIRCName(user.username),
              key,
            );
          else
            this.sql.exec(
              "INSERT INTO user_metadata(target_key,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(target_key,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
              canonicalizeIRCName(user.username),
              key,
              value,
              Date.now(),
            );
          if (field === "displayName")
            this.sql.exec("UPDATE users SET display_name = ? WHERE id = ?", value, actorId);
        }
        return this.readUserProfile(user.username);
      },
      (profile, revision, eventId) => ({
        eventId,
        accountId: actorId,
        username: user.username,
        revision,
        profile,
        changedKeys: Object.keys(parsed),
        visibility: "public",
        operationId: clientOperationId ?? null,
        metadata: null,
      }),
      () => this.sessionScopeAtCommit(sessionHash, actorId, "profile.update", actorId),
    );
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

  private rawAutoJoinChannels(
    userId: string,
  ): Array<{ channel: string; key?: string; generation?: string }> {
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

  public async getAutoJoinChannels(
    userId: string,
  ): Promise<Array<{ channel: string; key?: string; generation: string }>> {
    const entries = this.rawAutoJoinChannels(userId);
    const valid: Array<{ channel: string; key?: string; generation: string }> = [];
    for (const entry of entries) {
      if (
        typeof entry.channel !== "string" ||
        typeof entry.generation !== "string" ||
        !entry.generation
      )
        continue;
      const channel = this.env.CHANNELS.get(
        this.env.CHANNELS.idFromName(
          `${SERVER_CONFIG.networkId}:${canonicalizeIRCName(entry.channel)}`,
        ),
      );
      if ((await channel.getExistingChannelGeneration()) === entry.generation)
        valid.push({
          channel: entry.channel,
          ...(entry.key ? { key: entry.key } : {}),
          generation: entry.generation,
        });
    }
    return valid;
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
    key: string | undefined,
    generation: string,
  ): Promise<void> {
    if (!generation) return;
    const channel = this.env.CHANNELS.get(
      this.env.CHANNELS.idFromName(
        `${SERVER_CONFIG.networkId}:${canonicalizeIRCName(channelName)}`,
      ),
    );
    if ((await channel.getExistingChannelGeneration()) !== generation) return;
    const existing = this.rawAutoJoinChannels(userId);
    const canon = canonicalizeIRCName(channelName);
    const filtered = existing.filter(
      (e) =>
        canonicalizeIRCName(e.channel) !== canon || (e.generation && e.generation !== generation),
    );
    filtered.push({ channel: channelName, ...(key ? { key } : {}), generation });
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

  public async removeAutoJoinChannel(
    userId: string,
    channelName: string,
    generation: string,
  ): Promise<void> {
    if (!generation) return;
    const existing = this.rawAutoJoinChannels(userId);
    const canon = canonicalizeIRCName(channelName);
    const filtered = existing.filter(
      (e) => canonicalizeIRCName(e.channel) !== canon || e.generation !== generation,
    );
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
  ): Promise<{ ok: true } | { ok: false; code: "INVALID_SUBSCRIPTION" | "SUBSCRIPTION_LIMIT" }> {
    // IRC and REST share validation and storage limits at the owning object.
    if (
      !WebPushSubscribeSchema.pick({ endpoint: true }).safeParse({ endpoint }).success ||
      typeof keysStr !== "string" ||
      keysStr.length > 1024
    )
      return { ok: false, code: "INVALID_SUBSCRIPTION" };
    const canon = canonicalizeIRCName(userKey);
    const rows = this.sql
      .exec<{ endpoint: string }>(
        "SELECT endpoint FROM webpush_subscriptions WHERE user_key = ?",
        canon,
      )
      .toArray();
    if (rows.length >= 20 && !rows.some((row) => row.endpoint === endpoint))
      return { ok: false, code: "SUBSCRIPTION_LIMIT" };
    this.sql.exec(
      `INSERT INTO webpush_subscriptions (user_key, endpoint, keys_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_key, endpoint) DO UPDATE SET keys_json = excluded.keys_json, created_at = excluded.created_at`,
      canon,
      endpoint,
      keysStr,
      Date.now(),
    );
    return { ok: true };
  }

  public async unregisterWebpush(userKey: string, endpoint: string): Promise<boolean> {
    const canon = canonicalizeIRCName(userKey);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "DELETE FROM push_deliveries WHERE endpoint = ? AND account_id = (SELECT id FROM users WHERE canonical_username = ?)",
        endpoint,
        canon,
      );
      this.sql.exec(
        "DELETE FROM webpush_subscriptions WHERE user_key = ? AND endpoint = ?",
        canon,
        endpoint,
      );
    });
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

  /** Session calls this only after its journal and recipient intent are durable. */
  public async enqueuePushEvent(eventId: string, accountId: string): Promise<void> {
    if (
      !eventId ||
      !accountId ||
      eventId.length > MAX_REALTIME_EVENT_ID_LENGTH ||
      accountId.length > 128
    )
      throw new Error("Invalid push intent");
    this.ctx.storage.transactionSync(() => {
      const existing = this.sql
        .exec("SELECT 1 FROM push_events WHERE event_id = ? AND account_id = ?", eventId, accountId)
        .toArray()[0];
      if (existing) return;
      const retained =
        this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM push_events").toArray()[0]
          ?.count ?? 0;
      if (retained >= 100000) throw new Error("Push intent capacity reached");
      const now = Date.now();
      this.sql.exec(
        "INSERT INTO push_events(event_id, account_id, created_at) VALUES (?, ?, ?)",
        eventId,
        accountId,
        now,
      );
      const account = this.sql
        .exec<{ canonical_username: string; credential_version: number }>(
          "SELECT canonical_username, credential_version FROM users WHERE id = ? AND disabled_at IS NULL",
          accountId,
        )
        .toArray()[0];
      if (!account) return;
      for (const subscription of this.sql
        .exec<{ endpoint: string; keys_json: string }>(
          "SELECT endpoint, keys_json FROM webpush_subscriptions WHERE user_key = ?",
          account.canonical_username,
        )
        .toArray())
        this.sql.exec(
          "INSERT INTO push_deliveries(event_id, account_id, endpoint, keys_json, credential_version, next_attempt) VALUES (?, ?, ?, ?, ?, ?)",
          eventId,
          accountId,
          subscription.endpoint,
          subscription.keys_json,
          account.credential_version,
          now,
        );
    });
    await this.scheduleMaintenanceAlarm();
  }

  private async scheduleMaintenanceAlarm(): Promise<void> {
    const pushDue = this.sql
      .exec<{ next_attempt: number | null }>(
        "SELECT MIN(next_attempt) AS next_attempt FROM push_deliveries",
      )
      .toArray()[0]?.next_attempt;
    const leaseDue = this.sql
      .exec<{ due: number | null }>(
        "SELECT MIN(lease_until) AS due FROM media_uploads WHERE storage_kind = 'r2' AND upload_state = 'pending'",
      )
      .toArray()[0]?.due;
    const legacyDue = this.sql
      .exec<{ due: number | null }>("SELECT MIN(next_attempt) AS due FROM media_cleanup_tombstones")
      .toArray()[0]?.due;
    const eventExpiryDue = this.sql
      .exec<{ due: number | null }>(
        "SELECT MIN(created_at) + ? AS due FROM push_events e WHERE NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.event_id = e.event_id AND d.account_id = e.account_id)",
        7 * 24 * 60 * 60 * 1000,
      )
      .toArray()[0]?.due;
    const sweepDue = this.env.MEDIA_BUCKET ? Date.now() + MEDIA_SWEEP_MS : null;
    const values = [pushDue, leaseDue, legacyDue, eventExpiryDue, sweepDue].filter(
      (value): value is number => value != null,
    );
    if (!values.length) return;
    const due = Math.min(...values);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || due < current)
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, due));
  }

  private async reconcileMedia(now: number): Promise<void> {
    if (!this.env.MEDIA_BUCKET) return;
    // Expiry and ownership removal share a transaction with the publication fence.
    this.ctx.storage.transactionSync(() => {
      const expired = this.sql
        .exec<{ id: string; object_key: string | null }>(
          "SELECT id, object_key FROM media_uploads WHERE storage_kind = 'r2' AND upload_state = 'pending' AND lease_until <= ? ORDER BY lease_until LIMIT 100",
          now,
        )
        .toArray();
      for (const row of expired) {
        if (!row.object_key)
          this.sql.exec(
            "INSERT OR IGNORE INTO media_cleanup_tombstones(media_id, next_attempt) VALUES (?, ?)",
            row.id,
            now,
          );
        this.sql.exec(
          "DELETE FROM media_uploads WHERE id = ? AND upload_state = 'pending' AND lease_until <= ?",
          row.id,
          now,
        );
      }
    });
    for (const row of this.sql
      .exec<{ media_id: string; attempts: number }>(
        "SELECT media_id, attempts FROM media_cleanup_tombstones WHERE next_attempt <= ? ORDER BY next_attempt LIMIT 50",
        now,
      )
      .toArray()) {
      try {
        // Legacy bare IDs are never swept without an explicit retained record.
        const referenced = this.sql
          .exec("SELECT 1 FROM media_uploads WHERE id = ?", row.media_id)
          .toArray()[0];
        if (!referenced) await this.env.MEDIA_BUCKET.delete(row.media_id);
        this.sql.exec(
          "UPDATE media_cleanup_tombstones SET attempts = 0, next_attempt = ? WHERE media_id = ?",
          now + 24 * 60 * 60 * 1000,
          row.media_id,
        );
      } catch {
        this.sql.exec(
          "UPDATE media_cleanup_tombstones SET attempts = attempts + 1, next_attempt = ? WHERE media_id = ?",
          now + Math.min(60 * 60 * 1000, 5000 * 2 ** Math.min(row.attempts, 10)),
          row.media_id,
        );
      }
    }
    try {
      const cursor = this.sql
        .exec<{ value: string }>(
          "SELECT value FROM security_settings WHERE key = 'media_sweep_cursor'",
        )
        .toArray()[0]?.value;
      const page = await this.env.MEDIA_BUCKET.list({
        prefix: this.mediaPrefix,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      for (const object of page.objects) {
        const active = this.sql
          .exec(
            "SELECT 1 FROM media_uploads WHERE object_key = ? AND (upload_state = 'ready' OR (upload_state = 'pending' AND lease_until > ?))",
            object.key,
            Date.now(),
          )
          .toArray()[0];
        if (!active) await this.env.MEDIA_BUCKET.delete(object.key);
      }
      this.sql.exec(
        "INSERT OR REPLACE INTO security_settings(key, value) VALUES ('media_sweep_cursor', ?)",
        page.truncated ? page.cursor : "",
      );
    } catch {
      // A provider cursor may expire; restarting the bounded scan also retries deletions.
      this.sql.exec(
        "INSERT OR REPLACE INTO security_settings(key, value) VALUES ('media_sweep_cursor', '')",
      );
    }
  }

  /** Push-only policy, evaluated synchronously after the final authorization RPC. */
  private allowsPushNotification(accountId: string, event: unknown): boolean {
    if (!event || typeof event !== "object") return false;
    const payload = event as {
      channelId?: unknown;
      type?: unknown;
      data?: { content?: unknown; newContent?: unknown };
    };
    if (payload.channelId === undefined) return true;
    if (typeof payload.channelId !== "string") return false;
    const preference = this.sql
      .exec<{ level: string; muted_until: number | null }>(
        "SELECT level, muted_until FROM channel_notifications WHERE user_id = ? AND channel_name = ?",
        accountId,
        canonicalizeIRCName(payload.channelId),
      )
      .toArray()[0];
    if (preference?.muted_until && preference.muted_until > Date.now()) return false;
    const level = preference?.level ?? "mentions";
    if (level === "all") return true;
    if (level !== "mentions") return false;
    const content =
      payload.type === "message.created"
        ? payload.data?.content
        : payload.type === "message.updated"
          ? payload.data?.newContent
          : null;
    if (typeof content !== "string") return false;
    const names = this.sql
      .exec<{ name: string }>(
        "SELECT canonical_username AS name FROM users WHERE id = ? UNION SELECT nickname AS name FROM registered_nicks WHERE user_id = ?",
        accountId,
        accountId,
      )
      .toArray();
    const text = canonicalizeIRCName(content);
    // Match complete IRC account/nickname tokens, including RFC1459 case mapping.
    // Display names and arbitrary sender-supplied tags are not account identity.
    const boundary = "[^\\p{L}\\p{N}_\\-\\[\\]\\\\`^{}|~]";
    return names.some(({ name }) => {
      const escaped = canonicalizeIRCName(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|${boundary})@?${escaped}(?=$|${boundary})`, "u").test(text);
    });
  }

  public async alarm(): Promise<void> {
    const now = Date.now();
    await this.reconcileMedia(now);
    const rows = this.sql
      .exec<{
        event_id: string;
        account_id: string;
        endpoint: string;
        keys_json: string;
        credential_version: number;
        attempts: number;
      }>(
        "SELECT * FROM push_deliveries WHERE next_attempt <= ? ORDER BY next_attempt LIMIT 50",
        now,
      )
      .toArray();
    const namespace = this.env.SESSION as unknown as {
      idFromName(name: string): DurableObjectId;
      get(id: DurableObjectId): {
        getEventForRecipient(eventId: string, accountId: string, version: number): Promise<unknown>;
      };
    };
    const session = namespace.get(namespace.idFromName(SERVER_CONFIG.networkId));
    for (const row of rows) {
      let done = false;
      try {
        const current = this.sql
          .exec(
            "SELECT 1 FROM users u JOIN webpush_subscriptions s ON s.user_key = u.canonical_username JOIN push_deliveries d ON d.account_id = u.id AND d.endpoint = s.endpoint WHERE u.id = ? AND u.disabled_at IS NULL AND u.credential_version = ? AND s.endpoint = ? AND s.keys_json = ? AND d.event_id = ?",
            row.account_id,
            row.credential_version,
            row.endpoint,
            row.keys_json,
            row.event_id,
          )
          .toArray()[0];
        const event = current
          ? await session.getEventForRecipient(row.event_id, row.account_id, row.credential_version)
          : null;
        if (!event) done = true;
        else if (!allowedOutboundUrl(row.endpoint, outboundHosts(this.env, "push"))) done = true;
        else {
          const {
            WEBPUSH_VAPID_PUBLIC_KEY: publicKey,
            WEBPUSH_VAPID_PRIVATE_KEY: privateKey,
            WEBPUSH_VAPID_SUBJECT: subject,
          } = this.env;
          if (!publicKey || !privateKey || !subject) throw new Error("Push VAPID unavailable");
          const keys = JSON.parse(row.keys_json) as { p256dh?: string; auth?: string };
          if (!keys.p256dh || !keys.auth) done = true;
          else {
            const body = await encryptWebPush(
              new TextEncoder().encode(JSON.stringify(event)),
              keys.p256dh,
              keys.auth,
            );
            const authorization = await vapidAuthorization(
              row.endpoint,
              publicKey,
              privateKey,
              subject,
            );
            const checkedEvent = await session.getEventForRecipient(
              row.event_id,
              row.account_id,
              row.credential_version,
            );
            const stillCurrent = this.sql
              .exec(
                "SELECT 1 FROM users u JOIN webpush_subscriptions s ON s.user_key = u.canonical_username JOIN push_deliveries d ON d.account_id = u.id AND d.endpoint = s.endpoint WHERE u.id = ? AND u.disabled_at IS NULL AND u.credential_version = ? AND s.endpoint = ? AND s.keys_json = ? AND d.event_id = ?",
                row.account_id,
                row.credential_version,
                row.endpoint,
                row.keys_json,
                row.event_id,
              )
              .toArray()[0];
            if (
              !stillCurrent ||
              !checkedEvent ||
              JSON.stringify(checkedEvent) !== JSON.stringify(event) ||
              !this.allowsPushNotification(row.account_id, checkedEvent)
            ) {
              done = true;
              this.sql.exec(
                "DELETE FROM push_deliveries WHERE event_id = ? AND account_id = ? AND endpoint = ?",
                row.event_id,
                row.account_id,
                row.endpoint,
              );
              continue;
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
              const response = await fetch(row.endpoint, {
                method: "POST",
                redirect: "manual",
                signal: controller.signal,
                headers: {
                  Authorization: authorization,
                  "Content-Encoding": "aes128gcm",
                  "Content-Type": "application/octet-stream",
                  TTL: "60",
                },
                body,
              });
              await response.body?.cancel();
              done =
                response.ok ||
                (response.status >= 400 && response.status < 500 && response.status !== 429);
              if (response.status === 404 || response.status === 410)
                this.sql.exec(
                  "DELETE FROM webpush_subscriptions WHERE endpoint = ? AND keys_json = ? AND user_key = (SELECT canonical_username FROM users WHERE id = ?) AND EXISTS (SELECT 1 FROM push_deliveries WHERE event_id = ? AND account_id = ? AND endpoint = ?)",
                  row.endpoint,
                  row.keys_json,
                  row.account_id,
                  row.event_id,
                  row.account_id,
                  row.endpoint,
                );
            } finally {
              clearTimeout(timeout);
            }
          }
        }
      } catch {
        /* transient failures retry with bounded exponential backoff */
      }
      if (done || row.attempts >= 7)
        this.sql.exec(
          "DELETE FROM push_deliveries WHERE event_id = ? AND account_id = ? AND endpoint = ?",
          row.event_id,
          row.account_id,
          row.endpoint,
        );
      else
        this.sql.exec(
          "UPDATE push_deliveries SET attempts = attempts + 1, next_attempt = ? WHERE event_id = ? AND account_id = ? AND endpoint = ?",
          now + Math.min(60 * 60 * 1000, 5000 * 2 ** row.attempts),
          row.event_id,
          row.account_id,
          row.endpoint,
        );
    }
    this.sql.exec(
      "DELETE FROM push_events WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.event_id = push_events.event_id AND d.account_id = push_events.account_id)",
      now - 7 * 24 * 60 * 60 * 1000,
    );
    await this.scheduleMaintenanceAlarm();
  }

  // Canonical User Profiles
  private readUserProfile(username: string): UserProfile | null {
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

  public async getUserProfile(
    username: string,
  ): Promise<(UserProfile & { revision: number }) | null> {
    const profile = this.readUserProfile(username);
    if (!profile) return null;
    // Disabling login does not reset the version of an existing public profile.
    // Keep both reads synchronous so a mutation cannot interleave between them.
    const revision =
      this.sql
        .exec<{ revision: number }>(
          "SELECT COALESCE(r.revision, 0) AS revision FROM users u LEFT JOIN account_revisions r ON r.user_id = u.id WHERE u.canonical_username = ?",
          canonicalizeIRCName(username),
        )
        .toArray()[0]?.revision ?? 0;
    return { ...profile, revision };
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
  ): Promise<"ok" | "denied" | "too_large"> {
    const account = await this.verifyApiSession(token);
    if (!account) return "denied";
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > filehostMaxUploadBytes(this.env)
    )
      return "too_large";
    if (file.storageKind === "r2" && !this.mediaPrefix) return "denied";
    if (file.storageKind === "sqlite" && file.data.byteLength !== file.size)
      throw new Error("Invalid media payload");
    let target = scope.target ?? null;
    let generation: string | null = null;
    if (scope.kind === "channel") {
      if (!target) return "denied";
      const channel = this.env.CHANNELS.get(
        this.env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canonicalizeIRCName(target)}`),
      );
      generation = await channel.getMediaScope({ ...account, isAdmin: false });
      if (!generation) return "denied";
      target = canonicalizeIRCName(target);
    } else if (scope.kind === "dm") {
      const other = target ? await this.getAccountByUsername(target) : null;
      if (!other) return "denied";
      target = JSON.stringify([account.id, other.id].sort());
    } else if (scope.kind !== "private") return "denied";
    if (!(await this.authorizeCredential(token, "media.upload", target ?? account.id)))
      return "denied";
    const hash = file.storageKind === "sqlite" ? await mediaDigest(file.data) : null;
    const sessionHash = await hashSessionToken(token);
    if (!(await this.authorizeSessionHash(sessionHash, "media.upload", target ?? account.id)))
      return "denied";
    const objectKey =
      file.storageKind === "r2" ? `${this.mediaPrefix}${file.id}/${crypto.randomUUID()}` : null;
    const leaseUntil = objectKey ? Date.now() + MEDIA_LEASE_MS : null;
    return this.ctx.storage.transactionSync(() => {
      // Scope lookup and digesting can yield to logout or account disable. Check
      // the originating session inside the same transaction as the write.
      const current = this.sql
        .exec<{ id: string }>(
          `SELECT u.id FROM api_sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.user_id = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
          sessionHash,
          account.id,
          Date.now(),
        )
        .toArray()[0];
      if (!current) return "denied";
      const used = this.sql
        .exec<{ size: number }>(
          "SELECT COALESCE(SUM(size), 0) AS size FROM media_uploads WHERE owner_id = ?",
          account.id,
        )
        .toArray()[0].size;
      if (used + file.size > 100 * 1024 * 1024) return "denied";
      this.sql.exec(
        `INSERT INTO media_uploads (id, filename, mime_type, size, data, created_at, owner_id, scope_kind, scope_target, scope_generation, storage_kind, data_layout, data_sha256, upload_state, object_key, lease_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        file.id,
        file.filename,
        file.mimeType,
        file.size,
        new ArrayBuffer(0),
        Date.now(),
        account.id,
        scope.kind,
        target,
        generation,
        file.storageKind,
        file.storageKind === "sqlite" ? "chunked" : "inline",
        hash,
        file.storageKind === "r2" ? "pending" : "ready",
        objectKey,
        leaseUntil,
      );
      if (file.storageKind === "sqlite") {
        for (let offset = 0, index = 0; offset < file.size; offset += MEDIA_CHUNK_BYTES, index++)
          this.sql.exec(
            "INSERT INTO media_upload_chunks (media_id, chunk_index, data) VALUES (?, ?, ?)",
            file.id,
            index,
            file.data.slice(offset, offset + MEDIA_CHUNK_BYTES),
          );
      }
      return "ok";
    });
  }

  public async getMediaReservationKey(
    token: string,
    id: string,
    ownerId: string,
  ): Promise<string | null> {
    const actor = await this.verifyApiSession(token);
    if (!actor || actor.id !== ownerId) return null;
    const row = this.sql
      .exec<{ object_key: string | null; scope_target: string | null }>(
        "SELECT object_key, scope_target FROM media_uploads WHERE id = ? AND owner_id = ? AND storage_kind = 'r2' AND upload_state = 'pending' AND lease_until > ?",
        id,
        ownerId,
        Date.now(),
      )
      .toArray()[0];
    if (
      !row?.object_key ||
      !(await this.authorizeCredential(token, "media.upload", row.scope_target ?? ownerId))
    )
      return null;
    return row.object_key;
  }

  /** Internal upload coordinator only: publish a completed R2 reservation. */
  public async finalizeMediaReservation(
    token: string,
    id: string,
    ownerId: string,
    objectKey: string,
  ): Promise<boolean> {
    const account = await this.verifyApiSession(token);
    if (!account || account.id !== ownerId) return false;
    const reservation = this.sql
      .exec<{ scope_kind: string; scope_target: string | null; scope_generation: string | null }>(
        "SELECT scope_kind, scope_target, scope_generation FROM media_uploads WHERE id = ? AND owner_id = ? AND object_key = ? AND storage_kind = 'r2' AND upload_state = 'pending' AND lease_until > ?",
        id,
        ownerId,
        objectKey,
        Date.now(),
      )
      .toArray()[0];
    if (!reservation) return false;
    if (
      !(await this.authorizeCredential(
        token,
        "media.upload",
        reservation.scope_target ?? account.id,
      ))
    )
      return false;
    if (reservation.scope_kind === "channel") {
      if (!reservation.scope_target || !reservation.scope_generation) return false;
      const channel = this.env.CHANNELS.get(
        this.env.CHANNELS.idFromName(
          `${SERVER_CONFIG.networkId}:${canonicalizeIRCName(reservation.scope_target)}`,
        ),
      );
      // Recheck after the external object write. This closes revocation during
      // put; ChannelDO authorization and the AccountsDO commit are not atomic.
      const generation = await channel.getMediaScope({ ...account, isAdmin: false });
      if (generation !== reservation.scope_generation) return false;
    }
    const sessionHash = await hashSessionToken(token);
    if (
      !(await this.authorizeSessionHash(
        sessionHash,
        "media.upload",
        reservation.scope_target ?? account.id,
      ))
    )
      return false;
    return this.ctx.storage.transactionSync(() => {
      const active = this.sql
        .exec<{ id: string }>(
          `SELECT u.id FROM api_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.user_id = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
          sessionHash,
          ownerId,
          Date.now(),
        )
        .toArray()[0];
      const pending = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM media_uploads WHERE id = ? AND owner_id = ? AND object_key = ? AND storage_kind = 'r2' AND upload_state = 'pending' AND lease_until > ?",
          id,
          ownerId,
          objectKey,
          Date.now(),
        )
        .toArray()[0];
      if (!active || !pending) return false;
      this.sql.exec(
        "UPDATE media_uploads SET upload_state = 'ready' WHERE id = ? AND owner_id = ? AND upload_state = 'pending'",
        id,
        ownerId,
      );
      return true;
    });
  }

  /** Internal upload coordinator only: remove one failed, unpublished reservation. */
  public async rollbackMediaReservation(id: string, ownerId: string): Promise<void> {
    const pending = this.ctx.storage.transactionSync(() => {
      const row = this.sql
        .exec<{ object_key: string | null }>(
          "SELECT object_key FROM media_uploads WHERE id = ? AND owner_id = ? AND storage_kind = 'r2' AND upload_state = 'pending'",
          id,
          ownerId,
        )
        .toArray()[0];
      if (!row) return null;
      if (!row.object_key)
        this.sql.exec(
          "INSERT OR IGNORE INTO media_cleanup_tombstones(media_id, next_attempt) VALUES (?, ?)",
          id,
          Date.now(),
        );
      this.sql.exec(
        "DELETE FROM media_uploads WHERE id = ? AND owner_id = ? AND upload_state = 'pending'",
        id,
        ownerId,
      );
      return row;
    });
    if (!pending) return;
    if (!this.env.MEDIA_BUCKET) throw new Error("Media storage unavailable");
    await this.env.MEDIA_BUCKET.delete(pending.object_key ?? id);
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
  ): Promise<
    | (Awaited<ReturnType<AccountsDO["getMedia"]>> & { storageKind: string; objectKey: string })
    | null
  > {
    const account = await this.verifyApiSession(token);
    if (!account) return null;
    const row = this.sql
      .exec<{
        owner_id: string | null;
        scope_kind: string;
        scope_target: string | null;
        scope_generation: string | null;
        storage_kind: string;
        upload_state: string;
        object_key: string | null;
      }>(
        "SELECT owner_id, scope_kind, scope_target, scope_generation, storage_kind, upload_state, object_key FROM media_uploads WHERE id = ?",
        id,
      )
      .toArray()[0];
    if (!row?.owner_id || row.upload_state !== "ready") return null; // Unowned and unpublished media stay private.
    if (!(await this.authorizeCredential(token, "media.read", id))) return null;
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
    if (!(await this.authorizeCredential(token, "media.read", id))) return null;
    return media
      ? { ...media, storageKind: row.storage_kind, objectKey: row.object_key ?? id }
      : null;
  }

  /** Lists only published media within a scope the caller can currently read. */
  public async listPrivateMedia(
    token: string,
    scope: { kind: "private" | "channel" | "dm"; target?: string },
  ) {
    return this.listPrivateMediaWithHash(await hashSessionToken(token), scope);
  }

  public async listPrivateMediaWithHash(
    hash: string,
    scope: { kind: "private" | "channel" | "dm"; target?: string },
  ): Promise<Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: number;
  }> | null> {
    const account = await this.verifySessionHash(hash);
    if (!account) return null;
    let target: string | null = null;
    let generation: string | null = null;
    if (scope.kind === "channel") {
      if (!scope.target) return null;
      target = canonicalizeIRCName(scope.target);
      if (!(await this.authorizeSessionHash(hash, "media.list", target))) return null;
      const channel = this.env.CHANNELS.get(
        this.env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${target}`),
      );
      const access = await channel.getAccessSnapshot({
        id: account.id,
        username: account.username,
        credentialVersion: account.credentialVersion ?? 0,
      });
      if (!access.canRead) return null;
      generation = access.generation;
    } else if (scope.kind === "dm") {
      if (!scope.target) return null;
      const other = await this.resolveConversationAccount(scope.target);
      if (!other) return null;
      target = JSON.stringify([account.id, other.id].sort());
      if (!(await this.authorizeSessionHash(hash, "media.list", target))) return null;
    } else if (scope.kind === "private") {
      if (!(await this.authorizeSessionHash(hash, "media.list", account.id))) return null;
    } else return null;
    const rows = this.sql
      .exec<{ id: string; filename: string; mime_type: string; size: number; created_at: number }>(
        `SELECT id, filename, mime_type, size, created_at FROM media_uploads
       WHERE upload_state = 'ready' AND scope_kind = ?
         AND ((? = 'private' AND owner_id = ?) OR (? = 'dm' AND scope_target = ?) OR (? = 'channel' AND scope_target = ? AND scope_generation = ?))
       ORDER BY created_at DESC, id DESC LIMIT 100`,
        scope.kind,
        scope.kind,
        account.id,
        scope.kind,
        target,
        scope.kind,
        target,
        generation,
      )
      .toArray();
    if (!(await this.authorizeSessionHash(hash, "media.list", target ?? account.id))) return null;
    return rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: row.size,
      createdAt: row.created_at,
    }));
  }

  public async listPendingMedia(token: string): Promise<Array<{
    id: string;
    filename: string;
    size: number;
    createdAt: number;
    leaseUntil: number;
  }> | null> {
    const actor = await this.verifyApiSession(token);
    if (!actor || !(await this.authorizeCredential(token, "media.list", actor.id))) return null;
    return this.sql
      .exec<{
        id: string;
        filename: string;
        size: number;
        created_at: number;
        lease_until: number;
      }>(
        "SELECT id, filename, size, created_at, lease_until FROM media_uploads WHERE owner_id = ? AND upload_state = 'pending' AND lease_until > ? ORDER BY created_at DESC, id DESC LIMIT 100",
        actor.id,
        Date.now(),
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        filename: row.filename,
        size: row.size,
        createdAt: row.created_at,
        leaseUntil: row.lease_until,
      }));
  }

  public async deletePrivateMedia(token: string, id: string): Promise<boolean> {
    const account = await this.verifyApiSession(token);
    if (!account) return false;
    const row = this.sql
      .exec<{ storage_kind: string; object_key: string | null; upload_state: string }>(
        "SELECT storage_kind, object_key, upload_state FROM media_uploads WHERE id = ? AND owner_id = ?",
        id,
        account.id,
      )
      .toArray()[0];
    if (!row) return false;
    if (!(await this.authorizeCredential(token, "media.delete", id))) return false;
    if (row.storage_kind === "r2" && row.upload_state === "pending") {
      await this.rollbackMediaReservation(id, account.id);
      return true;
    }
    if (row.storage_kind === "r2") {
      if (!this.env.MEDIA_BUCKET) throw new Error("Media storage unavailable");
      await this.env.MEDIA_BUCKET.delete(row.object_key ?? id);
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
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM media_upload_chunks WHERE media_id = ?", file.id);
      this.sql.exec(
        `INSERT INTO media_uploads (id, filename, mime_type, size, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET filename = excluded.filename, mime_type = excluded.mime_type, size = excluded.size, data = excluded.data, created_at = excluded.created_at, data_layout = 'inline', data_sha256 = NULL`,
        file.id,
        file.filename,
        file.mimeType,
        file.size,
        file.data,
        Date.now(),
      );
    });
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
        data_layout: string;
        data_sha256: string | null;
      }>(
        "SELECT filename, mime_type, size, data, data_layout, data_sha256 FROM media_uploads WHERE id = ?",
        id,
      )
      .toArray();
    if (rows.length === 0) return null;
    const row = rows[0];
    let data = row.data;
    if (row.data_layout === "chunked") {
      const chunks = this.sql
        .exec<{ chunk_index: number; data: ArrayBuffer }>(
          "SELECT chunk_index, data FROM media_upload_chunks WHERE media_id = ? ORDER BY chunk_index",
          id,
        )
        .toArray();
      const assembled = new Uint8Array(row.size);
      let offset = 0;
      for (const [index, chunk] of chunks.entries()) {
        const bytes = new Uint8Array(chunk.data);
        if (
          chunk.chunk_index !== index ||
          bytes.byteLength !== Math.min(MEDIA_CHUNK_BYTES, row.size - offset)
        )
          throw new Error("Media storage integrity failure");
        assembled.set(bytes, offset);
        offset += bytes.byteLength;
      }
      if (
        offset !== row.size ||
        !row.data_sha256 ||
        (await mediaDigest(assembled.buffer)) !== row.data_sha256
      )
        throw new Error("Media storage integrity failure");
      data = assembled.buffer;
    } else if (row.data_layout !== "inline") {
      throw new Error("Media storage integrity failure");
    }
    return {
      filename: rows[0].filename,
      mimeType: rows[0].mime_type,
      size: rows[0].size,
      data,
    };
  }
}
