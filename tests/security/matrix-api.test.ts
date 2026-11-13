import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { generateReports } from "../../scripts/security-matrix-report";
import { generateOpenAPISpec } from "../../server/routes/openapi.json.get";
import { createMatrixFixture } from "../helpers/matrix-fixture";

const { inventory } = generateReports();
const publicRoutes = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/accounts/register",
  "/api/health",
  "/api/status",
]);
const protectedRouteCases: { route: string; method: string; alias: string }[] = [
  ...inventory.routes.fileRoutes.filter(
    (r: any) =>
      r.method !== "any" &&
      !publicRoutes.has(r.route) &&
      r.route !== "/api/v1/events" &&
      r.route !== "/api/events" &&
      !r.route.includes("/webhooks/{") &&
      (r.route.startsWith("/api/") || r.route.startsWith("/media/") || r.route === "/metrics"),
  ),
  ...inventory.routes.adminRoutes.flatMap((r: any) =>
    r.aliases.map((alias: string) => ({ ...r, route: alias })),
  ),
].map((r: any) => ({
  route: r.route,
  method: r.method.toUpperCase(),
  alias: r.route
    .replace(/\{username\}/g, "bob")
    .replace(/\{channel\}/g, "%23protected")
    .replace(/\{target\}/g, "bob")
    .replace(/\{key\}/g, "bio")
    .replace(/\{id\}/g, "protected-resource"),
}));

async function databases(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? databases(path.join(directory, e.name))
          : Promise.resolve(e.name.endsWith(".sqlite") ? [path.join(directory, e.name)] : []),
      ),
    )
  ).flat();
}
// Inspect only after workerd has closed SQLite. Runtime limiter state is intentionally
// excluded; a denied request may increment its own security budget, never resources.
async function protectedState(f: Awaited<ReturnType<typeof createMatrixFixture>>) {
  await f.stop();
  const state: any[] = [];
  for (const file of (await databases(f.directory)).sort()) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = [
        "users",
        "account_roles",
        "user_metadata",
        "account_settings",
        "registered_nicks",
        "media_uploads",
        "webpush_subscriptions",
        "channel_metadata",
        "channel_members",
        "channel_permissions",
        "channel_bans",
        "channel_invites",
        "channel_kv_metadata",
        "channel_role_groups",
        "channel_user_roles",
        "channel_webhooks",
        "channel_outgoing_webhooks",
        "messages",
        "direct_messages",
      ];
      for (const table of tables) {
        if (db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table))
          state.push([
            path.relative(f.directory, file),
            table,
            db
              .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
              .all()
              .map((row: any) => {
                if (table !== "channel_members") return row;
                // Reconnecting the authorized witness legitimately rotates its socket
                // and join timestamp; compare stable identity/membership/privileges.
                const { session_id, joined_at, ...stable } = row;
                return { ...stable, modes: [...String(row.modes)].sort().join("") };
              }),
          ]);
      }
    } finally {
      db.close();
    }
  }
  return state;
}

