import { DatabaseSync } from "node:sqlite";
import * as accounts from "../../server/storage/schemas/accounts";
import * as channels from "../../server/storage/schemas/channels";
import * as sessions from "../../server/storage/schemas/session";
import { compareSchema } from "./compare";
import { normalizeExpression } from "./expressions";

export const schemaDomains = [
  { domain: "accounts", sentinel: "users", models: accounts },
  { domain: "channel", sentinel: "channel_metadata", models: channels },
  { domain: "session", sentinel: "session_state", models: sessions },
] as const;
export type SchemaDomain = (typeof schemaDomains)[number]["domain"];

const FTS_DEFINITION =
  "CREATE VIRTUAL TABLE messages_fts USING fts5(message_id UNINDEXED,sender_nick UNINDEXED,content)";

/** Verify provider-managed FTS layout separately from the ORM's ordinary tables. */
export function compareDomainSchema(db: DatabaseSync, domain: SchemaDomain) {
  const definition = schemaDomains.find((item) => item.domain === domain)!;
  const names = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
    .all()
    .map((row) => String(row.name));
  const providerTables = names.filter(
    (name) => name.toLowerCase().startsWith("_cf_") || name === "__cf_kv",
  );
  const expected: Array<{ name: string; sql: string }> = [];
  if (domain === "channel") {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec(FTS_DEFINITION);
      expected.push(
        ...(reference
          .prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name")
          .all() as Array<{ name: string; sql: string }>),
      );
    } finally {
      reference.close();
    }
  }
  const report = compareSchema(db, definition.models, [
    ...providerTables,
    ...expected.map((table) => table.name),
  ]);
  for (const table of expected) {
    const actual = db
      .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
      .get(table.name);
    const normalized = actual ? normalizeExpression(String(actual.sql), table.name) : null;
    const desired = normalizeExpression(table.sql, table.name);
    if (normalized !== desired)
      report.differences.push({
        table: table.name,
        property: "managedFtsSchema",
        expected: desired,
        actual: normalized,
      });
  }
  report.status = report.differences.length || report.unmodeledTables.length ? "FAIL" : "PASS";
  return {
    ...report,
    managedFtsTables: expected.map((table) => table.name),
    providerTables,
    scope:
      "Application schema and exact FTS table layouts; reserved provider tables listed, never read or compared as application data",
  };
}
