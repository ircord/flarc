import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";
import { compareSchema } from "../../scripts/schema/compare";

const parents = sqliteTable("parents", {
  id: integer("id").primaryKey(),
  secret: text("secret").notNull(),
});
const links = sqliteTable(
  "links",
  {
    left: integer("left")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    right: integer("right")
      .notNull()
      .references(() => parents.id),
    kind: text("kind").notNull().default("check('secret')"),
  },
  (table) => [
    primaryKey({ columns: [table.left, table.right] }),
    index("links_kind").on(table.kind),
    check("valid_kind", sql`${table.kind} IN ('check(''secret'')', 'normal')`),
  ],
);
const schema = `
CREATE TABLE parents(id INTEGER PRIMARY KEY,secret TEXT NOT NULL);
CREATE TABLE links("left" INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  "right" INTEGER NOT NULL REFERENCES parents(id),kind TEXT NOT NULL DEFAULT 'check(''secret'')',
  PRIMARY KEY("left","right"),CHECK(kind IN('check(''secret'')','normal')));
CREATE INDEX links_kind ON links(kind);
`;

it("schema verification uses read-only SQLite metadata and preserves files and secret rows", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flarc-schema-"));
  const file = path.join(directory, "state.sqlite");
  try {
    const writer = new DatabaseSync(file);
    writer.exec(schema);
    writer.prepare("INSERT INTO parents VALUES (?,?)").run(1, "private-row-must-never-be-reported");
    writer.close();
    const digest = async () =>
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
    const before = await digest();
    const reader = new DatabaseSync(file, { readOnly: true });
    try {
      const report = compareSchema(reader, { parents, links });
      expect(report.status).toBe("PASS");
      expect(report.differences).toEqual([]);
      expect(JSON.stringify(report)).not.toContain("private-row-must-never-be-reported");
      expect(() => reader.exec("DELETE FROM parents")).toThrow();
    } finally {
      reader.close();
    }
    expect(await digest()).toBe(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("schema verification detects missing indexes, weakened CHECKs, extra unique constraints and unmodeled tables", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema.replace("CHECK(kind IN('check(''secret'')','normal'))", "CHECK(1)"));
    db.exec(
      "DROP INDEX links_kind; CREATE UNIQUE INDEX unexpected_unique ON parents(secret); CREATE TABLE invisible(id TEXT);",
    );
    const report = compareSchema(db, { parents, links });
    expect(report.status).toBe("FAIL");
    expect(report.unmodeledTables).toEqual(["invisible"]);
    expect(report.differences.map((difference) => difference.property)).toEqual(
      expect.arrayContaining([
        "index.links_kind",
        "checks",
        "index.unexpected_unique.declaredUniqueConstraint",
      ]),
    );
  } finally {
    db.close();
  }
});

it("nullable TEXT primary keys remain real differences; INTEGER rowid is not falsely flagged", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE legacy(id TEXT PRIMARY KEY); CREATE TABLE parents(id INTEGER PRIMARY KEY,secret TEXT NOT NULL)",
    );
    db.exec("INSERT INTO legacy VALUES(NULL),(NULL)");
    const legacy = sqliteTable("legacy", { id: text("id").primaryKey() });
    const report = compareSchema(db, { legacy, parents });
    expect(report.status).toBe("FAIL");
    expect(report.differences).toEqual([
      { table: "legacy", property: "id.notNull", expected: true, actual: false },
    ]);
  } finally {
    db.close();
  }
});

it("composite foreign keys are compared as ordered groups, not independent matching columns", () => {
  const db = new DatabaseSync(":memory:");
  const parent = sqliteTable("parent", { a: text("a").notNull(), b: text("b").notNull() }, (t) => [
    primaryKey({ columns: [t.a, t.b] }),
  ]);
  const child = sqliteTable("child", { a: text("a"), b: text("b") }, (t) => [
    foreignKey({ columns: [t.a, t.b], foreignColumns: [parent.a, parent.b] }),
  ]);
  try {
    db.exec(
      "CREATE TABLE parent(a TEXT NOT NULL,b TEXT NOT NULL,PRIMARY KEY(a,b)); CREATE TABLE child(a TEXT REFERENCES parent(a),b TEXT REFERENCES parent(b))",
    );
    const report = compareSchema(db, { parent, child });
    expect(report.status).toBe("FAIL");
    expect(report.differences.map((difference) => difference.property)).toEqual(["foreignKeys"]);
  } finally {
    db.close();
  }
});
