import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import { TestIRCClient } from "../helpers/miniflare-harness";

describe("matrix identity", () => {
  let f: Awaited<ReturnType<typeof createMatrixFixture>>;
  afterEach(async () => {
    await f?.dispose();
  });

  it("AUTH-005 AUTH-006 AUTH-007 AUTH-011 AUTH-012 AUTH-013 AUTH-022: independent credentials and device logout", async () => {
    f = await createMatrixFixture();
    const alice = await f.createActor("alice");
    const bob = await f.createActor("bob");
    const second = await f.login(alice.username, alice.password);
    expect(second.token).not.toBe(alice.token);
    expect(second.account.username).toBe(alice.account.username);
    expect(second.account.id).toBe(alice.account.id);
    expect(second.account.id).not.toBe(bob.account.id);
    for (const [username, password] of [
      ["alice", bob.password],
      ["unknown", alice.password],
    ]) {
      const res = await f.request("/api/v1/auth/login", null, "POST", {
        username,
        password,
      });
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).not.toContain('"token"');
    }
    expect((await f.request("/api/v1/auth/logout", alice, "POST")).status).toBe(200);
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(401);
    expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
  });

  it("USER-001 USER-002 USER-003 USER-004 USER-005 USER-006 USER-012 USER-013 USER-014: profile path and body identity are bound to session", async () => {
    f = await createMatrixFixture();
    const admin = await f.createActor("rootadmin", true);
    const alice = await f.createActor("alice");
    const bob = await f.createActor("bob");
    expect(
      (
        await f.request("/api/v1/profiles/bob", bob, "PATCH", {
          displayName: "Bob Original",
          avatar: "bob-avatar",
          customStatus: "bob-status",
        })
      ).status,
    ).toBe(200);
    const before = await (await f.request("/api/v1/profiles/bob", bob)).json();
    const denial = await f.request(
      "/api/v1/profiles/bob?user=alice",
      alice,
      "PATCH",
      {
        displayName: "stolen",
        avatar: "stolen",
        customStatus: "stolen",
      },
      { "x-user": "bob" },
    );
    expect(denial.status).toBe(403);
    expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(before);
    const protectedBefore = await (await f.request("/api/v1/profiles/alice", alice)).json();
    const malicious = await f.request("/api/v1/profiles/alice", alice, "PATCH", {
      username: "bob",
      displayName: "Alice Own",
      roles: ["admin"],
      isAdmin: true,
    });
    expect(malicious.status).toBe(400);
    expect(await (await f.request("/api/v1/profiles/alice", alice)).json()).toEqual(
      protectedBefore,
    );
    expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(before);
    const own = await f.request("/api/v1/profiles/alice", alice, "PATCH", {
      displayName: "Alice Own",
    });
    expect(own.status).toBe(200);
    const ownProfile = (await (await f.request("/api/v1/profiles/alice", alice)).json()) as any;
    expect(ownProfile.profile.displayName).toBe("Alice Own");
    expect(ownProfile.profile.roles).not.toContain("admin");
    expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(before);
    expect((await f.request("/admin/accounts", alice)).status).toBe(403);
    expect((await f.request("/admin/accounts", admin)).status).toBe(200);
    await f.stop();
    const rows = JSON.stringify(await f.snapshot("user_metadata"));
    expect(rows).toContain("Alice Own");
    expect(rows).toContain("Bob Original");
    expect(rows).not.toContain("stolen");
  });

  it("AUTH-008 AUTH-024 AUTH-025: disable revokes both devices and reenable does not revive them", async () => {
    f = await createMatrixFixture();
    const admin = await f.createActor("rootadmin", true);
    const alice = await f.createActor("alice");
    const second = await f.login(alice.username, alice.password);
    const bob = await f.createActor("bob");
    expect((await f.request("/admin/accounts/alice/disable", admin, "POST")).status).toBe(200);
    expect(
      (
        await f.request("/api/v1/auth/login", null, "POST", {
          username: alice.username,
          password: alice.password,
        })
      ).status,
    ).toBe(401);
    for (const a of [alice, second])
      expect((await f.request("/api/v1/profiles/alice", a)).status).toBe(401);
    expect((await f.request("/admin/accounts/alice/enable", admin, "POST")).status).toBe(200);
    for (const a of [alice, second])
      expect((await f.request("/api/v1/profiles/alice", a)).status).toBe(401);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    expect((await f.login(alice.username, alice.password)).token).toBeTruthy();
  });
});

