import { blob, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
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
  createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AccountRole = typeof accountRoles.$inferSelect;
export type MediaUpload = typeof mediaUploads.$inferSelect;
