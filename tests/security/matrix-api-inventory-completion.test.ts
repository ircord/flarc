import { expect, it } from "vitest";
import { observedAuthFixture, sameProtected } from "../helpers/auth-gap-fixture";
import { TestIRCClient } from "../helpers/miniflare-harness";

// This covers specific supported operations and their aliases; it is not a
// claim that source enumeration alone proves every route or feature secure.
it("API-017 API-018: capability webhook and admin aliases enforce their advertised authority", async () => {
  const r = await observedAuthFixture();
  try {
    const openapiResponse = await r.f.request("/openapi.json");
    expect(openapiResponse.status).toBe(200);
    const spec = (await openapiResponse.json()) as any;
    expect(spec.security).toEqual([{ SessionToken: [] }]);
    for (const path of ["/admin/accounts/{username}", "/api/v1/admin/accounts/{username}"]) {
      const adminSecurity = spec.paths[path].get.security ?? spec.security;
      expect(adminSecurity).toEqual([{ SessionToken: [] }, { CookieSession: [] }]);
    }
    for (const path of [
      "/api/v1/webhooks/{token}",
      "/api/v1/webhooks/{id}/{token}",
      "/api/webhooks/{id}/{token}",
    ])
      expect(spec.paths[path].post.security).toEqual([]);
    const created = await r.f.request("/api/v1/channels/%23protected/webhooks", r.bob, "POST", {
      name: "parity-hook",
      created_by: "charlie",
    });
    expect(created.status).toBe(201);
    const hook = ((await created.json()) as any).webhook;
    expect(hook).toMatchObject({ name: "parity-hook", createdBy: "bob" });
    expect(hook.id).toBeTruthy();
    expect(hook.token).toBeTruthy();
    const paths = [
      `/api/v1/webhooks/${hook.token}`,
      `/api/v1/webhooks/${hook.id}/${hook.token}`,
      `/api/webhooks/${hook.id}/${hook.token}`,
    ];
    const messageIds: string[] = [];
    for (const [i, path] of paths.entries()) {
      const content = `capability-positive-${i}`;
      const delivery = r.b.waitForNewLine((line) => line.includes(content));
      const response = await r.f.request(`${path}?channel=%23protected`, null, "POST", {
        content,
        username: "alice",
        created_by: "alice",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toMatchObject({ ok: true, channel: "#protected" });
      expect(body.messageId).toBeTruthy();
      messageIds.push(body.messageId);
      expect(await delivery).toContain("hook_alice!webhook@discord.bot");
    }
    await r.flush();
    expect(r.c.lines.join("\n")).not.toMatch(/capability-positive-/);
    expect(r.outside.received.join("\n")).not.toMatch(/capability-positive-/);
    async function snapshot() {
      const state = await r.f.snapshot();
      const hooks = (await r.f.rows("channel_webhooks"))
        .flat()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return { state, hooks };
    }
    const before = await snapshot();
    expect(before.hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hook.id, name: "parity-hook", created_by: "bob" }),
      ]),
    );
    expect(before.state.messages.filter((row) => messageIds.includes(row.id))).toHaveLength(3);
    async function checks() {
      await r.silence(async () => {
        for (const prefix of ["/admin", "/api/v1/admin"]) {
          const path = `${prefix}/accounts/bob`;
          const good = await r.f.request(path, r.root);
          expect(good.status).toBe(200);
          expect(JSON.stringify(await good.json())).toContain(r.bob.account.id);
          for (const actor of [null, r.alice]) {
            const denied = await r.f.request(
              `${path}?token=${r.root.token}&username=rootadmin`,
              actor,
            );
            expect(denied.status).toBe(actor ? 403 : 401);
            const text = await denied.text();
            for (const secret of [r.bob.account.id, r.bob.password, r.root.token])
              expect(text).not.toContain(secret);
            const method = await r.f.request(path, actor, "POST", {
              username: "rootadmin",
              isAdmin: true,
            });
            expect(method.status).toBe(actor ? 403 : 401);
          }
        }
        for (const path of ["/api/profile/bob", "/api/v1/profiles/bob"]) {
          const good = await r.f.request(path, r.alice);
          expect(good.status).toBe(200);
          expect(((await good.json()) as any).profile.username).toBe("bob");
          expect((await r.f.request(path)).status).toBe(401);
        }
        for (const path of [
          "/api/v1/webhooks/invalid?channel=%23protected",
          `/api/v1/webhooks/wrong/${hook.token}?channel=%23protected`,
          `/api/webhooks/${hook.id}/${hook.token}?channel=%23unrelated`,
        ]) {
          const denied = await r.f.request(path, null, "POST", {
            content: "forbidden-hook-marker",
            username: "bob",
          });
          expect(denied.status).toBe(400);
          const text = await denied.text();
          expect(text).not.toContain(hook.token);
          expect(text).not.toContain("protected-auth-control");
        }
        const history = await r.f.request("/api/v1/channels/%23protected/messages", r.bob);
        expect(history.status).toBe(200);
        const text = await history.text();
        for (const id of messageIds) expect(text).toContain(id);
        expect(text).not.toContain("forbidden-hook-marker");
      });
    }
    for (let i = 0; i < 2; i++) {
      await r.resume();
      await checks();
      const after = await snapshot();
      sameProtected(before.state, after.state);
      expect(after.hooks).toEqual(before.hooks);
    }
  } finally {
    await r.dispose();
  }
}, 60000);

