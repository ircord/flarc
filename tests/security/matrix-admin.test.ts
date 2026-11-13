import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture } from "../helpers/matrix-fixture";

describe("matrix network administration", () => {
  let f: Awaited<ReturnType<typeof createMatrixFixture>>;
  afterEach(async () => {
    await f?.dispose();
  });
  it("ADMIN-001 ADMIN-019 ADMIN-020 ADMIN-021 ADMIN-022 ADMIN-025 ADMIN-026 ADMIN-030: ordinary, founder and oper cannot mutate accounts", async () => {
    f = await createMatrixFixture();
    const root = await f.createActor("rootadmin", true);
    const alice = await f.createActor("alice");
    const bob = await f.createActor("bob");
    const founder = await f.createActor("founder");
    const ircop = await f.createActor("ircop");
    expect(
      (
        await f.request("/admin/accounts/ircop/roles", root, "POST", {
          role: "oper",
          action: "grant",
        })
      ).status,
    ).toBe(200);
    const client = await f.connect(founder);
    client.send("JOIN #matrixadmin");
    await client.waitForLine((l) => l.includes(" 366 ") && l.includes("#matrixadmin"));
    expect(client.lines.some((l) => l.includes(" 353 ") && l.includes("~founder"))).toBe(true);
    const before = await (await f.request("/admin/accounts/bob", root)).json();
    const tables = [
      "users",
      "account_roles",
      "scram_credentials",
      "registered_nicks",
      "channel_members",
      "channel_permissions",
    ];
    await f.stop();
    const beforeRows = await Promise.all(tables.map((table) => f.snapshot(table)));
    await f.restart();
    const cases: [string, string, unknown?][] = [
      ["/admin/accounts", "GET"],
      ["/admin/accounts/bob/disable", "POST"],
      ["/admin/accounts/bob/password", "POST", { password: "attacker-password-123" }],
      ["/admin/accounts/bob/roles", "POST", { role: "admin", action: "grant" }],
    ];
    for (const actor of [alice, founder, ircop, null])
      for (const [route, method, body] of cases) {
        const res = await f.request(route, actor, method, body);
        expect(res.status, `${actor?.username ?? "anonymous"} ${route}`).toBe(actor ? 403 : 401);
      }
    expect(await (await f.request("/admin/accounts/bob", root)).json()).toEqual(before);
    expect((await f.login(bob.username, bob.password)).token).toBeTruthy();
    const list = await f.request("/admin/accounts", root);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain("bob");
    await f.stop();
    const afterRows = await Promise.all(tables.map((table) => f.snapshot(table)));
    expect(afterRows).toEqual(beforeRows);
  });
});