describe("matrix role fixture integration", () => {
  it("provisions the requested identities through public interfaces and observes channel modes", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const names = [
        "ircop",
        "alice",
        "bob",
        "charlie",
        "founder",
        "chanadmin",
        "operator",
        "halfop",
        "voiced",
        "banned",
        "disabled",
        "servicebot",
        "expired",
      ];
      const actors = Object.fromEntries(
        await Promise.all(names.map(async (name) => [name, await f.createActor(name)])),
      ) as Record<string, MatrixActor>;
      for (const [name, role] of [
        ["ircop", "oper"],
        ["servicebot", "bot"],
      ])
        expect(
          (
            await f.request(`/admin/accounts/${name}/roles`, root, "POST", {
              role,
              action: "grant",
            })
          ).status,
        ).toBe(200);
      expect((await f.request("/admin/accounts/disabled/disable", root, "POST")).status).toBe(200);
      expect((await f.request("/api/v1/auth/logout", actors.expired, "POST")).status).toBe(200);
      expect((await f.request("/api/v1/profiles/disabled", actors.disabled)).status).toBe(401);
      expect((await f.request("/api/v1/profiles/expired", actors.expired)).status).toBe(401);
      expect((await f.request("/api/v1/profiles/alice")).status).toBe(401);
      const owner = await f.connect(actors.founder);
      owner.send("JOIN #matrixroles");
      await owner.waitForLine((l) => l.includes(" 366 ") && l.includes("#matrixroles"));
      expect(owner.lines.some((l) => l.includes(" 353 ") && l.includes("~founder"))).toBe(true);
      for (const [name, mode] of [
        ["chanadmin", "a"],
        ["operator", "o"],
        ["halfop", "h"],
        ["voiced", "v"],
      ]) {
        const client = await f.connect(actors[name]);
        client.send("JOIN #matrixroles");
        await client.waitForLine((l) => l.includes(" 366 ") && l.includes("#matrixroles"));
        const observed = owner.waitForNewLine((l) =>
          l.includes(` MODE #matrixroles +${mode} ${name}`),
        );
        owner.send(`MODE #matrixroles +${mode} ${name}`);
        await observed;
      }
      owner.send("MODE #matrixroles +b banned!*@*");
      await owner.waitForLine((l) => l.includes(" MODE #matrixroles +b banned!*@*"));
      const banned = await f.connect(actors.banned);
      banned.send("JOIN #matrixroles");
      await banned.waitForNumeric(474);
      expect(new Set([root, ...Object.values(actors)].map((a) => a.password)).size).toBe(
        names.length + 1,
      );
    } finally {
      await f.dispose();
    }
  }, 30000);
});