it("API inventory ledger accounts for each discovered route and OpenAPI operation", async () => {
  const { createHash } = await import("node:crypto");
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { generateOpenAPISpec } = await import("../../server/routes/openapi.json.get");
  const { default: ledger } = await import("../helpers/api-operation-ledger.json");
  const { default: adminProof } = await import("../helpers/api-operation-admin-proof.json");
  const entries = ledger.operations;
  const key = (method: string, route: string) => `${method.toLowerCase()} ${route}`;
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = key(entry.method, entry.route);
    expect(seen.has(id), id).toBe(false);
    seen.add(id);
    expect(entry.policy, id).toBeTruthy();
    expect(entry.source, id).toBeTruthy();
    // Ledger mappings describe source assertions, never a runtime pass.
    expect(
      entry.positive.length +
        entry.denial.length +
        ("reviewedProofs" in entry ? (entry.reviewedProofs?.length ?? 0) : 0) +
        ("adminProof" in entry ? 1 : 0),
      id,
    ).toBeGreaterThan(0);
    expect(entry.unresolved, id).toEqual([]);
  }
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
      const name = path.join(dir, item.name);
      return item.isDirectory() ? files(name) : name.endsWith(".ts") ? [name] : [];
    });
  for (const file of files("server/routes")) {
    const rel = file.slice("server/routes/".length);
    const route =
      rel === "index.ts"
        ? "/"
        : `/${rel
            .replace(/\.(get|post|put|patch|delete)\.ts$/, "")
            .replace(/\.ts$/, "")
            .replace(/\/index$/, "")
            .replace(/\[\.\.\.([^\]]+)\]/g, "{$1...}")
            .replace(/\[([^\]]+)\]/g, "{$1}")}`;
    const method = file.match(/\.(get|post|put|patch|delete)\.ts$/)?.[1] ?? "any";
    expect(
      seen.has(key(method, route)),
      `new Nitro route requires a reviewed ledger row: ${method} ${route}`,
    ).toBe(true);
  }
  // The dispatcher is a catchall, so freeze the reviewed source as well as
  // enumerating both concrete prefixes; any branch change forces re-review.
  expect(createHash("sha256").update(readFileSync("server/handlers/admin.ts")).digest("hex")).toBe(
    ledger.adminSourceSha256,
  );
  const adminMappings = new Map(
    adminProof.operations.map((item) => [key(item.method, item.route), item]),
  );
  for (const entry of entries.filter(
    (item) =>
      item.kind === "admin" || item.policy === "admin-dispatch" || item.route === "/metrics",
  )) {
    const mapped = adminMappings.get(key(entry.method, entry.route));
    expect(
      mapped,
      `missing concrete admin proof mapping: ${entry.method} ${entry.route}`,
    ).toBeDefined();
    expect(mapped?.positive).toBeTruthy();
    expect(mapped?.denial).toBeTruthy();
  }
  // Parameter names differ between OpenAPI and Nitro dispatch but denote the
  // same single path segment. Require a unique, method-specific shape match.
  const shape = (route: string) => route.replace(/\{[^{}]+\}/g, "{}");
  const shaped = new Map<string, string[]>();
  for (const entry of entries) {
    const id = key(entry.method, shape(entry.route));
    shaped.set(id, [...(shaped.get(id) ?? []), entry.route]);
  }
  for (const [id, routes] of shaped) expect(routes, `ambiguous route shape ${id}`).toHaveLength(1);
  const spec = generateOpenAPISpec();
  for (const [route, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      expect(
        shaped.get(key(method, shape(route))) ?? [],
        `OpenAPI operation requires a unique explicit ledger row: ${method} ${route}`,
      ).toHaveLength(1);
    }
  }
});