describe("matrix administrative controls", () => {
  it("ADMIN-003 ADMIN-004 ADMIN-007 ADMIN-008: authorized account changes persist without affecting an unrelated account", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      for (const [action, expected] of [
        ["grant", true],
        ["revoke", false],
      ] as const) {
        const res = await f.request("/admin/accounts/bob/roles", root, "POST", {
          role: "oper",
          action,
        });
        expect(res.status).toBe(200);
        const data = (await (await f.request("/admin/accounts/bob/roles", root)).json()) as any;
        expect(data.roles.includes("oper")).toBe(expected);
      }
      expect((await f.request("/admin/accounts/bob/disable", root, "POST")).status).toBe(200);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(401);
      expect((await f.request("/admin/accounts/bob/enable", root, "POST")).status).toBe(200);
      expect((await f.login("bob", bob.password)).token).toBeTruthy();
      expect((await f.request("/api/v1/profiles/charlie", charlie)).status).toBe(200);
      await f.stop();
      const users = JSON.stringify(await f.snapshot("users"));
      expect(users).toContain('"username":"bob"');
      expect(users).toContain('"username":"charlie"');
      const roles = JSON.stringify(await f.snapshot("account_roles"));
      expect(roles).not.toContain('"role":"oper"');
    } finally {
      await f.dispose();
    }
  });
  it("AUTH-023: administrator password reset invalidates both old sessions and credentials", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const bob = await f.createActor("bob");
      const bob2 = await f.login("bob", bob.password);
      const charlie = await f.createActor("charlie");
      const nextPassword = "new-bob-password-321!";
      expect(
        (
          await f.request("/admin/accounts/bob/password", root, "POST", {
            password: nextPassword,
          })
        ).status,
      ).toBe(200);
      for (const actor of [bob, bob2])
        expect((await f.request("/api/v1/profiles/bob", actor)).status).toBe(401);
      expect(
        (
          await f.request("/api/v1/auth/login", null, "POST", {
            username: "bob",
            password: bob.password,
          })
        ).status,
      ).toBe(401);
      expect((await f.login("bob", nextPassword)).token).toBeTruthy();
      expect((await f.request("/api/v1/profiles/charlie", charlie)).status).toBe(200);
    } finally {
      await f.dispose();
    }
  });
  it("USER-009: public and administrative account responses omit password and SCRAM material", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      for (const [route, actor] of [
        ["/api/v1/profiles/bob", alice],
        ["/admin/accounts/bob", root],
        ["/admin/accounts", root],
      ] as const) {
        const res = await f.request(route, actor);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).not.toContain(bob.password);
        expect(body).not.toMatch(/password_hash|passwordHash|storedKey|serverKey|scram|salt/i);
      }
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix administrative broadcasts", () => {
  it("ADMIN-014 ADMIN-015 ADMIN-024: only a network administrator broadcasts to active IRC clients", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      for (const route of ["/admin/broadcast", "/api/v1/admin/broadcast"]) {
        const response = await f.request(route, alice, "POST", {
          message: "matrix-forbidden-broadcast",
        });
        expect(response.status).toBe(403);
      }
      await Promise.all([f.barrier(a), f.barrier(b)]);
      for (const client of [a, b])
        expect(client.lines.some((line) => line.includes("matrix-forbidden-broadcast"))).toBe(
          false,
        );
      const receivedA = a.waitForNewLine((line) => line.includes("matrix-authorized-broadcast"));
      const receivedB = b.waitForNewLine((line) => line.includes("matrix-authorized-broadcast"));
      expect(
        (
          await f.request("/admin/broadcast", root, "POST", {
            message: "matrix-authorized-broadcast",
          })
        ).status,
      ).toBe(200);
      await Promise.all([receivedA, receivedB]);
      expect((await f.request("/admin/stats", alice)).status).toBe(403);
      const stats = await f.request("/admin/stats", root);
      expect(stats.status).toBe(200);
      expect(await stats.json()).toHaveProperty("ok", true);
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix administrator route inventory", () => {
  it("denies each implemented route on both prefixes to every unprivileged principal without persistent mutation or delivery", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const founder = await f.createActor("founder");
      const operator = await f.createActor("operator");
      const ircop = await f.createActor("ircop");
      const revoked = await f.createActor("revoked");
      expect(
        (
          await f.request("/admin/accounts/ircop/roles", root, "POST", {
            role: "oper",
            action: "grant",
          })
        ).status,
      ).toBe(200);
      expect((await f.request("/api/v1/auth/logout", revoked, "POST")).status).toBe(200);
      const owner = await f.connect(founder);
      const op = await f.connect(operator);
      const oper = await f.connect(ircop);
      owner.send("JOIN #admininventory");
      await owner.waitForLine((l) => l.includes(" 366 ") && l.includes("#admininventory"));
      op.send("JOIN #admininventory");
      await op.waitForLine((l) => l.includes(" 366 ") && l.includes("#admininventory"));
      owner.send("MODE #admininventory +o operator");
      await owner.waitForLine((l) => l.includes(" MODE #admininventory +o operator"));
      oper.send(`NS IDENTIFY ircop ${ircop.password}`);
      await oper.waitForLine((l) => l.includes(" 900 ") && l.includes(" ircop "));
      const channel = "/channels/%23admininventory";
      const cases: [string, string, unknown?][] = [
        ["/config", "POST", { signupPolicy: "closed" }],
        ["/stats", "GET"],
        ["/broadcast", "POST", { message: "inventory-forbidden-broadcast" }],
        ["/sessions", "GET"],
        ["/sessions/disconnect", "POST", { nickname: "operator" }],
        ["/accounts", "GET"],
        ["/accounts", "POST", { username: "forged", password: "forged-password-123!" }],
        ["/accounts/register", "POST", { username: "forged", password: "forged-password-123!" }],
        ["/accounts/disable", "POST", { username: "bob" }],
        ["/accounts/bob", "GET"],
        ["/accounts/bob", "PATCH", { displayName: "forged" }],
        ["/accounts/bob", "DELETE"],
        ["/accounts/bob/password", "POST", { password: "forged-password-123!" }],
        ["/accounts/bob/disable", "POST"],
        ["/accounts/bob/enable", "POST"],
        ["/accounts/bob/roles", "GET"],
        ["/accounts/bob/roles", "POST", { role: "admin", action: "grant" }],
        ["/profile/bob", "GET"],
        ["/profile/bob", "PATCH", { displayName: "forged" }],
        ["/metadata/users/bob", "GET"],
        ["/metadata/users/bob", "PUT", { key: "note", value: "forged" }],
        ["/metadata/users/bob/note", "DELETE"],
        ["/metadata/channels/%23admininventory", "GET"],
        ["/metadata/channels/%23admininventory", "PUT", { key: "note", value: "forged" }],
        ["/metadata/channels/%23admininventory/note", "DELETE"],
        ["/messages/redact", "POST", { channel: "#admininventory", msgId: "guessed" }],
        ["/channels", "GET"],
        [channel, "GET"],
        [channel, "DELETE", { purgeMessages: false }],
        [`${channel}/info`, "GET"],
        [`${channel}/info`, "PATCH", { description: "forged" }],
        [`${channel}/register`, "POST", { founder: "alice" }],
        [`${channel}/unregister`, "POST"],
        [`${channel}/modes`, "POST", { modeString: "+m", modeArgs: [] }],
        [`${channel}/topic`, "POST", { topic: "forged" }],
        [`${channel}/kick`, "POST", { nickname: "operator" }],
        [`${channel}/bot`, "GET"],
        [`${channel}/bot`, "POST", { enabled: true }],
        [`${channel}/messages`, "GET"],
        [`${channel}/messages/purge`, "POST", { all: true }],
      ];
      const tables = [
        "users",
        "account_roles",
        "scram_credentials",
        "registered_nicks",
        "channel_metadata",
        "channel_permissions",
        "messages",
        "channel_kv_metadata",
      ];
      await f.stop();
      const before = await Promise.all(tables.map((t) => f.snapshot(t)));
      await f.restart();
      const observer = await f.connect(operator);
      observer.send("JOIN #admininventory");
      await observer.waitForLine((l) => l.includes(" 366 ") && l.includes("#admininventory"));
      for (const actor of [alice, bob, founder, operator, ircop, revoked, null])
        for (const prefix of ["/admin", "/api/v1/admin"])
          for (const [route, method, body] of cases) {
            const res = await f.request(prefix + route, actor, method, body);
            expect(
              res.status,
              `${actor?.username ?? "anonymous"} ${method} ${prefix}${route}`,
            ).toBe(!actor || actor === revoked ? 401 : 403);
          }
      await f.barrier(observer);
      expect(observer.lines.some((l) => l.includes("inventory-forbidden-broadcast"))).toBe(false);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
      await f.stop();
      const after = await Promise.all(tables.map((t) => f.snapshot(t)));
      expect(after).toEqual(before);
    } finally {
      await f.dispose();
    }
  }, 30000);
});

