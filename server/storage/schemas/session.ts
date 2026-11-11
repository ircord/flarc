import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const directMessages = sqliteTable("direct_messages", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  peerPair: text("peer_pair").notNull(),
  senderId: text("sender_id").notNull(),
  senderAccount: text("sender_account"),
  senderNick: text("sender_nick").notNull(),
  senderUser: text("sender_user").notNull(),
  senderHost: text("sender_host").notNull(),
  targetNick: text("target_nick").notNull(),
  targetAccount: text("target_account"),
  command: text("command").notNull().default("PRIVMSG"),
  content: text("content").notNull(),
  tagsJson: text("tags_json").notNull().default("{}"),
  redacted: integer("redacted").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export type DirectMessage = typeof directMessages.$inferSelect;
