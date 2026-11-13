export function initAccountsStorage(sql: SqlStorage): void {
  sql.exec("PRAGMA foreign_keys = ON;");

  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      disabled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS registered_nicks (
      nickname TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      registered_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_registered_nicks_user
      ON registered_nicks(user_id);

    CREATE TABLE IF NOT EXISTS account_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, role),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_account_roles_user
      ON account_roles(user_id);

    CREATE TABLE IF NOT EXISTS scram_credentials (
      user_id TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      stored_key TEXT NOT NULL,
      server_key TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_metadata (
      target_key TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (target_key, key)
    );

    CREATE INDEX IF NOT EXISTS idx_user_metadata_target
      ON user_metadata(target_key);

    CREATE TABLE IF NOT EXISTS read_markers (
      user_key TEXT NOT NULL,
      target TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_key, target)
    );

    CREATE INDEX IF NOT EXISTS idx_read_markers_user
      ON read_markers(user_key);

    CREATE TABLE IF NOT EXISTS channel_notifications (
      user_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'mentions',
      muted_until INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_channel_notifications_user
      ON channel_notifications(user_id);

    CREATE TABLE IF NOT EXISTS account_settings (
      user_id TEXT PRIMARY KEY,
      persistence INTEGER NOT NULL DEFAULT 0,
      auto_join_json TEXT NOT NULL DEFAULT '[]',
      vhost TEXT,
      vhost_enabled INTEGER NOT NULL DEFAULT 0,
      settings_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS webpush_subscriptions (
      user_key TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      keys_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_key, endpoint)
    );

    CREATE INDEX IF NOT EXISTS idx_webpush_user
      ON webpush_subscriptions(user_key);

    CREATE TABLE IF NOT EXISTS media_uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_upload_chunks (
      media_id TEXT NOT NULL REFERENCES media_uploads(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (media_id, chunk_index)
    );
  `);

  const safeAlterations = [
    "ALTER TABLE account_settings ADD COLUMN vhost TEXT",
    "ALTER TABLE account_settings ADD COLUMN vhost_enabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE account_settings ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
  ];
  for (const stmt of safeAlterations) {
    const [, table, column] = stmt.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/)!;
    if (
      !sql
        .exec<{ name: string }>(`PRAGMA table_info(${table})`)
        .toArray()
        .some((c) => c.name === column)
    )
      sql.exec(stmt);
  }
}

export function initChannelStorage(sql: SqlStorage): void {
  sql.exec("PRAGMA foreign_keys = ON;");

  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL UNIQUE,
      sender_id TEXT NOT NULL,
      sender_account TEXT,
      sender_nick TEXT NOT NULL,
      sender_user TEXT NOT NULL,
      sender_host TEXT NOT NULL,
      command TEXT NOT NULL DEFAULT 'PRIVMSG',
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '{}',
      multiline_json TEXT,
      redacted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created
      ON messages(created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_expires
      ON messages(expires_at);

    CREATE INDEX IF NOT EXISTS idx_messages_sequence
      ON messages(sequence);

    CREATE TABLE IF NOT EXISTS channel_members (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_name TEXT,
      nickname TEXT NOT NULL,
      username TEXT NOT NULL,
      hostname TEXT NOT NULL,
      realname TEXT NOT NULL,
      modes TEXT NOT NULL DEFAULT '',
      joined_at INTEGER NOT NULL,
      is_persistent INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_channel_members_user
      ON channel_members(user_id);

    CREATE INDEX IF NOT EXISTS idx_channel_members_nick
      ON channel_members(nickname);

    CREATE TABLE IF NOT EXISTS channel_permissions (
      user_id TEXT NOT NULL,
      account_name TEXT,
      permission TEXT NOT NULL,
      PRIMARY KEY (user_id, permission)
    );

    CREATE INDEX IF NOT EXISTS idx_channel_perms_user
      ON channel_permissions(user_id);

    CREATE TABLE IF NOT EXISTS channel_bans (
      mask TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS channel_list_modes (
      mode TEXT NOT NULL,
      mask TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (mode, mask)
    );

    CREATE TABLE IF NOT EXISTS channel_invites (
      target_nick TEXT PRIMARY KEY,
      invited_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_kv_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_role_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      irc_prefix TEXT,
      irc_mode TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      permissions_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS channel_user_roles (
      user_id TEXT NOT NULL,
      account_name TEXT,
      group_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, group_id),
      FOREIGN KEY (group_id) REFERENCES channel_role_groups(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_channel_user_roles_group
      ON channel_user_roles(group_id);

    CREATE TABLE IF NOT EXISTS channel_webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      avatar_url TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_channel_webhooks_token
      ON channel_webhooks(token);

    CREATE TABLE IF NOT EXISTS channel_outgoing_webhooks (
      id TEXT PRIMARY KEY,
      target_url TEXT NOT NULL,
      secret TEXT,
      events_json TEXT NOT NULL DEFAULT '["message.created"]',
      created_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id UNINDEXED,
      sender_nick UNINDEXED,
      content
    );
  `);

  const safeAlterations = [
    "ALTER TABLE messages ADD COLUMN tags_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE messages ADD COLUMN multiline_json TEXT",
    "ALTER TABLE messages ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE channel_permissions ADD COLUMN account_name TEXT",
    "ALTER TABLE channel_members ADD COLUMN is_persistent INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE channel_role_groups ADD COLUMN color TEXT",
    "ALTER TABLE channel_role_groups ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE channel_role_groups ADD COLUMN updated_at INTEGER",
  ];
  for (const stmt of safeAlterations) {
    try {
      sql.exec(stmt);
    } catch {
      // Column already exists
    }
  }
}

export function initSessionStorage(sql: SqlStorage): void {
  sql.exec("PRAGMA foreign_keys = ON;");

  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_state (
      session_id TEXT PRIMARY KEY,
      attachment_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_channels (
      session_id TEXT NOT NULL,
      canonical_channel TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      joined_at INTEGER,
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
      redacted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_direct_messages_peer
      ON direct_messages(peer_pair, created_at);
  `);
}

export const initializeAccountsSchema = initAccountsStorage;
export const initializeChannelSchema = initChannelStorage;
export const initializeSessionSchema = initSessionStorage;
