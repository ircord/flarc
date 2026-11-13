/** Additive account features. Existing sessions and legacy account identities are unchanged. */
export function initializeAccountFeatures(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS api_session_details (
      session_id TEXT PRIMARY KEY NOT NULL,
      token_hash TEXT NOT NULL UNIQUE REFERENCES api_sessions(token_hash) ON DELETE CASCADE,
      csrf_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS credential_policies (
      token_hash TEXT PRIMARY KEY NOT NULL REFERENCES api_sessions(token_hash) ON DELETE CASCADE,
      label TEXT NOT NULL,
      can_admin INTEGER NOT NULL DEFAULT 0,
      can_oper INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS credential_scopes (
      token_hash TEXT NOT NULL REFERENCES credential_policies(token_hash) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      resource TEXT NOT NULL,
      PRIMARY KEY(token_hash, operation, resource)
    );
    CREATE TABLE IF NOT EXISTS admin_scope_policies (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS admin_scope_grants (
      user_id TEXT NOT NULL REFERENCES admin_scope_policies(user_id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      resource TEXT NOT NULL,
      PRIMARY KEY(user_id, operation, resource)
    );
    CREATE TABLE IF NOT EXISTS account_revisions (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS account_operation_results (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, operation_id)
    );
    CREATE TABLE IF NOT EXISTS account_event_outbox (
      event_id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_account_event_outbox_order ON account_event_outbox(created_at, event_id);
    CREATE TABLE IF NOT EXISTS network_bans (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('account', 'hostmask')),
      value TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      UNIQUE(kind, value)
    );
    CREATE TABLE IF NOT EXISTS security_audit (
      id TEXT PRIMARY KEY NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      outcome TEXT NOT NULL,
      transport TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_security_audit_time ON security_audit(created_at);
    CREATE TABLE IF NOT EXISTS push_events (
      event_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(event_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS push_deliveries (
      event_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      keys_json TEXT NOT NULL,
      credential_version INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL,
      PRIMARY KEY(event_id, account_id, endpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_push_deliveries_due ON push_deliveries(next_attempt);
    CREATE TABLE IF NOT EXISTS media_cleanup_tombstones (
      media_id TEXT PRIMARY KEY NOT NULL,
      next_attempt INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_media_cleanup_due ON media_cleanup_tombstones(next_attempt);
  `);
  // Preserve early feature-preview databases when this additive module evolves.
  const policyColumns = sql
    .exec<{ name: string }>("PRAGMA table_info(credential_policies)")
    .toArray();
  if (!policyColumns.some((column) => column.name === "can_admin"))
    sql.exec("ALTER TABLE credential_policies ADD COLUMN can_admin INTEGER NOT NULL DEFAULT 0");
  if (!policyColumns.some((column) => column.name === "can_oper"))
    sql.exec("ALTER TABLE credential_policies ADD COLUMN can_oper INTEGER NOT NULL DEFAULT 0");
}
