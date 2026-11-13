import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { Miniflare } from "miniflare";
import { expect } from "vitest";
import * as accounts from "../../server/storage/schemas/accounts";
import * as operational from "../../server/storage/schemas/accounts-operational";
import { ensureNitroBuilt } from "./miniflare-harness";

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const accountMigrationTables = [
  ...Object.values({ ...accounts, ...operational }).map((table) => getTableConfig(table).name),
  "channel_notifications",
  "migration_probe",
  "migration_probe_audit",
];

export async function schemaMigrationFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flarc-schema-migration-"));
  await cp(path.dirname(await ensureNitroBuilt()), path.join(dir, "production"), {
    recursive: true,
  });
  await promisify(execFile)("bun", [
    "build",
    path.resolve("server/storage/migrations/primary-nullability.ts"),
    "--target=browser",
    `--outfile=${path.join(dir, "migration.mjs")}`,
  ]);
  await writeFile(
    path.join(dir, "wrapper.mjs"),
    `
import app, {AccountsDO as Accounts} from './production/index.mjs';
import {migratePrimaryKeyNullability} from './migration.mjs';
export {SessionDO,ChannelDO} from './production/index.mjs';
export class AccountsDO extends Accounts {
  // Pin only this test fixture at the pre-repair schema. Authentication and all
  // domain operations remain production code; the explicit migration is tested below.
  constructor(ctx,env) {
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO schema_migrations VALUES(1000,0)');
    super(ctx,env);
  }
  migrationRun(options) {
    try { return {result:migratePrimaryKeyNullability({transactionSync: fn=>this.ctx.storage.transactionSync(fn), sql:{databaseSize:this.ctx.storage.sql.databaseSize,exec:(query,...args)=>{try{return this.ctx.storage.sql.exec(query,...args);}catch(e){throw new Error(query+": "+e.message);}}}}, {
      ...options, checkpoint(stage) {if(stage === options.fault) throw new Error('injected migration failure: '+stage);}
    })}; } catch (error) { return {error: error.message}; }
  }
  migrationPrepare(id) {
    const sql=this.ctx.storage.sql;
    sql.exec('CREATE TABLE migration_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL REFERENCES UsErS(id) ON DELETE CASCADE, value TEXT CHECK(length(value)>0))');
    sql.exec('CREATE TABLE migration_probe_audit (message TEXT NOT NULL)');
    sql.exec('CREATE INDEX migration_probe_owner ON migration_probe(owner)');
    sql.exec("CREATE TRIGGER migration_probe_insert AFTER INSERT ON migration_probe BEGIN INSERT INTO migration_probe_audit VALUES ('insert'); END");
    sql.exec('INSERT INTO migration_probe(id,owner,value) VALUES(41,?,?)',id,'preserve');
    sql.exec('INSERT INTO migration_probe(id,owner,value) VALUES(90,?,?)',id,'deleted-high-water');
    sql.exec('DELETE FROM migration_probe WHERE id=90');
  }
  migrationCorrupt(id) {this.ctx.storage.sql.exec('INSERT INTO registered_nicks VALUES(NULL,?,?)',id,Date.now());}
  migrationClearCorrupt() {this.ctx.storage.sql.exec('DELETE FROM registered_nicks WHERE nickname IS NULL');}
  migrationConstraintChecks(id) {
    const sql=this.ctx.storage.sql;
    const check = (query,...args)=>{try {sql.exec(query,...args);return null;} catch(e){return e.message;}};
    return {
      nullInsert:check('INSERT INTO registered_nicks VALUES(NULL,?,?)',id,Date.now()),
      nullUpdate:check('UPDATE registered_nicks SET nickname=NULL WHERE user_id=?',id),
      unique:check('INSERT INTO registered_nicks SELECT * FROM registered_nicks LIMIT 1'),
      foreignKey:check("INSERT INTO migration_probe(owner,value) VALUES ('nonexistent-account','x')"),
      checkConstraint:check("INSERT INTO migration_probe(owner,value) VALUES (?, '')",id),
      nextId:sql.exec("INSERT INTO migration_probe(owner,value) VALUES (?, 'post-migration') RETURNING id",id).toArray()[0].id,
      auditCount:sql.exec('SELECT count(*) AS n FROM migration_probe_audit').toArray()[0].n,
      fk:sql.exec('PRAGMA foreign_keys').toArray()[0].foreign_keys,
    };
  }
}
export default app;
`,
  );
  let runtime: { mf: Miniflare; origin: URL; accounts: any } | undefined;
  async function start() {
    const mf = new Miniflare({
      modules: true,
      scriptPath: path.join(dir, "wrapper.mjs"),
      modulesRoot: dir,
      compatibilityDate: "2025-02-04",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { SIGNUP_POLICY: "open" },
      durableObjectsPersist: path.join(dir, "do"),
      durableObjects: {
        SESSION: { className: "SessionDO", useSQLite: true },
        CHANNELS: { className: "ChannelDO", useSQLite: true },
        ACCOUNTS: { className: "AccountsDO", useSQLite: true },
      },
    });
    const origin = await mf.ready;
    const ns = await mf.getDurableObjectNamespace("ACCOUNTS");
    runtime = { mf, origin, accounts: ns.get(ns.idFromName("FlaRC")) };
  }
  await start();
  async function stop() {
    if (runtime) {
      await runtime.mf.dispose();
      runtime = undefined;
    }
  }
  function request(route: string, token?: string, method = "GET", body?: unknown) {
    return fetch(new URL(route, runtime!.origin), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function actor(username: string) {
    const password = `Password-${randomUUID()}!`;
    expect(
      (await request("/api/v1/auth/register", undefined, "POST", { username, password })).status,
    ).toBe(201);
    const login = await request("/api/v1/auth/login", undefined, "POST", { username, password });
    expect(login.status).toBe(200);
    return {
      username,
      password,
      ...((await login.json()) as { token: string; account: { id: string } }),
    };
  }
  async function sqlite<T>(read: (db: DatabaseSync) => T): Promise<T> {
    if (runtime) throw new Error("Independent reads require stopped workerd");
    async function files(folder: string): Promise<string[]> {
      const found: string[] = [];
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) found.push(...(await files(file)));
        else if (entry.name.endsWith(".sqlite")) found.push(file);
      }
      return found;
    }
    for (const file of await files(path.join(dir, "do"))) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='users'").get()) return read(db);
      } finally {
        db.close();
      }
    }
    throw new Error("Accounts SQLite database not found");
  }
  return {
    request,
    actor,
    stop,
    start,
    sqlite,
    get accounts() {
      const stub = runtime!.accounts;
      return Object.fromEntries(
        [
          "migrationRun",
          "migrationPrepare",
          "migrationCorrupt",
          "migrationClearCorrupt",
          "migrationConstraintChecks",
        ].map((name) => [
          name,
          async (...args: unknown[]) => {
            const value = await stub[name](...args);
            return value === undefined ? value : JSON.parse(JSON.stringify(value));
          },
        ]),
      );
    },
    async snapshot() {
      await stop();
      const result = await sqlite((db) => {
        const tables = db
          .prepare(
            "SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string; sql: string }[];
        return {
          data: Object.fromEntries(
            tables
              .filter((t) => t.name !== "schema_migrations")
              .map(({ name }) => [
                name,
                createHash("sha256")
                  .update(
                    JSON.stringify(
                      db.prepare(`SELECT rowid,* FROM ${quote(name)} ORDER BY rowid`).all(),
                    ),
                  )
                  .digest("hex"),
              ]),
          ),
          schema: tables,
          objects: db
            .prepare(
              "SELECT type,name,sql FROM sqlite_schema WHERE type IN ('index','trigger') AND sql IS NOT NULL AND name NOT LIKE '_cf_%' ORDER BY name",
            )
            .all(),
          fk: db.prepare("PRAGMA foreign_key_check").all(),
        };
      });
      await start();
      return result;
    },
    async close() {
      await stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
