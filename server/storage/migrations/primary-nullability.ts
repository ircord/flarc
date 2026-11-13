/**
 * Repair SQLite's legacy nullable non-integer primary keys without disabling FKs.
 * Only operator-approved application tables may be rebuilt. The complete dependent
 * graph is staged in SQLite, not JavaScript, in the same rollbackable transaction.
 */
export type PrimaryKeyMigrationOptions = {
  tables: readonly string[];
  version: number;
  maxRows?: number;
  maxDatabaseBytes?: number;
  checkpoint?: (stage: "staged" | "dropped" | "restored") => void;
};

type Column = { name: string; type: string; notnull: number; pk: number; hidden: number };
type Table = {
  name: string;
  ddl: string;
  columns: Column[];
  parents: string[];
  nullable: string[];
  rowid: string;
};
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Split CREATE TABLE column clauses while retaining every original SQL token. */
function clauses(ddl: string): { start: number; end: number; values: string[] } {
  let depth = 0;
  let start = -1;
  let mark = -1;
  const values: string[] = [];
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let terminated = false;
      while (++i < ddl.length) {
        if (ddl[i] !== close) continue;
        if (ch !== "[" && ddl[i + 1] === close) i++;
        else {
          terminated = true;
          break;
        }
      }
      if (!terminated) throw new Error("Unsupported unterminated schema token");
    } else if (ch === "-" && ddl[i + 1] === "-") {
      while (i < ddl.length && ddl[i] !== "\n") i++;
    } else if (ch === "/" && ddl[i + 1] === "*") {
      const end = ddl.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unsupported unterminated schema comment");
      i = end + 1;
    } else if (ch === "(") {
      if (depth++ === 0) start = mark = i + 1;
    } else if (ch === ")") {
      if (--depth === 0) {
        values.push(ddl.slice(mark, i));
        return { start, end: i, values };
      }
      if (depth < 0) break;
    } else if (ch === "," && depth === 1) {
      values.push(ddl.slice(mark, i));
      mark = i + 1;
    }
  }
  throw new Error("Unsupported CREATE TABLE layout");
}

