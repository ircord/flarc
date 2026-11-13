import { request as httpRequest } from "node:http";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { type ApiBoundaryRig, apiBoundaryRig } from "../helpers/api-boundary-gap-fixture";

// Send the exact oversized JSON over HTTP and require a complete response. A reset
// without a complete response is a failure, even when 413 is expected.
async function wireOversizedProfile(url: URL, token: string | undefined) {
  const payload = Buffer.from(JSON.stringify({ bio: "x".repeat(65536) }));
  return await new Promise<Response>((resolve, reject) => {
    let sent = 0,
      finished = false,
      seen = false;
    const request = httpRequest(url.toString(), {
      method: "PATCH",
      agent: false,
      headers: {
        "content-type": "application/json",
        "content-length": String(payload.byteLength),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error("HTTP boundary response timeout"));
    }, 10000);
    request.on("response", (response) => {
      seen = true;
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      response.on("aborted", () => {
        clearTimeout(timer);
        reject(new Error("Incomplete HTTP boundary response"));
      });
      response.on("end", () => {
        clearTimeout(timer);
        if (!response.complete) {
          reject(new Error("Incomplete HTTP boundary response"));
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers))
          for (const part of Array.isArray(value) ? value : value === undefined ? [] : [value])
            headers.append(key, part);
        trace(
          `WIRE PATCH profile oversized status=${response.statusCode} complete=true declared=${payload.byteLength} queued=${sent} cache=${headers.get("cache-control")}`,
        );
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
      });
      if (!finished) {
        finished = true;
        request.end();
      }
    });
    request.on("error", (error) => {
      if (!seen) {
        clearTimeout(timer);
        reject(error);
      }
    });
    function pump() {
      while (!finished && sent < payload.length) {
        const end = Math.min(sent + 16384, payload.length),
          chunk = payload.subarray(sent, end);
        sent = end;
        if (!request.write(chunk)) {
          request.once("drain", pump);
          return;
        }
      }
      if (!finished) {
        finished = true;
        request.end();
      }
    }
    pump();
  });
}

function trace(label: string) {
  if (process.env.API_BOUNDARY_TRACE === "1") console.log(`API_BOUNDARY_PHASE ${label}`);
}

function sensitive(r: ApiBoundaryRig, baseline: Awaited<ReturnType<ApiBoundaryRig["snapshot"]>>) {
  const data = baseline.protectedState;
  const values = [
    r.f.bootstrap,
    r.f.signup,
    r.root.token,
    r.alice.token,
    r.bob.token,
    r.charlie.token,
    r.alice.password,
    r.bob.password,
    r.charlie.password,
    "api-boundary-secret-channel",
    "api-boundary-secret-dm",
    "api-boundary-private-metadata",
    "api-boundary-private-media",
    ...data.users.map((row) => row.password_hash),
    ...data.scram_credentials.flatMap((row) => [row.salt, row.stored_key, row.server_key]),
  ];
  expect(values.every((value) => typeof value === "string" && value.length > 8)).toBe(true);
  return values as string[];
}
async function safeError(response: Response, expected: number, secrets: string[]) {
  expect(response.status).toBe(expected);
  const text = await response.text();
  for (const secret of secrets) expect(text).not.toContain(secret);
  expect(text).not.toMatch(
    /SQLITE|password_hash|stored_key|server_key|\bSELECT\b|\bat\s+\S+\.(?:mjs|ts):\d+/i,
  );
}
async function withRig(action: (r: ApiBoundaryRig, secrets: string[]) => Promise<void>) {
  const r = await apiBoundaryRig();
  try {
    trace("initial barrier");
    await r.barrier();
    trace("initial snapshot");
    const before = await r.snapshot();
    const secrets = sensitive(r, before);
    trace("resume first");
    await r.resume();
    await r.silent(async () => {
      trace("controls first");
      await r.controls();
      trace("action first");
      await action(r, secrets);
    });
    trace("snapshot first");
    const after = await r.snapshot();
    r.equal(before, after);
    trace("resume second");
    await r.resume();
    await r.silent(async () => {
      trace("controls second");
      await r.controls();
      trace("action second");
      await action(r, secrets);
    });
    const recreated = await r.snapshot();
    r.equal(before, recreated);
  } finally {
    await r.dispose();
  }
}

