import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import {
  compareDomainSchema,
  type SchemaDomain,
  schemaDomains,
} from "../../scripts/schema/domains";
import { createMatrixFixture } from "../helpers/matrix-fixture";

async function databases(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await databases(file)));
    else if (entry.name.endsWith(".sqlite")) found.push(file);
  }
  return found;
}
function domainOf(db: DatabaseSync) {
  return schemaDomains.find(({ sentinel }) =>
    db.prepare("SELECT 1 FROM sqlite_schema WHERE name=? AND type='table'").get(sentinel),
  )?.domain;
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function rowHash(db: DatabaseSync, table: string) {
  return createHash("sha256")
    .update(JSON.stringify(db.prepare(`SELECT rowid,* FROM ${quote(table)} ORDER BY rowid`).all()))
    .digest("hex");
}

it("actual startup schemas match all Drizzle constraints and FTS layouts after genuine REST and IRC activity", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const a = await f.connect(alice),
      b = await f.connect(bob);
    for (const c of [a, b]) {
      c.send("JOIN #schema");
      await c.waitForLine((l) => l.includes(" 366 ") && l.includes("#schema"));
    }
    a.send("PRIVMSG #schema :schema-channel-state");
    await b.waitForLine((l) => l.includes("PRIVMSG #schema :schema-channel-state"));
    a.send("PRIVMSG bob :schema-private-state");
    await b.waitForLine((l) => l.includes("PRIVMSG bob :schema-private-state"));
    await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
      name: "FlaRC",
      webSockets: "hibernate",
    });
    await f.barrier(a);
    await f.barrier(b);
    a.send("PRIVMSG #schema :after-schema-hibernation");
    await b.waitForLine((l) => l.includes("PRIVMSG #schema :after-schema-hibernation"));
    await f.stop();
    const domains = new Set<SchemaDomain>();
    for (const file of await databases(f.directory)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const domain = domainOf(db);
        if (!domain) continue;
        domains.add(domain);
        const report = compareDomainSchema(db, domain);
        expect(report, `${domain} strict schema`).toMatchObject({
          status: "PASS",
          differences: [],
          unmodeledTables: [],
        });
        expect(
          db.prepare("SELECT count(*) AS n FROM schema_migrations WHERE version=1000").get()?.n,
        ).toBe(1);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        db.close();
      }
    }
    expect([...domains].sort()).toEqual(["accounts", "channel", "session"]);
  } finally {
    await f.dispose();
  }
}, 60000);

it("production constructor repairs legacy nullable keys without losing authenticated ownership, messages or dependent rows", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      outsider = await f.createActor("charlie");
    const room = "/api/v1/channels/%23upgrade";
    expect(
      (await f.request("/api/v1/channels", alice, "POST", { name: "#upgrade", privacy: "secret" }))
        .status,
    ).toBe(201);
    expect((await f.request(`${room}/join`, bob, "POST", {})).status).toBe(200);
    const messageResponse = await f.request(`${room}/messages`, alice, "POST", {
      content: "upgrade-kept-channel",
    });
    expect(messageResponse.status).toBe(201);
    const message = ((await messageResponse.json()) as any).message;
    const created = await f.request("/api/v1/conversations", alice, "POST", {
      peer: bob.account.id,
      clientOperationId: `${Date.now()}.${randomUUID()}`,
    });
    expect(created.status).toBe(200);
    const conversation = ((await created.json()) as any).conversation;
    expect(
      (
        await f.request(`/api/v1/conversations/${conversation.id}/messages`, alice, "POST", {
          content: "upgrade-kept-dm",
          clientOperationId: `${Date.now()}.${randomUUID()}`,
        })
      ).status,
    ).toBe(200);
    await f.stop();
    const proofs: Array<{
      file: string;
      domain: SchemaDomain;
      root: string;
      hashes: Record<string, string>;
    }> = [];
    for (const file of await databases(f.directory)) {
      const db = new DatabaseSync(file);
      try {
        const domain = domainOf(db);
        if (!domain) continue;
        const root =
          domain === "accounts" ? "users" : domain === "channel" ? "messages" : "session_state";
        const key = domain === "session" ? "session_id" : "id";
        const tables =
          domain === "accounts"
            ? [
                "users",
                "registered_nicks",
                "scram_credentials",
                "api_sessions",
                "api_session_details",
              ]
            : domain === "channel"
              ? ["messages", "message_edits", "channel_members", "channel_user_roles"]
              : [
                  "session_state",
                  "direct_messages",
                  "conversations",
                  "conversation_members",
                  "event_audience",
                ];
        const hashes = Object.fromEntries(tables.map((table) => [table, rowHash(db, table)]));
        const ddl = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(root)!.sql);
        const legacy = ddl.replace(
          new RegExp(`(\\b${key}\\s+TEXT\\s+PRIMARY\\s+KEY)\\s+NOT\\s+NULL`, "i"),
          "$1",
        );
        expect(legacy).not.toBe(ddl);
        const objects = db
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type",
          )
          .all(root);
        const columns = db
          .prepare(`PRAGMA table_info(${quote(root)})`)
          .all()
          .map((c) => quote(String(c.name)))
          .join(",");
        // This is stopped-runtime legacy fixture construction, never application migration.
        // Keep every dependent row while restoring the exact historical nullable key.
        db.exec("PRAGMA foreign_keys=OFF;BEGIN");
        db.exec(
          `CREATE TABLE legacy_stage AS SELECT rowid AS saved_rowid,* FROM ${quote(root)};DROP TABLE ${quote(root)}`,
        );
        db.exec(legacy);
        db.exec(
          `INSERT INTO ${quote(root)}(rowid,${columns}) SELECT saved_rowid,${columns} FROM legacy_stage;DROP TABLE legacy_stage`,
        );
        for (const object of objects) db.exec(String(object.sql));
        db.exec("DELETE FROM schema_migrations WHERE version=1000;COMMIT;PRAGMA foreign_keys=ON");
        expect(
          db
            .prepare(`PRAGMA table_info(${quote(root)})`)
            .all()
            .find((c) => c.name === key)?.notnull,
        ).toBe(0);
        expect(Object.fromEntries(tables.map((table) => [table, rowHash(db, table)]))).toEqual(
          hashes,
        );
        proofs.push({ file, domain, root, hashes });
      } finally {
        if (db.isTransaction) db.exec("ROLLBACK");
        db.close();
      }
    }
    await f.restart();
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
    expect((await f.request(`${room}/messages`, bob)).status).toBe(200);
    const dm = await f.request(`/api/v1/conversations/${conversation.id}/messages`, bob);
    expect(dm.status).toBe(200);
    expect(await dm.text()).toContain("upgrade-kept-dm");
    expect((await f.request(`${room}/messages`, outsider)).status).toBe(403);
    const denied = await f.request(`/api/v1/conversations/${conversation.id}/messages`, outsider);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("upgrade-kept-dm");
    const history = await f.request(`${room}/messages`, bob);
    expect(await history.text()).toContain(message.id);
    await f.stop();
    expect(proofs).toHaveLength(3);
    for (const proof of proofs) {
      const db = new DatabaseSync(proof.file, { readOnly: true });
      try {
        expect(
          Object.fromEntries(Object.keys(proof.hashes).map((table) => [table, rowHash(db, table)])),
        ).toEqual(proof.hashes);
        expect(compareDomainSchema(db, proof.domain).status).toBe("PASS");
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        db.close();
      }
    }
  } finally {
    await f.dispose();
  }
}, 60000);
