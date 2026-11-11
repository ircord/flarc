import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createMiniflareServer, TestIRCClient } from "../helpers/miniflare-harness";

async function sqliteFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sqliteFiles(file)));
    else if (file.endsWith(".sqlite")) result.push(file);
  }
  return result;
}

function databaseWithTable(files: string[], table: string): DatabaseSync {
  for (const file of files) {
    const db = new DatabaseSync(file);
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
      return db;
    db.close();
  }
  throw new Error(`No persisted database contains ${table}`);
}

describe("Real SQLite persistence, constraints and failure recovery", () => {
  it("rolls back a failed cross-object rename import and keeps the original private channel usable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flarc-rename-rollback-"));
    const options = { durableObjectsPersist: directory };
    let server = await createMiniflareServer(options);
    let alice: TestIRCClient | undefined;
    let token = "";
    const call = (url: string, method = "GET", body?: unknown) =>
      fetch(new URL(url, server.url), {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const password = "rename-rollback-password";
    try {
      expect(
        (await call("/api/v1/auth/register", "POST", { username: "Alice", password })).status,
      ).toBe(201);
      token = (
        (await (
          await call("/api/v1/auth/login", "POST", { username: "Alice", password })
        ).json()) as any
      ).token;
      alice = new TestIRCClient(server.wsUrl);
      await alice.connect();
      alice.send(`PASS Alice:${password}`);
      await alice.register("Alice");
      alice.send("JOIN #rename-source");
      await alice.waitForLine((line) => line.includes(" 366 "));
      alice.send("MODE #rename-source +s");
      await alice.waitForLine((line) => line.includes("MODE #rename-source +s"));
      expect(
        (
          await call("/api/v1/channels/%23rename-source/messages", "POST", {
            content: "must-survive-failed-rename",
          })
        ).status,
      ).toBe(201);
      // Initialize an empty destination object without creating a channel there.
      expect(
        (await call("/api/v1/channels/%23rename-failed/roles", "POST", { name: "denied" })).status,
      ).toBe(403);
      alice.close();
      await server.dispose();
      let injected = false;
      for (const file of await sqliteFiles(directory)) {
        const db = new DatabaseSync(file);
        if (
          db.prepare("SELECT name FROM sqlite_master WHERE name = 'channel_metadata'").get() &&
          !db.prepare("SELECT value FROM channel_metadata WHERE key = 'name'").get()
        ) {
          db.exec(
            "CREATE TRIGGER fail_rename_import BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'injected rename import failure'); END",
          );
          injected = true;
        }
        db.close();
      }
      expect(injected).toBe(true);
      server = await createMiniflareServer(options);
      alice = new TestIRCClient(server.wsUrl);
      await alice.connect();
      alice.send(`PASS Alice:${password}`);
      await alice.register("Alice");
      alice.send("JOIN #rename-source");
      await alice.waitForLine((line) => line.includes(" 366 "));
      alice.send("RENAME #rename-source #rename-failed");
      await alice.waitForLine((line) => line.includes("FAIL RENAME CANNOT_RENAME"));
      expect(
        JSON.stringify(await (await call("/api/v1/channels/%23rename-source/messages")).json()),
      ).toContain("must-survive-failed-rename");
      expect(
        (
          await call("/api/v1/channels/%23rename-source/messages", "POST", {
            content: "source-writes-recovered",
          })
        ).status,
      ).toBe(201);
      alice.close();
      await server.dispose();
      let checked = false;
      for (const file of await sqliteFiles(directory)) {
        const db = new DatabaseSync(file);
        if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'fail_rename_import'").get()) {
          expect(db.prepare("SELECT id FROM messages").all()).toHaveLength(0);
          expect(
            db
              .prepare(
                "SELECT value FROM channel_metadata WHERE key IN ('name', 'founder', 'rename_pending')",
              )
              .all(),
          ).toHaveLength(0);
          checked = true;
        }
        db.close();
      }
      expect(checked).toBe(true);
    } finally {
      alice?.close();
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves accounts, sessions, channel state, roles, edits, markers, subscriptions and private media across a full runtime restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flarc-persistence-"));
    const options = {
      durableObjectsPersist: directory,
      bindings: { ADMIN_USERS: "AuditAdmin", ADMIN_TOKEN: "storage-bootstrap" },
    };
    let server = await createMiniflareServer(options);
    const clients: TestIRCClient[] = [];
    const tokens: Record<string, string> = {};
    const call = (url: string, user?: string, method = "GET", body?: unknown) =>
      fetch(new URL(url, server.url), {
        method,
        headers: {
          ...(user ? { Authorization: `Bearer ${tokens[user]}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const password = "persistent-Password-123!";
    async function register(username: string) {
      const response = await fetch(new URL("/api/v1/auth/register", server.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(username === "AuditAdmin" ? { "x-bootstrap-token": "storage-bootstrap" } : {}),
        },
        body: JSON.stringify({ username, password }),
      });
      expect(response.status).toBe(201);
      const account = ((await response.json()) as any).account;
      const login = await call("/api/v1/auth/login", undefined, "POST", { username, password });
      tokens[username] = ((await login.json()) as any).token;
      return account;
    }
    try {
      await register("AuditAdmin");
      const aliceAccount = await register("Alice");
      const bobAccount = await register("Bob");
      for (const username of ["Alice", "Bob"]) {
        const client = new TestIRCClient(server.wsUrl);
        clients.push(client);
        await client.connect();
        client.send(`PASS ${username}:${password}`);
        await client.register(username);
      }
      const [alice, bob] = clients;
      alice.send("JOIN #persist");
      await alice.waitForLine((l) => l.includes(" 366 "));
      alice.send("MODE #persist +s");
      await alice.waitForLine((l) => l.includes(" MODE #persist +s"));
      bob.send("JOIN #persist");
      await bob.waitForLine((l) => l.includes(" 366 "));
      const base = "/api/v1/channels/%23persist";
      const createRole = await call(`${base}/roles`, "Alice", "POST", {
        name: "Trusted",
        ircMode: "v",
        permissions: ["send_messages"],
      });
      expect(createRole.status).toBe(201);
      const roleId = ((await createRole.json()) as any).role.id;
      expect(
        (
          await call(`${base}/roles/assign`, "Alice", "POST", {
            userId: bobAccount.id,
            roleGroupId: roleId,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(`${base}/info`, "Alice", "PATCH", {
            description: "persisted channel",
            topic: "persistent topic",
            category: "Audit",
          })
        ).status,
      ).toBe(200);
      expect(
        (await call("/api/v1/profiles/Alice", "Alice", "PATCH", { bio: "persisted profile" }))
          .status,
      ).toBe(200);
      const sent = await call(`${base}/messages`, "Alice", "POST", {
        content: "original persisted text",
      });
      expect(sent.status).toBe(201);
      const messageId = ((await sent.json()) as any).message.id;
      expect(
        (
          await call(`${base}/messages/${messageId}`, "Alice", "PATCH", {
            content: "edited persisted text",
          })
        ).status,
      ).toBe(200);
      alice.send(`MARKREAD #persist timestamp=${new Date().toISOString()}`);
      alice.send("NS SET always-on on");
      await alice.waitForLine((l) => l.includes("Successfully changed account setting"));
      expect(
        (
          await call("/api/v1/notifications/subscribe", "Alice", "POST", {
            username: "Alice",
            endpoint: "https://push.example.com/persist",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call("/api/v1/users/Alice/notifications/%23persist", "Alice", "PUT", {
            level: "all",
          })
        ).status,
      ).toBe(200);
      const upload = await fetch(new URL("/api/v1/media/upload?channel=%23persist", server.url), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.Alice}`,
          "Content-Type": "text/plain",
          "X-Filename": "private.txt",
        },
        body: "persistent private file",
      });
      expect(upload.status).toBe(201);
      const media = (await upload.json()) as any;
      for (const client of clients.splice(0)) client.close();
      await server.dispose();
      const files = await sqliteFiles(directory);
      const accounts = databaseWithTable(files, "users");
      const account = accounts
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(aliceAccount.id) as any;
      expect(account.canonical_username).toBe("alice");
      expect(account.password_hash).toMatch(/^pbkdf2:100000:/);
      expect(account.password_hash).not.toContain(password);
      expect(
        accounts
          .prepare("SELECT stored_key FROM scram_credentials WHERE user_id = ?")
          .get(aliceAccount.id),
      ).toBeDefined();
      expect(accounts.prepare("SELECT COUNT(*) AS count FROM api_sessions").get()).toMatchObject({
        count: 3,
      });
      expect(
        accounts.prepare("SELECT timestamp FROM read_markers WHERE user_key = 'alice'").get(),
      ).toBeDefined();
      expect(
        accounts
          .prepare("SELECT endpoint FROM webpush_subscriptions WHERE user_key = 'alice'")
          .get(),
      ).toMatchObject({ endpoint: "https://push.example.com/persist" });
      accounts.exec(
        `CREATE TRIGGER fail_scram_insert BEFORE INSERT ON scram_credentials BEGIN SELECT RAISE(ABORT, 'injected credential write failure'); END`,
      );
      accounts.close();
      const channel = databaseWithTable(files, "messages");
      expect(
        channel.prepare("SELECT content FROM messages WHERE id = ?").get(messageId),
      ).toMatchObject({ content: "edited persisted text" });
      expect(
        channel
          .prepare("SELECT group_id FROM channel_user_roles WHERE user_id = ?")
          .get(bobAccount.id),
      ).toMatchObject({ group_id: roleId });
      channel.exec("PRAGMA foreign_keys = ON");
      expect(() =>
        channel
          .prepare(
            "INSERT INTO channel_user_roles (user_id, group_id, assigned_at) VALUES (?, ?, ?)",
          )
          .run(bobAccount.id, "nonexistent-group", Date.now()),
      ).toThrow(/FOREIGN KEY/);
      channel.close();
      server = await createMiniflareServer(options);
      const failedReset = await call("/admin/accounts/Alice/password", "AuditAdmin", "POST", {
        password: "replacement-credential-password",
      });
      expect(failedReset.status).toBe(500);
      const oldLogin = await call("/api/v1/auth/login", undefined, "POST", {
        username: "Alice",
        password,
      });
      expect(oldLogin.status).toBe(200);
      const newLogin = await call("/api/v1/auth/login", undefined, "POST", {
        username: "Alice",
        password: "replacement-credential-password",
      });
      expect(newLogin.status).toBe(401);
      const info = (await (await call(`${base}/info`, "Alice")).json()) as any;
      expect(info.channel.description).toBe("persisted channel");
      expect(info.channel.topic).toBe("persistent topic");
      expect(info.channel.founder).toBe("Alice");
      expect(JSON.stringify(await (await call(`${base}/messages`, "Alice")).json())).toContain(
        "edited persisted text",
      );
      expect(
        JSON.stringify(await (await call("/api/v1/profiles/Alice", "Alice")).json()),
      ).toContain("persisted profile");
      expect(
        JSON.stringify(await (await call("/api/v1/users/Alice/notifications", "Alice")).json()),
      ).toContain('"all"');
      const download = await call(media.url, "Alice");
      expect(download.status).toBe(200);
      expect(await download.text()).toBe("persistent private file");
      expect((await call(`${base}/roles/${roleId}`, "Alice", "DELETE")).status).toBe(200);
      expect((await call(`${base}/messages/${messageId}`, "Alice", "DELETE")).status).toBe(200);
      expect((await call(`/api/v1/media/${media.id}`, "Alice", "DELETE")).status).toBe(200);
      expect((await call(media.url, "Alice")).status).toBe(404);
      await server.dispose();
      const finalChannel = databaseWithTable(await sqliteFiles(directory), "messages");
      expect(
        finalChannel.prepare("SELECT * FROM channel_user_roles WHERE group_id = ?").all(roleId),
      ).toHaveLength(0);
      expect(
        finalChannel
          .prepare("SELECT content, tags_json, multiline_json, redacted FROM messages WHERE id = ?")
          .get(messageId),
      ).toMatchObject({ content: "", tags_json: "{}", multiline_json: null, redacted: 1 });
      expect(
        finalChannel.prepare("SELECT * FROM messages_fts WHERE message_id = ?").all(messageId),
      ).toHaveLength(0);
      finalChannel.close();
    } finally {
      for (const client of clients) client.close();
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("expires sessions and history from authoritative persisted timestamps, with no stale search results", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flarc-expiry-"));
    const options = { durableObjectsPersist: directory };
    let server = await createMiniflareServer(options);
    try {
      const password = "expiry-password-123";
      await fetch(new URL("/api/v1/auth/register", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Alice", password }),
      });
      const login = await fetch(new URL("/api/v1/auth/login", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Alice", password }),
      });
      const { token } = (await login.json()) as any;
      const client = new TestIRCClient(server.wsUrl);
      await client.connect();
      client.send(`PASS Alice:${password}`);
      await client.register("Alice");
      client.send("JOIN #expiry");
      await client.waitForLine((l) => l.includes(" 366 "));
      const sent = await fetch(new URL("/api/v1/channels/%23expiry/messages", server.url), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "expired-needle" }),
      });
      expect(sent.status).toBe(201);
      client.close();
      await server.dispose();
      const files = await sqliteFiles(directory);
      const channel = databaseWithTable(files, "messages");
      channel.prepare("UPDATE messages SET expires_at = ?").run(Date.now() - 1);
      channel.close();
      server = await createMiniflareServer(options);
      for (const suffix of ["/messages", "/messages/search?q=expired", "/unread"]) {
        const response = await fetch(new URL(`/api/v1/channels/%23expiry${suffix}`, server.url), {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        expect(await response.text()).not.toContain("expired-needle");
      }
      await server.dispose();
      const accounts = databaseWithTable(await sqliteFiles(directory), "api_sessions");
      accounts.prepare("UPDATE api_sessions SET expires_at = ?").run(Date.now() - 1);
      accounts.close();
      server = await createMiniflareServer(options);
      expect(
        (
          await fetch(new URL("/api/v1/profiles/Alice", server.url), {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(401);
    } finally {
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