it("API-017 API-018: channel info and unread aliases bind actor and secret channel access", async () => {
  const r = await observedAuthFixture();
  try {
    for (const [index, prefix] of ["/api/channels", "/api/v1/channels"].entries()) {
      const response = await r.f.request(`${prefix}/%23protected/info`, r.bob, "PATCH", {
        description: `alias-contract-${index}`,
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as any).channel.description).toBe(`alias-contract-${index}`);
    }
    await r.flush();
    const before = await r.f.snapshot();
    async function verify() {
      await r.silence(async () => {
        for (const prefix of ["/api/channels", "/api/v1/channels"]) {
          const info = await r.f.request(`${prefix}/%23protected/info`, r.bob);
          expect(info.status).toBe(200);
          expect(((await info.json()) as any).channel.description).toBe("alias-contract-1");
          const unread = await r.f.request(`${prefix}/%23protected/unread`, r.bob);
          expect(unread.status).toBe(200);
          expect((await unread.json()) as any).toMatchObject({
            ok: true,
            channel: "#protected",
            username: "bob",
          });
          for (const method of ["GET", "PATCH"]) {
            const denied = await r.f.request(
              `${prefix}/%23protected/info?username=bob`,
              r.charlie,
              method,
              method === "PATCH" ? { description: "alias-forbidden" } : undefined,
            );
            expect(denied.status).toBe(403);
            expect(await denied.text()).not.toContain("alias-contract-1");
          }
          expect(
            (await r.f.request(`${prefix}/%23protected/unread?username=bob`, r.charlie)).status,
          ).toBe(403);
          expect(
            (await r.f.request(`${prefix}/%23protected/unread?username=alice`, r.bob)).status,
          ).toBe(403);
        }
        for (const prefix of ["/api/users", "/api/v1/users"]) {
          const own = await r.f.request(`${prefix}/bob/unread`, r.bob);
          expect(own.status).toBe(200);
          const body = (await own.json()) as any;
          expect(body).toMatchObject({ ok: true, username: "bob" });
          expect(body.channels).toEqual(
            expect.arrayContaining([expect.objectContaining({ channel: "#protected" })]),
          );
          expect(
            (await r.f.request(`${prefix}/bob/unread?username=charlie`, r.charlie)).status,
          ).toBe(403);
        }
        const ownList = await r.f.request("/api/v1/channels", r.bob);
        expect(ownList.status).toBe(200);
        const outsiderList = await r.f.request("/api/v1/channels", r.charlie);
        expect(outsiderList.status).toBe(200);
        expect(await outsiderList.text()).not.toContain("#protected");
      });
    }
    for (let i = 0; i < 2; i++) {
      await r.resume();
      await verify();
      sameProtected(before, await r.f.snapshot());
    }
  } finally {
    await r.dispose();
  }
}, 60000);

