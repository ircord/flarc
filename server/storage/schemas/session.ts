import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export { schemaMigrations } from "./common";

export const whowasHistory = sqliteTable("whowas_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  canonNick: text("canon_nick").notNull(),
  nickname: text("nickname").notNull(),
  username: text("username").notNull(),
  hostname: text("hostname").notNull(),
  realname: text("realname").notNull(),
  accountName: text("account_name"),
  leftAt: integer("left_at").notNull(),
});

export const sessionState = sqliteTable("session_state", {
  sessionId: text("session_id").primaryKey(),
  attachmentJson: text("attachment_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessionChannels = sqliteTable(
  "session_channels",
  {
    sessionId: text("session_id").notNull(),
    canonicalChannel: text("canonical_channel").notNull(),
    channelName: text("channel_name").notNull(),
    joinedAt: integer("joined_at"),
    generation: text("generation"),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.canonicalChannel] })],
);

export const sessionMonitors = sqliteTable(
  "session_monitors",
  {
    sessionId: text("session_id").notNull(),
    targetNick: text("target_nick").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.targetNick] })],
);

export const sessionInvites = sqliteTable(
  "session_invites",
  {
    canonNick: text("canon_nick").notNull(),
    targetUserId: text("target_user_id"),
    generation: text("generation"),
    channelName: text("channel_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.canonNick, table.channelName] })],
);

export const knownChannels = sqliteTable("known_channels", {
  canonicalChannel: text("canonical_channel").primaryKey(),
  channelName: text("channel_name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const directMessages = sqliteTable(
  "direct_messages",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    peerPair: text("peer_pair").notNull(),
    conversationId: text("conversation_id").references(() => conversations.id),
    senderId: text("sender_id").notNull(),
    senderAccount: text("sender_account"),
    senderNick: text("sender_nick").notNull(),
    senderUser: text("sender_user").notNull(),
    senderHost: text("sender_host").notNull(),
    targetNick: text("target_nick").notNull(),
    targetAccount: text("target_account"),
    targetId: text("target_id"),
    expiresAt: integer("expires_at"),
    multilineJson: text("multiline_json"),
    command: text("command").notNull().default("PRIVMSG"),
    content: text("content").notNull(),
    tagsJson: text("tags_json").notNull().default("{}"),
    redacted: integer("redacted").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_dm_conversation_sequence").on(t.conversationId, t.sequence)],
);

export type DirectMessage = typeof directMessages.$inferSelect;

export const directMessageEdits = sqliteTable("direct_message_edits", {
  messageId: text("message_id")
    .primaryKey()
    .references(() => directMessages.id, { onDelete: "cascade" }),
  rootId: text("root_id")
    .notNull()
    .references(() => directMessages.id, { onDelete: "cascade" }),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey().notNull(),
  pairKey: text("pair_key").unique().notNull(),
  kind: text("kind").notNull().default("direct"),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
export const conversationMembers = sqliteTable(
  "conversation_members",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    readSequence: integer("read_sequence").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.accountId] }),
    index("idx_conversation_member_account").on(t.accountId, t.conversationId),
  ],
);
export const featureOperations = sqliteTable(
  "feature_operations",
  {
    actorId: text("actor_id").notNull(),
    operationId: text("operation_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    resultJson: text("result_json").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.operationId] }),
    index("idx_feature_operation_expiry").on(t.expiresAt),
  ],
);
export const eventJournal = sqliteTable(
  "event_journal",
  {
    journalSequence: integer("journal_sequence").primaryKey({ autoIncrement: true }).notNull(),
    eventId: text("event_id").unique().notNull(),
    audienceRequired: integer("audience_required").notNull().default(0),
    livePublic: integer("live_public").notNull().default(0),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    generation: text("generation"),
    ownerId: text("owner_id"),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_event_journal_resource").on(t.resourceKind, t.resourceId, t.journalSequence)],
);
export const eventCursors = sqliteTable(
  "event_cursors",
  {
    token: text("token").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    journalSequence: integer("journal_sequence").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_event_cursor_expiry").on(t.expiresAt)],
);
export const eventJournalState = sqliteTable("event_journal_state", {
  key: text("key").primaryKey().notNull(),
  value: integer("value").notNull(),
});

export const eventAudience = sqliteTable(
  "event_audience",
  { eventId: text("event_id").notNull(), accountId: text("account_id").notNull() },
  (t) => [primaryKey({ columns: [t.eventId, t.accountId] })],
);
export const eventPushIntents = sqliteTable(
  "event_push_intents",
  {
    eventId: text("event_id").notNull(),
    accountId: text("account_id").notNull(),
    accepted: integer("accepted").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.accountId] })],
);

export const eventSubscriptions = sqliteTable(
  "event_subscriptions",
  {
    accountId: text("account_id").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    resourceId: text("resource_id").notNull(),
    generation: text("generation").notNull(),
    expiresAt: integer("expires_at").notNull(),
    registered: integer("registered").notNull().default(0),
    revision: integer("revision"),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.resourceId, t.generation] })],
);

export const eventSubscriptionPreferences = sqliteTable("event_subscription_preferences", {
  accountId: text("account_id").primaryKey().notNull(),
  subscriptionsJson: text("subscriptions_json").notNull(),
});

export const bootstrapPages = sqliteTable(
  "bootstrap_pages",
  {
    token: text("token").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    scanAfter: text("scan_after").notNull(),
    recoveryCursor: text("recovery_cursor").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_bootstrap_page_expiry").on(t.expiresAt)],
);

export const eventConnectionLeases = sqliteTable(
  "event_connection_leases",
  {
    leaseId: text("lease_id").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    sourceJson: text("source_json").notNull(),
    shard: integer("shard").notNull(),
    protocol: integer("protocol").notNull(),
    cursor: text("cursor").notNull(),
    pendingCursor: text("pending_cursor"),
    subscriptionsJson: text("subscriptions_json"),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_event_lease_account").on(t.accountId, t.expiresAt)],
);
export const eventShardHints = sqliteTable("event_shard_hints", {
  shard: integer("shard").primaryKey().notNull(),
  revision: integer("revision").notNull(),
});
export const sessionTopology = sqliteTable("session_topology", {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull(),
});

export const eventEdgeAdmissions = sqliteTable("event_edge_admissions", {
  leaseId: text("lease_id").primaryKey().notNull(),
  expiresAt: integer("expires_at").notNull(),
});
