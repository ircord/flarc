import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { adminAuditOutcome } from "../../server/utils/admin-audit";
import { join, observers } from "../helpers/admin-gap-fixture";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import { createMiniflareServer } from "../helpers/miniflare-harness";

async function accountFile(directory: string): Promise<string> {
  async function files(folder: string): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(folder, { withFileTypes: true })
        ).map((entry) =>
          entry.isDirectory()
            ? files(path.join(folder, entry.name))
            : Promise.resolve(
                entry.name.endsWith(".sqlite") ? [path.join(folder, entry.name)] : [],
              ),
        ),
      )
    ).flat();
  }
  for (const file of await files(directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get())
        return file;
    } finally {
      db.close();
    }
  }
  throw new Error("Accounts database not found");
}

async function accountState(directory: string) {
  async function files(folder: string): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(folder, { withFileTypes: true })
        ).map((entry) =>
          entry.isDirectory()
            ? files(path.join(folder, entry.name))
            : Promise.resolve(
                entry.name.endsWith(".sqlite") ? [path.join(folder, entry.name)] : [],
              ),
        ),
      )
    ).flat();
  }
  for (const file of await files(directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get())
        continue;
      const tables = [
        "users",
        "scram_credentials",
        "registered_nicks",
        "account_roles",
        "api_sessions",
        "api_session_details",
        "credential_policies",
        "credential_scopes",
        "user_metadata",
        "account_revisions",
        "account_operation_results",
        "account_event_outbox",
      ];
      return Object.fromEntries(
        tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
      );
    } finally {
      db.close();
    }
  }
  throw new Error("Accounts database not found");
}

