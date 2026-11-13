import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// These are existing runtime bookkeeping tables, not new authorization features.
export { schemaMigrations as accountSchemaMigrations } from "./common";
export const securitySettings = sqliteTable("security_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export const requestLimits = sqliteTable("request_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: integer("reset_at").notNull(),
});
export const accountTombstones = sqliteTable("account_tombstones", {
  canonicalUsername: text("canonical_username").primaryKey(),
  userId: text("user_id"),
});