function requirePrimaryKeys(ddl: string, names: string[]): string {
  const parts = clauses(ddl);
  const pending = new Set(names.map((name) => name.toLowerCase()));
  const updated = parts.values.map((part) => {
    const prefix = part.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");
    const token = /^(?:"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z_0-9$]*)/.exec(
      prefix,
    )?.[0];
    if (!token) throw new Error("Unsupported column declaration");
    const name = (
      /^["`[]/.test(token) ? token.slice(1, -1).replaceAll('""', '"').replaceAll("``", "`") : token
    ).toLowerCase();
    if (!pending.delete(name)) return part;
    return `${part}\n NOT NULL`;
  });
  if (pending.size) throw new Error("Could not identify primary key declarations");
  return ddl.slice(0, parts.start) + updated.join(",") + ddl.slice(parts.end);
}

export function migratePrimaryKeyNullability(
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync">,
  options: PrimaryKeyMigrationOptions,
): { changed: string[]; preserved: string[]; rows: number } {
  if (!Number.isSafeInteger(options.version) || options.version <= 0)
    throw new Error("Invalid migration version");
  const sql = storage.sql;
  return storage.transactionSync(() => {
    const allowed = new Set(options.tables);
    const definitions = sql
      .exec<{ name: string; sql: string }>(
        "SELECT name,sql FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL ORDER BY name",
      )
      .toArray()
      // workerd reserves this prefix for alarm/KV metadata and forbids even
      // PRAGMA introspection of it. Never rebuild or inspect provider tables.
      // Application dependencies, including unknown tables, remain checked below.
      .filter(({ name }) => !name.toLowerCase().startsWith("_cf_") && name !== "__cf_kv");
    const actualNames = new Map(definitions.map((table) => [table.name.toLowerCase(), table.name]));
    const resolveParent = (name: string) => actualNames.get(name.toLowerCase()) ?? name;
    const tables = new Map<string, Table>();
    for (const definition of definitions) {
      if (!allowed.has(definition.name)) continue;
      if (!/^CREATE TABLE\b/i.test(definition.sql) || /\bWITHOUT\s+ROWID\b/i.test(definition.sql))
        throw new Error(`Unsupported table layout: ${definition.name}`);
      const columns = sql.exec<Column>(`PRAGMA table_xinfo(${quote(definition.name)})`).toArray();
      if (columns.some((column) => column.hidden))
        throw new Error(`Generated columns require a dedicated migration: ${definition.name}`);
      if (columns.some((column) => column.name.toLowerCase() === "__saved_rowid"))
        throw new Error(`Reserved staging column: ${definition.name}`);
      const indexes = sql
        .exec<{ origin: string }>(`PRAGMA index_list(${quote(definition.name)})`)
        .toArray();
      const primary = columns.filter((column) => column.pk);
      const integerAlias =
        primary.length === 1 &&
        primary[0].type.toUpperCase() === "INTEGER" &&
        !indexes.some((index) => index.origin === "pk");
      const rowid = ["rowid", "_rowid_", "oid"].find(
        (alias) => !columns.some((column) => column.name.toLowerCase() === alias),
      );
      if (!rowid) throw new Error(`Shadowed row identity: ${definition.name}`);
      tables.set(definition.name, {
        name: definition.name,
        ddl: definition.sql,
        columns,
        rowid,
        nullable: primary.filter((column) => !column.notnull && !integerAlias).map((c) => c.name),
        parents: sql
          .exec<{ table: string }>(`PRAGMA foreign_key_list(${quote(definition.name)})`)
          .toArray()
          .map((fk) => resolveParent(fk.table)),
      });
    }
    const changed = [...tables.values()].filter((table) => table.nullable.length);
    if (!changed.length) return { changed: [], preserved: [], rows: 0 };
    const selected = new Set(changed.map((table) => table.name));
    // Unknown dependent tables cannot be silently dropped by ON DELETE CASCADE.
    const dependencies = definitions.map(({ name }) => ({
      name,
      parents: sql
        .exec<{ table: string }>(`PRAGMA foreign_key_list(${quote(name)})`)
        .toArray()
        .map((fk) => resolveParent(fk.table)),
    }));
    for (let size = -1; size !== selected.size; ) {
      size = selected.size;
      for (const table of dependencies) {
        if (!table.parents.some((parent) => selected.has(parent))) continue;
        if (!tables.has(table.name)) throw new Error(`Unapproved dependent table: ${table.name}`);
        selected.add(table.name);
      }
    }
    const ordered: Table[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function visit(name: string) {
      if (visited.has(name)) return;
      if (visiting.has(name))
        throw new Error(`Cyclic foreign keys require dedicated migration: ${name}`);
      visiting.add(name);
      const table = tables.get(name)!;
      for (const parent of table.parents) if (selected.has(parent)) visit(parent);
      visiting.delete(name);
      visited.add(name);
      ordered.push(table);
    }
    for (const name of selected) visit(name);
    if (sql.databaseSize > (options.maxDatabaseBytes ?? 32 * 1024 * 1024))
      throw new Error("Primary key migration requires offline maintenance: database size limit");
    let rows = 0;
    for (const table of ordered) {
      rows += sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quote(table.name)}`)
        .toArray()[0].n;
      if (rows > (options.maxRows ?? 100000))
        throw new Error("Primary key migration requires offline maintenance: row limit");
      if (
        table.nullable.length &&
        sql
          .exec(
            `SELECT 1 FROM ${quote(table.name)} WHERE ${table.nullable.map((name) => `${quote(name)} IS NULL`).join(" OR ")} LIMIT 1`,
          )
          .toArray().length
      )
        throw new Error(`Legacy NULL primary key requires repair: ${table.name}`);
    }
    if (sql.exec("PRAGMA foreign_key_check").toArray().length)
      throw new Error("Legacy foreign key violations require repair");
    const schema = sql
      .exec<{ type: string; name: string; tbl_name: string; sql: string }>(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name",
      )
      .toArray()
      .filter((item) => selected.has(item.tbl_name));
    const sequences = definitions.some((table) => table.name === "sqlite_sequence")
      ? sql
          .exec<{ name: string; seq: number }>("SELECT name,seq FROM sqlite_sequence")
          .toArray()
          .filter((sequence) => selected.has(sequence.name))
      : [];
    const backups = new Map<string, string>();
    for (let i = 0; i < ordered.length; i++) {
      const table = ordered[i];
      const backup = `__flarc_pk_stage_${options.version}_${i}`;
      // Never overwrite a preexisting table, even one that resembles a staging name.
      sql.exec(
        `CREATE TABLE ${quote(backup)} AS SELECT ${table.rowid} AS "__saved_rowid", * FROM ${quote(table.name)}`,
      );
      backups.set(table.name, backup);
    }
    options.checkpoint?.("staged");
    for (const table of [...ordered].reverse()) sql.exec(`DROP TABLE ${quote(table.name)}`);
    options.checkpoint?.("dropped");
    for (const table of ordered) sql.exec(requirePrimaryKeys(table.ddl, table.nullable));
    // Parent uniqueness may be declared by an external index referenced by an FK.
    for (const item of schema) if (item.type === "index") sql.exec(item.sql);
    for (const table of ordered) {
      const columns = table.columns.map((column) => quote(column.name)).join(",");
      const backup = quote(backups.get(table.name)!);
      sql.exec(
        `INSERT INTO ${quote(table.name)} (${table.rowid},${columns}) SELECT "__saved_rowid",${columns} FROM ${backup}`,
      );
      const current = `SELECT ${table.rowid},${columns} FROM ${quote(table.name)}`;
      const previous = `SELECT "__saved_rowid",${columns} FROM ${backup}`;
      if (
        sql.exec(`SELECT 1 FROM (${current} EXCEPT ${previous}) LIMIT 1`).toArray().length ||
        sql.exec(`SELECT 1 FROM (${previous} EXCEPT ${current}) LIMIT 1`).toArray().length
      )
        throw new Error(`Restored data mismatch: ${table.name}`);
    }
    for (const sequence of sequences) {
      sql.exec("DELETE FROM sqlite_sequence WHERE name = ?", sequence.name);
      sql.exec("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)", sequence.name, sequence.seq);
    }
    for (const item of schema) if (item.type === "trigger") sql.exec(item.sql);
    options.checkpoint?.("restored");
    if (sql.exec("PRAGMA foreign_key_check").toArray().length)
      throw new Error("Restored foreign key validation failed");
    for (const backup of backups.values()) sql.exec(`DROP TABLE ${quote(backup)}`);
    sql.exec(
      "INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)",
      options.version,
      Date.now(),
    );
    return {
      changed: changed.map((table) => table.name),
      preserved: ordered.map((table) => table.name),
      rows,
    };
  });
}
