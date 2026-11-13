import { once } from "node:events";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import { TestIRCClient } from "../helpers/miniflare-harness";

describe("matrix push and abuse", () => {
  for (const prefix of ["/api/v1/notifications", "/api/webpush"]) {
    it(`${prefix} PUSH-001 PUSH-002 PUSH-003 PUSH-004 PUSH-012 own subscriptions isolate endpoints and exclude keys`, async () => {
      const f = await createMatrixFixture();
      try {
        const alice = await f.createActor("alice"),
          bob = await f.createActor("bob");
        const a = await f.connect(alice),
          b = await f.connect(bob);
        const endpoints = {
          alice: "https://push.example.test/alice-secret-endpoint",
          bob: "https://push.example.test/bob-secret-endpoint",
        };
        const keys = { p256dh: "private-p256dh-marker", auth: "private-auth-marker" };
        for (const actor of [alice, bob]) {
          const r = await f.request(`${prefix}/subscribe`, actor, "POST", {
            username: actor.username,
            endpoint: endpoints[actor.username as "alice" | "bob"],
            keys,
          });
          expect(r.status).toBe(200);
          expect(await r.text()).not.toMatch(/private-p256dh-marker|private-auth-marker/);
        }
        const beforeA = a.lines.length,
          beforeB = b.lines.length;
        const denied = await f.request(`${prefix}/subscribe`, alice, "POST", {
          username: "bob",
          userId: alice.account.id,
          endpoint: "https://push.example.test/stolen",
          keys,
        });
        expect(denied.status).toBe(403);
        expect(await denied.text()).not.toContain(endpoints.bob);
        const listOther = await f.request(
          `${prefix}/subscriptions?username=bob&userId=${alice.account.id}`,
          alice,
        );
        expect(listOther.status).toBe(403);
        expect(await listOther.text()).not.toContain(endpoints.bob);
        const removeOther = await f.request(
          `${prefix}/subscribe?username=bob&endpoint=${encodeURIComponent(endpoints.bob)}`,
          alice,
          "DELETE",
        );
        expect(removeOther.status).toBe(403);
        for (const actor of [alice, bob]) {
          const response = await f.request(
            `${prefix}/subscriptions?username=${actor.username}`,
            actor,
          );
          expect(response.status).toBe(200);
          const text = await response.text();
          expect(text).not.toMatch(
            /private-p256dh-marker|private-auth-marker|keys_json|created_at/,
          );
          expect(JSON.parse(text).endpoints).toEqual([
            endpoints[actor.username as "alice" | "bob"],
          ]);
        }
        await f.barrier(a);
        await f.barrier(b);
        for (const lines of [a.lines.slice(beforeA), b.lines.slice(beforeB)])
          expect(lines.join("\n")).not.toMatch(
            /secret-endpoint|private-p256dh-marker|private-auth-marker|stolen/,
          );
        expect(
          (
            await f.request(
              `${prefix}/subscribe?username=alice&endpoint=${encodeURIComponent(endpoints.alice)}`,
              alice,
              "DELETE",
            )
          ).status,
        ).toBe(200);
        await f.stop();
        const rows = (await f.snapshot("webpush_subscriptions")).flat() as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          user_key: "bob",
          endpoint: endpoints.bob,
          keys_json: JSON.stringify(keys),
        });
        await f.restart();
        expect(
          ((await (await f.request(`${prefix}/subscriptions?username=bob`, bob)).json()) as any)
            .endpoints,
        ).toEqual([endpoints.bob]);
        expect(
          ((await (await f.request(`${prefix}/subscriptions?username=alice`, alice)).json()) as any)
            .endpoints,
        ).toEqual([]);
      } finally {
        await f.dispose();
      }
    });
  }

  it("IRC PUSH-001 PUSH-002 PUSH-003 PUSH-004 PUSH-012 WEBPUSH uses authenticated owner across REST reads", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice),
        b = await f.connect(bob);
      const ep = "https://push.example.test/irc-alice",
        other = "https://push.example.test/rest-bob";
      expect(
        (
          await f.request("/api/v1/notifications/subscribe", bob, "POST", {
            username: "bob",
            endpoint: other,
          })
        ).status,
      ).toBe(200);
      a.send(`WEBPUSH REGISTER ${ep} private-irc-key private-irc-auth`);
      await a.waitForLine((l) => l.includes(`WEBPUSH REGISTER ${ep}`));
      a.send("WEBPUSH LIST bob");
      await f.barrier(a);
      expect(a.lines.join("\n")).toContain(`WEBPUSH LIST ${ep}`);
      expect(a.lines.join("\n")).not.toContain(other);
      expect(a.lines.join("\n")).not.toMatch(/private-irc-key|private-irc-auth/);
      const offset = b.lines.length;
      b.send("WEBPUSH LIST alice");
      await f.barrier(b);
      expect(b.lines.slice(offset).join("\n")).toContain(other);
      expect(b.lines.slice(offset).join("\n")).not.toContain(ep);
      b.send(`WEBPUSH UNREGISTER ${ep}`);
      await b.waitForLine((l) => l.includes(`WEBPUSH UNREGISTER ${ep}`));
      expect(
        (
          (await (
            await f.request("/api/v1/notifications/subscriptions?username=alice", alice)
          ).json()) as any
        ).endpoints,
      ).toEqual([ep]);
      a.send(`WEBPUSH UNREGISTER ${ep}`);
      await a.waitForLine((l) => l.includes(`WEBPUSH UNREGISTER ${ep}`));
      await f.stop();
      expect((await f.snapshot("webpush_subscriptions")).flat()).toEqual([
        expect.objectContaining({ user_key: "bob", endpoint: other }),
      ]);
    } finally {
      await f.dispose();
    }
  });

  it("PUSH-005 disabled account cannot reuse old REST subscription credentials or IRC socket", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice),
        b = await f.connect(bob);
      const endpoint = "https://push.example.test/alice-before-disable";
      expect(
        (
          await f.request("/api/v1/notifications/subscribe", alice, "POST", {
            username: "alice",
            endpoint,
          })
        ).status,
      ).toBe(200);
      const closed = once(a.ws, "close");
      expect((await f.request("/admin/accounts/alice/disable", root, "POST", {})).status).toBe(200);
      await closed;
      const list = await f.request("/api/v1/notifications/subscriptions?username=alice", alice);
      expect(list.status).toBe(401);
      expect(await list.text()).not.toContain(endpoint);
      expect(
        (
          await f.request("/api/webpush/subscribe", alice, "POST", {
            username: "alice",
            endpoint: "https://push.example.test/disabled",
          })
        ).status,
      ).toBe(401);
      expect(
        (await f.request("/api/v1/notifications/subscriptions?username=bob", bob)).status,
      ).toBe(200);
      await f.barrier(b);
      await f.stop();
      const rows = (await f.snapshot("webpush_subscriptions")).flat() as any[];
      expect(rows).toEqual([expect.objectContaining({ user_key: "alice", endpoint })]);
    } finally {
      await f.dispose();
    }
  });

  it("PUSH-010 API-013 API-014 ABUSE-014 rejects malformed subscription payloads without modifying stored subscriptions", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const endpoint = "https://push.example.test/valid";
      expect(
        (
          await f.request("/api/v1/notifications/subscribe", bob, "POST", {
            username: "bob",
            endpoint,
          })
        ).status,
      ).toBe(200);
      const invalid = [
        null,
        [],
        { username: "alice", endpoint: "http://127.0.0.1/" },
        { username: "alice", endpoint: "javascript:alert(1)" },
        { username: "alice", endpoint: "https://example.test/", keys: { auth: "x".repeat(257) } },
        { username: "alice", endpoint: "https://example.test/", keys: [] },
        { username: ["alice"], endpoint },
        { username: "alice", endpoint: 123 },
      ];
      for (const prefix of ["/api/v1/notifications", "/api/webpush"]) {
        for (const body of invalid) {
          const response = await f.request(`${prefix}/subscribe`, alice, "POST", body);
          expect(response.status).toBe(400);
          expect(await response.text()).not.toMatch(
            /SQLITE|SELECT |password_hash|Error:|\bat .*\.mjs/,
          );
        }
      }
      const client = await f.connect(alice);
      const rejected = client.waitForNewLine((l) =>
        l.includes("FAIL WEBPUSH INVALID_SUBSCRIPTION REGISTER"),
      );
      client.send("WEBPUSH REGISTER http://127.0.0.1/ bad-key bad-auth");
      await rejected;
      await f.barrier(client);
      expect(
        (
          (await (
            await f.request("/api/v1/notifications/subscriptions?username=alice", alice)
          ).json()) as any
        ).endpoints,
      ).toEqual([]);
      await f.stop();
      expect((await f.snapshot("webpush_subscriptions")).flat()).toEqual([
        expect.objectContaining({ user_key: "bob", endpoint }),
      ]);
    } finally {
      await f.dispose();
    }
  });

  it("subscription count limit rejects excess registrations safely and preserves existing owners", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      for (let i = 0; i < 20; i++)
        expect(
          (
            await f.request("/api/v1/notifications/subscribe", alice, "POST", {
              username: "alice",
              endpoint: `https://push.example.test/${i}`,
            })
          ).status,
        ).toBe(200);
      const denied = await f.request("/api/v1/notifications/subscribe", alice, "POST", {
        username: "alice",
        endpoint: "https://push.example.test/21",
      });
      // A thrown RPC exception/500 is a product failure, not a passing denial.
      expect.soft(denied.status).toBe(429);
      expect(await denied.text()).not.toMatch(/SQLITE|Error:|\bat .*\.mjs/);
      expect(
        (
          await f.request("/api/v1/notifications/subscribe", bob, "POST", {
            username: "bob",
            endpoint: "https://push.example.test/bob",
          })
        ).status,
      ).toBe(200);
      await f.stop();
      const rows = (await f.snapshot("webpush_subscriptions")).flat() as any[];
      expect(rows.filter((r) => r.user_key === "alice")).toHaveLength(20);
      expect(rows.filter((r) => r.user_key === "bob")).toHaveLength(1);
      expect(rows.some((r) => r.endpoint.endsWith("/21"))).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("push quota permits duplicate updates and released capacity with REST alias and IRC parity", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice),
        b = await f.connect(bob);
      for (let i = 0; i < 20; i++) {
        expect(
          (
            await f.request("/api/v1/notifications/subscribe", alice, "POST", {
              username: "alice",
              endpoint: `https://push.example.test/${i}`,
            })
          ).status,
        ).toBe(200);
      }
      const updatedKeys = { auth: "updated-at-capacity", p256dh: "updated-key" };
      expect(
        (
          await f.request("/api/webpush/subscribe", alice, "POST", {
            username: "alice",
            endpoint: "https://push.example.test/0",
            keys: updatedKeys,
          })
        ).status,
      ).toBe(200);
      const denied = await f.request("/api/webpush/subscribe", alice, "POST", {
        username: "alice",
        endpoint: "https://push.example.test/forbidden",
      });
      expect.soft(denied.status).toBe(429);
      expect(await denied.text()).not.toMatch(/updated-at-capacity|updated-key|Error:|SQLITE/);
      const refused = a.waitForNewLine((l) => l.includes("FAIL WEBPUSH LIMIT_REACHED REGISTER"));
      a.send(
        "WEBPUSH REGISTER https://push.example.test/irc-excess secret-irc-key secret-irc-auth",
      );
      await refused;
      const offset = b.lines.length;
      expect(
        (
          await f.request(
            "/api/webpush/subscribe?username=alice&endpoint=https%3A%2F%2Fpush.example.test%2F1",
            alice,
            "DELETE",
          )
        ).status,
      ).toBe(200);
      const added = a.waitForNewLine((l) =>
        l.includes("WEBPUSH REGISTER https://push.example.test/replacement"),
      );
      a.send(
        "WEBPUSH REGISTER https://push.example.test/replacement replacement-key replacement-auth",
      );
      await added;
      const duplicate = a.waitForNewLine((l) =>
        l.includes("WEBPUSH REGISTER https://push.example.test/replacement"),
      );
      a.send(
        "WEBPUSH REGISTER https://push.example.test/replacement replacement-updated-key replacement-updated-auth",
      );
      await duplicate;
      expect(
        (
          (await (
            await f.request("/api/v1/notifications/subscriptions?username=alice", alice)
          ).json()) as any
        ).endpoints,
      ).toHaveLength(20);
      a.send("WEBPUSH UNREGISTER https://push.example.test/replacement");
      await a.waitForLine((l) =>
        l.includes("WEBPUSH UNREGISTER https://push.example.test/replacement"),
      );
      expect(
        (
          await f.request("/api/v1/notifications/subscribe", alice, "POST", {
            username: "alice",
            endpoint: "https://push.example.test/final",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request("/api/v1/notifications/subscribe", bob, "POST", {
            username: "bob",
            endpoint: "https://push.example.test/bob-independent",
          })
        ).status,
      ).toBe(200);
      await f.barrier(b);
      expect(b.lines.slice(offset).join("\n")).not.toMatch(
        /replacement|secret-irc|updated-at-capacity|updated-key|irc-excess/,
      );
      await f.stop();
      const rows = (await f.snapshot("webpush_subscriptions")).flat() as any[];
      expect(rows.filter((r) => r.user_key === "alice")).toHaveLength(20);
      expect(rows.filter((r) => r.user_key === "bob")).toHaveLength(1);
      const updatedRow = rows.find((r) => r.endpoint === "https://push.example.test/0");
      expect(updatedRow.user_key).toBe("alice");
      expect(JSON.parse(updatedRow.keys_json)).toEqual(updatedKeys);
      expect(
        rows.some((r) =>
          ["/forbidden", "/irc-excess", "/replacement", "/1"].some((end) =>
            r.endpoint.endsWith(end),
          ),
        ),
      ).toBe(false);
      await f.restart();
      expect(
        (
          (await (
            await f.request("/api/webpush/subscriptions?username=alice", alice)
          ).json()) as any
        ).endpoints,
      ).toHaveLength(20);
    } finally {
      await f.dispose();
    }
  });

  it("ABUSE-003 streamed oversized JSON preserves 413 across auth channel admin and legacy handlers without side effects", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice),
        b = await f.connect(bob);
      a.send("JOIN #boundedjson");
      await a.waitForLine((l) => l.includes(" 366 "));
      b.send("JOIN #boundedjson");
      await b.waitForLine((l) => l.includes(" 366 "));
      const sent = await f.request("/api/v1/channels/%23boundedjson/messages", alice, "POST", {
        content: "original-before-json-denials",
      });
      expect(sent.status).toBe(201);
      const messageId = ((await sent.json()) as any).message.id;
      const created = await f.request("/api/v1/channels/%23boundedjson/roles", alice, "POST", {
        name: "OriginalRole",
        permissions: [],
      });
      expect(created.status).toBe(201);
      const roleId = ((await created.json()) as any).role.id;
      const tables = [
        "users",
        "account_roles",
        "user_metadata",
        "account_settings",
        "messages",
        "channel_metadata",
        "channel_role_groups",
        "channel_user_roles",
        "webpush_subscriptions",
      ];
      await f.stop();
      const before = await Promise.all(tables.map((t) => f.snapshot(t)));
      await f.restart();
      const watcher = await f.connect(bob);
      watcher.send("JOIN #boundedjson");
      await watcher.waitForLine((l) => l.includes(" 366 "));
      const offset = watcher.lines.length;
      const channel = "/api/v1/channels/%23boundedjson";
      const cases: [string, string, typeof alice | null, unknown][] = [
        [
          "/api/v1/auth/register",
          "POST",
          null,
          { username: "oversizedcandidate", password: "unique-candidate-password-for-size" },
        ],
        [
          "/api/accounts/register",
          "POST",
          null,
          { username: "oversizedcandidate", password: "unique-legacy-password-for-size" },
        ],
        [
          "/api/v1/auth/login",
          "POST",
          null,
          { username: alice.username, password: alice.password },
        ],
        ["/api/v1/profiles/alice", "PATCH", alice, { bio: "oversized-profile" }],
        ["/api/profile/alice", "PATCH", alice, { bio: "oversized-profile" }],
        [
          "/api/v1/notifications/subscribe",
          "POST",
          alice,
          { username: "alice", endpoint: "https://push.example.test/oversized" },
        ],
        [
          "/api/webpush/subscribe",
          "POST",
          alice,
          { username: "alice", endpoint: "https://push.example.test/oversized" },
        ],
        [`${channel}/info`, "PATCH", alice, { topic: "oversized-topic" }],
        ["/api/channels/%23boundedjson/info", "PATCH", alice, { topic: "oversized-topic" }],
        [`${channel}/messages`, "POST", alice, { content: "oversized-message" }],
        [`${channel}/messages/${messageId}`, "PATCH", alice, { content: "oversized-edit" }],
        [`${channel}/roles`, "POST", alice, { name: "OversizedRole", permissions: [] }],
        [`${channel}/roles/${roleId}`, "PATCH", alice, { name: "OversizedRoleEdit" }],
        [`${channel}/roles/assign`, "POST", alice, { userId: bob.account.id, roleGroupId: roleId }],
        ["/admin/accounts/bob", "PATCH", root, { displayName: "oversized-admin" }],
        ["/api/v1/admin/accounts/bob", "PATCH", root, { displayName: "oversized-admin" }],
      ];
      for (const [route, method, actor, data] of cases) {
        const bytes = new TextEncoder().encode(
          JSON.stringify({ ...(data as any), padding: "x".repeat(70000) }),
        );
        // A stream has no declared Content-Length: rejection must come from the
        // runtime byte counter while reading, not only a header pre-check.
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 32768));
            controller.enqueue(bytes.subarray(32768));
            controller.close();
          },
        });
        const response = await f.server.mf.dispatchFetch(new URL(route, f.server.url).href, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
          },
          body: stream,
          duplex: "half",
        });
        expect.soft(response.status, `${method} ${route} streamed oversize`).toBe(413);
        expect(await response.text()).not.toMatch(/SQLITE|pbkdf2:|Error:|\bat .*\.mjs/);
        const malformed = await f.server.mf.dispatchFetch(new URL(route, f.server.url).href, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
          },
          body: '{"invalid":',
        });
        expect(malformed.status, `${method} ${route} malformed JSON`).toBe(400);
        expect(await malformed.text()).not.toMatch(/SQLITE|pbkdf2:|\bat .*\.mjs/);
      }
      await f.barrier(watcher);
      expect(watcher.lines.slice(offset).join("\n")).not.toMatch(/oversized-|OversizedRole/);
      await f.stop();
      expect(await Promise.all(tables.map((t) => f.snapshot(t)))).toEqual(before);
      await f.restart();
      const followup = await f.connect(alice);
      followup.send("JOIN #boundedjson");
      await followup.waitForLine((l) => l.includes(" 366 "));
      expect(
        (
          await f.request(`${channel}/messages`, alice, "POST", {
            content: "valid-followup-message",
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await f.request(`${channel}/roles`, alice, "POST", {
            name: "FollowupRole",
            permissions: [],
          })
        ).status,
      ).toBe(201);
      expect(
        (await f.request("/api/profile/alice", alice, "PATCH", { bio: "valid-followup-profile" }))
          .status,
      ).toBe(200);
      expect(
        (
          await f.request("/admin/accounts/bob", root, "PATCH", {
            displayName: "valid-followup-admin",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request("/api/v1/auth/login", null, "POST", {
            username: bob.username,
            password: bob.password,
          })
        ).status,
      ).toBe(200);
      await f.stop();
      expect(JSON.stringify(await f.snapshot("messages"))).toContain("valid-followup-message");
      expect(JSON.stringify(await f.snapshot("user_metadata"))).toContain("valid-followup-profile");
      expect((await f.snapshot("users")).flat()).toContainEqual(
        expect.objectContaining({ id: bob.account.id, display_name: "valid-followup-admin" }),
      );
    } finally {
      await f.dispose();
    }
  });

  it("ABUSE-003 oversized JSON bodies are rejected while legitimate profile updates persist", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const response = await f.server.mf.dispatchFetch(
        new URL("/api/v1/profiles/alice", f.server.url).href,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ bio: "oversized-marker", padding: "x".repeat(70000) }),
        },
      );
      expect.soft(response.status).toBe(413);
      expect(await response.text()).not.toMatch(/SQLITE|pbkdf2:|Error:/);
      expect(
        (
          await f.request("/api/v1/profiles/alice", alice, "PATCH", {
            bio: "valid-after-size-rejection",
          })
        ).status,
      ).toBe(200);
      expect(await (await f.request("/api/v1/profiles/bob", bob)).text()).not.toContain(
        "valid-after-size-rejection",
      );
      await f.stop();
      const metadata = JSON.stringify(await f.snapshot("user_metadata"));
      expect(metadata).not.toContain("oversized-marker");
      expect(metadata).toContain("valid-after-size-rejection");
    } finally {
      await f.dispose();
    }
  });

  it("ABUSE-004 failed authentication is rate limited without creating sessions or affecting another user", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const statuses: number[] = [],
        errors: string[] = [];
      for (let i = 0; i < 12; i++) {
        const response = await f.request("/api/v1/auth/login", null, "POST", {
          username: "alice",
          password: "wrong-password-marker",
        });
        statuses.push(response.status);
        errors.push(await response.text());
      }
      // The implemented account budget deliberately returns an auth failure (401)
      // with a rate-limit error; the separate public-IP budget uses HTTP 429.
      expect(statuses.every((s) => s === 401)).toBe(true);
      expect(errors[0]).toContain("Invalid credentials");
      expect(errors.slice(-3).every((e) => e.includes("Too many authentication attempts"))).toBe(
        true,
      );
      expect(
        (
          await f.request("/api/v1/auth/login", null, "POST", {
            username: "bob",
            password: bob.password,
          })
        ).status,
      ).toBe(200);
      expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
      await f.stop();
      const sessions = (await f.snapshot("api_sessions")).flat() as any[];
      expect(sessions.filter((r) => r.user_id === alice.account.id)).toHaveLength(1);
      expect(sessions.filter((r) => r.user_id === bob.account.id)).toHaveLength(2);
    } finally {
      await f.dispose();
    }
  });

  it("ABUSE-001 ABUSE-002 oversized IRC lines and frames disconnect the sender without publishing or crashing peers", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const b = await f.connect(bob);
      b.send("JOIN #bounded");
      await b.waitForLine((l) => l.includes(" 366 "));
      for (const bytes of [9000, 65537]) {
        const a = await f.connect(alice);
        a.send("JOIN #bounded");
        await a.waitForLine((l) => l.includes(" 366 "));
        const closed = once(a.ws, "close");
        a.ws.send(`PRIVMSG #bounded :oversized-marker-${"x".repeat(bytes)}`);
        await closed;
      }
      await f.barrier(b);
      expect(b.lines.join("\n")).not.toContain("oversized-marker-");
      expect(
        (
          await f.request("/api/v1/channels/%23bounded/messages", bob, "POST", {
            content: "healthy-after-frame-rejection",
          })
        ).status,
      ).toBe(201);
      const history = await f.request("/api/v1/channels/%23bounded/messages", bob);
      expect(history.status).toBe(200);
      const text = await history.text();
      expect(text).not.toContain("oversized-marker-");
      expect(text).toContain("healthy-after-frame-rejection");
      await f.stop();
      const messages = JSON.stringify(await f.snapshot("messages"));
      expect(messages).not.toContain("oversized-marker-");
      expect(messages).toContain("healthy-after-frame-rejection");
    } finally {
      await f.dispose();
    }
  });

  it("API-009 API-015 ABUSE-008 extreme history parameters remain bounded and cannot paginate into a secret channel", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice);
      a.send("JOIN #history");
      await a.waitForLine((l) => l.includes(" 366 "));
      a.send("MODE #history +s");
      await a.waitForLine((l) => l.includes("MODE #history +s"));
      for (let i = 0; i < 105; i++)
        expect(
          (
            await f.request("/api/v1/channels/%23history/messages", alice, "POST", {
              content: `bounded-history-${i}`,
            })
          ).status,
        ).toBe(201);
      for (const limit of ["-1", "0", "10000000000000", "Infinity", "abc", "1e99", "NaN"]) {
        const route = `/api/v1/channels/%23history/messages?limit=${limit}&before=&username=alice`;
        const denied = await f.request(route, bob);
        expect(denied.status).toBe(403);
        expect(await denied.text()).not.toContain("bounded-history-");
        const allowed = await f.request(route, alice);
        expect(allowed.status).toBe(200);
        const data = (await allowed.json()) as any;
        expect(data.messages.length).toBeGreaterThan(0);
        expect(data.messages.length).toBeLessThanOrEqual(100);
        expect(data.pagination.limit).toBeGreaterThanOrEqual(1);
        expect(data.pagination.limit).toBeLessThanOrEqual(100);
      }
      await f.stop();
      expect((await f.snapshot("messages")).flat()).toHaveLength(105);
    } finally {
      await f.dispose();
    }
  });

  it("ABUSE-009 ABUSE-010 malformed Unicode and forged server tags cannot crash the runtime or forge persisted identity", async () => {
    const f = await createMatrixFixture();
    let binary: TestIRCClient | undefined;
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      a.send("JOIN #tags");
      await a.waitForLine((l) => l.includes(" 366 "));
      a.send("MODE #tags +s");
      await a.waitForLine((l) => l.includes("MODE #tags +s"));
      b.send("JOIN #tags");
      await b.waitForLine((l) => l.includes(" 366 "));
      a.send(
        "@account=bob;msgid=forged-id;time=1900-01-01T00:00:00Z;foo=bad\\x PRIVMSG #tags :canonical-tag-message",
      );
      await b.waitForLine((l) => l.includes("canonical-tag-message"));
      await f.barrier(a);
      binary = new TestIRCClient(f.server.wsUrl, "binary.ircv3.net");
      await binary.connect();
      binary.send(`PASS ${alice.username}:${alice.password}`);
      await binary.register("alicebinary");
      binary.ws.send(Buffer.from([0xff, 0xfe, 0x0d, 0x0a]));
      await f.barrier(binary);
      const nul = await f.request("/api/v1/channels/%23tags/messages", alice, "POST", {
        content: "nul\u0000marker",
      });
      expect(nul.status).toBe(400);
      const response = await f.request("/api/v1/channels/%23tags/messages", alice);
      expect(response.status).toBe(200);
      const messages = ((await response.json()) as any).messages;
      const message = messages.find((m: any) => m.content === "canonical-tag-message");
      expect(message).toBeDefined();
      expect(message.senderAccount).toBe("alice");
      expect(message.senderNick).toBe("alice");
      expect(message.id).not.toBe("forged-id");
      expect(message.tags.account).not.toBe("bob");
      expect(message.tags.msgid).not.toBe("forged-id");
      expect(message.tags.time).not.toBe("1900-01-01T00:00:00Z");
      await f.barrier(c);
      expect(c.lines.join("\n")).not.toContain("canonical-tag-message");
      binary.close();
      await f.stop();
      const stored = JSON.stringify(await f.snapshot("messages"));
      expect(stored).toContain("canonical-tag-message");
      expect(stored).not.toContain("forged-id");
      expect(stored).not.toContain("nul\\u0000marker");
    } finally {
      binary?.close();
      await f.dispose();
    }
  });

  it("ABUSE-011 event subscriptions have a per-account cap and another account retains capacity", async () => {
    const f = await createMatrixFixture();
    const sockets: WebSocket[] = [];
    async function open(token: string): Promise<number> {
      const ws = new WebSocket(
        new URL("/api/v1/events", f.server.url).href.replace(/^http/, "ws"),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      sockets.push(ws);
      return new Promise((resolve, reject) => {
        ws.once("open", () => resolve(101));
        ws.once("error", reject);
        ws.once("unexpected-response", (_req, res) => {
          res.resume();
          resolve(res.statusCode!);
        });
      });
    }
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      for (let i = 0; i < 5; i++) expect(await open(alice.token)).toBe(101);
      expect(await open(alice.token)).toBe(429);
      expect(await open(bob.token)).toBe(101);
      expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    } finally {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.close();
        else ws.terminate();
      }
      await f.dispose();
    }
  });
});
