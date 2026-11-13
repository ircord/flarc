import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export { schemaMigrations } from "./common";

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
  parentId: text("parent_id"),
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

export const messageEdits = sqliteTable(
  "message_edits",
  {
    messageId: text("message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    rootId: text("root_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
  },
  (table) => [index("idx_message_edit_root").on(table.rootId)],
);

export const webhookLimits = sqliteTable("webhook_limits", {
  hookId: text("hook_id")
    .primaryKey()
    .references(() => channelWebhooks.id, { onDelete: "cascade" }),
  count: integer("count").notNull(),
  resetAt: integer("reset_at").notNull(),
});

export const channelOutgoingWebhooks = sqliteTable("channel_outgoing_webhooks", {
  id: text("id").primaryKey(),
  targetUrl: text("target_url").notNull(),
  secret: text("secret"),
  eventsJson: text("events_json").notNull().default('["message.created"]'),
  createdAt: integer("created_at").notNull(),
});

export const channelFeatureRevision = sqliteTable(
  "channel_feature_revision",
  {
    id: integer("id").primaryKey(),
    revision: integer("revision").notNull(),
  },
  (table) => [check("channel_feature_revision_singleton", sql`${table.id} = 1`)],
);

export const channelArchivedMessages = sqliteTable(
  "channel_archived_messages",
  {
    generation: text("generation").notNull(),
    id: text("id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.generation, table.id] }),
    index("channel_archived_expiry").on(table.expiresAt),
  ],
);

export const channelArchivedEdits = sqliteTable(
  "channel_archived_edits",
  {
    generation: text("generation").notNull(),
    messageId: text("message_id").notNull(),
    rootId: text("root_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.generation, table.messageId] })],
);

export const channelFeatureOutbox = sqliteTable(
  "channel_feature_outbox",
  {
    id: text("id").primaryKey(),
    generation: text("generation").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
    sequence: integer("sequence"),
  },
  (table) => [uniqueIndex("channel_feature_outbox_sequence").on(table.sequence)],
);

export const channelFeatureOutboxCounter = sqliteTable(
  "channel_feature_outbox_counter",
  {
    id: integer("id").primaryKey(),
    nextSequence: integer("next_sequence").notNull(),
  },
  (table) => [check("channel_feature_outbox_counter_singleton", sql`${table.id} = 1`)],
);

export const channelBulkOperations = sqliteTable(
  "channel_bulk_operations",
  {
    actorId: text("actor_id").notNull(),
    operationId: text("operation_id").notNull(),
    generation: text("generation").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.operationId, table.generation] })],
);

export const channelFeatureOperations = sqliteTable(
  "channel_feature_operations",
  {
    actorId: text("actor_id").notNull(),
    operationId: text("operation_id").notNull(),
    generation: text("generation").notNull(),
    kind: text("kind").notNull(),
    fingerprint: text("fingerprint").notNull(),
    result: text("result").notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.operationId, table.generation] })],
);

export const channelFeatureObservers = sqliteTable(
  "channel_feature_observers",
  {
    accountId: text("account_id").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    generation: text("generation").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.subscriptionId] })],
);

export const channelRestrictedMessages = sqliteTable(
  "channel_restricted_messages",
  {
    id: text("id").primaryKey(),
    generation: text("generation").notNull(),
    senderId: text("sender_id").notNull(),
    minimumRank: integer("minimum_rank").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("channel_restricted_expiry").on(table.expiresAt)],
);
