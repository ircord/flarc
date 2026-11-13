import { expect, it } from "vitest";
import {
  accountMigrationTables,
  schemaMigrationFixture,
} from "../helpers/schema-migration-fixture";

it("migrates real authenticated Accounts data with complete FK dependents, rollback, row identities and restart", async () => {
  const f = await schemaMigrationFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob");
    const credentialResponse = await f.request("/api/v1/auth/credentials", alice.token, "POST", {
      label: "migration-reader",
      expiresAt: Date.now() + 300000,
      scopes: [
        { operation: "rest.get", resource: "/api/v1/profiles/alice" },
        { operation: "profile.get", resource: "alice" },
      ],
    });
    expect(credentialResponse.status).toBe(200);
    const credential = ((await credentialResponse.json()) as any).credential;
    expect(
      (
        await f.request("/api/v1/users/alice/notifications/%23migration", alice.token, "PUT", {
          level: "nothing",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request("/api/v1/profiles/alice", alice.token, "PATCH", {
          displayName: "Migration Alice",
        })
      ).status,
    ).toBe(200);
    await f.accounts.migrationPrepare(alice.account.id);
    const before = await f.snapshot();
    expect(before.schema.find((t) => t.name === "users")!.sql).not.toMatch(
      /id TEXT PRIMARY KEY NOT NULL/,
    );
    const options = { tables: accountMigrationTables, version: 701 };
    for (const fault of ["staged", "dropped", "restored"]) {
      const failure = await f.accounts.migrationRun({ ...options, fault });
      expect(failure).toEqual({ error: `injected migration failure: ${fault}` });
      expect(await f.snapshot()).toEqual(before);
    }
    const migrated = await f.accounts.migrationRun(options);
    expect(migrated.error).toBeUndefined();
    expect(migrated.result.changed).toEqual(
      expect.arrayContaining(["users", "registered_nicks", "api_sessions"]),
    );
    expect(migrated.result.preserved).toEqual(
      expect.arrayContaining([
        "credential_scopes",
        "api_session_details",
        "channel_notifications",
        "migration_probe",
      ]),
    );
    const after = await f.snapshot();
    expect(after.data).toEqual(before.data);
    expect(after.objects).toEqual(before.objects);
    expect(after.fk).toEqual([]);
    expect(after.schema.some((t) => t.name.startsWith("__flarc_pk_stage_"))).toBe(false);
    expect(await f.accounts.migrationRun(options)).toEqual({
      result: { changed: [], preserved: [], rows: 0 },
    });
    expect(await f.snapshot()).toEqual(after);
    for (const token of [alice.token, credential.token])
      expect((await f.request("/api/v1/profiles/alice", token)).status).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", credential.token)).status).toBe(403);
    expect((await f.request("/api/v1/profiles/bob", bob.token)).status).toBe(200);
    const login = await f.request("/api/v1/auth/login", undefined, "POST", {
      username: "alice",
      password: alice.password,
    });
    expect(login.status).toBe(200);
    expect(((await login.json()) as any).account.id).toBe(alice.account.id);
    const constraints = await f.accounts.migrationConstraintChecks(alice.account.id);
    expect(constraints).toMatchObject({
      nullInsert: expect.stringMatching(/NOT NULL/i),
      nullUpdate: expect.stringMatching(/NOT NULL/i),
      unique: expect.stringMatching(/UNIQUE/i),
      foreignKey: expect.stringMatching(/FOREIGN KEY/i),
      checkConstraint: expect.stringMatching(/CHECK/i),
      nextId: 91,
      auditCount: 3,
      fk: 1,
    });
    await f.stop();
    await f.sqlite((db) => {
      expect(
        db
          .prepare("PRAGMA table_info(users)")
          .all()
          .find((c) => c.name === "id")?.notnull,
      ).toBe(1);
      expect(
        db.prepare("SELECT count(*) AS n FROM schema_migrations WHERE version=701").get()?.n,
      ).toBe(1);
      expect(db.prepare("SELECT count(*) AS n FROM users").get()?.n).toBe(2);
    });
  } finally {
    await f.close();
  }
}, 60000);

it("rejects legacy NULL identities, missing dependency approval and bounded-maintenance overflow without changing stored data", async () => {
  const f = await schemaMigrationFixture();
  try {
    const alice = await f.actor("alice");
    await f.accounts.migrationPrepare(alice.account.id);
    const options = { tables: accountMigrationTables, version: 702 };
    const before = await f.snapshot();
    for (const override of [
      { tables: accountMigrationTables.filter((t) => t !== "migration_probe") },
      { maxRows: 1 },
      { maxDatabaseBytes: 1 },
    ]) {
      expect((await f.accounts.migrationRun({ ...options, ...override })).error).toMatch(
        /Unapproved dependent|row limit|size limit/,
      );
      expect(await f.snapshot()).toEqual(before);
    }
    await f.accounts.migrationCorrupt(alice.account.id);
    const corrupt = await f.snapshot();
    expect((await f.accounts.migrationRun(options)).error).toMatch(/Legacy NULL primary key/);
    expect(await f.snapshot()).toEqual(corrupt);
    await f.accounts.migrationClearCorrupt();
    expect(await f.snapshot()).toEqual(before);
    expect((await f.accounts.migrationRun(options)).error).toBeUndefined();
    expect((await f.request("/api/v1/profiles/alice", alice.token)).status).toBe(200);
  } finally {
    await f.close();
  }
}, 60000);
