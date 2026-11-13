import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { migratePrimaryKeyNullability } from "./primary-nullability";

export const PRIMARY_KEY_SCHEMA_VERSION = 1000;

export function initializePrimaryKeyIntegrity(
  storage: DurableObjectStorage,
  models: Record<string, unknown>,
  env: { SQLITE_MIGRATION_MAX_BYTES?: string; SQLITE_MIGRATION_MAX_ROWS?: string },
): void {
  if (
    storage.sql
      .exec("SELECT 1 FROM schema_migrations WHERE version = ?", PRIMARY_KEY_SCHEMA_VERSION)
      .toArray().length
  )
    return;
  const positive = (raw: string | undefined, fallback: number) => {
    const value = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  const result = migratePrimaryKeyNullability(storage, {
    version: PRIMARY_KEY_SCHEMA_VERSION,
    tables: Object.values(models)
      .filter((model) => is(model, SQLiteTable))
      .map((model) => getTableConfig(model).name),
    maxDatabaseBytes: positive(env.SQLITE_MIGRATION_MAX_BYTES, 32 * 1024 * 1024),
    maxRows: positive(env.SQLITE_MIGRATION_MAX_ROWS, 100000),
  });
  // A fresh schema may already satisfy the invariant. Record its checked version
  // once; a failed migration throws before reaching this statement.
  if (!result.changed.length)
    storage.sql.exec(
      "INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)",
      PRIMARY_KEY_SCHEMA_VERSION,
      Date.now(),
    );
}
