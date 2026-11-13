import { expect, it } from "vitest";
import { normalizePeerAddress, requestSource } from "../../server/core/request-source";
import { createMatrixFixture } from "../helpers/matrix-fixture";

it("request-source trust is selected by server configuration, never forwarding headers", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.17",
    "x-forwarded-for": "198.51.100.9",
    "x-local-ingress": "forged",
    "true-client-ip": "192.0.2.3",
  });
  expect(requestSource({ headers }, {})).toEqual({ ip: "127.0.0.1", kind: "development" });
  expect(requestSource({ headers }, { LOCAL_IRC_BRIDGE_SECRET: "real-secret" })).toBeNull();
  headers.set("x-local-ingress", "real-secret");
  expect(requestSource({ headers }, { LOCAL_IRC_BRIDGE_SECRET: "real-secret" })).toEqual({
    ip: "203.0.113.17",
    kind: "local-ingress",
  });
  expect(requestSource({ headers }, { REQUEST_SOURCE: "cloudflare" })).toEqual({
    ip: "203.0.113.17",
    kind: "cloudflare",
  });
  headers.set("cf-connecting-ip", "203.0.113.17, 198.51.100.9");
  expect(requestSource({ headers }, { REQUEST_SOURCE: "cloudflare" })).toBeNull();
  expect(requestSource({ headers }, { REQUEST_SOURCE: "unknown-proxy" })).toBeNull();
});

it("peer addresses have one numeric spelling without hostnames, ports or mapped-v4 ambiguity", () => {
  expect(normalizePeerAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
  expect(normalizePeerAddress("0:0:0:0:0:ffff:7f00:1")).toBe("127.0.0.1");
  expect(normalizePeerAddress("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
  for (const value of [
    "localhost",
    "2130706433",
    "127.1",
    "127.0.0.1:80",
    "127.000.0.1",
    "256.0.0.1",
    "::1%lo",
    "[::1]",
    "",
    null,
  ])
    expect(normalizePeerAddress(value), String(value)).toBeNull();
});

it("hostmask bans protect REST login and existing sessions despite forged source headers without changing stored account state", async () => {
  const f = await createMatrixFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    expect(
      (
        await f.request("/api/v1/profiles/alice", alice, "PATCH", {
          customStatus: "allowed-before-ban",
        })
      ).status,
    ).toBe(200);
    const ban = await f.request("/admin/bans", root, "POST", {
      kind: "hostmask",
      value: "alice!*@127.0.0.1",
    });
    expect(ban.status).toBe(200);
    const {
      ban: { id },
    } = (await ban.json()) as { ban: { id: string } };
    await f.stop();
    const before = { users: await f.snapshot("users"), sessions: await f.snapshot("api_sessions") };
    await f.restart();
    const headers = {
      "cf-connecting-ip": "203.0.113.17",
      "x-forwarded-for": "198.51.100.9",
      "x-local-ingress": "forged",
    };
    expect(
      (await f.request("/api/v1/profiles/alice", alice, "GET", undefined, headers)).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/api/v1/profiles/alice",
          alice,
          "PATCH",
          { customStatus: "forbidden-after-ban" },
          headers,
        )
      ).status,
    ).toBe(403);
    const login = await f.request(
      "/api/v1/auth/login",
      null,
      "POST",
      { username: alice.username, password: alice.password },
      headers,
    );
    expect(login.status).toBe(403);
    expect(await login.text()).not.toMatch(/token|password|credentialVersion/);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    const retained = await f.request("/api/v1/profiles/alice", root);
    expect(retained.status).toBe(200);
    expect(await retained.text()).toContain("allowed-before-ban");
    await f.stop();
    expect({
      users: await f.snapshot("users"),
      sessions: await f.snapshot("api_sessions"),
    }).toEqual(before);
    await f.restart();
    expect((await f.request(`/admin/bans/${id}`, root, "DELETE")).status).toBe(200);
    expect(
      (
        await f.request("/api/v1/profiles/alice", alice, "PATCH", {
          customStatus: "allowed-after-unban",
        })
      ).status,
    ).toBe(200);
    await f.restart();
    expect(await (await f.request("/api/v1/profiles/alice", alice)).text()).toContain(
      "allowed-after-unban",
    );
  } finally {
    await f.dispose();
  }
}, 60000);

it("a hostmask-denied signup creates no account and works after the ban is removed", async () => {
  const f = await createMatrixFixture();
  try {
    const root = await f.createActor("rootadmin", true);
    const ban = await f.request("/admin/bans", root, "POST", {
      kind: "hostmask",
      value: "newblocked!*@127.0.0.1",
    });
    expect(ban.status).toBe(200);
    const {
      ban: { id },
    } = (await ban.json()) as { ban: { id: string } };
    const body = { username: "newblocked", password: "Strong-test-password-123!" };
    const signup = await f.request("/api/v1/auth/register", null, "POST", body, {
      "cf-connecting-ip": "203.0.113.8",
      "x-forwarded-for": "198.51.100.8",
    });
    expect(signup.status).toBe(403);
    await f.stop();
    expect((await f.snapshot("users")).flat().map((row: any) => row.username)).toEqual([
      "rootadmin",
    ]);
    expect((await f.snapshot("api_sessions")).flat()).toHaveLength(1);
    await f.restart();
    const bob = await f.createActor("bob");
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    expect((await f.request(`/admin/bans/${id}`, root, "DELETE")).status).toBe(200);
    expect((await f.request("/api/v1/auth/register", null, "POST", body)).status).toBe(201);
    const account = await f.login(body.username, body.password);
    expect(account.account.username).toBe(body.username);
  } finally {
    await f.dispose();
  }
}, 60000);