describe("matrix isolated identity substitution", () => {
  it.each([
    {
      surface: "URL",
      route: "/api/v1/profiles/bob",
      body: { displayName: "bad-path" },
      headers: {},
      expectedStatus: 403,
    },
    {
      surface: "body",
      route: "/api/v1/profiles/alice",
      body: {
        username: "bob",
        userId: "bob",
        displayName: "alice-body-control",
      },
      headers: {},
      expectedStatus: 400,
    },
    {
      surface: "query",
      route: "/api/v1/profiles/alice?username=bob&user=bob",
      body: { displayName: "alice-query-control" },
      headers: {},
      expectedStatus: 200,
    },
    {
      surface: "header",
      route: "/api/v1/profiles/alice",
      body: { displayName: "alice-header-control" },
      headers: { "x-user": "bob", "soju-username": "bob" },
      expectedStatus: 200,
    },
  ])(
    "binds $surface substitution to the authenticated actor",
    async ({ route, body, headers, expectedStatus }) => {
      const f = await createMatrixFixture();
      try {
        const alice = await f.createActor("alice");
        const bob = await f.createActor("bob");
        const charlie = await f.createActor("charlie");
        for (const [actor, displayName] of [
          [bob, "Bob safe"],
          [charlie, "Charlie safe"],
        ] as const)
          expect(
            (await f.request(`/api/v1/profiles/${actor.username}`, actor, "PATCH", { displayName }))
              .status,
          ).toBe(200);
        const beforeBob = await (await f.request("/api/v1/profiles/bob", bob)).json();
        const beforeCharlie = await (await f.request("/api/v1/profiles/charlie", charlie)).json();
        const res = await f.request(route, alice, "PATCH", body, headers as Record<string, string>);
        expect(res.status).toBe(expectedStatus);
        expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(beforeBob);
        expect(await (await f.request("/api/v1/profiles/charlie", charlie)).json()).toEqual(
          beforeCharlie,
        );
        if (expectedStatus === 200)
          expect(
            JSON.stringify(await (await f.request("/api/v1/profiles/alice", alice)).json()),
          ).toContain(body.displayName);
        await f.stop();
        const metadata = JSON.stringify(await f.snapshot("user_metadata"));
        expect(metadata).toContain("Bob safe");
        expect(metadata).toContain("Charlie safe");
        if (expectedStatus === 200) expect(metadata).toContain(body.displayName);
        else expect(metadata).not.toContain(body.displayName);
      } finally {
        await f.dispose();
      }
    },
  );

  it("USER-010 USER-011: NickServ groups and drops only the authenticated account's nicknames", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      a.send("NICK AliceExtra");
      await a.waitForLine((l) => / NICK :?AliceExtra/.test(l));
      a.send("NS GROUP");
      await a.waitForLine((l) => l.includes("Successfully grouped nickname AliceExtra"));
      a.send("NS DROP bob");
      await a.waitForLine((l) => l.includes("Could not drop nickname bob"));
      a.send("NICK bob");
      await a.waitForNumeric(433);
      a.send("NS DROP AliceExtra");
      await a.waitForLine((l) => l.includes("Successfully dropped nickname AliceExtra"));
      await Promise.all([f.barrier(a), f.barrier(b)]);
      const bobDetails = (await (await f.request("/admin/accounts/bob", root)).json()) as any;
      const aliceDetails = (await (await f.request("/admin/accounts/alice", root)).json()) as any;
      expect(bobDetails.registeredNicks).toContain("bob");
      expect(aliceDetails.registeredNicks).not.toContain("aliceextra");
      await f.stop();
      const nicks = JSON.stringify(await f.snapshot("registered_nicks"));
      expect(nicks).toContain('"nickname":"bob"');
      expect(nicks).not.toContain('"nickname":"aliceextra"');
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix authentication transports", () => {
  it("AUTH-014 AUTH-015: NickServ and SASL resolve the REST account principal", async () => {
    const f = await createMatrixFixture();
    const clients: TestIRCClient[] = [];
    try {
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const client = await f.connect(bob, "bobdevice");
      client.send(`NS IDENTIFY alice ${alice.password}`);
      const identified = await client.waitForLine(
        (l) => l.includes(" 900 ") && l.includes(" alice "),
      );
      expect(identified).toContain(" alice ");
      const sasl = new TestIRCClient(f.server.wsUrl);
      clients.push(sasl);
      await sasl.connect();
      sasl.send("CAP LS 302");
      await sasl.waitForLine((l) => l.includes(" CAP * LS "));
      sasl.send("CAP REQ :sasl");
      await sasl.waitForLine((l) => l.includes(" CAP * ACK "));
      sasl.send("AUTHENTICATE PLAIN");
      await sasl.waitForLine((l) => l.includes("AUTHENTICATE +"));
      sasl.send(
        `AUTHENTICATE ${Buffer.from(`alice\0alice\0${alice.password}`).toString("base64")}`,
      );
      const loggedIn = await sasl.waitForLine((l) => l.includes(" 900 "));
      expect(loggedIn).toContain(" alice ");
      await sasl.waitForNumeric(903);
      sasl.send("NICK AliceSasl\r\nUSER AliceSasl 0 * :Alice SASL\r\nCAP END");
      await sasl.waitForNumeric(1);
      sasl.send("JOIN #principals");
      await sasl.waitForLine((l) => l.includes(" 366 ") && l.includes("#principals"));
      sasl.send("MODE #principals +s");
      await sasl.waitForLine((l) => l.includes(" MODE #principals +s"));
      const info = await f.request("/api/v1/channels/%23principals/info", alice);
      expect(info.status).toBe(200);
      expect((await f.request("/api/v1/channels/%23principals/info", bob)).status).toBe(403);
    } finally {
      clients.forEach((client) => {
        client.close();
      });
      await f.dispose();
    }
  });
  it("AUTH-023: NickServ self password change revokes other devices without changing another account", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice");
      const alice2 = await f.login("alice", alice.password);
      const bob = await f.createActor("bob");
      const client = await f.connect(alice);
      const newPassword = "alice-new-password-123!";
      const disconnected = new Promise<void>((resolve) => client.ws.once("close", () => resolve()));
      client.send(`NS PASSWD ${newPassword}`);
      await disconnected;
      for (const actor of [alice, alice2])
        expect((await f.request("/api/v1/profiles/alice", actor)).status).toBe(401);
      expect(
        (
          await f.request("/api/v1/auth/login", null, "POST", {
            username: "alice",
            password: alice.password,
          })
        ).status,
      ).toBe(401);
      expect((await f.login("alice", newPassword)).account.id).toBe(alice.account.id);
      expect((await f.login("bob", bob.password)).account.id).toBe(bob.account.id);
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix expired and unauthenticated access", () => {
  it("AUTH-010: an expired session is rejected while another device remains valid", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice");
      const active = await f.login("alice", alice.password);
      const bob = await f.createActor("bob");
      await f.stop();
      async function files(dir: string): Promise<string[]> {
        const items = await readdir(dir, { withFileTypes: true });
        return (
          await Promise.all(
            items.map((e) =>
              e.isDirectory()
                ? files(join(dir, e.name))
                : Promise.resolve(e.name.endsWith(".sqlite") ? [join(dir, e.name)] : []),
            ),
          )
        ).flat();
      }
      let updates = 0;
      const hash = createHash("sha256").update(alice.token).digest("hex");
      for (const file of await files(f.directory)) {
        const db = new DatabaseSync(file);
        try {
          if (
            db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_sessions'")
              .get()
          )
            updates += Number(
              db.prepare("UPDATE api_sessions SET expires_at = 0 WHERE token_hash = ?").run(hash)
                .changes,
            );
        } finally {
          db.close();
        }
      }
      expect(updates).toBe(1);
      await f.restart();
      expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(401);
      expect((await f.request("/api/v1/profiles/alice", active)).status).toBe(200);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    } finally {
      await f.dispose();
    }
  });
  it("AUTH-001 AUTH-002 AUTH-003 AUTH-004: IRC NICK and USER alone cannot join or send messages", async () => {
    const f = await createMatrixFixture();
    const guest = new TestIRCClient(f.server.wsUrl);
    try {
      const bob = await f.createActor("bob");
      const b = await f.connect(bob);
      b.send("JOIN #preauth");
      await b.waitForLine((l) => l.includes(" 366 ") && l.includes("#preauth"));
      await guest.connect();
      guest.send(
        "NICK guest\r\nUSER guest 0 * :Guest\r\nJOIN #preauth\r\nPRIVMSG #preauth :preauth-channel-attack\r\nPRIVMSG bob :preauth-dm-attack\r\nPING :guest-barrier",
      );
      await guest.waitForLine((l) => l.includes(" PONG ") && l.includes("guest-barrier"));
      await f.barrier(b);
      expect(guest.lines.some((l) => l.includes(" 001 ") || l.includes(" JOIN #preauth"))).toBe(
        false,
      );
      expect(guest.lines.some((l) => l.includes(" 451 "))).toBe(true);
      expect(
        b.lines.some(
          (l) => l.includes("preauth-channel-attack") || l.includes("preauth-dm-attack"),
        ),
      ).toBe(false);
      await f.stop();
      expect(JSON.stringify(await f.snapshot("direct_messages"))).not.toContain(
        "preauth-dm-attack",
      );
      expect(JSON.stringify(await f.snapshot("messages"))).not.toContain("preauth-channel-attack");
    } finally {
      guest.close();
      await f.dispose();
    }
  });
});
