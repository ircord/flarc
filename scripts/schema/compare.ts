import type { DatabaseSync } from "node:sqlite";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from "drizzle-orm/sqlite-core";
import { checkExpressions, normalizeExpression } from "./expressions";

export type SchemaDifference = {
  table: string;
  property: string;
  expected: unknown;
  actual: unknown;
};
export type SchemaComparison = {
  status: "PASS" | "FAIL";
  tables: string[];
  differences: SchemaDifference[];
  unmodeledTables: string[];
  additionalIndexes: { table: string; name: string; unique: boolean; partial: boolean }[];
};

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const dialect = new SQLiteSyncDialect();
function defaultValue(value: unknown, sql = false): unknown {
  if (value === undefined || value === null) return null;
  if (is(value, SQL)) return defaultValue(dialect.sqlToQuery(value).sql, true);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (!sql) return String(value);
  let text = String(value).trim();
  while (/^\([^()]*\)$/.test(text)) text = text.slice(1, -1).trim();
  return text.startsWith("'") && text.endsWith("'")
    ? text.slice(1, -1).replaceAll("''", "'")
    : text;
}

/** Metadata-only comparison; never queries application rows or changes schema. */
export function compareSchema(
  db: DatabaseSync,
  models: Record<string, unknown>,
  bookkeeping: readonly string[] = [],
): SchemaComparison {
  const tables = Object.values(models).filter((model) => is(model, SQLiteTable));
  const result: SchemaComparison = {
    status: "PASS",
    tables: [],
    differences: [],
    unmodeledTables: [],
    additionalIndexes: [],
  };
  const compare = (table: string, property: string, expected: unknown, actual: unknown) => {
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      result.differences.push({ table, property, expected, actual });
  };
  const actualTables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)!='sqlite_'")
    .all()
    .map((row) => String(row.name));
  const names = new Set(tables.map((table) => getTableConfig(table).name));
  result.unmodeledTables = actualTables
    .filter((name) => !names.has(name) && !bookkeeping.includes(name))
    .sort();

  for (const model of tables) {
    const config = getTableConfig(model);
    const name = config.name;
    result.tables.push(name);
    if (!actualTables.includes(name)) {
      compare(name, "exists", true, false);
      continue;
    }
    const columns = db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all();
    compare(
      name,
      "columns",
      config.columns.map((column) => column.name).sort(),
      columns.map((column) => String(column.name)).sort(),
    );
    const primary = config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name));
    if (!primary.length)
      primary.push(...config.columns.filter((c) => c.primary).map((c) => c.name));
    compare(
      name,
      "primaryKey",
      primary,
      columns
        .filter((column) => column.pk)
        .sort((a, b) => Number(a.pk) - Number(b.pk))
        .map((c) => c.name),
    );
    const indexes = db
      .prepare(`PRAGMA index_list(${quote(name)})`)
      .all()
      .map((index) => ({
        name: String(index.name),
        unique: Boolean(index.unique),
        partial: Boolean(index.partial),
        origin: String(index.origin),
        columns: db
          .prepare(`PRAGMA index_info(${quote(String(index.name))})`)
          .all()
          .sort((a, b) => Number(a.seqno) - Number(b.seqno))
          .map((c) => c.name),
      }));
    for (const column of config.columns) {
      const actual = columns.find((entry) => entry.name === column.name);
      if (!actual) continue;
      compare(
        name,
        `${column.name}.type`,
        column.getSQLType().toUpperCase(),
        String(actual.type).toUpperCase(),
      );
      // INTEGER PRIMARY KEY without a separate PK index aliases the rowid and
      // cannot store NULL even though table_xinfo reports notnull=0.
      const rowid =
        primary.length === 1 &&
        primary[0] === column.name &&
        String(actual.type).toUpperCase() === "INTEGER" &&
        !indexes.some((index) => index.origin === "pk");
      compare(name, `${column.name}.notNull`, column.notNull, Boolean(actual.notnull) || rowid);
      compare(
        name,
        `${column.name}.default`,
        defaultValue(column.default),
        defaultValue(actual.dflt_value, true),
      );
    }
    const expectedUnique = [
      ...config.columns.filter((c) => c.isUnique).map((c) => [c.name]),
      ...config.uniqueConstraints.map((constraint) => constraint.columns.map((c) => c.name)),
    ];
    for (const columns of expectedUnique) {
      compare(
        name,
        `unique(${columns.join(",")})`,
        true,
        indexes.some(
          (index) =>
            index.unique &&
            !index.partial &&
            JSON.stringify(index.columns) === JSON.stringify(columns),
        ),
      );
    }
    for (const index of config.indexes) {
      const actual = indexes.find((entry) => entry.name === index.config.name);
      compare(
        name,
        `index.${index.config.name}`,
        {
          unique: index.config.unique,
          partial: Boolean(index.config.where),
          columns: index.config.columns.map((column) =>
            "name" in column ? column.name : "<expression>",
          ),
        },
        actual ? { unique: actual.unique, partial: actual.partial, columns: actual.columns } : null,
      );
      if (index.config.where || index.config.columns.some((column) => !("name" in column)))
        compare(name, `index.${index.config.name}.expressionVerified`, true, false);
    }
    for (const index of indexes.filter((entry) => entry.origin !== "pk")) {
      if (config.indexes.some((entry) => entry.config.name === index.name)) continue;
      if (
        expectedUnique.some(
          (columns) =>
            index.unique &&
            !index.partial &&
            JSON.stringify(columns) === JSON.stringify(index.columns),
        )
      )
        continue;
      result.additionalIndexes.push({
        table: name,
        name: index.name,
        unique: index.unique,
        partial: index.partial,
      });
      if (index.unique) compare(name, `index.${index.name}.declaredUniqueConstraint`, true, false);
    }
    const expectedForeign = config.foreignKeys.map((key) => {
      const reference = key.reference();
      return {
        table: getTableConfig(reference.foreignTable).name,
        from: reference.columns.map((column) => column.name),
        to: reference.foreignColumns.map((column) => column.name),
        onDelete: (key.onDelete ?? "no action").toUpperCase(),
        onUpdate: (key.onUpdate ?? "no action").toUpperCase(),
      };
    });
    const foreign = db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all();
    const actualForeign = [...new Set(foreign.map((row) => row.id))].map((id) => {
      const group = foreign
        .filter((row) => row.id === id)
        .sort((a, b) => Number(a.seq) - Number(b.seq));
      return {
        table: group[0].table,
        from: group.map((r) => r.from),
        to: group.map((r) => r.to),
        onDelete: group[0].on_delete,
        onUpdate: group[0].on_update,
      };
    });
    const sort = (items: unknown[]) => items.map((item) => JSON.stringify(item)).sort();
    compare(name, "foreignKeys", sort(expectedForeign), sort(actualForeign));
    const definition = db
      .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
      .get(name);
    compare(
      name,
      "checks",
      config.checks
        .map((check) => normalizeExpression(dialect.sqlToQuery(check.value).sql, name))
        .sort(),
      checkExpressions(String(definition?.sql), name),
    );
  }
  result.tables.sort();
  result.status = result.differences.length || result.unmodeledTables.length ? "FAIL" : "PASS";
  return result;
}
