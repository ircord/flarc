import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export * from "./accounts-operational";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  // Legacy migration adds nullable TEXT; registration and backfill populate the canonical value.
  canonicalUsername: text("canonical_username").unique(),
  credentialVersion: integer("credential_version").notNull().default(0),
  displayName: text("display_name"),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  disabledAt: integer("disabled_at"),
});

export const registeredNicks = sqliteTable(
  "registered_nicks",
  {
    nickname: text("nickname").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    registeredAt: integer("registered_at").notNull(),
  },
  (table) => [index("idx_registered_nicks_user").on(table.userId)],
);

export const accountRoles = sqliteTable(
  "account_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    index("idx_account_roles_user").on(table.userId),
  ],
);

export const scramCredentials = sqliteTable("scram_credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  salt: text("salt").notNull(),
  iterations: integer("iterations").notNull(),
  storedKey: text("stored_key").notNull(),
  serverKey: text("server_key").notNull(),
});

export const userMetadata = sqliteTable(
  "user_metadata",
  {
    targetKey: text("target_key").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.targetKey, table.key] }),
    index("idx_user_metadata_target").on(table.targetKey),
  ],
);

export const readMarkers = sqliteTable(
  "read_markers",
  {
    userKey: text("user_key").notNull(),
    target: text("target").notNull(),
    timestamp: text("timestamp").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userKey, table.target] }),
    index("idx_read_markers_user").on(table.userKey),
  ],
);

export const accountSettings = sqliteTable("account_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  persistence: integer("persistence").notNull().default(0),
  autoJoinJson: text("auto_join_json").notNull().default("[]"),
  vhost: text("vhost"),
  vhostEnabled: integer("vhost_enabled").notNull().default(0),
  settingsJson: text("settings_json").notNull().default("{}"),
});

export const channelNotifications = sqliteTable(
  "channel_notifications",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelName: text("channel_name").notNull(),
    level: text("level").notNull().default("mentions"),
    mutedUntil: integer("muted_until"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.channelName] }),
    index("idx_channel_notifications_user").on(table.userId),
  ],
);

export const webpushSubscriptions = sqliteTable(
  "webpush_subscriptions",
  {
    userKey: text("user_key").notNull(),
    endpoint: text("endpoint").notNull(),
    keysJson: text("keys_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userKey, table.endpoint] }),
    index("idx_webpush_user").on(table.userKey),
  ],
);

export const mediaUploads = sqliteTable("media_uploads", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  ownerId: text("owner_id"),
  scopeKind: text("scope_kind").notNull().default("private"),
  scopeTarget: text("scope_target"),
  scopeGeneration: text("scope_generation"),
  storageKind: text("storage_kind").notNull().default("sqlite"),
  uploadState: text("upload_state").notNull().default("ready"),
  dataLayout: text("data_layout").notNull().default("inline"),
  dataSha256: text("data_sha256"),
  objectKey: text("object_key"),
  leaseUntil: integer("lease_until"),
  createdAt: integer("created_at").notNull(),
});

export const mediaUploadChunks = sqliteTable(
  "media_upload_chunks",
  {
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaUploads.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.mediaId, table.chunkIndex] })],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AccountRole = typeof accountRoles.$inferSelect;
export type MediaUpload = typeof mediaUploads.$inferSelect;

export const apiSessions = sqliteTable(
  "api_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_api_sessions_user").on(table.userId)],
);
export const eventTickets = sqliteTable("event_tickets", {
  ticketHash: text("ticket_hash").primaryKey(),
  sessionHash: text("session_hash")
    .notNull()
    .references(() => apiSessions.tokenHash, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});

// Additive session identifiers never expose bearer hashes through public APIs.
export const apiSessionDetails = sqliteTable("api_session_details", {
  sessionId: text("session_id").primaryKey().notNull(),
  tokenHash: text("token_hash")
    .notNull()
    .unique()
    .references(() => apiSessions.tokenHash, { onDelete: "cascade" }),
  csrfHash: text("csrf_hash"),
});
export const networkBans = sqliteTable(
  "network_bans",
  {
    id: text("id").primaryKey().notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => [
    unique().on(table.kind, table.value),
    check("network_bans_kind_check", sql`${table.kind} IN ('account', 'hostmask')`),
  ],
);
export const securityAudit = sqliteTable(
  "security_audit",
  {
    id: text("id").primaryKey().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    target: text("target").notNull(),
    outcome: text("outcome").notNull(),
    transport: text("transport").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_security_audit_time").on(table.createdAt)],
);

export const credentialPolicies = sqliteTable("credential_policies", {
  tokenHash: text("token_hash")
    .primaryKey()
    .notNull()
    .references(() => apiSessions.tokenHash, { onDelete: "cascade" }),
  label: text("label").notNull(),
  canAdmin: integer("can_admin").notNull().default(0),
  canOper: integer("can_oper").notNull().default(0),
});
export const credentialScopes = sqliteTable(
  "credential_scopes",
  {
    tokenHash: text("token_hash")
      .notNull()
      .references(() => credentialPolicies.tokenHash, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    resource: text("resource").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tokenHash, table.operation, table.resource] })],
);
export const adminScopePolicies = sqliteTable("admin_scope_policies", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});
export const adminScopeGrants = sqliteTable(
  "admin_scope_grants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => adminScopePolicies.userId, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    resource: text("resource").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.operation, table.resource] })],
);

export const accountRevisions = sqliteTable("account_revisions", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
});
export const accountOperationResults = sqliteTable(
  "account_operation_results",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    revision: integer("revision").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.operationId] })],
);

export const accountEventOutbox = sqliteTable(
  "account_event_outbox",
  {
    eventId: text("event_id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_account_event_outbox_order").on(table.createdAt, table.eventId)],
);

export const pushEvents = sqliteTable(
  "push_events",
  {
    eventId: text("event_id").notNull(),
    accountId: text("account_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.accountId] })],
);

export const pushDeliveries = sqliteTable(
  "push_deliveries",
  {
    eventId: text("event_id").notNull(),
    accountId: text("account_id").notNull(),
    endpoint: text("endpoint").notNull(),
    keysJson: text("keys_json").notNull(),
    credentialVersion: integer("credential_version").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttempt: integer("next_attempt").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.accountId, table.endpoint] }),
    index("idx_push_deliveries_due").on(table.nextAttempt),
  ],
);

export const mediaCleanupTombstones = sqliteTable(
  "media_cleanup_tombstones",
  {
    mediaId: text("media_id").primaryKey().notNull(),
    nextAttempt: integer("next_attempt").notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [index("idx_media_cleanup_due").on(table.nextAttempt)],
);
