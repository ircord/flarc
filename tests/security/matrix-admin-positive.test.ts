import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture as newMatrixFixture } from "../helpers/matrix-fixture";

const routeTrace: any[] = [];
async function assertedAdminRead(response: Response): Promise<any> {
  expect(response.status).toBe(200);
  return response.json();
}
afterAll(() => {
  if (process.env.ADMIN_ROUTE_LOG)
    writeFileSync(process.env.ADMIN_ROUTE_LOG, JSON.stringify(routeTrace, null, 2));
});
for (const swapAliases of [false, true]) {
  async function createMatrixFixture() {
    const f = await newMatrixFixture();
    const request: typeof f.request = async (route, actor, method = "GET", body, headers) => {
      const actual = !swapAliases
        ? route
        : route.startsWith("/api/v1/admin/")
          ? `/admin/${route.slice("/api/v1/admin/".length)}`
          : route.startsWith("/admin/")
            ? `/api/v1/admin/${route.slice("/admin/".length)}`
            : route;
      const response = await f.request(actual, actor, method, body, headers);
      let domainOk: boolean | undefined;
      if (response.headers.get("content-type")?.includes("json")) {
        const data = (await response.clone().json()) as any;
        if (typeof data.ok === "boolean") domainOk = data.ok;
      }
      routeTrace.push({
        testTitle: expect.getState().currentTestName,
        method,
        url: actual,
        actor: actor?.username ?? "anonymous",
        status: response.status,
        ...(domainOk === undefined ? {} : { domainOk }),
      });
      return response;
    };
    return {
      ...f,
      get server() {
        return f.server;
      },
      request,
    };
  }

  describe(`matrix administrative positive controls and complete branch inventory${swapAliases ? " [swapped administrative aliases]" : ""}`, () => {
    it("ADMIN-014 ADMIN-015 ADMIN-024: operational statistics, configuration and broadcast with alias parity and recipient isolation", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const bob = await f.createActor("bob");
        const charlie = await f.createActor("charlie");

        const clientB = await f.connect(bob);
        const clientC = await f.connect(charlie);

        // 1. Stats route: GET /stats and GET /api/v1/admin/stats (ADMIN-015)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyStats = await f.request(`${prefix}/stats`, alice);
          expect(denyStats.status, `ordinary GET ${prefix}/stats`).toBe(403);
          const anonStats = await f.request(`${prefix}/stats`, null);
          expect(anonStats.status, `anonymous GET ${prefix}/stats`).toBe(401);

          const okStats = await f.request(`${prefix}/stats`, root);
          expect(okStats.status, `root GET ${prefix}/stats`).toBe(200);
          const statsData = (await okStats.json()) as any;
          expect(statsData).toHaveProperty("ok", true);
          expect(statsData).toHaveProperty("activeConnections");
          expect(statsData).toHaveProperty("registeredSessions");
        }

        // 2. Config route: POST /config and POST /api/v1/admin/config
        const denyConfig = await f.request("/admin/config", alice, "POST", {
          signupPolicy: "closed",
        });
        expect(denyConfig.status).toBe(403);
        const anonConfig = await f.request("/api/v1/admin/config", null, "POST", {
          signupPolicy: "closed",
        });
        expect(anonConfig.status).toBe(401);

        // Valid update via /admin/config
        const config1 = await f.request("/admin/config", root, "POST", {
          signupPolicy: "invite",
        });
        expect(config1.status).toBe(200);
        expect(((await config1.json()) as any).config.signupPolicy).toBe("invite");

        // Valid update via /api/v1/admin/config
        const config2 = await f.request("/api/v1/admin/config", root, "POST", {
          signupPolicy: "open",
        });
        expect(config2.status).toBe(200);
        expect(((await config2.json()) as any).config.signupPolicy).toBe("open");

        // 3. Broadcast route: POST /broadcast and POST /api/v1/admin/broadcast (ADMIN-014, ADMIN-024)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyBroadcast = await f.request(`${prefix}/broadcast`, alice, "POST", {
            message: "forbidden-broadcast-marker",
          });
          expect(denyBroadcast.status, `ordinary POST ${prefix}/broadcast`).toBe(403);
        }

        await Promise.all([f.barrier(clientB), f.barrier(clientC)]);
        expect(clientB.lines.some((l) => l.includes("forbidden-broadcast-marker"))).toBe(false);
        expect(clientC.lines.some((l) => l.includes("forbidden-broadcast-marker"))).toBe(false);

        // Positive broadcast on /admin/broadcast with notice
        const bNotice = clientB.waitForNewLine((l) => l.includes("authorized-notice-1"));
        const cNotice = clientC.waitForNewLine((l) => l.includes("authorized-notice-1"));

        const res1 = await f.request("/admin/broadcast", root, "POST", {
          message: "authorized-notice-1",
          notice: true,
        });
        expect(res1.status).toBe(200);
        expect(((await res1.json()) as any).sentCount).toBeGreaterThanOrEqual(2);
        await Promise.all([bNotice, cNotice]);

        // Positive broadcast on /api/v1/admin/broadcast
        const bMsg = clientB.waitForNewLine((l) => l.includes("authorized-broadcast-2"));
        const cMsg = clientC.waitForNewLine((l) => l.includes("authorized-broadcast-2"));

        const res2 = await f.request("/api/v1/admin/broadcast", root, "POST", {
          message: "authorized-broadcast-2",
        });
        expect(res2.status).toBe(200);
        expect(((await res2.json()) as any).sentCount).toBeGreaterThanOrEqual(2);
        await Promise.all([bMsg, cMsg]);
      } finally {
        await f.dispose();
      }
    });

    it("ADMIN-005 ADMIN-006 USER-009: session inspection, revocation, and active IRC user disconnection without secret exposure", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const bob = await f.createActor("bob");
        const charlie = await f.createActor("charlie");

        const clientB = await f.connect(bob);
        const clientC = await f.connect(charlie);

        // 1. Session listing: GET /sessions and GET /api/v1/admin/sessions
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denySessions = await f.request(`${prefix}/sessions`, alice);
          expect(denySessions.status, `ordinary GET ${prefix}/sessions`).toBe(403);
          const anonSessions = await f.request(`${prefix}/sessions`, null);
          expect(anonSessions.status, `anon GET ${prefix}/sessions`).toBe(401);

          const okSessions = await f.request(`${prefix}/sessions`, root);
          expect(okSessions.status, `root GET ${prefix}/sessions`).toBe(200);
          const payload = await okSessions.text();
          const data = JSON.parse(payload);
          expect(data).toHaveProperty("ok", true);
          expect(Array.isArray(data.sessions)).toBe(true);
          expect(data.sessions.some((s: any) => s.nickname === "bob")).toBe(true);
          expect(data.sessions.some((s: any) => s.nickname === "charlie")).toBe(true);

          // USER-009: No session tokens, passwords, or SCRAM secrets in response
          expect(payload).not.toContain(root.token);
          expect(payload).not.toContain(alice.token);
          expect(payload).not.toContain(bob.token);
          expect(payload).not.toContain(bob.password);
          expect(payload).not.toMatch(/token_hash|sessionToken|bearer|scram|salt/i);
        }

        // 2. Revoke session by sessionId: POST /admin/sessions/disconnect (ADMIN-005)
        const listRes = (await (await f.request("/admin/sessions", root)).json()) as any;
        const bobSession = listRes.sessions.find((s: any) => s.nickname === "bob");
        expect(bobSession?.sessionId).toBeTruthy();

        const denyDisconnect = await f.request("/admin/sessions/disconnect", alice, "POST", {
          sessionId: bobSession.sessionId,
        });
        expect(denyDisconnect.status).toBe(403);

        const bClosed = new Promise<void>((resolve) => clientB.ws.once("close", () => resolve()));
        const disconnectSession = await f.request("/admin/sessions/disconnect", root, "POST", {
          sessionId: bobSession.sessionId,
          reason: "Administrative session revocation",
        });
        expect(disconnectSession.status).toBe(200);
        expect(((await disconnectSession.json()) as any).ok).toBe(true);
        await bClosed;

        // Policy check: session disconnection closes the live connection but does NOT invalidate the underlying REST account token
        const profileAfterDisconnect = await f.request(`/api/v1/profiles/${bob.username}`, bob);
        expect(
          profileAfterDisconnect.status,
          "account bearer token remains valid after connection disconnect",
        ).toBe(200);

        // Charlie remains active and unaffected
        await f.barrier(clientC);
        expect(clientC.lines.some((l) => l.includes("Administrative session revocation"))).toBe(
          false,
        );

        // 3. Disconnect active IRC user by nickname: POST /api/v1/admin/sessions/disconnect (ADMIN-006)
        const clientB2 = await f.connect(bob);
        await f.barrier(clientB2);

        const denyNickDisconnect = await f.request(
          "/api/v1/admin/sessions/disconnect",
          alice,
          "POST",
          {
            nickname: "bob",
          },
        );
        expect(denyNickDisconnect.status).toBe(403);

        const b2Closed = new Promise<void>((resolve) => clientB2.ws.once("close", () => resolve()));
        const disconnectNick = await f.request("/api/v1/admin/sessions/disconnect", root, "POST", {
          nickname: "bob",
          reason: "Administrative nick disconnect",
        });
        expect(disconnectNick.status).toBe(200);
        expect(((await disconnectNick.json()) as any).ok).toBe(true);
        await b2Closed;

        // Charlie still untouched
        await f.barrier(clientC);
      } finally {
        await f.dispose();
      }
    });

    it("ADMIN-001 ADMIN-002 ADMIN-003 ADMIN-004 ADMIN-007 ADMIN-008 ADMIN-019 ADMIN-020 ADMIN-021 ADMIN-022 ADMIN-023 AUTH-009 AUTH-023 USER-009: account provisioning, profile, credentials, roles, enable/disable and deletion across aliases", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const unrelated = await f.createActor("unrelated");

        // 1. Account Creation: POST /admin/accounts, POST /api/v1/admin/accounts/register, and POST /admin/accounts/register
        const pass1 = "managed-pass-01-secure!";
        const pass2 = "managed-pass-02-secure!";
        const pass3 = "managed-pass-03-secure!";

        const denyCreate1 = await f.request("/admin/accounts", alice, "POST", {
          username: "managed1",
          password: pass1,
        });
        expect(denyCreate1.status).toBe(403);
        const denyCreate2 = await f.request("/api/v1/admin/accounts/register", alice, "POST", {
          username: "managed2",
          password: pass2,
        });
        expect(denyCreate2.status).toBe(403);

        const create1 = await f.request("/admin/accounts", root, "POST", {
          username: "managed1",
          password: pass1,
          displayName: "Managed User 1",
          roles: ["oper"],
        });
        expect(create1.status).toBe(201);
        expect(((await create1.json()) as any).ok).toBe(true);

        const create2 = await f.request("/api/v1/admin/accounts/register", root, "POST", {
          username: "managed2",
          password: pass2,
          displayName: "Managed User 2",
        });
        expect(create2.status).toBe(201);
        expect(((await create2.json()) as any).ok).toBe(true);

        const create3 = await f.request("/admin/accounts/register", root, "POST", {
          username: "managed3",
          password: pass3,
          displayName: "Managed User 3",
        });
        expect(create3.status).toBe(201);
        expect(((await create3.json()) as any).ok).toBe(true);

        // Created accounts can log in
        const actor1 = await f.login("managed1", pass1);
        const actor2 = await f.login("managed2", pass2);
        const actor3 = await f.login("managed3", pass3);
        expect(actor1.token).toBeTruthy();
        expect(actor2.token).toBeTruthy();
        expect(actor3.token).toBeTruthy();

        // 2. Account Listing: GET /admin/accounts and GET /api/v1/admin/accounts (ADMIN-001, ADMIN-019, USER-009)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyList = await f.request(`${prefix}/accounts`, alice);
          expect(denyList.status).toBe(403);

          const listRes = await f.request(`${prefix}/accounts`, root);
          expect(listRes.status).toBe(200);
          const listText = await listRes.text();
          expect(listText).toContain("managed1");
          expect(listText).toContain("managed2");
          expect(listText).toContain("managed3");
          expect(listText).toContain("unrelated");
          expect(listText).not.toContain(pass1);
          expect(listText).not.toContain(pass2);
          expect(listText).not.toMatch(
            /password_hash|passwordHash|storedKey|serverKey|scram|salt/i,
          );
        }

        // Query filter on account listing
        const filtered = await f.request("/admin/accounts?role=oper", root);
        expect(filtered.status).toBe(200);
        const filteredText = await filtered.text();
        expect(filteredText).toContain("managed1");
        expect(filteredText).not.toContain("managed2");

        // 3. Account Details: GET /admin/accounts/:username and GET /api/v1/admin/accounts/:username (ADMIN-002)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyDetails = await f.request(`${prefix}/accounts/managed1`, alice);
          expect(denyDetails.status).toBe(403);

          const okDetails = await f.request(`${prefix}/accounts/managed1`, root);
          expect(okDetails.status).toBe(200);
          const detailsData = (await okDetails.json()) as any;
          expect(detailsData.account.username).toBe("managed1");
          expect(detailsData.account.roles).toContain("oper");
          expect(JSON.stringify(detailsData)).not.toContain(pass1);
          expect(JSON.stringify(detailsData)).not.toMatch(
            /password_hash|storedKey|serverKey|salt/i,
          );
        }

        // 4. Account Update: PATCH /admin/accounts/:username and PATCH /api/v1/admin/accounts/:username
        const denyUpdate = await f.request("/admin/accounts/managed1", alice, "PATCH", {
          displayName: "Hacked Name",
        });
        expect(denyUpdate.status).toBe(403);

        const okUpdate1 = await f.request("/admin/accounts/managed1", root, "PATCH", {
          displayName: "Managed 1 Updated",
        });
        expect(okUpdate1.status).toBe(200);

        const okUpdate2 = await f.request("/api/v1/admin/accounts/managed1", root, "PATCH", {
          displayName: "Managed 1 Alias Updated",
        });
        expect(okUpdate2.status).toBe(200);

        const checkDetails = (await (
          await f.request("/admin/accounts/managed1", root)
        ).json()) as any;
        expect(checkDetails.account.displayName).toBe("Managed 1 Alias Updated");

        // 5. Profile routes: GET/PATCH /admin/profile/:username and /api/v1/admin/profile/:username
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyProfGet = await f.request(`${prefix}/profile/managed1`, alice);
          expect(denyProfGet.status).toBe(403);
          const denyProfPatch = await f.request(`${prefix}/profile/managed1`, alice, "PATCH", {
            customStatus: "Hacked Status",
          });
          expect(denyProfPatch.status).toBe(403);
        }

        const profPatch1 = await f.request("/admin/profile/managed1", root, "PATCH", {
          customStatus: "Status via /admin",
        });
        expect(profPatch1.status).toBe(200);
        const profGet1 = await assertedAdminRead(await f.request("/admin/profile/managed1", root));
        expect(profGet1.profile.customStatus).toBe("Status via /admin");

        const profPatch2 = await f.request("/api/v1/admin/profile/managed1", root, "PATCH", {
          customStatus: "Status via /api/v1/admin",
        });
        expect(profPatch2.status).toBe(200);
        const profGet2 = await assertedAdminRead(
          await f.request("/api/v1/admin/profile/managed1", root),
        );
        expect(profGet2.profile.customStatus).toBe("Status via /api/v1/admin");

        // 6. Role management: GET/POST /admin/accounts/:username/roles (ADMIN-007, ADMIN-008, ADMIN-022)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyRolesGet = await f.request(`${prefix}/accounts/managed1/roles`, alice);
          expect(denyRolesGet.status).toBe(403);
          const denyRolesPost = await f.request(
            `${prefix}/accounts/managed1/roles`,
            alice,
            "POST",
            {
              role: "admin",
              action: "grant",
            },
          );
          expect(denyRolesPost.status).toBe(403);
        }

        // Grant role via /admin
        const grantRes = await f.request("/admin/accounts/managed1/roles", root, "POST", {
          role: "bot",
          action: "grant",
        });
        expect(grantRes.status).toBe(200);
        const roles1 = (await (
          await f.request("/admin/accounts/managed1/roles", root)
        ).json()) as any;
        expect(roles1.roles).toContain("bot");
        expect(roles1.roles).toContain("oper");

        // Revoke role via /api/v1/admin
        const revokeRes = await f.request("/api/v1/admin/accounts/managed1/roles", root, "POST", {
          role: "oper",
          action: "revoke",
        });
        expect(revokeRes.status).toBe(200);
        const roles2 = (await (
          await f.request("/api/v1/admin/accounts/managed1/roles", root)
        ).json()) as any;
        expect(roles2.roles).not.toContain("oper");
        expect(roles2.roles).toContain("bot");

        // 7. Password reset on both aliases: POST /admin/accounts/:username/password and /api/v1/admin/... (ADMIN-021, AUTH-023)
        const nextPassA = "managed1-pass-stepA-99!";
        const nextPassB = "managed1-pass-stepB-99!";

        const denyReset = await f.request("/admin/accounts/managed1/password", alice, "POST", {
          password: nextPassA,
        });
        expect(denyReset.status).toBe(403);

        // Reset via /admin alias
        const resetResA = await f.request("/admin/accounts/managed1/password", root, "POST", {
          password: nextPassA,
        });
        expect(resetResA.status).toBe(200);
        expect(((await resetResA.json()) as any).ok).toBe(true);

        // Old session invalidated
        expect((await f.request("/api/v1/profiles/managed1", actor1)).status).toBe(401);
        // Login with nextPassA succeeds
        const actor1A = await f.login("managed1", nextPassA);
        expect(actor1A.token).toBeTruthy();

        // Reset via /api/v1/admin alias
        const resetResB = await f.request(
          "/api/v1/admin/accounts/managed1/password",
          root,
          "POST",
          {
            password: nextPassB,
          },
        );
        expect(resetResB.status).toBe(200);
        expect((await f.request("/api/v1/profiles/managed1", actor1A)).status).toBe(401);
        const actor1B = await f.login("managed1", nextPassB);
        expect(actor1B.token).toBeTruthy();

        // 8. Disable and enable: POST /accounts/disable, POST /accounts/:username/disable, POST /accounts/:username/enable (ADMIN-003, ADMIN-004, ADMIN-020)
        expect(
          (
            await f.request("/admin/accounts/disable", alice, "POST", {
              username: "managed1",
            })
          ).status,
        ).toBe(403);
        expect((await f.request("/admin/accounts/managed1/disable", alice, "POST")).status).toBe(
          403,
        );
        expect((await f.request("/admin/accounts/managed1/enable", alice, "POST")).status).toBe(
          403,
        );

        // Disable via /admin/accounts/disable
        const dis1 = await f.request("/admin/accounts/disable", root, "POST", {
          username: "managed1",
        });
        expect(dis1.status).toBe(200);
        expect((await f.request("/api/v1/profiles/managed1", actor1B)).status).toBe(401);
        expect(
          (
            await f.request("/api/v1/auth/login", null, "POST", {
              username: "managed1",
              password: nextPassB,
            })
          ).status,
        ).toBe(401);

        // Enable via /api/v1/admin/accounts/managed1/enable
        const en1 = await f.request("/api/v1/admin/accounts/managed1/enable", root, "POST");
        expect(en1.status).toBe(200);
        const actor1C = await f.login("managed1", nextPassB);
        expect(actor1C.token).toBeTruthy();

        // Disable via /api/v1/admin/accounts/managed1/disable
        const dis2 = await f.request("/api/v1/admin/accounts/managed1/disable", root, "POST");
        expect(dis2.status).toBe(200);
        expect((await f.request("/api/v1/profiles/managed1", actor1C)).status).toBe(401);

        // Enable via /admin/accounts/managed1/enable
        const en2 = await f.request("/admin/accounts/managed1/enable", root, "POST");
        expect(en2.status).toBe(200);
        expect((await f.login("managed1", nextPassB)).token).toBeTruthy();

        // 9. Account deletion across aliases: DELETE /admin/accounts/:username and /api/v1/admin/accounts/:username (AUTH-009)
        const denyDel = await f.request("/admin/accounts/managed2", alice, "DELETE");
        expect(denyDel.status).toBe(403);

        // Delete managed2 via /api/v1/admin
        const delRes2 = await f.request("/api/v1/admin/accounts/managed2", root, "DELETE");
        expect(delRes2.status).toBe(200);
        expect(((await delRes2.json()) as any).ok).toBe(true);

        // Delete managed3 via /admin
        const delRes3 = await f.request("/admin/accounts/managed3", root, "DELETE");
        expect(delRes3.status).toBe(200);
        expect(((await delRes3.json()) as any).ok).toBe(true);

        // AUTH-009: Deleted accounts cannot authenticate
        expect(
          (
            await f.request("/api/v1/auth/login", null, "POST", {
              username: "managed2",
              password: pass2,
            })
          ).status,
        ).toBe(401);
        expect(
          (
            await f.request("/api/v1/auth/login", null, "POST", {
              username: "managed3",
              password: pass3,
            })
          ).status,
        ).toBe(401);

        // Unrelated account remains completely healthy and accessible
        expect((await f.request("/api/v1/profiles/unrelated", unrelated)).status).toBe(200);

        // Verify DB state across stop
        await f.stop();
        const usersStr = JSON.stringify(await f.snapshot("users"));
        expect(usersStr).toContain('"username":"managed1"');
        expect(usersStr).not.toContain('"username":"managed2"');
        expect(usersStr).not.toContain('"username":"managed3"');
        expect(usersStr).toContain('"username":"unrelated"');

        const rolesStr = JSON.stringify(await f.snapshot("account_roles"));
        expect(rolesStr).toContain('"role":"bot"');
        expect(rolesStr).not.toContain('"role":"oper"');

        // Recreate the runtime and independently read account, credential and deletion effects.
        await f.restart();
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const persisted = await f.request(`${prefix}/accounts/managed1`, root);
          expect(persisted.status).toBe(200);
          const account = ((await persisted.json()) as any).account;
          expect(account).toMatchObject({
            username: "managed1",
            displayName: "Managed 1 Alias Updated",
          });
          expect(account.roles).toContain("bot");
          expect(account.roles).not.toContain("oper");
        }
        for (const oldActor of [actor1, actor1A, actor1B, actor1C])
          expect((await f.request("/api/v1/profiles/managed1", oldActor)).status).toBe(401);
        const fresh = await f.login("managed1", nextPassB);
        expect((await f.request("/api/v1/profiles/managed1", fresh)).status).toBe(200);
        for (const password of [pass1, nextPassA])
          expect(
            (
              await f.request("/api/v1/auth/login", null, "POST", {
                username: "managed1",
                password,
              })
            ).status,
          ).toBe(401);
        for (const [username, password] of [
          ["managed2", pass2],
          ["managed3", pass3],
        ])
          expect(
            (await f.request("/api/v1/auth/login", null, "POST", { username, password })).status,
          ).toBe(401);
        expect((await f.request("/api/v1/profiles/unrelated", unrelated)).status).toBe(200);
      } finally {
        await f.dispose();
      }
    });

    it("ADMIN-002: user and channel KV metadata administration across aliases and restart persistence", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        await f.createActor("bob");

        // 1. User KV metadata: GET, PUT, DELETE across aliases
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyGet = await f.request(`${prefix}/metadata/users/bob`, alice);
          expect(denyGet.status, `ordinary GET ${prefix}/metadata/users/bob`).toBe(403);
          const denyPut = await f.request(`${prefix}/metadata/users/bob`, alice, "PUT", {
            key: "test_key",
            value: "forbidden",
          });
          expect(denyPut.status, `ordinary PUT ${prefix}/metadata/users/bob`).toBe(403);
          const denyDel = await f.request(`${prefix}/metadata/users/bob/test_key`, alice, "DELETE");
          expect(denyDel.status, `ordinary DELETE ${prefix}/metadata/users/bob/test_key`).toBe(403);
        }

        // Authorized PUT single key via /admin
        const putUser1 = await f.request("/admin/metadata/users/bob", root, "PUT", {
          key: "security_clearance",
          value: "top-secret",
        });
        expect(putUser1.status).toBe(200);

        // Authorized PUT multiple entries via /api/v1/admin
        const putUser2 = await f.request("/api/v1/admin/metadata/users/bob", root, "PUT", {
          entries: { dept: "infosec", region: "emea" },
        });
        expect(putUser2.status).toBe(200);

        // Authorized GET via /admin and /api/v1/admin
        const getUser1 = await assertedAdminRead(
          await f.request("/admin/metadata/users/bob?keys=security_clearance,dept", root),
        );
        expect(getUser1.metadata.security_clearance).toBe("top-secret");
        expect(getUser1.metadata.dept).toBe("infosec");

        const getUser2 = await assertedAdminRead(
          await f.request("/api/v1/admin/metadata/users/bob", root),
        );
        expect(getUser2.metadata.region).toBe("emea");

        // Authorized DELETE via /admin and /api/v1/admin
        const delUser1 = await f.request("/admin/metadata/users/bob/region", root, "DELETE");
        expect(delUser1.status).toBe(200);

        const delUser2 = await f.request("/api/v1/admin/metadata/users/bob/dept", root, "DELETE");
        expect(delUser2.status).toBe(200);

        const getUserFinal = await assertedAdminRead(
          await f.request("/admin/metadata/users/bob", root),
        );
        expect(getUserFinal.metadata.security_clearance).toBe("top-secret");
        expect(getUserFinal.metadata.dept).toBeUndefined();
        expect(getUserFinal.metadata.region).toBeUndefined();

        // 2. Channel KV metadata: GET, PUT, DELETE across aliases
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyChanGet = await f.request(
            `${prefix}/metadata/channels/%23matrixmetadata`,
            alice,
          );
          expect(denyChanGet.status).toBe(403);
          const denyChanPut = await f.request(
            `${prefix}/metadata/channels/%23matrixmetadata`,
            alice,
            "PUT",
            {
              key: "topic_tag",
              value: "forbidden",
            },
          );
          expect(denyChanPut.status).toBe(403);
          const denyChanDel = await f.request(
            `${prefix}/metadata/channels/%23matrixmetadata/topic_tag`,
            alice,
            "DELETE",
          );
          expect(denyChanDel.status).toBe(403);
        }

        // Authorized PUT channel metadata via /admin
        const putChan1 = await f.request(
          "/admin/metadata/channels/%23matrixmetadata",
          root,
          "PUT",
          {
            key: "classification",
            value: "confidential",
          },
        );
        expect(putChan1.status).toBe(200);

        // Authorized PUT channel entries via /api/v1/admin
        const putChan2 = await f.request(
          "/api/v1/admin/metadata/channels/%23matrixmetadata",
          root,
          "PUT",
          {
            entries: { project: "matrix", tier: "production" },
          },
        );
        expect(putChan2.status).toBe(200);

        // Authorized GET channel metadata via /admin and /api/v1/admin
        const getChan1 = await assertedAdminRead(
          await f.request("/admin/metadata/channels/%23matrixmetadata", root),
        );
        expect(getChan1.metadata.classification).toBe("confidential");
        expect(getChan1.metadata.project).toBe("matrix");

        const getChan2 = await assertedAdminRead(
          await f.request("/api/v1/admin/metadata/channels/%23matrixmetadata?keys=tier", root),
        );
        expect(getChan2.metadata.tier).toBe("production");

        // Authorized DELETE channel key via /admin and /api/v1/admin
        const delChan1 = await f.request(
          "/admin/metadata/channels/%23matrixmetadata/project",
          root,
          "DELETE",
        );
        expect(delChan1.status).toBe(200);

        const delChan2 = await f.request(
          "/api/v1/admin/metadata/channels/%23matrixmetadata/tier",
          root,
          "DELETE",
        );
        expect(delChan2.status).toBe(200);

        const getChanFinal = await assertedAdminRead(
          await f.request("/admin/metadata/channels/%23matrixmetadata", root),
        );
        expect(getChanFinal.metadata.classification).toBe("confidential");
        expect(getChanFinal.metadata.project).toBeUndefined();
        expect(getChanFinal.metadata.tier).toBeUndefined();

        // 3. Inspect stopped SQLite database tables across restart
        await f.stop();
        const userMetaRows = JSON.stringify(await f.snapshot("user_metadata"));
        expect(userMetaRows).toContain("security_clearance");
        expect(userMetaRows).toContain("top-secret");
        expect(userMetaRows).not.toContain("dept");
        expect(userMetaRows).not.toContain("region");

        const chanMetaRows = JSON.stringify(await f.snapshot("channel_kv_metadata"));
        expect(chanMetaRows).toContain("classification");
        expect(chanMetaRows).toContain("confidential");
        expect(chanMetaRows).not.toContain("project");
        expect(chanMetaRows).not.toContain("tier");

        // Restart and confirm persistent read
        await f.restart();
        const postRestartUser = await assertedAdminRead(
          await f.request("/admin/metadata/users/bob", root),
        );
        expect(postRestartUser.metadata.security_clearance).toBe("top-secret");

        const postRestartChan = await assertedAdminRead(
          await f.request("/admin/metadata/channels/%23matrixmetadata", root),
        );
        expect(postRestartChan.metadata.classification).toBe("confidential");
      } finally {
        await f.dispose();
      }
    });

    it("ADMIN-009 ADMIN-010 ADMIN-011 ADMIN-017: channel lifecycle, registration, info, bot F configuration, and channel deletion across aliases", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const clientA = await f.connect(alice);

        const target1 = "#lifecyclechan1";
        const target2 = "#lifecyclechan2";
        const unrelated = "#unrelatedpreserved";
        clientA.send(`JOIN ${unrelated}`);
        await clientA.waitForLine((l) => l.includes(" 366 ") && l.includes(unrelated));

        // 1. Channel listing: GET /channels and GET /api/v1/admin/channels
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyList = await f.request(`${prefix}/channels`, alice);
          expect(denyList.status).toBe(403);

          const okList = await f.request(`${prefix}/channels`, root);
          expect(okList.status).toBe(200);
          const data = (await okList.json()) as any;
          expect(data).toHaveProperty("ok", true);
          expect(Array.isArray(data.channels)).toBe(true);
          expect(data.channels.some((c: any) => c.channelName === unrelated)).toBe(true);
        }

        // 2. Channel registration: POST /register on both aliases (ADMIN-009)
        const denyReg = await f.request(
          `/admin/channels/${encodeURIComponent(target1)}/register`,
          alice,
          "POST",
          {
            founder: "alice",
          },
        );
        expect(denyReg.status).toBe(403);

        // Register target1 via /admin
        const okReg1 = await f.request(
          `/admin/channels/${encodeURIComponent(target1)}/register`,
          root,
          "POST",
          {
            founder: "alice",
          },
        );
        expect(okReg1.status).toBe(200);

        // Register target2 via /api/v1/admin
        const okReg2 = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target2)}/register`,
          root,
          "POST",
          {
            founder: "alice",
          },
        );
        expect(okReg2.status).toBe(200);

        const checkReg1 = (await (
          await f.request(`/admin/channels/${encodeURIComponent(target1)}/info`, root)
        ).json()) as any;
        expect(checkReg1.channel.registered).toBe(true);
        expect(checkReg1.channel.founder).toBe("alice");

        // Unregister target1 via /api/v1/admin
        const denyUnreg = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target1)}/unregister`,
          alice,
          "POST",
        );
        expect(denyUnreg.status).toBe(403);

        const okUnreg = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target1)}/unregister`,
          root,
          "POST",
        );
        expect(okUnreg.status).toBe(200);
        const checkUnreg = (await (
          await f.request(`/admin/channels/${encodeURIComponent(target1)}/info`, root)
        ).json()) as any;
        expect(checkUnreg.channel.registered).toBe(false);

        // Unregister target2 via /admin
        const okUnreg2 = await f.request(
          `/admin/channels/${encodeURIComponent(target2)}/unregister`,
          root,
          "POST",
        );
        expect(okUnreg2.status).toBe(200);

        // Re-register target1 via /api/v1/admin
        const reReg = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target1)}/register`,
          root,
          "POST",
          {
            founder: "alice",
          },
        );
        expect(reReg.status).toBe(200);

        // 3. Channel details: GET /channels/:channel across aliases (ADMIN-010)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyDetails = await f.request(
            `${prefix}/channels/${encodeURIComponent(target1)}`,
            alice,
          );
          expect(denyDetails.status).toBe(403);

          const okDetails = await f.request(
            `${prefix}/channels/${encodeURIComponent(target1)}`,
            root,
          );
          expect(okDetails.status).toBe(200);
          const detailsData = (await okDetails.json()) as any;
          expect(detailsData.ok).toBe(true);
          expect(detailsData.channel.name).toBe(target1);
        }

        // 4. Channel info: GET & PATCH across aliases (ADMIN-011)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyInfoPatch = await f.request(
            `${prefix}/channels/${encodeURIComponent(target1)}/info`,
            alice,
            "PATCH",
            {
              description: "Malicious update",
            },
          );
          expect(denyInfoPatch.status).toBe(403);
        }

        const patch1 = await f.request(
          `/admin/channels/${encodeURIComponent(target1)}/info`,
          root,
          "PATCH",
          {
            description: "Configured description via /admin",
          },
        );
        expect(patch1.status).toBe(200);

        const patch2 = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target1)}/info`,
          root,
          "PATCH",
          {
            description: "Updated description via /api/v1/admin",
          },
        );
        expect(patch2.status).toBe(200);

        const infoCheck = (await (
          await f.request(`/admin/channels/${encodeURIComponent(target1)}/info`, root)
        ).json()) as any;
        expect(infoCheck.channel.description).toBe("Updated description via /api/v1/admin");

        // 5. Bot F configuration: GET & POST across aliases (ADMIN-017)
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyBotGet = await f.request(
            `${prefix}/channels/${encodeURIComponent(target1)}/bot`,
            alice,
          );
          expect(denyBotGet.status).toBe(403);
          const denyBotPost = await f.request(
            `${prefix}/channels/${encodeURIComponent(target1)}/bot`,
            alice,
            "POST",
            {
              enabled: true,
            },
          );
          expect(denyBotPost.status).toBe(403);
        }

        const botSet1 = await f.request(
          `/admin/channels/${encodeURIComponent(target1)}/bot`,
          root,
          "POST",
          {
            enabled: true,
            welcomeMessage: "Welcome from Bot via /admin",
          },
        );
        expect(botSet1.status).toBe(200);
        const botGet1 = await assertedAdminRead(
          await f.request(`/admin/channels/${encodeURIComponent(target1)}/bot`, root),
        );
        expect(botGet1.bot.enabled).toBe(true);
        expect(botGet1.bot.welcomeMessage).toBe("Welcome from Bot via /admin");

        const botSet2 = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target1)}/bot`,
          root,
          "POST",
          {
            enabled: true,
            welcomeMessage: "Welcome from Bot via /api/v1/admin",
          },
        );
        expect(botSet2.status).toBe(200);
        const botGet2 = await assertedAdminRead(
          await f.request(`/api/v1/admin/channels/${encodeURIComponent(target1)}/bot`, root),
        );
        expect(botGet2.bot.welcomeMessage).toBe("Welcome from Bot via /api/v1/admin");

        // 6. Channel deletion on both aliases: DELETE /admin/channels/:channel and /api/v1/admin/channels/:channel
        const denyDestroy = await f.request(
          `/admin/channels/${encodeURIComponent(target1)}`,
          alice,
          "DELETE",
          {
            purgeMessages: false,
          },
        );
        expect(denyDestroy.status).toBe(403);

        // Destroy target1 via /api/v1/admin
        const okDestroy1 = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target1)}`,
          root,
          "DELETE",
          {
            purgeMessages: true,
          },
        );
        expect(okDestroy1.status).toBe(200);

        // Destroy target2 via /admin
        const okDestroy2 = await f.request(
          `/admin/channels/${encodeURIComponent(target2)}`,
          root,
          "DELETE",
          {
            purgeMessages: false,
          },
        );
        expect(okDestroy2.status).toBe(200);

        // Confirm channels are unregistered and unrouted
        const checkDestroyed1 = (await (
          await f.request(`/admin/channels/${encodeURIComponent(target1)}/info`, root)
        ).json()) as any;
        expect(checkDestroyed1.channel.registered).toBe(false);

        // Unrelated channel remains active
        await f.barrier(clientA);
        const unrelatedInfo = await f.request(
          `/admin/channels/${encodeURIComponent(unrelated)}/info`,
          root,
        );
        expect(unrelatedInfo.status).toBe(200);

        // Verify SQLite state across stop
        await f.stop();
        const meta = JSON.stringify(await f.snapshot("channel_metadata"));
        expect(meta).toContain(unrelated);
      } finally {
        await f.dispose();
      }
    });

    it("ADMIN-011: channel moderation, message inspection, redaction, purge, modes, topic, and kick with IRC delivery and alias parity", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const bob = await f.createActor("bob");
        const outsider = await f.createActor("outsider");

        const clientA = await f.connect(alice);
        const clientB = await f.connect(bob);
        const clientOutsider = await f.connect(outsider);

        const target = "#modchannel";
        const outside = "#outsidechan";

        clientA.send(`JOIN ${target}`);
        await clientA.waitForLine((l) => l.includes(" 366 ") && l.includes(target));
        clientB.send(`JOIN ${target}`);
        await clientB.waitForLine((l) => l.includes(" 366 ") && l.includes(target));

        clientOutsider.send(`JOIN ${outside}`);
        await clientOutsider.waitForLine((l) => l.includes(" 366 ") && l.includes(outside));

        // Post messages from Alice
        const postMsg1 = await f.request(
          `/api/v1/channels/${encodeURIComponent(target)}/messages`,
          alice,
          "POST",
          {
            content: "message-to-redact-1",
          },
        );
        expect(postMsg1.status).toBe(201);
        const msg1 = ((await postMsg1.json()) as any).message;

        const postMsg2 = await f.request(
          `/api/v1/channels/${encodeURIComponent(target)}/messages`,
          alice,
          "POST",
          {
            content: "message-to-redact-2",
          },
        );
        expect(postMsg2.status).toBe(201);
        const msg2 = ((await postMsg2.json()) as any).message;

        const postMsg3 = await f.request(
          `/api/v1/channels/${encodeURIComponent(target)}/messages`,
          alice,
          "POST",
          {
            content: "message-to-purge-3",
          },
        );
        expect(postMsg3.status).toBe(201);

        // 1. Message inspection: GET /channels/:channel/messages across aliases
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const denyMsgs = await f.request(
            `${prefix}/channels/${encodeURIComponent(target)}/messages`,
            outsider,
          );
          expect(denyMsgs.status).toBe(403);

          const okMsgs = await f.request(
            `${prefix}/channels/${encodeURIComponent(target)}/messages`,
            root,
          );
          expect(okMsgs.status).toBe(200);
          const msgsText = await okMsgs.text();
          expect(msgsText).toContain("message-to-redact-1");
          expect(msgsText).toContain("message-to-redact-2");
          expect(msgsText).toContain("message-to-purge-3");
        }

        // 2. Message Redaction on both aliases: POST /messages/redact and POST /api/v1/admin/messages/redact
        const denyRedact = await f.request("/admin/messages/redact", outsider, "POST", {
          channel: target,
          msgId: msg1.id,
        });
        expect(denyRedact.status).toBe(403);

        // Redact msg1 via /admin/messages/redact
        const okRedact1 = await f.request("/admin/messages/redact", root, "POST", {
          channel: target,
          msgId: msg1.id,
          reason: "Administrative moderation alias A",
        });
        expect(okRedact1.status).toBe(200);

        // Redact msg2 via /api/v1/admin/messages/redact
        const okRedact2 = await f.request("/api/v1/admin/messages/redact", root, "POST", {
          channel: target,
          msgId: msg2.id,
          reason: "Administrative moderation alias B",
        });
        expect(okRedact2.status).toBe(200);

        const afterRedact = await (
          await f.request(`/admin/channels/${encodeURIComponent(target)}/messages`, root)
        ).text();
        expect(afterRedact).not.toContain("message-to-redact-1");
        expect(afterRedact).not.toContain("message-to-redact-2");
        expect(afterRedact).toContain("message-to-purge-3");

        // 3. Message Purge on both aliases: POST /channels/:channel/messages/purge
        const denyPurge = await f.request(
          `/admin/channels/${encodeURIComponent(target)}/messages/purge`,
          outsider,
          "POST",
          {
            all: true,
          },
        );
        expect(denyPurge.status).toBe(403);

        const okPurge = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target)}/messages/purge`,
          root,
          "POST",
          {
            all: true,
          },
        );
        expect(okPurge.status).toBe(200);

        const afterPurge = await (
          await f.request(`/admin/channels/${encodeURIComponent(target)}/messages`, root)
        ).text();
        expect(afterPurge).not.toContain("message-to-purge-3");

        // 4. Topic change on both aliases: POST /admin/channels/:channel/topic and /api/v1/admin/...
        const denyTopic = await f.request(
          `/admin/channels/${encodeURIComponent(target)}/topic`,
          outsider,
          "POST",
          {
            topic: "Denied topic",
          },
        );
        expect(denyTopic.status).toBe(403);

        // Topic update via /admin
        const topicLineA1 = clientA.waitForNewLine((l) => l.includes("authorized-topic-step1"));
        const topicLineB1 = clientB.waitForNewLine((l) => l.includes("authorized-topic-step1"));

        const okTopic1 = await f.request(
          `/admin/channels/${encodeURIComponent(target)}/topic`,
          root,
          "POST",
          {
            topic: "authorized-topic-step1",
          },
        );
        expect(okTopic1.status).toBe(200);
        await Promise.all([topicLineA1, topicLineB1]);

        // Topic update via /api/v1/admin
        const topicLineA2 = clientA.waitForNewLine((l) => l.includes("authorized-topic-step2"));
        const topicLineB2 = clientB.waitForNewLine((l) => l.includes("authorized-topic-step2"));

        const okTopic2 = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target)}/topic`,
          root,
          "POST",
          {
            topic: "authorized-topic-step2",
          },
        );
        expect(okTopic2.status).toBe(200);
        await Promise.all([topicLineA2, topicLineB2]);

        await f.barrier(clientOutsider);
        expect(clientOutsider.lines.some((l) => l.includes("authorized-topic-step"))).toBe(false);

        // 5. Mode change on both aliases: POST /api/v1/admin/channels/:channel/modes and /admin/...
        const denyModes = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target)}/modes`,
          outsider,
          "POST",
          {
            modeString: "+m",
            modeArgs: [],
          },
        );
        expect(denyModes.status).toBe(403);

        // Mode +m via /api/v1/admin
        const modeLineA1 = clientA.waitForNewLine((l) => l.includes(" MODE #modchannel +m"));
        const modeLineB1 = clientB.waitForNewLine((l) => l.includes(" MODE #modchannel +m"));

        const okModes1 = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target)}/modes`,
          root,
          "POST",
          {
            modeString: "+m",
            modeArgs: [],
          },
        );
        expect(okModes1.status).toBe(200);
        await Promise.all([modeLineA1, modeLineB1]);

        // Mode -m via /admin
        const modeLineA2 = clientA.waitForNewLine((l) => l.includes(" MODE #modchannel -m"));
        const modeLineB2 = clientB.waitForNewLine((l) => l.includes(" MODE #modchannel -m"));

        const okModes2 = await f.request(
          `/admin/channels/${encodeURIComponent(target)}/modes`,
          root,
          "POST",
          {
            modeString: "-m",
            modeArgs: [],
          },
        );
        expect(okModes2.status).toBe(200);
        await Promise.all([modeLineA2, modeLineB2]);

        await f.barrier(clientOutsider);
        expect(clientOutsider.lines.some((l) => l.includes(" MODE #modchannel "))).toBe(false);

        // 6. Kick member on both aliases: POST /channels/:channel/kick
        const denyKick = await f.request(
          `/admin/channels/${encodeURIComponent(target)}/kick`,
          outsider,
          "POST",
          {
            nickname: "bob",
          },
        );
        expect(denyKick.status).toBe(403);

        const kickLineA = clientA.waitForNewLine((l) => l.includes(" KICK #modchannel bob"));
        const kickLineB = clientB.waitForNewLine((l) => l.includes(" KICK #modchannel bob"));

        const okKick = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(target)}/kick`,
          root,
          "POST",
          {
            nickname: "bob",
            reason: "Admin kicked bob via api alias",
          },
        );
        expect(okKick.status).toBe(200);
        expect(((await okKick.json()) as any).ok).toBe(true);

        await Promise.all([kickLineA, kickLineB]);
        await f.barrier(clientOutsider);
        expect(clientOutsider.lines.some((l) => l.includes(" KICK #modchannel bob"))).toBe(false);
      } finally {
        await f.dispose();
      }
    });

    it("DM-021: network administrators do not automatically gain private conversation access unless an explicit policy grants it", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const bob = await f.createActor("bob");

        // Alice sends a private DM to Bob over IRC
        const clientA = await f.connect(alice);
        const clientB = await f.connect(bob);

        const dmMarker = "confidential-alice-to-bob-direct-message";
        const bReceived = clientB.waitForNewLine((l) => l.includes(dmMarker));
        clientA.send(`PRIVMSG bob :${dmMarker}`);
        await bReceived;

        // Bob replies to Alice
        const replyMarker = "bob-confidential-reply-to-alice";
        const aReceived = clientA.waitForNewLine((l) => l.includes(replyMarker));
        clientB.send(`PRIVMSG alice :${replyMarker}`);
        await aReceived;

        // 1. Rootadmin requests GET /api/v1/dms/bob/messages as rootadmin
        // In FlaRC, DMs are strictly between the caller and the target. Rootadmin has no direct message history with Bob.
        const rootBobDMs = await f.request("/api/v1/dms/bob/messages", root);
        expect(rootBobDMs.status).toBe(200);
        const rootBobText = await rootBobDMs.text();
        expect(rootBobText).not.toContain(dmMarker);
        expect(rootBobText).not.toContain(replyMarker);

        // 2. Rootadmin requests GET /api/v1/dms/alice/messages as rootadmin
        const rootAliceDMs = await f.request("/api/v1/dms/alice/messages", root);
        expect(rootAliceDMs.status).toBe(200);
        const rootAliceText = await rootAliceDMs.text();
        expect(rootAliceText).not.toContain(dmMarker);
        expect(rootAliceText).not.toContain(replyMarker);

        // 3. FlaRC administration has no route for DM inspection or redaction
        // /admin/messages/redact operates only on channels and cannot redact DMs
        const adminRoutes = ["/admin/messages/redact", "/api/v1/admin/messages/redact"];
        for (const route of adminRoutes) {
          const redactRes = await f.request(route, root, "POST", {
            channel: "#nonexistentchan",
            msgId: "irrelevant-id",
          });
          expect(redactRes.status).toBe(200);
          expect(((await redactRes.json()) as any).ok).toBe(false);
        }

        // 4. Server-side search by administrator cannot reveal Alice and Bob's private DMs
        // Prove search is implemented and returns a public positive control before trusting an empty private result.
        clientA.send("JOIN #adminsearchcontrol");
        await clientA.waitForLine((l) => l.includes(" 366 ") && l.includes("#adminsearchcontrol"));
        const searchControl = await f.request(
          "/api/v1/channels/%23adminsearchcontrol/messages",
          alice,
          "POST",
          { content: "publicadminsearchcontrol" },
        );
        expect(searchControl.status).toBe(201);
        const publicMessage = ((await searchControl.json()) as any).message;
        const publicSearch = await f.request(
          "/api/v1/search?q=publicadminsearchcontrol&in=%23adminsearchcontrol",
          root,
        );
        expect(publicSearch.status).toBe(200);
        const publicResult = (await publicSearch.json()) as any;
        expect(
          publicResult.messages.some(
            (message: any) =>
              message.id === publicMessage.id && message.content === "publicadminsearchcontrol",
          ),
        ).toBe(true);
        const rootSearch = await f.request("/api/v1/search?q=confidential-alice-to-bob", root);
        expect(rootSearch.status).toBe(200);
        const searchText = await rootSearch.text();
        expect(searchText).not.toContain(dmMarker);
        expect(searchText).not.toContain(replyMarker);

        // Alice and Bob can view their own DM history
        const aliceDMs = await (await f.request("/api/v1/dms/bob/messages", alice)).text();
        expect(aliceDMs).toContain(dmMarker);
        expect(aliceDMs).toContain(replyMarker);

        const bobDMs = await (await f.request("/api/v1/dms/alice/messages", bob)).text();
        expect(bobDMs).toContain(dmMarker);
        expect(bobDMs).toContain(replyMarker);
      } finally {
        await f.dispose();
      }
    });

    it("ADMIN-028 ADMIN-030: legacy and alias denial integrity and rejected attempt state immutability across all 40 operations", async () => {
      const f = await createMatrixFixture();
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const targetuser = await f.createActor("targetuser");
        const unrelated = await f.createActor("unrelated");

        const channel = "/channels/%23integritychan";
        // Create and register channel first with root
        const registered = await f.request(`/admin${channel}/register`, root, "POST", {
          founder: "rootadmin",
        });
        expect(registered.status).toBe(200);
        expect(((await registered.json()) as any).ok).toBe(true);
        const prepareObservers = async () => {
          const owner = await f.connect(root),
            member = await f.connect(targetuser),
            outsider = await f.connect(unrelated);
          for (const [client, name] of [
            [owner, "#integritychan"],
            [member, "#integritychan"],
            [outsider, "#integrityother"],
          ] as const) {
            client.send(`JOIN ${name}`);
            await client.waitForLine((l) => l.includes(" 366 ") && l.includes(name));
          }
          return [owner, member, outsider];
        };
        await prepareObservers();
        for (const [name, actor, content] of [
          ["%23integritychan", root, "protected-integrity-control"],
          ["%23integrityother", unrelated, "unrelated-integrity-control"],
        ] as const) {
          const sent = await f.request(`/api/v1/channels/${name}/messages`, actor, "POST", {
            content,
          });
          expect(sent.status).toBe(201);
        }

        const cases: [string, string, unknown?][] = [
          ["/config", "POST", { signupPolicy: "closed" }],
          ["/stats", "GET"],
          ["/broadcast", "POST", { message: "rejected-broadcast" }],
          ["/sessions", "GET"],
          ["/sessions/disconnect", "POST", { nickname: "targetuser" }],
          ["/accounts", "GET"],
          ["/accounts", "POST", { username: "rejected1", password: "pwd-rejected-123!" }],
          ["/accounts/register", "POST", { username: "rejected2", password: "pwd-rejected-123!" }],
          ["/accounts/disable", "POST", { username: "targetuser" }],
          ["/accounts/targetuser", "GET"],
          ["/accounts/targetuser", "PATCH", { displayName: "rejected" }],
          ["/accounts/targetuser", "DELETE"],
          ["/accounts/targetuser/password", "POST", { password: "rejected-pass-123!" }],
          ["/accounts/targetuser/disable", "POST"],
          ["/accounts/targetuser/enable", "POST"],
          ["/accounts/targetuser/roles", "GET"],
          ["/accounts/targetuser/roles", "POST", { role: "oper", action: "grant" }],
          ["/profile/targetuser", "GET"],
          ["/profile/targetuser", "PATCH", { customStatus: "rejected" }],
          ["/metadata/users/targetuser", "GET"],
          ["/metadata/users/targetuser", "PUT", { key: "note", value: "rejected" }],
          ["/metadata/users/targetuser/note", "DELETE"],
          ["/metadata/channels/%23integritychan", "GET"],
          ["/metadata/channels/%23integritychan", "PUT", { key: "note", value: "rejected" }],
          ["/metadata/channels/%23integritychan/note", "DELETE"],
          ["/messages/redact", "POST", { channel: "#integritychan", msgId: "nonexistent" }],
          ["/channels", "GET"],
          [channel, "GET"],
          [channel, "DELETE", { purgeMessages: false }],
          [`${channel}/info`, "GET"],
          [`${channel}/info`, "PATCH", { description: "rejected" }],
          [`${channel}/register`, "POST", { founder: "alice" }],
          [`${channel}/unregister`, "POST"],
          [`${channel}/modes`, "POST", { modeString: "+m", modeArgs: [] }],
          [`${channel}/topic`, "POST", { topic: "rejected" }],
          [`${channel}/kick`, "POST", { nickname: "targetuser" }],
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
          "channel_kv_metadata",
          "channel_permissions",
          "messages",
          "user_metadata",
          "security_settings",
          "channel_user_roles",
        ];

        await f.stop();
        const beforeSnapshot = await Promise.all(tables.map((t) => f.snapshot(t)));
        await f.restart();
        const observers = await prepareObservers();
        const notifications: any[][] = [[], [], []];
        const streams: WebSocket[] = [];
        for (const [i, actor] of [root, targetuser, unrelated].entries()) {
          const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
          expect(ticket.status).toBe(200);
          const socket = new WebSocket(
            `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
          );
          streams.push(socket);
          socket.on("message", (data) => notifications[i].push(JSON.parse(data.toString())));
          await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
          });
        }
        const starts = observers.map((client) => client.lines.length);

        // Run rejected operations as ordinary user (alice) and anonymous across both aliases
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          for (const [route, method, body] of cases) {
            const resAlice = await f.request(prefix + route, alice, method, body);
            expect(resAlice.status, `alice ${method} ${prefix}${route}`).toBe(403);

            const resAnon = await f.request(prefix + route, null, method, body);
            expect(resAnon.status, `anonymous ${method} ${prefix}${route}`).toBe(401);
          }
        }

        await Promise.all(observers.map((client) => f.barrier(client)));
        expect(notifications).toEqual([[], [], []]);
        for (const [i, client] of observers.entries())
          expect(client.lines.slice(starts[i]).filter((line) => !line.includes(" PONG "))).toEqual(
            [],
          );
        expect((await f.request("/api/v1/profiles/targetuser", targetuser)).status).toBe(200);
        expect(
          await (await f.request("/api/v1/channels/%23integritychan/messages", root)).text(),
        ).toContain("protected-integrity-control");
        expect(
          await (await f.request("/api/v1/channels/%23integrityother/messages", unrelated)).text(),
        ).toContain("unrelated-integrity-control");
        streams.forEach((socket) => {
          socket.terminate();
        });
        // Verify that after all rejected requests, SQLite persistent state is completely unmodified
        await f.stop();
        const afterSnapshot = await Promise.all(tables.map((t) => f.snapshot(t)));
        expect(afterSnapshot).toEqual(beforeSnapshot);
      } finally {
        await f.dispose();
      }
    });
  });
}