it("API-013 API-014: runtime validation and foreign writes fail safely without state or events", async () => {
  await withRig(async (r, secrets) => {
    for (const route of ["/api/v1/profiles/alice", "/api/profile/alice"]) {
      await safeError(
        await r.f.request(route, r.alice, "PATCH", { displayName: 123 }),
        400,
        secrets,
      );
      await safeError(
        await r.f.request(route, r.alice, "PATCH", { bio: "x".repeat(2049) }),
        400,
        secrets,
      );
      const malformed = await fetch(new URL(route, r.f.url), {
        method: "PATCH",
        headers: { authorization: `Bearer ${r.alice.token}`, "content-type": "application/json" },
        body: '{"bio":',
      });
      await safeError(malformed, 400, secrets);
    }
    for (const route of ["/api/v1/channels/%23boundary/info", "/api/channels/%23boundary/info"]) {
      await safeError(
        await r.f.request(route, r.bob, "PATCH", { topic: "x".repeat(391) }),
        400,
        secrets,
      );
      await safeError(
        await r.f.request(route, r.charlie, "PATCH", {
          description: "forged-boundary-description",
        }),
        403,
        secrets,
      );
    }
    for (const body of [{ content: "" }, { content: 42 }, { content: "invalid\u0000content" }])
      await safeError(
        await r.f.request("/api/v1/channels/%23boundary/messages", r.bob, "POST", body),
        400,
        secrets,
      );
    await safeError(await r.f.request("/api/v1/search?limit=-1&q=needle", r.alice), 400, secrets);
    await safeError(
      await r.f.request("/api/v1/profiles/bob", r.alice, "PATCH", { bio: "forged-bob-profile" }),
      403,
      secrets,
    );
  });
}, 60000);