it("API-017 API-018: incoming webhook management enforces channel authority on real capability rows", async () => {
  const r = await observedAuthFixture();
  try {
    const path = "/api/v1/channels/%23protected/webhooks";
    const created = await r.f.request(path, r.bob, "POST", { name: "managed-hook" });
    expect(created.status).toBe(201);
    const hook = ((await created.json()) as any).webhook;
    const otherCreated = await r.f.request(
      "/api/v1/channels/%23unrelated/webhooks",
      r.charlie,
      "POST",
      { name: "unrelated-hook" },
    );
    expect(otherCreated.status).toBe(201);
    const other = ((await otherCreated.json()) as any).webhook;
    await r.flush();
    const before = await r.f.snapshot();
    const hooksBefore = (await r.f.rows("channel_webhooks"))
      .flat()
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(hooksBefore).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hook.id }),
        expect.objectContaining({ id: other.id }),
      ]),
    );
    await r.resume();
    await r.silence(async () => {
      const list = await r.f.request(path, r.bob);
      expect(list.status).toBe(200);
      expect(((await list.json()) as any).webhooks).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: hook.id, token: hook.token })]),
      );
      for (const [method, route, body] of [
        ["GET", path, undefined],
        ["POST", path, { name: "forged-hook" }],
        ["DELETE", `${path}/${hook.id}`, undefined],
      ] as const) {
        const denied = await r.f.request(route, r.charlie, method, body);
        expect(denied.status).toBe(403);
        expect(await denied.text()).not.toContain(hook.token);
      }
    });
    const rejected = await r.f.snapshot();
    sameProtected(before, rejected);
    expect(
      (await r.f.rows("channel_webhooks"))
        .flat()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(hooksBefore);
    await r.resume();
    expect((await r.f.request(`${path}/${hook.id}`, r.bob, "DELETE")).status).toBe(200);
    const after = await r.f.request(path, r.bob);
    expect(after.status).toBe(200);
    expect(((await after.json()) as any).webhooks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: hook.id })]),
    );
    const unrelated = await r.f.request("/api/v1/channels/%23unrelated/webhooks", r.charlie);
    expect(unrelated.status).toBe(200);
    expect(((await unrelated.json()) as any).webhooks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: other.id })]),
    );
    await r.resume();
    const persisted = await r.f.request(path, r.bob);
    expect(persisted.status).toBe(200);
    expect(((await persisted.json()) as any).webhooks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: hook.id })]),
    );
  } finally {
    await r.dispose();
  }
}, 60000);

it("API-017 API-018: public registration alias and icon expose their documented public behavior", async () => {
  const r = await observedAuthFixture();
  try {
    const registration = await r.f.request("/api/accounts/register", null, "POST", {
      username: "legacyuser",
      password: "Legacy-passphrase-934!",
    });
    expect(registration.status).toBe(201);
    const data = (await registration.json()) as any;
    expect(data.account.username).toBe("legacyuser");
    expect(data.account.roles).not.toContain("admin");
    const login = await r.f.login("legacyuser", "Legacy-passphrase-934!");
    expect(login.account.id).toBe(data.account.id);
    const discovery = await r.f.request("/");
    expect(discovery.status).toBe(200);
    expect(((await discovery.json()) as any).websocketEndpoint).toBe("/irc");
    for (const [index, route] of ["/", "/irc"].entries()) {
      const guest = new TestIRCClient(`ws://${r.f.url.host}${route}`);
      try {
        await guest.connect();
        guest.send(`NICK guest${index}`);
        guest.send(`USER guest${index} 0 * :Unauthenticated guest`);
        guest.send("JOIN #protected");
        await guest.waitForNumeric(451);
        const marker = `guest-barrier-${index}`;
        const pong = guest.waitForNewLine(
          (line) => line.includes(" PONG ") && line.includes(marker),
        );
        guest.send(`PING :${marker}`);
        await pong;
        expect(guest.lines.some((line) => line.includes(" 001 "))).toBe(false);
        expect(guest.lines.some((line) => line.includes(" JOIN #protected"))).toBe(false);
      } finally {
        guest.close();
      }
      const authenticated = new TestIRCClient(`ws://${r.f.url.host}${route}`);
      try {
        await authenticated.connect();
        authenticated.send("PASS legacyuser:Legacy-passphrase-934!");
        await authenticated.register(`legacy${index}`);
        const joined = authenticated.waitForNewLine(
          (line) => line.includes(" 366 ") && line.includes("#legacycontrol"),
        );
        authenticated.send("JOIN #legacycontrol");
        await joined;
      } finally {
        authenticated.close();
      }
    }
    const image = await r.f.request("/icon.svg");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/svg+xml");
    expect(await image.text()).toContain("<svg");
    expect((await r.f.request("/admin/accounts", login)).status).toBe(403);
  } finally {
    await r.dispose();
  }
}, 60000);
