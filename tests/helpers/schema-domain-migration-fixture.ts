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
import * as channelSchema from "../../server/storage/schemas/channels";
import * as sessionSchema from "../../server/storage/schemas/session";
import { ensureNitroBuilt } from "./miniflare-harness";

const names = (schema: object) => Object.values(schema).map((table) => getTableConfig(table).name);
export const channelTables = [...names(channelSchema), "schema_migrations"];
export const sessionTables = [...names(sessionSchema), "schema_migrations", "whowas_history"];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const operation = () => `${Date.now()}.${randomUUID()}`;
export type Actor = { username: string; password: string; token: string; account: { id: string } };

export async function domainMigrationFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flarc-domain-migration-"));
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
import app, {ChannelDO as Channel, SessionDO as Session} from './production/index.mjs';
import {migratePrimaryKeyNullability} from './migration.mjs';
export {AccountsDO} from './production/index.mjs';
function run(ctx, options) {
 try { return { result:migratePrimaryKeyNullability({transactionSync:fn=>ctx.storage.transactionSync(fn),sql:{databaseSize:ctx.storage.sql.databaseSize,exec:(query,...args)=>{try{return ctx.storage.sql.exec(query,...args)}catch(e){throw new Error(query+': '+e.message)}}}}, {...options,checkpoint(stage){if(stage===options.fault)throw new Error('injected migration failure: '+stage)}}) }; }
 catch(e){return {error:e.message};}
}
export class ChannelDO extends Channel {
  // Pin only this test fixture at the pre-repair schema. Authentication and all
  // domain operations remain production code; the explicit migration is tested below.
  constructor(ctx,env) {
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO schema_migrations VALUES(1000,0)');
    super(ctx,env);
  }
  domainMigration(options){return run(this.ctx,options)}
  domainDependency(create){this.ctx.storage.sql.exec(create ? 'CREATE TABLE unknown_dependency(id TEXT REFERENCES messages(id))' : 'DROP TABLE unknown_dependency')}
}
export class SessionDO extends Session {
  // Pin only this test fixture at the pre-repair schema. Authentication and all
  // domain operations remain production code; the explicit migration is tested below.
  constructor(ctx,env) {
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO schema_migrations VALUES(1000,0)');
    super(ctx,env);
  }
  domainMigration(options){return run(this.ctx,options)}
  domainDependency(create){this.ctx.storage.sql.exec(create ? 'CREATE TABLE unknown_dependency(id TEXT REFERENCES session_state(session_id))' : 'DROP TABLE unknown_dependency')}
}
export default app;
`,
  );
  let runtime: { mf: Miniflare; origin: URL } | undefined;
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
    runtime = { mf, origin: await mf.ready };
  }
  async function stop() {
    if (runtime) {
      await runtime.mf.dispose();
      runtime = undefined;
    }
  }
  await start();
  const request = (route: string, actor?: Actor, method = "GET", body?: unknown) =>
    fetch(new URL(route, runtime!.origin), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function actor(username: string): Promise<Actor> {
    const password = `Secret-${randomUUID()}!`;
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
  async function migrate(domain: "channel" | "session", options: object) {
    const ns = await runtime!.mf.getDurableObjectNamespace(
      domain === "channel" ? "CHANNELS" : "SESSION",
    );
    const stub = ns.get(ns.idFromName(domain === "channel" ? "FlaRC:#migration" : "FlaRC")) as any;
    return JSON.parse(JSON.stringify(await stub.domainMigration(options))) as {
      result?: { changed: string[]; preserved: string[]; rows: number };
      error?: string;
    };
  }
  async function dependency(domain: "channel" | "session", create: boolean) {
    const ns = await runtime!.mf.getDurableObjectNamespace(
      domain === "channel" ? "CHANNELS" : "SESSION",
    );
    const stub = ns.get(ns.idFromName(domain === "channel" ? "FlaRC:#migration" : "FlaRC")) as any;
    await stub.domainDependency(create);
  }
  async function snapshot(domain: "channel" | "session") {
    await stop();
    async function files(folder: string): Promise<string[]> {
      const result: string[] = [];
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) result.push(...(await files(file)));
        else if (entry.name.endsWith(".sqlite")) result.push(file);
      }
      return result;
    }
    let snapshot:
      | {
          data: Record<string, string>;
          counts: Record<string, number>;
          schema: { name: string; sql: string }[];
          objects: unknown[];
          fk: unknown[];
          modeled: string[];
          unmodeled: string[];
          provider: Record<string, { sql: string; hash: string }>;
          modelDiff: Array<{
            table: string;
            modelOnly: string[];
            databaseOnly: string[];
            nullability: string[];
          }>;
        }
      | undefined;
    for (const file of await files(path.join(dir, "do"))) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const marker = domain === "channel" ? "channel_metadata" : "session_state";
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(marker))
          continue;
        const tables = db
          .prepare(
            "SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string; sql: string }[];
        const allowed = new Set(domain === "channel" ? channelTables : sessionTables);
        const modelConfigs = Object.values(
          domain === "channel" ? channelSchema : sessionSchema,
        ).map((table) => getTableConfig(table));
        const providerTables = db
          .prepare(
            "SELECT name,sql FROM sqlite_schema WHERE type='table' AND (lower(name) GLOB '_cf_*' OR name='__cf_kv') ORDER BY name",
          )
          .all() as { name: string; sql: string }[];
        const providerHash = (name: string) => {
          const statement = db.prepare(`SELECT * FROM ${quote(name)}`);
          statement.setReadBigInts(true);
          const rows = statement
            .all()
            .map((row) =>
              JSON.stringify(row, (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
              ),
            )
            .sort();
          return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
        };
        snapshot = {
          schema: tables,
          modelDiff: tables.flatMap(({ name }) => {
            const model = modelConfigs.find((item) => item.name === name);
            if (!model) return [];
            const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as {
              name: string;
              notnull: number;
              pk: number;
              type: string;
            }[];
            const modelOnly = model.columns
              .filter((column) => !columns.some((actual) => actual.name === column.name))
              .map((column) => column.name);
            const databaseOnly = columns
              .filter((column) => !model.columns.some((declared) => declared.name === column.name))
              .map((column) => column.name);
            const nullability = model.columns.flatMap((column) => {
              const actual = columns.find((item) => item.name === column.name);
              if (!actual) return [];
              const integerPrimaryAlias =
                actual.pk === 1 &&
                actual.type.toUpperCase() === "INTEGER" &&
                columns.filter((item) => item.pk).length === 1;
              return Boolean(column.notNull) !== Boolean(actual.notnull || integerPrimaryAlias)
                ? [column.name]
                : [];
            });
            return modelOnly.length || databaseOnly.length || nullability.length
              ? [{ table: name, modelOnly, databaseOnly, nullability }]
              : [];
          }),
          provider: Object.fromEntries(
            providerTables.map(({ name, sql }) => [
              name,
              {
                sql,
                hash: providerHash(name),
              },
            ]),
          ),
          counts: Object.fromEntries(
            tables
              .filter((t) => t.name !== "schema_migrations")
              .map(({ name }) => [
                name,
                Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get()!.n),
              ]),
          ),
          data: Object.fromEntries(
            tables
              .filter((t) => t.name !== "schema_migrations")
              .map(({ name, sql }) => [
                name,
                createHash("sha256")
                  .update(
                    JSON.stringify(
                      /WITHOUT\s+ROWID/i.test(sql)
                        ? db
                            .prepare(`SELECT * FROM ${quote(name)}`)
                            .all()
                            .map((row) => JSON.stringify(row))
                            .sort()
                        : db.prepare(`SELECT rowid,* FROM ${quote(name)} ORDER BY rowid`).all(),
                    ),
                  )
                  .digest("hex"),
              ]),
          ),
          objects: db
            .prepare(
              "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') AND sql IS NOT NULL AND name NOT LIKE '_cf_%' ORDER BY name",
            )
            .all(),
          fk: db.prepare("PRAGMA foreign_key_check").all(),
          modeled: tables.filter((t) => allowed.has(t.name)).map((t) => t.name),
          unmodeled: tables.filter((t) => !allowed.has(t.name)).map((t) => t.name),
        };
      } finally {
        db.close();
      }
      if (snapshot) break;
    }
    await start();
    if (!snapshot) throw new Error(`No ${domain} database`);
    return snapshot;
  }
  return {
    request,
    actor,
    migrate,
    dependency,
    snapshot,
    stop,
    start,
    async close() {
      await stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
