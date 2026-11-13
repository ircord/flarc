import { createHash, createHmac, pbkdf2Sync, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  base64ToUint8Array,
  generateScramKeys,
  hmacSha256,
  sha256,
  uint8ArrayToBase64,
  xorBytes,
} from "~/core/authentication/scram";
import {
  type authGapFixture,
  hashToken,
  observedAuthFixture,
  sameProtected,
  wire,
} from "../helpers/auth-gap-fixture";
import type { MatrixActor } from "../helpers/matrix-fixture";

const traces: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.FLARC_AUTH_TRACE)
    writeFileSync(process.env.FLARC_AUTH_TRACE, JSON.stringify(traces, null, 2));
});
function save(f: { trace: unknown }) {
  traces[expect.getState().currentTestName!] = f.trace;
}
async function invalid(
  f: Awaited<ReturnType<typeof authGapFixture>>,
  username: string,
  password: string,
  error = "Invalid credentials",
) {
  const response = await f.request("/api/v1/auth/login", null, "POST", { username, password });
  expect(response.status).toBe(401);
  const body = (await response.json()) as any;
  expect(body.statusText).toBe(error);
  expect(body).not.toHaveProperty("token");
  expect(JSON.stringify(body)).not.toMatch(
    /password_hash|stored_key|server_key|disabled_at|credential_version|Unknown account/,
  );
  return body;
}
async function healthy(r: Awaited<ReturnType<typeof observedAuthFixture>>) {
  expect((await r.f.request("/api/v1/profiles/bob", r.bob)).status).toBe(200);
  expect((await r.f.request("/api/v1/profiles/charlie", r.charlie)).status).toBe(200);
  expect((await r.f.login("charlie", r.charlie.password)).account.id).toBe(r.charlie.account.id);
}
async function sasl(r: Awaited<ReturnType<typeof observedAuthFixture>>, mechanism = "PLAIN") {
  const c = await r.f.guest();
  await wire(c, "CAP LS 302", / CAP \* LS /);
  await wire(c, "CAP REQ :sasl", / CAP \* ACK /);
  await wire(c, `AUTHENTICATE ${mechanism}`, /AUTHENTICATE \+/);
  return c;
}