describe("matrix API", () => {
  for (const [kind, id] of [
    ["missing", "API-001"],
    ["invalid", "API-002"],
    ["expired", "API-003"],
    ["revoked", "API-004"],
  ] as const) {
    it(`${id} ${kind} credentials cannot access inventoried protected routes or aliases`, async () => {
      const f = await createMatrixFixture();
      try {
        const alice = await f.createActor("alice"),
          bob = await f.createActor("bob"),
          expired = await f.createActor("expired"),
          revoked = await f.createActor("revoked");
        expect(
          (
            await f.request("/api/v1/profiles/bob", bob, "PATCH", {
              bio: "protected-profile-marker",
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await f.request("/api/v1/notifications/subscribe", bob, "POST", {
              username: "bob",
              endpoint: "https://push.example.test/protected-marker",
            })
          ).status,
        ).toBe(200);
        const client = await f.connect(bob);
        client.send("JOIN #protected");
        await client.waitForLine((l) => l.includes(" 366 "));
        client.send("MODE #protected +s");
        await client.waitForLine((l) => l.includes("MODE #protected +s"));
        expect(
          (
            await f.request("/api/v1/channels/%23protected/messages", bob, "POST", {
              content: "protected-message-marker",
            })
          ).status,
        ).toBe(201);
        expect((await f.request("/api/v1/auth/logout", revoked, "POST")).status).toBe(200);
        await f.stop();
        for (const file of await databases(f.directory)) {
          const db = new DatabaseSync(file);
          try {
            if (db.prepare("SELECT name FROM sqlite_master WHERE name='api_sessions'").get())
              db.prepare("UPDATE api_sessions SET expires_at=? WHERE token_hash=?").run(
                Date.now() - 1,
                createHash("sha256").update(expired.token).digest("hex"),
              );
          } finally {
            db.close();
          }
        }
        const before = await protectedState(f);
        await f.restart();
        const watcher = await f.connect(bob);
        watcher.send("JOIN #protected");
        await watcher.waitForLine((l) => l.includes(" 366 "));
        const start = watcher.lines.length;
        const actor =
          kind === "missing"
            ? null
            : kind === "invalid"
              ? { ...alice, token: "invalid-credential-marker" }
              : kind === "expired"
                ? expired
                : revoked;
        for (const route of protectedRouteCases) {
          const response = await f.request(
            route.alias,
            actor,
            route.method,
            ["POST", "PUT", "PATCH", "DELETE"].includes(route.method)
              ? {
                  content: "forbidden-mutation-marker",
                  username: "bob",
                  topic: "forbidden-topic",
                  isAdmin: true,
                }
              : undefined,
          );
          expect(response.status, `${kind} ${route.method} ${route.alias}`).toBe(401);
          const text = await response.text();
          expect(text).not.toMatch(
            /protected-(profile|message|marker)|pbkdf2:|password_hash|stored_key|SQLITE|SELECT |Error:|\bat .*\.mjs/,
          );
          expect(response.headers.get("cache-control")).toContain("no-store");
        }
        for (const route of ["/api/events", "/api/v1/events"]) {
          const response = await f.server.mf.dispatchFetch(`${f.server.url.origin}${route}`, {
            headers: {
              Upgrade: "websocket",
              ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
            },
          });
          expect(response.status, `${kind} upgrade ${route}`).toBe(401);
        }
        await f.barrier(watcher);
        expect(watcher.lines.slice(start).join("\n")).not.toMatch(
          /forbidden-mutation-marker|forbidden-topic|protected-message-marker/,
        );
        expect(await protectedState(f)).toEqual(before);
        await f.restart();
        const read = await f.request("/api/v1/channels/%23protected/messages", bob);
        expect(read.status).toBe(200);
        expect(await read.text()).toContain("protected-message-marker");
        expect(
          await (await f.request("/api/v1/notifications/subscriptions?username=bob", bob)).text(),
        ).toContain("protected-marker");
        expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
      } finally {
        await f.dispose();
      }
    });
  }

  it("API-005 API-006 API-007 API-021 ordinary users and query credentials cannot invoke concrete admin aliases", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      expect((await f.request("/api/v1/admin/accounts/bob", root)).status).toBe(200);
      // Initialize the observer's SessionDO schema before taking the baseline.
      await f.barrier(await f.connect(bob));
      const before = await protectedState(f);
      await f.restart();
      const watcher = await f.connect(bob);
      await f.barrier(watcher);
      const offset = watcher.lines.length;
      for (const route of protectedRouteCases.filter(
        (r) => r.route.startsWith("/admin/") || r.route.startsWith("/api/v1/admin/"),
      )) {
        const response = await f.request(
          route.alias,
          alice,
          route.method,
          ["POST", "PUT", "PATCH", "DELETE"].includes(route.method) ? {} : undefined,
        );
        expect(response.status, `${route.method} ${route.alias}`).toBe(403);
        expect(await response.text()).not.toMatch(
          /password_hash|pbkdf2:|stored_key|scram|"accounts"\s*:/,
        );
      }
      for (const prefix of ["/admin", "/api/v1/admin"]) {
        const response = await f.request(
          `${prefix}/accounts?token=${root.token}&adminToken=${root.token}&api_key=${root.token}`,
        );
        expect(response.status).toBe(401);
        expect(await response.text()).not.toContain(bob.account.id);
      }
      await f.barrier(watcher);
      expect(watcher.lines.slice(offset).every((l) => l.includes(" PONG "))).toBe(true);
      expect(await protectedState(f)).toEqual(before);
      await f.restart();
      expect((await f.request("/admin/accounts/bob", root)).status).toBe(200);
    } finally {
      await f.dispose();
    }
  });

  it("API-008 API-010 API-011 API-012 API-022 path query and body identity substitutions preserve account ownership", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const own = await f.request("/api/v1/profiles/alice", alice, "PATCH", { bio: "alice-own" });
      expect(own.status).toBe(200);
      await f.barrier(await f.connect(bob));
      const before = await protectedState(f);
      await f.restart();
      const watcher = await f.connect(bob);
      await f.barrier(watcher);
      const offset = watcher.lines.length;
      for (const prefix of ["/api/profile", "/api/v1/profiles"]) {
        const denied = await f.request(
          `${prefix}/bob?username=alice&userId=${alice.account.id}`,
          alice,
          "PATCH",
          { bio: "forbidden", username: "alice", id: alice.account.id },
        );
        expect(denied.status).toBe(400); // Strict schema rejects forged identity fields first.
        expect(await denied.text()).not.toContain(bob.password);
        const forbidden = await f.request(
          `${prefix}/bob?username=alice&userId=${alice.account.id}`,
          alice,
          "PATCH",
          { bio: "forbidden" },
        );
        expect(forbidden.status).toBe(403);
      }
      await f.barrier(watcher);
      expect(watcher.lines.slice(offset).every((l) => l.includes(" PONG "))).toBe(true);
      expect(await protectedState(f)).toEqual(before);
      await f.restart();
      const assigned = await f.request("/api/v1/profiles/alice?username=bob", alice, "PATCH", {
        bio: "alice-updated",
        username: "bob",
        userId: bob.account.id,
        isAdmin: true,
        roles: ["admin"],
        disabledAt: null,
      });
      expect(assigned.status).toBe(400);
      const valid = await f.request("/api/v1/profiles/alice?username=bob", alice, "PATCH", {
        bio: "alice-updated",
      });
      expect(valid.status).toBe(200);
      const publicBob = await f.request("/api/v1/profiles/bob", alice);
      expect(publicBob.status).toBe(200);
      expect(await publicBob.text()).not.toMatch(
        /alice-updated|passwordHash|password_hash|storedKey|stored_key|serverKey|server_key|scram|token_hash/,
      );
      expect((await f.request("/admin/accounts", alice)).status).toBe(403);
      expect(await (await f.request("/api/v1/profiles/alice", bob)).text()).toContain(
        "alice-updated",
      );
      await f.stop();
      const rows = (await f.snapshot("users")).flat() as any[];
      const roles = (await f.snapshot("account_roles")).flat() as any[];
      expect(
        roles.filter((r) => r.user_id === alice.account.id || r.user_id === bob.account.id),
      ).toEqual([]);
      expect(rows.find((r) => r.id === bob.account.id)).toMatchObject({
        username: "bob",
        disabled_at: null,
      });
    } finally {
      await f.dispose();
    }
  });

  it("API-017 API-024 OpenAPI describes inventoried client methods and public endpoints exclude credentials", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice");
      const response = await f.request("/openapi.json");
      expect(response.status).toBe(200);
      const runtime = (await response.json()) as any;
      const source = generateOpenAPISpec();
      expect(runtime.security).toEqual(source.security);
      for (const route of protectedRouteCases.filter((r) => r.route.startsWith("/api/"))) {
        const candidate = Object.keys(runtime.paths).find(
          (p) => p.replace(/\{[^}]+\}/g, "{}") === route.route.replace(/\{[^}]+\}/g, "{}"),
        );
        expect(candidate, `${route.method} ${route.route}`).toBeDefined();
        const operation = runtime.paths[candidate!][route.method.toLowerCase()];
        expect(operation).toBeDefined();
        expect(operation.security ?? runtime.security).not.toEqual([]);
      }
      for (const route of [
        "/health",
        "/status",
        "/api/health",
        "/api/status",
        "/docs",
        "/openapi.json",
        "/",
      ]) {
        const result = await f.request(route);
        expect(result.status).toBe(200);
        const text = await result.text();
        expect(text).not.toContain(alice.password);
        expect(text).not.toContain(alice.token);
        expect(text).not.toMatch(
          /pbkdf2:100000:|"password_hash"\s*:|"stored_key"\s*:|"token_hash"\s*:/,
        );
      }
    } finally {
      await f.dispose();
    }
  });

  it("API-020 API-023 cross-origin requests receive no permissive CORS credentials and cookies do not authenticate", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice");
      for (const method of ["GET", "PATCH", "OPTIONS"]) {
        const response = await f.request(
          "/api/v1/profiles/alice",
          null,
          method,
          method === "PATCH" ? { bio: "cross-origin-marker" } : undefined,
          {
            Origin: "https://attacker.invalid",
            Cookie: `session=${alice.token}; token=${alice.token}`,
            "Access-Control-Request-Method": "PATCH",
          },
        );
        expect(response.status).toBe(401);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
        expect(response.headers.get("access-control-allow-credentials")).toBeNull();
        expect(await response.text()).not.toContain(alice.token);
      }
      const authorized = await f.request("/api/v1/profiles/alice", alice);
      expect(authorized.status).toBe(200);
      expect(authorized.headers.get("cache-control")).toBe("private, no-store");
      expect(await authorized.text()).not.toContain("cross-origin-marker");
      await f.stop();
      expect(JSON.stringify(await f.snapshot("user_metadata"))).not.toContain(
        "cross-origin-marker",
      );
    } finally {
      await f.dispose();
    }
  });
});
