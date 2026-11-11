import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const channelMetadata = sqliteTable("channel_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sequence: integer("sequence").notNull().unique(),
    senderId: text("sender_id").notNull(),
    senderAccount: text("sender_account"),
    senderNick: text("sender_nick").notNull(),
    senderUser: text("sender_user").notNull(),
    senderHost: text("sender_host").notNull(),
    command: text("command").notNull().default("PRIVMSG"),
    content: text("content").notNull(),
    tagsJson: text("tags_json").notNull().default("{}"),
    multilineJson: text("multiline_json"),
    redacted: integer("redacted").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_messages_created").on(table.createdAt),
    index("idx_messages_expires").on(table.expiresAt),
    index("idx_messages_sequence").on(table.sequence),
  ],
);

export const channelMembers = sqliteTable(
  "channel_members",
  {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id").notNull(),
    accountName: text("account_name"),
    nickname: text("nickname").notNull(),
    username: text("username").notNull(),
    hostname: text("hostname").notNull(),
    realname: text("realname").notNull(),
    modes: text("modes").notNull().default(""),
    joinedAt: integer("joined_at").notNull(),
    isPersistent: integer("is_persistent").notNull().default(0),
  },
  (table) => [
    index("idx_channel_members_user").on(table.userId),
    index("idx_channel_members_nick").on(table.nickname),
  ],
);

export const channelPermissions = sqliteTable(
  "channel_permissions",
  {
    userId: text("user_id").notNull(),
    accountName: text("account_name"),
    permission: text("permission").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permission] }),
    index("idx_channel_perms_user").on(table.userId),
  ],
);

export const channelBans = sqliteTable("channel_bans", {
  mask: text("mask").primaryKey(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  reason: text("reason"),
});

export const channelListModes = sqliteTable(
  "channel_list_modes",
  {
    mode: text("mode").notNull(),
    mask: text("mask").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.mode, table.mask] })],
);

export const channelInvites = sqliteTable("channel_invites", {
  targetNick: text("target_nick").primaryKey(),
  targetUserId: text("target_user_id"),
  invitedBy: text("invited_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const channelKvMetadata = sqliteTable("channel_kv_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Custom Role Groups & Granular Channel Permissions
export const channelRoleGroups = sqliteTable("channel_role_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color"),
  position: integer("position").notNull().default(0),
  updatedAt: integer("updated_at"),
  ircPrefix: text("irc_prefix"), // e.g. "~", "&", "@", "%", "+"
  ircMode: text("irc_mode"), // e.g. "q", "a", "o", "h", "v"
  priority: integer("priority").notNull().default(0),
  permissionsJson: text("permissions_json").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
});

export const channelUserRoles = sqliteTable(
  "channel_user_roles",
  {
    userId: text("user_id").notNull(),
    accountName: text("account_name"),
    groupId: text("group_id")
      .notNull()
      .references(() => channelRoleGroups.id, { onDelete: "cascade" }),
    assignedAt: integer("assigned_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.groupId] }),
    index("idx_channel_user_roles_group").on(table.groupId),
  ],
);

export const channelWebhooks = sqliteTable(
  "channel_webhooks",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    token: text("token").notNull().unique(),
    avatarUrl: text("avatar_url"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_channel_webhooks_token").on(table.token)],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ChannelMember = typeof channelMembers.$inferSelect;
export type ChannelRoleGroup = typeof channelRoleGroups.$inferSelect;
export type ChannelUserRole = typeof channelUserRoles.$inferSelect;
export type ChannelWebhook = typeof channelWebhooks.$inferSelect;

export const messageEdits = sqliteTable("message_edits", {
  messageId: text("message_id")
    .primaryKey()
    .references(() => messages.id, { onDelete: "cascade" }),
  rootId: text("root_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
});