describe("supported authentication acceptance gaps", () => {
  it("AUTH-001 AUTH-002 AUTH-003 AUTH-004 AUTH-030: pre-auth whitelist is bounded and rejected commands cannot change protected state across recreation", async () => {
    const r = await observedAuthFixture();
    try {
      await r.flush();
      const before = await r.f.snapshot();
      await r.resume();
      await r.silence(async () => {
        const guest = await r.f.guest();
        guest.send("NICK anonymous\r\nUSER anonymous 0 * :Anonymous");
        await r.f.barrier(guest);
        for (const command of [
          "JOIN #protected",
          "PRIVMSG #protected :forbidden-preauth-channel",
          "PRIVMSG bob :forbidden-preauth-dm",
          "MODE #protected +o anonymous",
          "TOPIC #protected :forbidden-preauth-topic",
          "KICK #protected bob :forbidden-preauth-kick",
          "LIST",
          "WHO #protected",
          "CHATHISTORY LATEST #protected * 10",
          "NS INFO bob",
          "CS AMODE #protected +q anonymous",
          "OPER rootadmin wrong",
        ])
          await wire(guest, command, / 451 /);
        await wire(guest, "CAP LS 302", / CAP .* LS /);
        await wire(guest, "PING :whitelist-control", / PONG .*whitelist-control/);
        await wire(guest, "AUTHENTICATE EXTERNAL", / 904 /);
        await wire(guest, "VERIFY anonymous invalid-code", / FAIL VERIFY INVALID_CODE /);
        expect(
          guest.lines.some((line) =>
            / 001 | 900 | 903 | JOIN #protected|protected-auth-control/.test(line),
          ),
        ).toBe(false);
      });
      const rejected = await r.f.snapshot();
      sameProtected(before, rejected);
      await r.resume();
      const renewed = await r.f.guest();
      await wire(renewed, "JOIN #protected", / 451 /);
      await r.flush();
      expect((await r.f.request("/api/v1/profiles/alice", r.alice)).status).toBe(200);
      await healthy(r);
      expect(
        (
          await r.f.request("/api/v1/channels/%23protected/messages", r.alice, "POST", {
            content: "authenticated-after-preauth-control",
          })
        ).status,
      ).toBe(201);
      await r.good.until("authenticated-after-preauth-control");
      await r.flush();
    } finally {
      save(r.f);
      await r.dispose();
    }
  });

  it("AUTH-005 AUTH-006 AUTH-007 AUTH-011 AUTH-012 AUTH-013 AUTH-022 AUTH-029: real login and device logout persist while rejected credentials are uniform silent and inert", async () => {
    const r = await observedAuthFixture();
    try {
      await r.flush();
      const before = await r.f.snapshot();
      await r.resume();
      await r.silence(async () => {
        const wrong = await invalid(r.f, "alice", r.bob.password);
        const unknown = await invalid(r.f, "unknownaccount", r.alice.password);
        expect(wrong.statusText).toBe(unknown.statusText);
        expect(wrong.status).toBe(unknown.status);
      });
      const rejected = await r.f.snapshot();
      sameProtected(before, rejected);
      await r.resume();
      let second: MatrixActor | undefined;
      await r.silence(async () => {
        second = await r.f.login("alice", r.alice.password);
        expect(second.account.id).toBe(r.alice.account.id);
        expect(second.token).not.toBe(r.alice.token);
        expect(second.account.id).not.toBe(r.bob.account.id);
      });
      const sessions = await r.f.snapshot();
      sameProtected(rejected, sessions, ["api_sessions"]);
      expect(sessions.api_sessions).toContainEqual(
        expect.objectContaining({
          user_id: r.alice.account.id,
          token_hash: hashToken(second!.token),
        }),
      );
      await r.resume();
      await r.silence(async () => {
        expect((await r.f.request("/api/v1/auth/logout", r.alice, "POST")).status).toBe(200);
        expect((await r.f.request("/api/v1/profiles/alice", r.alice)).status).toBe(401);
        expect((await r.f.request("/api/v1/auth/events-ticket", r.alice, "POST")).status).toBe(401);
      });
      expect((await r.f.request("/api/v1/profiles/alice", second!)).status).toBe(200);
      const loggedOut = await r.f.snapshot();
      sameProtected(sessions, loggedOut, ["api_sessions"]);
      expect(
        loggedOut.api_sessions.some((row) => row.token_hash === hashToken(r.alice.token)),
      ).toBe(false);
      expect(
        loggedOut.api_sessions.some((row) => row.token_hash === hashToken(second!.token)),
      ).toBe(true);
      await r.resume();
      await r.silence(async () => {
        expect((await r.f.request("/api/v1/profiles/alice", r.alice)).status).toBe(401);
      });
      expect((await r.f.request("/api/v1/profiles/alice", second!)).status).toBe(200);
      await healthy(r);
      expect(
        (
          await r.f.request("/api/v1/channels/%23protected/messages", second!, "POST", {
            content: "second-device-live-control",
          })
        ).status,
      ).toBe(201);
      await r.good.until("second-device-live-control");
      await r.flush();
    } finally {
      save(r.f);
      await r.dispose();
    }
  });

  for (const state of ["disabled", "deleted"] as const)
    it(`AUTH-${state === "disabled" ? "008" : "009"} AUTH-012 AUTH-029: ${state} accounts cannot authenticate and expose the same safe credential error after restart`, async () => {
      const r = await observedAuthFixture();
      try {
        const actor = await r.f.create(state);
        const existing = await r.f.login(state, actor.password);
        const op = state === "disabled" ? "/disable" : "";
        expect(
          (
            await r.f.request(
              `/admin/accounts/${state}${op}`,
              r.root,
              state === "disabled" ? "POST" : "DELETE",
            )
          ).status,
        ).toBe(200);
        await r.flush();
        const before = await r.f.snapshot();
        await r.resume();
        await r.silence(async () => {
          const denial = await invalid(r.f, state, actor.password);
          const client = await r.f.guest();
          const denied = client.waitForNewLine((line) => line.includes(" 464 "));
          client.send(
            `PASS ${state}:${actor.password}\r\nNICK rejected${state}\r\nUSER rejected 0 * :Rejected`,
          );
          expect(await denied).toContain("Password incorrect");
          await wire(client, "JOIN #protected", / 451 /);
          expect(client.lines.some((line) => / 001 | 900 /.test(line))).toBe(false);
          const unknown = await invalid(r.f, "unknownaccount", actor.password);
          expect(denial.statusText).toBe(unknown.statusText);
          for (const token of [actor, existing])
            expect((await r.f.request(`/api/v1/profiles/${state}`, token)).status).toBe(401);
        });
        const after = await r.f.snapshot();
        sameProtected(before, after);
        expect(after.api_sessions.some((row) => row.user_id === actor.account.id)).toBe(false);
        if (state === "disabled")
          expect(after.users.find((row) => row.id === actor.account.id).disabled_at).toBeTypeOf(
            "number",
          );
        else {
          expect(after.users.some((row) => row.id === actor.account.id)).toBe(false);
          expect(after.account_tombstones).toContainEqual(
            expect.objectContaining({ canonical_username: state }),
          );
        }
        await r.resume();
        await invalid(r.f, state, actor.password);
        await healthy(r);
      } finally {
        save(r.f);
        await r.dispose();
      }
    });

  it("AUTH-010 AUTH-011 AUTH-022: independently expired and revoked real sessions stay denied while a fresh device survives recreation", async () => {
    const r = await observedAuthFixture();
    try {
      const expired = await r.f.create("expired"),
        activeExpired = await r.f.login(expired.username, expired.password),
        revoked = await r.f.login("alice", r.alice.password);
      await r.silence(async () => {
        expect((await r.f.request("/api/v1/auth/logout", revoked, "POST")).status).toBe(200);
      });
      await r.f.expire(expired);
      const before = await r.f.snapshot();
      expect(before.api_sessions).toContainEqual(
        expect.objectContaining({ token_hash: hashToken(expired.token), expires_at: 0 }),
      );
      await r.resume();
      await r.silence(async () => {
        for (const actor of [expired, revoked])
          for (const path of [
            "/api/v1/profiles/alice",
            "/api/v1/channels/%23protected/messages",
            "/api/v1/auth/events-ticket",
          ])
            expect(
              (await r.f.request(path, actor, path.endsWith("events-ticket") ? "POST" : "GET"))
                .status,
            ).toBe(401);
      });
      expect((await r.f.request("/api/v1/profiles/expired", activeExpired)).status).toBe(200);
      const after = await r.f.snapshot();
      sameProtected(before, after);
      await r.resume();
      expect((await r.f.request("/api/v1/profiles/expired", activeExpired)).status).toBe(200);
      for (const actor of [expired, revoked])
        expect((await r.f.request("/api/v1/profiles/alice", actor)).status).toBe(401);
      expect((await r.f.request("/api/v1/profiles/alice", r.alice)).status).toBe(200);
      await healthy(r);
    } finally {
      save(r.f);
      await r.dispose();
    }
  });

  for (const transport of ["NickServ", "SASL-PLAIN", "SCRAM-SHA-256"] as const)
    it(`AUTH-013 ${transport === "NickServ" ? "AUTH-014" : "AUTH-015"} AUTH-016 AUTH-017: ${transport} resolves stable identity and restores only its ChanServ grant`, async () => {
      const r = await observedAuthFixture();
      try {
        await wire(r.b, "CS AMODE #protected +o alice", / MODE #protected \+o alice/);
        await r.flush();
        const before = await r.f.snapshot();
        await r.resume();
        let c: Awaited<ReturnType<typeof r.f.guest>>;
        if (transport === "NickServ") {
          c = await r.f.connect(r.bob, "switcher");
          const reply = c.waitForNewLine(
            (line) => line.includes(" 900 ") && line.includes(" alice "),
          );
          c.send(`NS IDENTIFY alice ${r.alice.password}`);
          await reply;
        } else {
          c = await sasl(r, transport === "SASL-PLAIN" ? "PLAIN" : "SCRAM-SHA-256");
          if (transport === "SASL-PLAIN") {
            const reply = c.waitForNewLine((line) => line.includes(" 903 "));
            c.send(
              `AUTHENTICATE ${Buffer.from(`alice\0alice\0${r.alice.password}`).toString("base64")}`,
            );
            await reply;
          } else {
            const first = "n=alice,r=authgapnonce";
            const challenge = c.waitForNewLine(
              (line) => line.includes(" AUTHENTICATE ") && !line.endsWith(" +"),
            );
            c.send(`AUTHENTICATE ${Buffer.from(`n,,${first}`).toString("base64")}`);
            const serverFirst = Buffer.from(
              (await challenge).split(" ").at(-1)!,
              "base64",
            ).toString();
            const attrs = Object.fromEntries(
              serverFirst.split(",").map((v: string) => [v[0], v.slice(2)]),
            );
            const final = `c=biws,r=${attrs.r}`,
              auth = `${first},${serverFirst},${final}`;
            const salted = pbkdf2Sync(
              r.alice.password,
              Buffer.from(attrs.s, "base64"),
              Number(attrs.i),
              32,
              "sha256",
            );
            const key = createHmac("sha256", salted).update("Client Key").digest();
            const stored = createHash("sha256").update(key).digest();
            const signature = createHmac("sha256", stored).update(auth).digest();
            const proof = Buffer.from(key.map((value, index) => value ^ signature[index])).toString(
              "base64",
            );
            const server = c.waitForNewLine((line) => line.includes(" AUTHENTICATE "));
            c.send(`AUTHENTICATE ${Buffer.from(`${final},p=${proof}`).toString("base64")}`);
            const expected = createHmac(
              "sha256",
              createHmac("sha256", salted).update("Server Key").digest(),
            )
              .update(auth)
              .digest("base64");
            expect(Buffer.from((await server).split(" ").at(-1)!, "base64").toString()).toBe(
              `v=${expected}`,
            );
            const done = c.waitForNewLine((line) => line.includes(" 903 "));
            c.send("AUTHENTICATE +");
            await done;
          }
          const done = c.waitForNewLine((line) => line.includes(" 001 "));
          c.send(`NICK authdevice\r\nUSER authdevice 0 * :Real auth device\r\nCAP END`);
          await done;
        }
        await wire(c, "JOIN #protected", / 366 .*#protected/);
        const authorizedMode = r.b.waitForNewLine((line) => line.includes(" MODE #protected +m"));
        await wire(c, "MODE #protected +m", / MODE #protected \+m/);
        await authorizedMode;
        await wire(c, "JOIN #unrelated", / 366 .*#unrelated/);
        await r.silence(async () => {
          await wire(c, "MODE #unrelated +m", / 482 /);
          await wire(c, "MODE #protected +q alice", / 482 /);
        });
        const marker = `principal-${transport}`;
        const delivered = r.b.waitForNewLine((line) => line.includes(marker));
        c.send(`PRIVMSG #protected :${marker}`);
        await delivered;
        await r.flush();
        const after = await r.f.snapshot();
        expect(after.messages.find((row) => row.content === marker)).toMatchObject({
          sender_id: r.alice.account.id,
          sender_account: "alice",
        });
        expect(after.users).toEqual(before.users);
        expect(after.scram_credentials).toEqual(before.scram_credentials);
        expect(after.account_roles).toEqual(before.account_roles);
        expect(after.channel_permissions).toEqual(before.channel_permissions);
        expect(after.api_sessions).toEqual(before.api_sessions);
        await r.resume();
        expect((await r.f.login("alice", r.alice.password)).account.id).toBe(r.alice.account.id);
        await wire(r.a, "MODE #protected -m", / MODE #protected -m/);
        await healthy(r);
      } finally {
        save(r.f);
        await r.dispose();
      }
    });

  it("AUTH-006 AUTH-007 AUTH-012 AUTH-029: wrong and unknown IRC PASS and NickServ credentials have uniform inert failures", async () => {
    const r = await observedAuthFixture();
    try {
      await r.flush();
      const before = await r.f.snapshot();
      await r.resume();
      const probe = await r.f.connect(r.bob, "credentialprobe");
      await r.silence(async () => {
        const errors: string[] = [];
        for (const username of ["alice", "unknownaccount"]) {
          const client = await r.f.guest();
          const failed = client.waitForNewLine((line) => line.includes(" 464 "));
          client.send(
            `PASS ${username}:${r.bob.password}\r\nNICK bad${username}\r\nUSER rejected 0 * :Rejected`,
          );
          const reply = await failed;
          errors.push(reply.split(" :").at(-1)!);
          await wire(client, "JOIN #protected", / 451 /);
          expect(client.lines.some((line) => / 001 | 900 | 903 /.test(line))).toBe(false);
          const notice = probe.waitForNewLine((line) => line.includes(" NOTICE credentialprobe "));
          probe.send(`NS IDENTIFY ${username} ${r.bob.password}`);
          expect(await notice).toContain("Invalid account or password");
        }
        expect(errors).toEqual(["Password incorrect", "Password incorrect"]);
        expect(await wire(probe, "WHOAMI", / 900 /)).toContain(" bob ");
      });
      const after = await r.f.snapshot();
      sameProtected(before, after);
      await r.resume();
      await healthy(r);
    } finally {
      save(r.f);
      await r.dispose();
    }
  });

  it("AUTH-005 AUTH-018 AUTH-020 AUTH-030: allowed IRC REGISTER creates an ordinary durable principal and grants no administration", async () => {
    const r = await observedAuthFixture();
    try {
      const before = await r.f.snapshot();
      await r.resume();
      const client = await r.f.guest();
      const password = `IRC-signup-${randomUUID()}!`;
      await r.silence(async () => {
        const registered = client.waitForNewLine((line) => line.includes(" 920 "));
        client.send(`REGISTER ircsignup * ${password}`);
        expect(await registered).toContain("ircsignup");
      });
      const completed = client.waitForNewLine((line) => line.includes(" 001 "));
      client.send("NICK ircsignup\r\nUSER ircsignup 0 * :IRC signup");
      await completed;
      const actor = await r.f.login("ircsignup", password);
      expect(actor.account.roles).not.toContain("admin");
      await r.silence(async () => {
        expect((await r.f.request("/admin/accounts", actor)).status).toBe(403);
      });
      const after = await r.f.snapshot();
      expect(after.users).toContainEqual(
        expect.objectContaining({ id: actor.account.id, username: "ircsignup" }),
      );
      expect(after.account_roles).toEqual(before.account_roles);
      expect(
        after.scram_credentials.filter((row) => row.user_id === actor.account.id),
      ).toHaveLength(1);
      expect(after.api_sessions).toContainEqual(
        expect.objectContaining({ user_id: actor.account.id, token_hash: hashToken(actor.token) }),
      );
      await r.resume();
      expect((await r.f.login("ircsignup", password)).account.id).toBe(actor.account.id);
      await r.silence(async () => {
        expect((await r.f.request("/admin/accounts", actor)).status).toBe(403);
      });
      await healthy(r);
    } finally {
      save(r.f);
      await r.dispose();
    }
  });

  for (const finalKind of ["nonce", "binding", "proof-length"] as const)
    it(`AUTH-027: SCRAM final ${finalKind} rejection preserves credentials sessions and observed resources`, async () => {
      const r = await observedAuthFixture();
      try {
        const before = await r.f.snapshot();
        await r.resume();
        await r.silence(async () => {
          const client = await sasl(r, "SCRAM-SHA-256");
          const first = client.waitForNewLine((line) => line.includes(" AUTHENTICATE "));
          client.send(
            `AUTHENTICATE ${Buffer.from("n,,n=alice,r=malformed-final-nonce").toString("base64")}`,
          );
          const challenge = Buffer.from((await first).split(" ").at(-1)!, "base64").toString();
          const nonce = challenge.split(",")[0].slice(2);
          const final = `c=${finalKind === "binding" ? "AAAA" : "biws"},r=${finalKind === "nonce" ? "different-nonce" : nonce},p=AAAA`;
          const rejected = client.waitForNewLine((line) => line.includes(" 904 "));
          client.send(`AUTHENTICATE ${Buffer.from(final).toString("base64")}`);
          expect(await rejected).toContain("SASL authentication failed");
          await wire(client, "JOIN #protected", / 451 /);
          expect(client.lines.some((line) => / 900 | 903 | 001 /.test(line))).toBe(false);
        });
        const after = await r.f.snapshot();
        sameProtected(before, after);
        await r.resume();
        await healthy(r);
      } finally {
        save(r.f);
        await r.dispose();
      }
    });

  it("AUTH-018 AUTH-019: both public registration routes reject privilege injection without creating accounts or credentials", async () => {
    const r = await observedAuthFixture();
    try {
      await r.flush();
      const before = await r.f.snapshot();
      await r.resume();
      await r.silence(async () => {
        for (const [index, extra] of [
          { roles: ["admin"] },
          { isAdmin: true },
          { isOper: true },
          { account: { roles: ["admin"] } },
          { id: r.root.account.id },
          { bootstrapToken: r.f.bootstrap },
        ].entries())
          for (const route of ["/api/v1/auth/register", "/api/accounts/register"]) {
            const response = await r.f.request(route, null, "POST", {
              username: `injected${index}`,
              password: `Injection-${randomUUID()}!`,
              ...extra,
            });
            expect(response.status).toBe(400);
            expect(((await response.json()) as any).statusText).toMatch(/Unrecognized key/);
          }
        expect(
          (
            await r.f.request("/api/v1/auth/register", null, "POST", {
              username: "rootadmin",
              password: `Reserved-${randomUUID()}!`,
            })
          ).status,
        ).toBe(400);
      });
      const rejected = await r.f.snapshot();
      sameProtected(before, rejected);
      await r.resume();
      const regular = await r.f.create("regular");
      expect(regular.account.roles).not.toContain("admin");
      await r.silence(async () => {
        expect((await r.f.request("/admin/accounts", regular)).status).toBe(403);
      });
      const created = await r.f.snapshot();
      expect(created.account_roles.filter((row) => row.user_id === regular.account.id)).toEqual([]);
      expect(created.users.filter((row) => row.username.startsWith("injected"))).toEqual([]);
      await r.resume();
      expect((await r.f.login("regular", regular.password)).account.id).toBe(regular.account.id);
      await r.silence(async () => {
        expect((await r.f.request("/admin/accounts", regular)).status).toBe(403);
      });
      await healthy(r);
    } finally {
      save(r.f);
      await r.dispose();
    }
  });

  for (const policy of ["closed", "invite"] as const)
    it(`AUTH-020: ${policy} signup policy persists and public IRC REST attempts cannot bypass it`, async () => {
      const r = await observedAuthFixture();
      try {
        expect(
          (await r.f.request("/admin/config", r.root, "POST", { signupPolicy: policy })).status,
        ).toBe(200);
        await r.flush();
        const before = await r.f.snapshot();
        await r.resume();
        await r.silence(async () => {
          for (const route of ["/api/v1/auth/register", "/api/accounts/register"])
            expect(
              (
                await r.f.request(route, null, "POST", {
                  username: "restricted",
                  password: `Restricted-${randomUUID()}!`,
                })
              ).status,
            ).toBe(400);
          const guest = await r.f.guest();
          const reply = guest.waitForNewLine((line) => line.includes(" FAIL REGISTER "));
          guest.send(`REGISTER wireaccount * Wire-${randomUUID()}!`);
          expect(await reply).toContain("restricted");
          await r.f.barrier(guest);
          expect(guest.lines.some((line) => / 900 | 920 | 001 /.test(line))).toBe(false);
        });
        const rejected = await r.f.snapshot();
        sameProtected(before, rejected);
        await r.resume();
        expect(
          (
            await r.f.request("/api/v1/auth/register", null, "POST", {
              username: "afterrestart",
              password: `After-${randomUUID()}!`,
            })
          ).status,
        ).toBe(400);
        if (policy === "invite") {
          const password = `Invited-${randomUUID()}!`;
          const accepted = await r.f.request(
            "/api/v1/auth/register",
            null,
            "POST",
            { username: "invited", password },
            { "x-signup-token": r.f.signup },
          );
          expect(accepted.status).toBe(201);
          const actor = await r.f.login("invited", password);
          const stored = await r.f.snapshot();
          expect(stored.users).toContainEqual(
            expect.objectContaining({ id: actor.account.id, username: "invited" }),
          );
          await r.resume();
          expect((await r.f.login("invited", password)).account.id).toBe(actor.account.id);
        } else {
          expect(
            (await r.f.request("/admin/config", r.root, "POST", { signupPolicy: "open" })).status,
          ).toBe(200);
          const actor = await r.f.create("opencontrol");
          const stored = await r.f.snapshot();
          expect(stored.users).toContainEqual(expect.objectContaining({ id: actor.account.id }));
          await r.resume();
          expect((await r.f.login("opencontrol", actor.password)).account.id).toBe(
            actor.account.id,
          );
        }
        await healthy(r);
      } finally {
        save(r.f);
        await r.dispose();
      }
    });

  it("AUTH-021: durable account login budgets reject further attempts without credentials or session side effects", async () => {
    const r = await observedAuthFixture();
    try {
      const target = await r.f.create("ratelimited");
      await r.flush();
      const before = await r.f.snapshot();
      await r.resume();
      await r.silence(async () => {
        for (let n = 0; n < 9; n++) await invalid(r.f, target.username, `Incorrect-${n}`);
        await invalid(r.f, target.username, target.password, "Too many authentication attempts");
      });
      const after = await r.f.snapshot();
      sameProtected(before, after);
      await r.resume();
      await invalid(r.f, target.username, target.password, "Too many authentication attempts");
      await healthy(r);
      expect(after.api_sessions.filter((row) => row.user_id === target.account.id)).toEqual(
        before.api_sessions.filter((row) => row.user_id === target.account.id),
      );
    } finally {
      save(r.f);
      await r.dispose();
    }
  });

  for (const action of ["reset", "disable-reenable", "NickServ-password"] as const)
    it(`${action === "disable-reenable" ? "AUTH-008 AUTH-024 AUTH-025" : "AUTH-023"}: ${action} invalidates existing devices and child event authority durably`, async () => {
      const r = await observedAuthFixture();
      try {
        const second = await r.f.login("alice", r.alice.password);
        const event = await r.f.event(second);
        await r.flush();
        const control = await r.f.request("/api/v1/channels/%23protected/messages", r.bob, "POST", {
          content: "before-account-revocation",
        });
        expect(control.status).toBe(201);
        await event.until("before-account-revocation");
        const old = r.alice.password,
          newPassword = `Replacement-${randomUUID()}!`;
        const closed = new Promise<void>((resolve) => event.ws.once("close", () => resolve()));
        const ircClosed = new Promise<void>((resolve) => r.a.ws.once("close", () => resolve()));
        if (action === "NickServ-password") r.a.send(`NS PASSWD ${newPassword}`);
        else
          expect(
            (
              await r.f.request(
                `/admin/accounts/alice/${action === "reset" ? "password" : "disable"}`,
                r.root,
                "POST",
                action === "reset" ? { password: newPassword } : undefined,
              )
            ).status,
          ).toBe(200);
        await ircClosed;
        r.setAliceEnabled(false);
        if (action !== "disable-reenable") r.alice.password = newPassword;
        await r.silence(async () => {
          for (const actor of [r.alice, second]) {
            expect((await r.f.request("/api/v1/profiles/alice", actor)).status).toBe(401);
            expect((await r.f.request("/api/v1/auth/events-ticket", actor, "POST")).status).toBe(
              401,
            );
          }
          await invalid(r.f, "alice", old);
        });
        await closed;
        const start = event.received.length;
        expect(
          (
            await r.f.request("/api/v1/channels/%23protected/messages", r.bob, "POST", {
              content: "after-account-revocation-private",
            })
          ).status,
        ).toBe(201);
        await r.good.until("after-account-revocation-private");
        await r.flush();
        expect(
          event.received
            .slice(start)
            .some((line) => line.includes("after-account-revocation-private")),
        ).toBe(false);
        if (action === "disable-reenable") {
          expect((await r.f.request("/admin/accounts/alice/enable", r.root, "POST")).status).toBe(
            200,
          );
          for (const actor of [r.alice, second])
            expect((await r.f.request("/api/v1/profiles/alice", actor)).status).toBe(401);
        }
        const state = await r.f.snapshot();
        expect(
          state.api_sessions.some(
            (row) =>
              row.token_hash === hashToken(r.alice.token) ||
              row.token_hash === hashToken(second.token),
          ),
        ).toBe(false);
        expect(state.users.find((row) => row.id === r.alice.account.id).disabled_at).toBe(null);
        await r.resume();
        await r.silence(async () => {
          for (const actor of [r.alice, second])
            expect((await r.f.request("/api/v1/profiles/alice", actor)).status).toBe(401);
        });
        const fresh = await r.f.login("alice", r.alice.password);
        expect(fresh.account.id).toBe(r.alice.account.id);
        const freshIrc = await r.f.connect(fresh, "restoredalice");
        await wire(freshIrc, "JOIN #protected", / 366 .*#protected/);
        await healthy(r);
        const after = await r.f.snapshot();
        expect(after.users).toEqual(state.users);
        expect(after.scram_credentials).toEqual(state.scram_credentials);
        expect(after.account_roles).toEqual(state.account_roles);
        expect(after.messages).toEqual(state.messages);
        expect(after.api_sessions).toContainEqual(
          expect.objectContaining({
            token_hash: hashToken(fresh.token),
            user_id: r.alice.account.id,
          }),
        );
      } finally {
        save(r.f);
        await r.dispose();
      }
    });

  for (const [mechanism, payload, code] of [
    ["PLAIN", "not-base64!", 904],
    ["PLAIN", Buffer.from("alice\0alice\0secret\0extra").toString("base64"), 904],
    ["PLAIN", Buffer.from("bob\0alice\0wrong").toString("base64"), 904],
    ["PLAIN", "A".repeat(401), 905],
    ["SCRAM-SHA-256", Buffer.from("p=tls-exporter,,n=alice,r=nonce").toString("base64"), 904],
    ["SCRAM-SHA-256", Buffer.from("n,,n=alice,n=bob,r=nonce").toString("base64"), 904],
    ["SCRAM-SHA-256", "not-base64!", 904],
  ] as const)
    it(`AUTH-027: malformed ${mechanism} vector ${payload.slice(0, 16)} is rejected without principal or persistent side effects`, async () => {
      const r = await observedAuthFixture();
      try {
        await r.flush();
        const before = await r.f.snapshot();
        await r.resume();
        await r.silence(async () => {
          const c = await sasl(r, mechanism);
          const failed = c.waitForNewLine((line) => line.includes(` ${code} `));
          c.send(`AUTHENTICATE ${payload}`);
          await failed;
          await wire(c, "JOIN #protected", / 451 /);
          expect(c.lines.some((line) => / 900 | 903 | 001 /.test(line))).toBe(false);
        });
        const after = await r.f.snapshot();
        sameProtected(before, after);
        await r.resume();
        expect((await r.f.login("alice", r.alice.password)).account.id).toBe(r.alice.account.id);
        await healthy(r);
      } finally {
        save(r.f);
        await r.dispose();
      }
    });

  it("AUTH-026: public responses and captured workerd stdout stderr exclude actual passwords hashes SCRAM keys and bearer credentials", async () => {
    const r = await observedAuthFixture();
    try {
      const before = await r.f.snapshot();
      await r.resume();
      const responses: string[] = [];
      await r.silence(async () => {
        const plain = await sasl(r);
        const payload = Buffer.from(`alice\0alice\0${r.alice.password}`).toString("base64");
        const accepted = plain.waitForNewLine((line) => line.includes(" 903 "));
        plain.send(`AUTHENTICATE ${payload}`);
        await accepted;
        const switcher = await r.f.connect(r.bob, "secretobserver");
        const identified = switcher.waitForNewLine(
          (line) => line.includes(" 900 ") && line.includes(" alice "),
        );
        switcher.send(`NS IDENTIFY alice ${r.alice.password}`);
        await identified;
        r.f.secretValues.push(payload);
        for (const path of [
          "/api/v1/profiles/alice",
          "/api/profile/alice",
          "/api/v1/channels/%23protected/info",
          "/api/v1/channels/%23protected/roles",
          "/api/health",
          "/api/status",
        ]) {
          const res = await r.f.request(path, r.bob);
          expect(res.status).toBe(200);
          responses.push(await res.text());
        }
        const failed = await r.f.request("/api/v1/auth/login", null, "POST", {
          username: "alice",
          password: r.bob.password,
        });
        expect(failed.status).toBe(401);
        responses.push(await failed.text());
      });
      const after = await r.f.snapshot();
      sameProtected(before, after);
      const secrets = [
        ...r.f.secretValues,
        ...before.users.map((row) => row.password_hash),
        ...before.scram_credentials.flatMap((row) => [row.stored_key, row.server_key]),
      ];
      expect(r.f.logs.length).toBeGreaterThan(0);
      const publicText = responses.join("\n"),
        runtimeLogs = r.f.logs.join("\n");
      expect(runtimeLogs).toContain("Client registered:");
      for (const secret of secrets) {
        expect(publicText.includes(secret), "public secret exclusion").toBe(false);
        expect(runtimeLogs.includes(secret), "runtime log secret exclusion").toBe(false);
      }
      expect(publicText).not.toMatch(
        /password_hash|stored_key|server_key|credential_version|token_hash/,
      );
      await r.resume();
      await healthy(r);
    } finally {
      save(r.f);
      await r.dispose();
    }
  });
});

it("AUTH-028: production SCRAM primitives match the published RFC7677 exchange and independent Node PBKDF2 oracle", async () => {
  const salt = "W22ZaJ0SNY7soEsUEjb6gQ==";
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((value: any) => {
    value.set(Buffer.from(salt, "base64"));
    return value;
  });
  try {
    const keys = await generateScramKeys("pencil", 4096);
    expect(keys.salt).toBe(salt);
    const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const auth = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=${salt},i=4096,c=biws,r=${nonce}`;
    const salted = pbkdf2Sync("pencil", Buffer.from(salt, "base64"), 4096, 32, "sha256");
    const key = await hmacSha256(salted, "Client Key");
    expect(uint8ArrayToBase64(await sha256(key))).toBe(keys.storedKey);
    expect(
      uint8ArrayToBase64(xorBytes(key, await hmacSha256(base64ToUint8Array(keys.storedKey), auth))),
    ).toBe("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=");
    expect(uint8ArrayToBase64(await hmacSha256(base64ToUint8Array(keys.serverKey), auth))).toBe(
      "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
    );
  } finally {
    random.mockRestore();
  }
});