describe("matrix privileged account operations", () => {
  it("ADMIN-002 ADMIN-006 AUTH-009: provision, profile, update, disconnect and delete affect only the intended account", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const password = "managed-unique-password-123!";
      const created = await f.request("/api/v1/admin/accounts/register", root, "POST", {
        username: "managed",
        password,
      });
      expect(created.status).toBe(201);
      const managed = await f.login("managed", password);
      const managedClient = await f.connect(managed);
      const bobClient = await f.connect(bob);
      expect((await f.request("/admin/accounts/managed", root)).status).toBe(200);
      expect(
        (
          await f.request("/admin/accounts/managed", root, "PATCH", {
            displayName: "Managed Name",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request("/admin/profile/managed", root, "PATCH", {
            customStatus: "managed status",
          })
        ).status,
      ).toBe(200);
      expect(await (await f.request("/admin/profile/managed", root)).text()).toContain(
        "managed status",
      );
      const closed = new Promise<void>((resolve) =>
        managedClient.ws.once("close", () => resolve()),
      );
      const deny = await f.request("/admin/sessions/disconnect", alice, "POST", {
        nickname: "managed",
      });
      expect(deny.status).toBe(403);
      await f.barrier(managedClient);
      const disconnect = await f.request("/admin/sessions/disconnect", root, "POST", {
        nickname: "managed",
      });
      expect(disconnect.status).toBe(200);
      expect(((await disconnect.json()) as any).ok).toBe(true);
      await closed;
      await f.barrier(bobClient);
      expect((await f.request("/admin/accounts/managed", root, "DELETE")).status).toBe(200);
      expect(
        (
          await f.request("/api/v1/auth/login", null, "POST", {
            username: "managed",
            password,
          })
        ).status,
      ).toBe(401);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
      await f.stop();
      const users = JSON.stringify(await f.snapshot("users"));
      expect(users).not.toContain('"username":"managed"');
      expect(users).toContain('"username":"bob"');
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix privileged channel configuration", () => {
  it("ADMIN-009 ADMIN-010 ADMIN-011 ADMIN-017: administrators configure registered channels without altering unrelated channels", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const other = await f.connect(alice);
      other.send("JOIN #unrelated");
      await other.waitForLine((l) => l.includes(" 366 ") && l.includes("#unrelated"));
      const base = "/admin/channels/%23managed";
      const register = await f.request(`${base}/register`, root, "POST", {
        founder: "alice",
      });
      expect(register.status).toBe(200);
      expect(((await register.json()) as any).ok).toBe(true);
      const before = await (await f.request("/admin/channels/%23unrelated/info", root)).json();
      expect(
        (
          await f.request(`${base}/info`, alice, "PATCH", {
            description: "forged",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await f.request(`${base}/info`, root, "PATCH", {
            description: "managed-description",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request(`${base}/topic`, root, "POST", {
            topic: "managed-topic",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request(`${base}/bot`, root, "POST", {
            enabled: true,
            welcomeMessage: "welcome managed",
          })
        ).status,
      ).toBe(200);
      const info = await f.request(`${base}/info`, root);
      expect(info.status).toBe(200);
      const payload = await info.text();
      expect(payload).toContain("managed-description");
      expect(payload).toContain("managed-topic");
      expect(payload).toContain("alice");
      const bot = await (await f.request(`${base}/bot`, root)).text();
      expect(bot).toContain("welcome managed");
      expect(bot).toContain('"enabled":true');
      expect(await (await f.request("/admin/channels/%23unrelated/info", root)).json()).toEqual(
        before,
      );
      await f.stop();
      const metadata = JSON.stringify(await f.snapshot("channel_metadata"));
      expect(JSON.stringify(await f.snapshot("channel_kv_metadata"))).toContain(
        "managed-description",
      );
      expect(metadata).toContain("managed-topic");
      expect(metadata).toContain("welcome managed");
      await f.restart();
      expect(await (await f.request(`${base}/info`, root)).text()).toContain("managed-description");
      expect(await (await f.request(`${base}/bot`, root)).text()).toContain("welcome managed");
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix privileged administrative state", () => {
  it("persists administrative configuration, user and channel metadata, and channel lifecycle operations", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      await f.createActor("alice");
      const bob = await f.createActor("bob");
      expect(
        (
          await f.request("/admin/config", root, "POST", {
            signupPolicy: "closed",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request("/api/v1/auth/register", null, "POST", {
            username: "blocked",
            password: "blocked-password-123!",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await f.request("/admin/config", root, "POST", {
            signupPolicy: "open",
          })
        ).status,
      ).toBe(200);
      const base = "/admin/channels/%23lifecycle";
      expect(
        (
          await f.request(`${base}/register`, root, "POST", {
            founder: "alice",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request("/admin/metadata/users/bob", root, "PUT", {
            key: "matrixnote",
            value: "bob-metadata",
          })
        ).status,
      ).toBe(200);
      expect(
        await (await f.request("/admin/metadata/users/bob?keys=matrixnote", root)).text(),
      ).toContain("bob-metadata");
      expect(
        (
          await f.request("/admin/metadata/channels/%23lifecycle", root, "PUT", {
            key: "matrixnote",
            value: "channel-metadata",
          })
        ).status,
      ).toBe(200);
      expect(
        await (
          await f.request("/admin/metadata/channels/%23lifecycle?keys=matrixnote", root)
        ).text(),
      ).toContain("channel-metadata");
      expect((await f.request("/admin/metadata/users/bob/matrixnote", root, "DELETE")).status).toBe(
        200,
      );
      expect(
        await (await f.request("/admin/metadata/users/bob?keys=matrixnote", root)).text(),
      ).not.toContain("bob-metadata");
      expect(
        (await f.request("/admin/metadata/channels/%23lifecycle/matrixnote", root, "DELETE"))
          .status,
      ).toBe(200);
      expect(
        await (
          await f.request("/admin/metadata/channels/%23lifecycle?keys=matrixnote", root)
        ).text(),
      ).not.toContain("channel-metadata");
      expect((await f.request(`${base}/unregister`, root, "POST")).status).toBe(200);
      const info = (await (await f.request(`${base}/info`, root)).json()) as any;
      expect(info.channel.registered).toBe(false);
      expect(
        (
          await f.request(`${base}/register`, root, "POST", {
            founder: "alice",
          })
        ).status,
      ).toBe(200);
      const deletion = await f.request(base, root, "DELETE", {
        purgeMessages: false,
      });
      expect(deletion.status).toBe(200);
      expect(((await deletion.json()) as any).ok).toBe(true);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
      await f.stop();
      const userMetadata = JSON.stringify(await f.snapshot("user_metadata"));
      expect(userMetadata).not.toContain("bob-metadata");
      const channelMetadata = JSON.stringify(await f.snapshot("channel_kv_metadata"));
      expect(channelMetadata).not.toContain("channel-metadata");
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix privileged channel moderation", () => {
  it("applies administrator mode, redaction, purge and kick with coherent recipient delivery", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      const c = await f.connect(charlie);
      a.send("JOIN #adminmod");
      await a.waitForLine((l) => l.includes(" 366 ") && l.includes("#adminmod"));
      b.send("JOIN #adminmod");
      await b.waitForLine((l) => l.includes(" 366 ") && l.includes("#adminmod"));
      b.send("JOIN #preserved");
      await b.waitForLine((l) => l.includes(" 366 ") && l.includes("#preserved"));
      c.send("JOIN #preserved");
      await c.waitForLine((l) => l.includes(" 366 ") && l.includes("#preserved"));
      a.send("MODE #adminmod +s");
      await a.waitForLine((l) => l.includes(" MODE #adminmod +s"));
      const admin = "/admin/channels/%23adminmod";
      const api = "/api/v1/channels/%23adminmod";
      const first = await f.request(`${api}/messages`, alice, "POST", {
        content: "admin-redaction-marker",
      });
      expect(first.status).toBe(201);
      const message = ((await first.json()) as any).message;
      expect(
        (
          await f.request("/admin/messages/redact", root, "POST", {
            channel: "#adminmod",
            msgId: message.id,
          })
        ).status,
      ).toBe(200);
      expect(await (await f.request(`${admin}/messages`, root)).text()).not.toContain(
        "admin-redaction-marker",
      );
      const second = await f.request(`${api}/messages`, alice, "POST", {
        content: "admin-purge-marker",
      });
      expect(second.status).toBe(201);
      expect(
        (
          await f.request(`${admin}/messages/purge`, root, "POST", {
            all: true,
          })
        ).status,
      ).toBe(200);
      expect(await (await f.request(`${admin}/messages`, root)).text()).not.toContain(
        "admin-purge-marker",
      );
      const mode = await f.request(`${admin}/modes`, root, "POST", {
        modeString: "+m",
        modeArgs: [],
      });
      expect(mode.status).toBe(200);
      expect(await (await f.request(`${admin}/info`, root)).text()).toContain("m");
      const kick = await f.request(`${admin}/kick`, root, "POST", {
        nickname: "bob",
      });
      expect(kick.status).toBe(200);
      expect(((await kick.json()) as any).ok).toBe(true);
      await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
      expect(a.lines.some((l) => l.includes(" KICK #adminmod bob"))).toBe(true);
      expect(b.lines.some((l) => l.includes(" KICK #adminmod bob"))).toBe(true);
      expect(c.lines.some((l) => l.includes(" KICK #adminmod bob"))).toBe(false);
      expect((await f.request(`${api}/info`, bob)).status).toBe(403);
      const sessions = (await (await f.request("/admin/sessions", root)).json()) as any;
      expect(
        sessions.sessions.find((session: any) => session.nickname === "bob").channels,
      ).not.toContain("#adminmod");
      expect(
        sessions.sessions.find((session: any) => session.nickname === "bob").channels,
      ).toContain("#preserved");
      const unaffected = c.waitForNewLine((l) => l.includes("preserved-channel-message"));
      b.send("PRIVMSG #preserved :preserved-channel-message");
      await unaffected;
      b.send("PRIVMSG #adminmod :kick-must-not-deliver");
      await b.waitForNumeric(404);
      await f.barrier(a);
      expect(a.lines.some((line) => line.includes("kick-must-not-deliver"))).toBe(false);
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix administrator channel event delivery", () => {
  it("delivers authenticated administrator topic and mode changes to members and not outsiders", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      const c = await f.connect(charlie);
      a.send("JOIN #events");
      await a.waitForLine((l) => l.includes(" 366 ") && l.includes("#events"));
      b.send("JOIN #events");
      await b.waitForLine((l) => l.includes(" 366 ") && l.includes("#events"));
      const path = "/admin/channels/%23events";
      expect(
        (
          await f.request(`${path}/topic`, charlie, "POST", {
            topic: "denied-topic",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await f.request(`${path}/modes`, charlie, "POST", {
            modeString: "+m",
            modeArgs: [],
          })
        ).status,
      ).toBe(403);
      await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
      for (const client of [a, b, c])
        expect(client.lines.some((l) => l.includes("denied-topic"))).toBe(false);
      expect(
        (
          await f.request(`${path}/topic`, root, "POST", {
            topic: "admin-topic-marker",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request(`${path}/modes`, root, "POST", {
            modeString: "+m",
            modeArgs: [],
          })
        ).status,
      ).toBe(200);
      await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
      for (const client of [a, b]) {
        expect
          .soft(
            client.lines.some(
              (l) => / TOPIC #events :?admin-topic-marker/.test(l) && l.startsWith(":rootadmin!"),
            ),
          )
          .toBe(true);
        expect
          .soft(
            client.lines.some((l) => l.includes(" MODE #events +m") && l.startsWith(":rootadmin!")),
          )
          .toBe(true);
      }
      expect(
        c.lines.some((l) => l.includes("admin-topic-marker") || l.includes(" MODE #events +m")),
      ).toBe(false);
      const data = (await (await f.request(`${path}/info`, root)).json()) as any;
      expect(data.channel.topic).toBe("admin-topic-marker");
      expect(data.channel.modes).toContain("m");
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix administrator realtime events", () => {
  it("delivers authorized topic and mode events to channel event subscribers only", async () => {
    const f = await createMatrixFixture();
    const sockets: WebSocket[] = [];
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      const c = await f.connect(charlie);
      c.send("JOIN #outsider");
      await c.waitForLine((l) => l.includes(" 366 ") && l.includes("#outsider"));
      a.send("JOIN #eventprivate");
      await a.waitForLine((l) => l.includes(" 366 ") && l.includes("#eventprivate"));
      b.send("JOIN #eventprivate");
      await b.waitForLine((l) => l.includes(" 366 ") && l.includes("#eventprivate"));
      a.send("MODE #eventprivate +s");
      await a.waitForLine((l) => l.includes(" MODE #eventprivate +s"));
      async function subscribe(token: string) {
        const events: any[] = [];
        const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        sockets.push(ws);
        ws.on("message", (data) => events.push(JSON.parse(data.toString())));
        await new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
        return events;
      }
      const aEvents = await subscribe(alice.token);
      const bEvents = await subscribe(bob.token);
      const cEvents = await subscribe(charlie.token);
      const base = "/admin/channels/%23eventprivate";
      expect(
        (
          await f.request(`${base}/topic`, root, "POST", {
            topic: "topic-event-test",
            setBy: "forged-administrator",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request(`${base}/modes`, root, "POST", {
            modeString: "+m",
            modeArgs: [],
          })
        ).status,
      ).toBe(200);
      const msg = await f.request("/api/v1/channels/%23eventprivate/messages", alice, "POST", {
        content: "event-control-marker",
      });
      expect(msg.status).toBe(201);
      const outsiderMessage = await f.request(
        "/api/v1/channels/%23outsider/messages",
        charlie,
        "POST",
        { content: "outsider-event-control" },
      );
      expect(outsiderMessage.status).toBe(201);
      await vi.waitFor(
        () => {
          for (const events of [aEvents, bEvents])
            expect(
              events.some(
                (e) => e.type === "message.created" && e.data?.content === "event-control-marker",
              ),
            ).toBe(true);
          expect(
            cEvents.some(
              (e) => e.type === "message.created" && e.data?.content === "outsider-event-control",
            ),
          ).toBe(true);
        },
        { timeout: 3000, interval: 20 },
      );
      for (const events of [aEvents, bEvents]) {
        const topics = events.filter(
          (e) => e.type === "channel.topic_changed" && e.channelId === "#eventprivate",
        );
        const modes = events.filter(
          (e) => e.type === "channel.updated" && e.channelId === "#eventprivate",
        );
        expect.soft(topics).toHaveLength(1);
        expect.soft(modes).toHaveLength(1);
        expect
          .soft(topics[0]?.data)
          .toMatchObject({ topic: "topic-event-test", setBy: "rootadmin" });
        expect.soft(modes[0]?.data).toMatchObject({ modes: "+m", actor: "rootadmin" });
      }
      expect(cEvents.some((e) => e.channelId === "#eventprivate")).toBe(false);
      const info = (await (await f.request(`${base}/info`, root)).json()) as any;
      expect(info.channel.topicSetBy).toBe("rootadmin");
      sockets.forEach((ws) => {
        ws.close();
      });
      await f.stop();
      const tables = (await f.snapshot("channel_metadata")) as Array<
        Array<{ key: string; value: string }>
      >;
      const state = tables.find((rows) =>
        rows.some((row) => row.key === "name" && row.value === "#eventprivate"),
      );
      expect(state?.find((row) => row.key === "topic")?.value).toBe("topic-event-test");
      expect(state?.find((row) => row.key === "modes")?.value).toContain("m");
    } finally {
      sockets.forEach((ws) => {
        ws.close();
      });
      await f.dispose();
    }
  });
});