it("targeted durable API sessions and scoped credentials revoke independently of other accounts", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const second = await f.login("alice", alice.password);
    const listing = await f.request("/api/v1/auth/sessions", alice);
    expect(listing.status).toBe(200);
    const sessions = ((await listing.json()) as any).sessions;
    expect(sessions).toHaveLength(2);
    expect(JSON.stringify(sessions)).not.toContain(alice.token);
    const victim = sessions.find((item: any) => !item.current);
    expect(victim.id).toBeTruthy();
    const a = await f.connect(alice),
      b = await f.connect(bob);
    for (const client of [a, b]) await join(client, "#identitybarrier");
    const witness = await observers(f, [alice, bob], [a, b]);
    try {
      await witness.barrier();
      const offsets = [a, b].map((client) => client.lines.length),
        eventOffsets = witness.received.map((lines) => lines.length);
      const before = await accountState(f.directory);
      expect((await f.request(`/api/v1/auth/sessions/${victim.id}`, bob, "DELETE")).status).toBe(
        403,
      );
      expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(200);
      expect(
        ((await (await f.request("/api/v1/auth/sessions", alice)).json()) as any).sessions,
      ).toEqual(sessions);
      const marker = await witness.barrier();
      for (const [i, client] of [a, b].entries())
        expect(client.lines.slice(offsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
      for (const [i, lines] of witness.received.entries())
        expect(lines.slice(eventOffsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
      expect(await accountState(f.directory)).toEqual(before);
    } finally {
      witness.close();
    }
    await f.restart();
    expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    const restoredSessions = (
      (await (await f.request("/api/v1/auth/sessions", alice)).json()) as any
    ).sessions;
    expect(restoredSessions.map((entry: any) => entry.id).sort()).toEqual(
      sessions.map((entry: any) => entry.id).sort(),
    );
    expect((await f.request(`/api/v1/auth/sessions/${victim.id}`, alice, "DELETE")).status).toBe(
      200,
    );
    expect((await f.request("/api/v1/profiles/alice", second)).status).toBe(401);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    expect(
      (
        await f.request("/api/v1/auth/credentials", alice, "POST", {
          label: "expired",
          expiresAt: Date.now() - 1,
          scopes: [{ operation: "*", resource: "*" }],
        })
      ).status,
    ).toBe(403);
    const create = await f.request("/api/v1/auth/credentials", alice, "POST", {
      label: "reader",
      expiresAt: Date.now() + 60000,
      scopes: [
        { operation: "rest.get", resource: "/api/v1/profiles/alice" },
        { operation: "profile.get", resource: "alice" },
      ],
    });
    expect(create.status).toBe(200);
    const credential = ((await create.json()) as any).credential;
    expect(credential.id).toBeTruthy();
    const listed = ((await (await f.request("/api/v1/auth/sessions", alice)).json()) as any)
      .sessions;
    expect(listed).toContainEqual(
      expect.objectContaining({ id: credential.id, kind: "integration", label: "reader" }),
    );
    expect(JSON.stringify(listed)).not.toContain(credential.token);
    const limited = { ...alice, token: credential.token };
    expect((await f.request("/api/v1/profiles/alice", limited)).status).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", limited)).status).toBe(403);
    expect((await f.request("/admin/accounts", limited)).status).toBe(403);
    await f.restart();
    expect((await f.request("/api/v1/profiles/alice", limited)).status).toBe(200);
    expect(
      (await f.request(`/api/v1/auth/sessions/${credential.id}`, alice, "DELETE")).status,
    ).toBe(200);
    expect((await f.request("/api/v1/profiles/alice", limited)).status).toBe(401);
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
  } finally {
    await f.dispose();
  }
}, 60000);

it("opt-in cookie sessions require exact origin and session-bound CSRF while bearer remains compatible", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const cookieLogin = await f.request(
      "/api/v1/auth/login",
      null,
      "POST",
      { username: "alice", password: alice.password },
      { Origin: f.server.url.origin, "X-FlaRC-Session": "cookie" },
    );
    expect(cookieLogin.status).toBe(200);
    const data = (await cookieLogin.json()) as any;
    expect(data.token).toBeUndefined();
    const setCookie = cookieLogin.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/__Host-flarc_session=.*HttpOnly.*Secure.*SameSite=Strict/i);
    const cookie = setCookie.split(";")[0];
    const mutate = (headers: Record<string, string>) =>
      f.request(
        "/api/v1/profiles/alice",
        null,
        "PATCH",
        { customStatus: "cookie-control" },
        { Cookie: cookie, ...headers },
      );
    const a = await f.connect(alice),
      b = await f.connect(bob);
    for (const client of [a, b]) await join(client, "#identitybarrier");
    const witness = await observers(f, [alice, bob], [a, b]);
    await witness.barrier();
    const offsets = [a, b].map((client) => client.lines.length),
      eventOffsets = witness.received.map((lines) => lines.length);
    const before = await accountState(f.directory);
    const profileBefore = await (await f.request("/api/v1/profiles/alice", alice)).json();
    expect((await mutate({})).status).toBe(403);
    expect((await mutate({ Authorization: "Basic invalid" })).status).toBe(401);
    expect(
      (await mutate({ Origin: "https://attacker.invalid", "X-CSRF-Token": data.csrfToken })).status,
    ).toBe(403);
    expect(
      (await mutate({ Origin: f.server.url.origin, "X-CSRF-Token": "0".repeat(64) })).status,
    ).toBe(403);
    const marker = await witness.barrier();
    for (const [i, client] of [a, b].entries())
      expect(client.lines.slice(offsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
    for (const [i, lines] of witness.received.entries())
      expect(lines.slice(eventOffsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
    expect(await accountState(f.directory)).toEqual(before);
    expect(await (await f.request("/api/v1/profiles/alice", alice)).json()).toEqual(profileBefore);
    witness.close();
    expect(
      (await mutate({ Origin: f.server.url.origin, "X-CSRF-Token": data.csrfToken })).status,
    ).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    await f.restart();
    expect(
      (await mutate({ Origin: f.server.url.origin, "X-CSRF-Token": data.csrfToken })).status,
    ).toBe(200);
  } finally {
    await f.dispose();
  }
}, 60000);

for (const enabled of [false, true]) {
  it(`audit ${enabled ? "enabled" : "default off"} stores only sanitized admin outcomes`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flarc-audit-feature-"));
    const bootstrap = `bootstrap-${randomUUID()}`;
    const options = {
      durableObjectsPersist: directory,
      bindings: {
        ADMIN_USERS: "rootadmin",
        ADMIN_TOKEN: bootstrap,
        ...(enabled ? { AUDIT_LOG_ENABLED: "true" } : {}),
      },
    };
    let server = await createMiniflareServer(options);
    const req = (
      route: string,
      token?: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(new URL(route, server.url), {
        method,
        headers: {
          ...headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      const password = `Secret-${randomUUID()}!`;
      expect(
        (
          await req(
            "/api/v1/auth/register",
            undefined,
            "POST",
            { username: "rootadmin", password },
            { "x-bootstrap-token": bootstrap },
          )
        ).status,
      ).toBe(201);
      expect(
        (await req("/api/v1/auth/register", undefined, "POST", { username: "alice", password }))
          .status,
      ).toBe(201);
      const root = (
        (await (
          await req("/api/v1/auth/login", undefined, "POST", { username: "rootadmin", password })
        ).json()) as any
      ).token as string;
      const alice = (
        (await (
          await req("/api/v1/auth/login", undefined, "POST", { username: "alice", password })
        ).json()) as any
      ).token as string;
      expect((await req("/admin/stats", root)).status).toBe(200);
      expect((await req("/admin/stats", alice)).status).toBe(403);
      expect((await req("/admin/stats")).status).toBe(401);
      expect((await req("/admin/accounts/alice/disable", undefined, "POST")).status).toBe(401);
      expect((await req("/admin/accounts/alice/disable", root, "POST")).status).toBe(200);
      expect((await req("/api/v1/admin/accounts/alice/enable", root, "POST")).status).toBe(200);
      const replacement = `Replacement-${randomUUID()}!`;
      expect(
        (await req("/admin/accounts/alice/password", root, "POST", { password: replacement }))
          .status,
      ).toBe(200);
      expect(
        (await req("/api/v1/admin/accounts/disable", root, "POST", { username: "ALICE" })).status,
      ).toBe(200);
      if (enabled) {
        await server.dispose();
        const db = new DatabaseSync(await accountFile(directory));
        try {
          db.exec(
            "CREATE TRIGGER fail_audit_test_ban BEFORE INSERT ON network_bans BEGIN SELECT RAISE(ABORT, 'injected backend failure'); END",
          );
        } finally {
          db.close();
        }
        server = await createMiniflareServer(options);
        const failed = await req("/admin/bans", root, "POST", {
          kind: "hostmask",
          value: "*!*@bad.example",
        });
        expect(failed.status).toBe(500);
      }
      const audit = await req("/admin/audit", root);
      expect(audit.status).toBe(200);
      const records = ((await audit.json()) as any).records;
      if (enabled) {
        expect(
          records.some(
            (r: any) =>
              r.action === "stats.read" && r.target === "stats" && r.outcome === "allowed",
          ),
        ).toBe(true);
        expect(records.some((r: any) => r.action === "stats.read" && r.outcome === "denied")).toBe(
          true,
        );
        const relevant = records.filter(
          (r: any) =>
            ["account.disable", "account.enable", "account.password.reset"].includes(r.action) &&
            r.outcome === "allowed",
        );
        expect(relevant.map((r: any) => r.action).sort()).toEqual(
          ["account.disable", "account.disable", "account.enable", "account.password.reset"].sort(),
        );
        expect(new Set(relevant.map((r: any) => r.target)).size).toBe(1);
        expect(
          records.some(
            (r: any) =>
              r.action === "account.disable" && r.outcome === "denied" && r.actor_id === null,
          ),
        ).toBe(true);
        expect(records.some((r: any) => r.action === "ban.create" && r.outcome === "error")).toBe(
          true,
        );
        expect(JSON.stringify(records)).not.toContain("injected backend failure");
      } else expect(records).toEqual([]);
      expect(JSON.stringify(records)).not.toContain(replacement);
      expect(JSON.stringify(records)).not.toContain(password);
      expect(JSON.stringify(records)).not.toContain(root);
      expect(JSON.stringify(records)).not.toContain(alice);
    } finally {
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60000);
}

it("scoped administrator grants do not cross account resources or aliases, and network bans revoke only the target", async () => {
  const f = await createMatrixFixture();
  let witness: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true),
      delegated = await f.createActor("delegate"),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const aliceIRC = await f.connect(alice),
      bobIRC = await f.connect(bob);
    for (const client of [aliceIRC, bobIRC]) await join(client, "#identitybarrier");
    witness = await observers(f, [alice, bob], [aliceIRC, bobIRC]);
    const preBanMarker = await witness.barrier();
    expect(aliceIRC.lines.some((line) => line.includes(preBanMarker))).toBe(true);
    expect(bobIRC.lines.some((line) => line.includes(preBanMarker))).toBe(true);
    expect(witness.received[0].some((line) => line.includes(preBanMarker))).toBe(true);
    expect(witness.received[1].some((line) => line.includes(preBanMarker))).toBe(true);
    expect(
      (
        await f.request("/admin/accounts/delegate/roles", root, "POST", {
          role: "admin",
          action: "grant",
        })
      ).status,
    ).toBe(200);
    const configured = await f.request("/admin/accounts/delegate/scopes", root, "PUT", {
      scopes: [
        { operation: "admin.route.accounts.get", resource: "alice" },
        { operation: "admin.rpc.getaccountdetails", resource: "alice" },
      ],
    });
    expect(configured.status).toBe(200);
    const constrainedResponse = await f.request("/api/v1/auth/credentials", root, "POST", {
      label: "scope-manager",
      expiresAt: Date.now() + 60000,
      scopes: [
        { operation: "rest.put", resource: "/admin/accounts/delegate/scopes" },
        { operation: "admin.route.accounts.put", resource: "delegate" },
        { operation: "admin.rpc.getaccountdetails", resource: "delegate" },
        { operation: "admin.scopes.write", resource: "*" },
      ],
    });
    expect(constrainedResponse.status).toBe(200);
    const constrained = {
      ...root,
      token: ((await constrainedResponse.json()) as any).credential.token,
    };
    await witness.barrier();
    const scopeBefore = await accountState(f.directory);
    const scopeIrcOffsets = [aliceIRC, bobIRC].map((client) => client.lines.length);
    const scopeEventOffsets = witness.received.map((lines) => lines.length);
    expect(
      (
        await f.request("/admin/accounts/delegate/scopes", constrained, "PUT", {
          scopes: [{ operation: "*", resource: "*" }],
        })
      ).status,
    ).toBe(403);
    const policy = await f.request("/admin/accounts/delegate/scopes", root);
    expect(policy.status).toBe(200);
    expect(await policy.json()).toMatchObject({
      restricted: true,
      scopes: [
        { operation: "admin.route.accounts.get", resource: "alice" },
        { operation: "admin.rpc.getaccountdetails", resource: "alice" },
      ],
    });
    for (const prefix of ["/admin", "/api/v1/admin"]) {
      const allowed = await f.request(`${prefix}/accounts/alice`, delegated);
      expect(allowed.status).toBe(200);
      expect(((await allowed.json()) as any).account.id).toBe(alice.account.id);
      expect((await f.request(`${prefix}/accounts/bob`, delegated)).status).toBe(403);
      expect(
        (
          await f.request(`${prefix}/accounts/delegate/scopes`, delegated, "PUT", {
            scopes: [{ operation: "*", resource: "*" }],
          })
        ).status,
      ).toBe(403);
    }
    const scopeBarrier = await witness.barrier();
    expect(await accountState(f.directory)).toEqual(scopeBefore);
    for (const [index, client] of [aliceIRC, bobIRC].entries())
      expect(
        client.lines.slice(scopeIrcOffsets[index]).filter((line) => !line.includes(scopeBarrier)),
      ).toEqual([]);
    for (const [index, lines] of witness.received.entries())
      expect(
        lines.slice(scopeEventOffsets[index]).filter((line) => !line.includes(scopeBarrier)),
      ).toEqual([]);
    const bansBeforeUnauthorizedAttempt = await f.request("/admin/bans", root);
    expect(bansBeforeUnauthorizedAttempt.status).toBe(200);
    expect(
      (await f.request("/admin/bans", bob, "POST", { kind: "account", value: alice.account.id }))
        .status,
    ).toBe(403);
    const bansAfterUnauthorizedAttempt = await f.request("/admin/bans", root);
    expect(await bansAfterUnauthorizedAttempt.json()).toEqual(
      await bansBeforeUnauthorizedAttempt.json(),
    );
    const created = await f.request("/admin/bans", root, "POST", {
      kind: "account",
      value: alice.account.id,
    });
    expect(created.status).toBe(200);
    const ban = ((await created.json()) as any).ban;
    expect(ban).toMatchObject({ kind: "account", value: alice.account.id });
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(401);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    const aliceIRCOffset = aliceIRC.lines.length;
    const eventOffsets = witness.received.map((lines) => lines.length);
    const postBanMarker = `account-ban-live-${randomUUID()}`;
    const received = witness.received;
    expect(
      (
        await f.request("/api/v1/channels/%23identitybarrier/messages", bob, "POST", {
          content: postBanMarker,
        })
      ).status,
    ).toBe(201);
    await bobIRC.waitForLine((line) => line.includes(postBanMarker));
    await expect
      .poll(() => received[1].some((line) => line.includes(postBanMarker)), {
        timeout: 4000,
        interval: 10,
      })
      .toBe(true);
    await f.barrier(bobIRC);
    expect(aliceIRC.lines.slice(aliceIRCOffset).some((line) => line.includes(postBanMarker))).toBe(
      false,
    );
    expect(
      witness.received[0].slice(eventOffsets[0]).some((line) => line.includes(postBanMarker)),
    ).toBe(false);
    expect(
      witness.received[1].slice(eventOffsets[1]).some((line) => line.includes(postBanMarker)),
    ).toBe(true);
    witness.close();
    witness = undefined;
    await f.stop();
    expect((await f.snapshot("network_bans")).flat()).toEqual([
      expect.objectContaining({ id: ban.id, kind: "account", value: alice.account.id }),
    ]);
    expect((await f.snapshot("users")).flat()).toContainEqual(
      expect.objectContaining({ id: bob.account.id, username: "bob" }),
    );
    await f.restart();
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(401);
    expect(await (await f.request("/admin/accounts/delegate/scopes", root)).json()).toMatchObject({
      restricted: true,
      scopes: [
        { operation: "admin.route.accounts.get", resource: "alice" },
        { operation: "admin.rpc.getaccountdetails", resource: "alice" },
      ],
    });
    for (const prefix of ["/admin", "/api/v1/admin"]) {
      expect((await f.request(`${prefix}/accounts/alice`, delegated)).status).toBe(200);
      expect((await f.request(`${prefix}/accounts/bob`, delegated)).status).toBe(403);
    }
    expect((await f.request(`/api/v1/admin/bans/${ban.id}`, root, "DELETE")).status).toBe(200);
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
  } finally {
    witness?.close();
    await f.dispose();
  }
}, 60000);

it("revoking one durable session blocks its hibernated event stream without affecting an independent session", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const second = await f.login("alice", alice.password);
    const owner = await f.connect(alice),
      receiver = await f.connect(bob);
    for (const client of [owner, receiver]) {
      const joined = client.waitForNewLine(
        (line) => line.includes(" 366 ") && line.includes("#sessions"),
      );
      client.send("JOIN #sessions");
      await joined;
    }
    async function stream(who: typeof alice) {
      const ticket = await f.request("/api/v1/auth/events-ticket", who, "POST");
      expect(ticket.status).toBe(200);
      const ws = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
      );
      sockets.push(ws);
      const lines: string[] = [];
      ws.on("message", (data) => lines.push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return lines;
    }
    const good = await stream(alice),
      stale = await stream(second);
    const sessions = ((await (await f.request("/api/v1/auth/sessions", alice)).json()) as any)
      .sessions;
    const victim = sessions.find((entry: any) => !entry.current);
    expect(victim).toBeDefined();
    await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
      name: "FlaRC",
      webSockets: "hibernate",
    });
    expect((await f.request(`/api/v1/auth/sessions/${victim.id}`, alice, "DELETE")).status).toBe(
      200,
    );
    const marker = `revoked-stream-${randomUUID()}`;
    const delivery = receiver.waitForNewLine((line) => line.includes(marker));
    expect(
      (await f.request("/api/v1/channels/%23sessions/messages", alice, "POST", { content: marker }))
        .status,
    ).toBe(201);
    await delivery;
    for (let i = 0; i < 400 && !good.some((line) => line.includes(marker)); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(good.some((line) => line.includes(marker))).toBe(true);
    expect(stale.some((line) => line.includes(marker))).toBe(false);
    expect((await f.request("/api/v1/auth/events-ticket", second, "POST")).status).toBe(401);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
  } finally {
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
}, 60000);

it("classifies administrative client rejections separately from internal errors", () => {
  expect(adminAuditOutcome({ statusCode: 403 })).toBe("denied");
  expect(adminAuditOutcome({ statusCode: 400 })).toBe("denied");
  expect(adminAuditOutcome({ statusCode: 500 })).toBe("error");
  expect(adminAuditOutcome(new Error("internal secret must not be logged"))).toBe("error");
});