it("API-020: configured WebSocket origins and HTTP cross-origin preflights follow the actual separate policies", async () => {
  await withRig(async (r, secrets) => {
    for (const origin of ["https://trusted.example", "https://attacker.invalid"]) {
      for (const route of ["/api/v1/profiles/bob", "/api/profile/bob"]) {
        const get = await r.f.request(route, r.alice, "GET", undefined, { Origin: origin });
        expect(get.status).toBe(200);
        expect(((await get.json()) as any).profile.username).toBe("bob");
        expect(get.headers.get("access-control-allow-origin")).toBeNull();
        expect(get.headers.get("access-control-allow-credentials")).toBeNull();
        const preflight = await r.f.request(route, null, "OPTIONS", undefined, {
          Origin: origin,
          "Access-Control-Request-Method": "PATCH",
          "Access-Control-Request-Headers": "authorization,content-type",
        });
        await safeError(preflight, 401, secrets);
        expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
        expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
        const cookie = await r.f.request(
          route,
          null,
          "PATCH",
          { bio: "cookie-forgery" },
          { Origin: origin, Cookie: `session=${r.bob.token}; token=${r.bob.token}` },
        );
        await safeError(cookie, 401, secrets);
        expect(cookie.headers.get("access-control-allow-origin")).toBeNull();
      }
    }
    const ticketResponse = await r.f.request("/api/v1/auth/events-ticket", r.bob, "POST");
    expect(ticketResponse.status).toBe(200);
    const ticket = ((await ticketResponse.json()) as any).ticket;
    const denied = new WebSocket(`ws://${r.f.url.host}/api/v1/events?ticket=${ticket}`, {
      headers: { Origin: "https://attacker.invalid" },
    });
    const status = await new Promise<number>((resolve, reject) => {
      denied.once("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      denied.once("open", () => reject(new Error("Untrusted origin unexpectedly upgraded")));
      denied.once("error", reject);
    });
    expect(status).toBe(403);
    const allowed = new WebSocket(`ws://${r.f.url.host}/api/v1/events?ticket=${ticket}`, {
      headers: { Origin: "https://trusted.example" },
    });
    await new Promise<void>((resolve, reject) => {
      allowed.once("open", resolve);
      allowed.once("error", reject);
    });
    allowed.terminate();
  });
}, 60000);

it("API-023: restricted successes and denials use private no-store cache policy", async () => {
  await withRig(async (r, secrets) => {
    for (const [route, actor, status] of [
      ["/api/v1/profiles/bob", r.alice, 200],
      ["/api/profile/bob", r.alice, 200],
      ["/api/v1/channels/%23boundary/messages", r.alice, 200],
      ["/api/v1/channels/%23boundary/messages", r.charlie, 403],
      ["/api/v1/dms/bob/messages", r.alice, 200],
      ["/admin/accounts/bob", r.root, 200],
      ["/admin/accounts/bob", r.alice, 403],
      [r.media.url, r.bob, 200],
      [r.media.url, r.charlie, 404],
    ] as const) {
      trace(`GET ${route.startsWith("/media/") ? "media" : route} expected=${status} start`);
      const response = await r.f.request(route, actor);
      trace(
        `GET ${route.startsWith("/media/") ? "media" : route} status=${response.status} response`,
      );
      expect(response.status).toBe(status);
      expect
        .soft(
          response.headers.get("cache-control"),
          `${route.startsWith("/media/") ? "media" : route} status=${status}`,
        )
        .toBe("private, no-store");
      const text = await response.text();
      if (status >= 400) for (const secret of secrets) expect(text).not.toContain(secret);
      if (route === r.media.url && actor === r.bob) expect(text).toBe("api-boundary-private-media");
      if (route === "/admin/accounts/bob" && actor === r.root)
        expect(text).toContain(r.bob.account.id);
    }
    trace("PATCH profile invalid expected=400 start");
    const invalid = await r.f.request("/api/v1/profiles/alice", r.alice, "PATCH", {
      displayName: 123,
    });
    trace(`PATCH profile invalid status=${invalid.status} response`);
    await safeError(invalid, 400, secrets);
    expect
      .soft(invalid.headers.get("cache-control"), "profile validation status=400")
      .toBe("private, no-store");
    for (const route of ["/api/v1/profiles/alice", "/api/profile/alice"]) {
      for (const actor of [r.alice, null]) {
        trace(`PATCH ${route} oversized auth=${actor ? "yes" : "no"} expected=413 start`);
        const tooLarge = await wireOversizedProfile(new URL(route, r.f.url), actor?.token);
        trace(
          `PATCH ${route} oversized auth=${actor ? "yes" : "no"} status=${tooLarge.status} response`,
        );
        await safeError(tooLarge, 413, secrets);
        expect
          .soft(tooLarge.headers.get("cache-control"), `${route} body limit status=413`)
          .toBe("private, no-store");
      }
    }
    trace("GET profile missing-auth expected=401 start");
    const missing = await r.f.request("/api/v1/profiles/bob");
    trace(`GET profile missing-auth status=${missing.status} response`);
    await safeError(missing, 401, secrets);
    expect
      .soft(missing.headers.get("cache-control"), "unauthenticated status=401")
      .toBe("private, no-store");
  });
}, 60000);

it("API-024: public health status docs and OpenAPI omit actual operational and private values", async () => {
  await withRig(async (r, secrets) => {
    for (const route of [
      "/health",
      "/status",
      "/api/health",
      "/api/status",
      "/docs",
      "/openapi.json",
      "/",
    ]) {
      const response = await r.f.request(route);
      expect(response.status).toBe(200);
      const text = await response.text();
      for (const secret of secrets) expect(text).not.toContain(secret);
      expect(text).not.toMatch(
        /"password_hash"\s*:|"stored_key"\s*:|"server_key"\s*:|"token_hash"\s*:|\bat\s+\S+\.mjs:\d+/i,
      );
      if (["/health", "/status", "/api/health", "/api/status"].includes(route))
        expect(JSON.parse(text)).toMatchObject({ ok: true, service: "flarc", network: "FlaRC" });
      if (route === "/docs") expect(text).toContain("/openapi.json");
      if (route === "/openapi.json") {
        const doc = JSON.parse(text);
        expect(doc.openapi).toMatch(/^3\./);
        expect(doc.paths["/api/v1/profiles/{username}"]).toBeDefined();
      }
    }
  });
}, 60000);

it("API-023: actual authenticated request-budget denial carries private no-store", async () => {
  const r = await apiBoundaryRig();
  try {
    await r.barrier();
    const before = await r.snapshot();
    const secrets = sensitive(r, before);
    await r.resume();
    await r.silent(async () => {
      let succeeded = 0,
        limited = false;
      for (let i = 0; i < 310; i++) {
        const response = await r.f.request("/api/v1/profiles/bob", r.charlie);
        if (response.status === 429) {
          await safeError(response, 429, secrets);
          expect(response.headers.get("cache-control")).toBe("private, no-store");
          limited = true;
          break;
        }
        expect(response.status).toBe(200);
        expect(((await response.json()) as any).profile.username).toBe("bob");
        succeeded++;
      }
      expect(succeeded).toBeGreaterThan(0);
      expect(limited).toBe(true);
      await r.controls();
    });
    const after = await r.snapshot();
    r.equal(before, after);
    await r.f.restart();
    for (const [actor, channel] of [
      [r.bob, "#boundary"],
      [r.alice, "#boundary"],
      [r.charlie, "#unrelated"],
    ] as const) {
      const client = await r.f.connect(actor);
      const joined = client.waitForNewLine(
        (line) => line.includes(" 366 ") && line.includes(channel),
      );
      client.send(`JOIN ${channel}`);
      await joined;
    }
    await r.controls();
    const recreated = await r.snapshot();
    r.equal(before, recreated);
  } finally {
    await r.dispose();
  }
}, 60000);
