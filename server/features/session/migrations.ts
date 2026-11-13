/** Additive migration: existing immutable message IDs, pair keys and sequences
 * stay intact. Nickname-only legacy records are never assigned guessed owners. */
export function initializeSessionFeatures(sql: SqlStorage) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS bootstrap_pages (
      token TEXT PRIMARY KEY NOT NULL,account_id TEXT NOT NULL,scan_after TEXT NOT NULL,
      recovery_cursor TEXT NOT NULL,expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bootstrap_page_expiry ON bootstrap_pages(expires_at);
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      pair_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'direct',
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      read_sequence INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conversation_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_member_account ON conversation_members(account_id, conversation_id);
    CREATE TABLE IF NOT EXISTS event_subscription_preferences (account_id TEXT PRIMARY KEY NOT NULL,subscriptions_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_subscriptions (
      account_id TEXT NOT NULL,subscription_id TEXT NOT NULL,resource_id TEXT NOT NULL,generation TEXT NOT NULL,
      expires_at INTEGER NOT NULL,registered INTEGER NOT NULL DEFAULT 0,revision INTEGER,
      PRIMARY KEY(account_id,resource_id,generation)
    );
    CREATE TABLE IF NOT EXISTS feature_operations (
      actor_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      result_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (actor_id, operation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_feature_operation_expiry ON feature_operations(expires_at);
    CREATE TABLE IF NOT EXISTS event_journal (
      journal_sequence INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      generation TEXT,
      owner_id TEXT,
      audience_required INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_journal_resource ON event_journal(resource_kind, resource_id, journal_sequence);
    CREATE TABLE IF NOT EXISTS event_audience (
      event_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(event_id,account_id)
    );
    CREATE TABLE IF NOT EXISTS event_push_intents (
      event_id TEXT NOT NULL,account_id TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(event_id,account_id)
    );
    CREATE TABLE IF NOT EXISTS event_cursors (
      token TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      journal_sequence INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_cursor_expiry ON event_cursors(expires_at);
    CREATE TABLE IF NOT EXISTS event_journal_state (
      key TEXT PRIMARY KEY NOT NULL,
      value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO event_journal_state(key,value) VALUES ('discarded_through',0);
  `);
  if (
    !sql
      .exec<{ name: string }>("PRAGMA table_info(event_journal)")
      .toArray()
      .some((c) => c.name === "audience_required")
  )
    sql.exec("ALTER TABLE event_journal ADD COLUMN audience_required INTEGER NOT NULL DEFAULT 0");
  if (
    !sql
      .exec<{ name: string }>("PRAGMA table_info(direct_messages)")
      .toArray()
      .some((c) => c.name === "conversation_id")
  )
    sql.exec(
      "ALTER TABLE direct_messages ADD COLUMN conversation_id TEXT REFERENCES conversations(id)",
    );
  if (
    !sql
      .exec<{ name: string }>("PRAGMA table_info(session_invites)")
      .toArray()
      .some((c) => c.name === "generation")
  )
    sql.exec("ALTER TABLE session_invites ADD COLUMN generation TEXT");
  if (
    !sql
      .exec<{ name: string }>("PRAGMA table_info(session_channels)")
      .toArray()
      .some((c) => c.name === "generation")
  )
    sql.exec("ALTER TABLE session_channels ADD COLUMN generation TEXT");
  if (
    !sql
      .exec<{ name: string }>("PRAGMA table_info(event_journal)")
      .toArray()
      .some((c) => c.name === "live_public")
  )
    sql.exec("ALTER TABLE event_journal ADD COLUMN live_public INTEGER NOT NULL DEFAULT 0");
  if (
    !sql.exec("SELECT 1 FROM event_journal_state WHERE key='dm_identity_migrated'").toArray().length
  )
    for (const pair of sql
      .exec<{ peer_pair: string; sender_id: string; target_id: string; created_at: number }>(
        "SELECT peer_pair, sender_id, target_id, MIN(created_at) AS created_at FROM direct_messages WHERE target_id IS NOT NULL GROUP BY peer_pair, sender_id, target_id",
      )
      .toArray()) {
      const id = crypto.randomUUID();
      sql.exec(
        "INSERT OR IGNORE INTO conversations(id,pair_key,created_at) VALUES (?,?,?)",
        id,
        pair.peer_pair,
        pair.created_at,
      );
      const actual = sql
        .exec<{ id: string }>("SELECT id FROM conversations WHERE pair_key=?", pair.peer_pair)
        .toArray()[0].id;
      for (const account of [pair.sender_id, pair.target_id])
        sql.exec(
          "INSERT OR IGNORE INTO conversation_members(conversation_id,account_id) VALUES (?,?)",
          actual,
          account,
        );
      sql.exec(
        "UPDATE direct_messages SET conversation_id=? WHERE peer_pair=? AND target_id IS NOT NULL AND conversation_id IS NULL",
        actual,
        pair.peer_pair,
      );
    }
  sql.exec(
    "INSERT OR IGNORE INTO event_journal_state(key,value) VALUES ('dm_identity_migrated',1)",
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_dm_conversation_sequence ON direct_messages(conversation_id,sequence)",
  );
}
