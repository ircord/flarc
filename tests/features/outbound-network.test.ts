import { randomUUID } from "node:crypto";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createSafeOutbound, isPublicAddress } from "../../scripts/safe-outbound.mjs";
import { ensureNitroBuilt } from "../helpers/miniflare-harness";

const yaml = (embeds = ["preview.example.com"], webhooks: string[] = [], push: string[] = []) =>
  `version: 1\nembeds: [${embeds.join(", ")}]\nwebhooks: [${webhooks.join(", ")}]\npush: [${push.join(", ")}]\n`;
const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];
const url = "https://preview.example.com/page";
function makeTransport(
  options: {
    status?: number;
    headers?: Record<string, string>;
    chunks?: Uint8Array[];
    hang?: boolean;
  } = {},
) {
  const calls: any[] = [];
  const responses: PassThrough[] = [];
  const requests: Writable[] = [];
  const transport = (params: any, callback: (response: any) => void) => {
    calls.push(params);
    const request = new Writable({
      autoDestroy: false,
      write(_chunk, _encoding, next) {
        next();
      },
      final(done) {
        done();
        if (options.hang) return;
        queueMicrotask(() => {
          const response = new PassThrough() as any;
          response.statusCode = options.status ?? 200;
          response.headers = options.headers ?? { "content-type": "text/plain" };
          responses.push(response);
          callback(response);
          for (const chunk of options.chunks ?? [Buffer.from("healthy")]) {
            if (response.destroyed) break;
            response.write(chunk);
          }
          if (!response.destroyed) response.end();
        });
      },
    });
    requests.push(request);
    return request;
  };
  return { transport, calls, responses, requests };
}

it("classifies IANA special-use, mapped and transition addresses conservatively", () => {
  for (const ip of [
    "0.1.2.3",
    "10.0.0.1",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.9",
    "192.0.2.1",
    "192.88.99.2",
    "192.168.0.1",
    "198.18.1.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::1",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2001:db8::1",
    "2001::1",
    "2002::1",
    "3fff::1",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "not-an-ip",
  ])
    expect(isPublicAddress(ip), ip).toBe(false);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])
    expect(isPublicAddress(ip), ip).toBe(true);
});

it("pins a verified public result for the actual TLS connection without a second lookup", async () => {
  const sink = makeTransport();
  let calls = 0;
  const adapter = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml() }),
    lookup: async () => {
      calls++;
      return calls === 1
        ? [{ address: "8.8.8.8", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    },
    transport: sink.transport,
  });
  const result = await adapter(new Request(url));
  expect(result.status).toBe(200);
  expect(await result.text()).toBe("healthy");
  expect(calls).toBe(1);
  expect(sink.calls).toHaveLength(1);
  expect(sink.calls[0]).toMatchObject({
    hostname: "8.8.8.8",
    family: 4,
    servername: "preview.example.com",
    port: 443,
    rejectUnauthorized: true,
    agent: false,
    headers: { host: "preview.example.com", "accept-encoding": "identity" },
  });
  expect(typeof sink.calls[0].checkServerIdentity).toBe("function");
});

it("rejects mixed, private, empty and oversized DNS answers before opening a socket", async () => {
  const sink = makeTransport();
  for (const answers of [
    [
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ],
    [{ address: "::ffff:8.8.8.8", family: 6 }],
    [],
    Array.from({ length: 65 }, () => ({ address: "8.8.8.8", family: 4 })),
  ]) {
    const adapter = createSafeOutbound({
      getEnv: () => ({ ALLOWLIST_YAML: yaml() }),
      lookup: async () => answers,
      transport: sink.transport,
    });
    const result = await adapter(new Request(url));
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain("169.254");
  }
  expect(sink.calls).toEqual([]);
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const denied = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml() }),
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    transport: sink.transport,
  });
  expect(
    (await denied(new Request(url, { method: "POST", body, duplex: "half" } as RequestInit)))
      .status,
  ).toBe(403);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancelled).toBe(true);
});

it("rechecks a live allowlist after DNS and after request-body completion", async () => {
  const sink = makeTransport();
  let allowed = true,
    releaseDns!: (value: any) => void;
  const adapter = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml(allowed ? ["preview.example.com"] : []) }),
    lookup: () =>
      new Promise((resolve) => {
        releaseDns = resolve;
      }),
    transport: sink.transport,
  });
  const pending = adapter(new Request(url));
  allowed = false;
  releaseDns([{ address: "8.8.8.8", family: 4 }]);
  expect((await pending).status).toBe(403);
  allowed = true;
  let finish!: () => void;
  const body = new ReadableStream({
    start(controller) {
      finish = () => {
        controller.enqueue(new TextEncoder().encode("ok"));
        controller.close();
      };
    },
  });
  const second = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml(allowed ? ["preview.example.com"] : []) }),
    lookup: publicDns,
    transport: sink.transport,
  });
  const request = new Request(url, { method: "POST", body, duplex: "half" } as RequestInit);
  const pendingBody = second(request);
  await new Promise((resolve) => setTimeout(resolve, 0));
  allowed = false;
  finish();
  expect((await pendingBody).status).toBe(403);
  expect(sink.calls).toEqual([]);
});

it("enforces HTTPS, response and request limits, stops redirects and removes unsafe headers", async () => {
  const env = { ALLOWLIST_YAML: yaml(["preview.example.com"], [], ["preview.example.com"]) };
  const sink = makeTransport({
    status: 302,
    headers: { location: "https://blocked.example/", "content-length": "10000000" },
    chunks: [Buffer.alloc(512)],
  });
  const adapter = createSafeOutbound({
    getEnv: () => env,
    lookup: publicDns,
    transport: sink.transport,
  });
  const request = new Request(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer client-secret",
      Cookie: "session=secret",
      "X-FlaRC-Secret": "hook-value",
      "User-Agent": "FlaRC-Webhook-Dispatcher/1.0",
      "Accept-Encoding": "gzip",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const response = await adapter(request);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://blocked.example/");
  expect(sink.calls).toHaveLength(1);
  expect(sink.responses[0].destroyed).toBe(true);
  expect(sink.calls[0].headers).not.toHaveProperty("authorization");
  expect(sink.calls[0].headers).not.toHaveProperty("cookie");
  expect(sink.calls[0].headers).toMatchObject({
    "x-flarc-secret": "hook-value",
    "user-agent": "FlaRC-Webhook-Dispatcher/1.0",
    "content-type": "application/json",
    "accept-encoding": "identity",
  });
  for (const destination of [
    "http://preview.example.com/",
    "https://127.0.0.1/",
    "https://preview.example.com:444/",
    "https://other.example.com/",
  ])
    expect((await adapter(new Request(destination))).status).toBe(403);
  expect(
    (await adapter({ url: "https://user:password@preview.example.com/", method: "GET" } as Request))
      .status,
  ).toBe(403);
  const over = makeTransport({ chunks: [Buffer.alloc(600000), Buffer.alloc(600000)] });
  expect(
    (
      await createSafeOutbound({ getEnv: () => env, lookup: publicDns, transport: over.transport })(
        new Request(url),
      )
    ).status,
  ).toBe(502);
  expect(over.responses[0].destroyed).toBe(true);
  const lying = makeTransport({
    headers: { "content-length": "1" },
    chunks: [Buffer.alloc(600000), Buffer.alloc(600000)],
  });
  expect(
    (
      await createSafeOutbound({
        getEnv: () => env,
        lookup: publicDns,
        transport: lying.transport,
      })(new Request(url))
    ).status,
  ).toBe(502);
  expect(lying.responses[0].destroyed).toBe(true);
  const compressed = makeTransport({ headers: { "content-encoding": "gzip" } });
  expect(
    (
      await createSafeOutbound({
        getEnv: () => env,
        lookup: publicDns,
        transport: compressed.transport,
      })(new Request(url))
    ).status,
  ).toBe(502);
  expect(compressed.responses[0].destroyed).toBe(true);
  const tooLarge = makeTransport();
  expect(
    (
      await createSafeOutbound({
        getEnv: () => env,
        lookup: publicDns,
        transport: tooLarge.transport,
      })(new Request(url, { method: "POST", body: "x".repeat(1024 * 1024 + 1) }))
    ).status,
  ).toBe(413);
  expect(tooLarge.calls).toEqual([]);
});

it("preserves VAPID only for push grants and never forwards a bearer token", async () => {
  const sink = makeTransport();
  const env = { ALLOWLIST_YAML: yaml([], [], ["preview.example.com"]) };
  const adapter = createSafeOutbound({
    getEnv: () => env,
    lookup: publicDns,
    transport: sink.transport,
  });
  const vapid = "vapid t=abc.def.ghi, k=public_key";
  expect(
    (
      await adapter(
        new Request(url, {
          method: "POST",
          headers: { authorization: vapid, ttl: "60", "content-encoding": "aes128gcm" },
          body: "encrypted",
        }),
      )
    ).status,
  ).toBe(200);
  expect(sink.calls[0].headers).toMatchObject({
    authorization: vapid,
    ttl: "60",
    "content-encoding": "aes128gcm",
  });
});

it("caps concurrent unresolved DNS without queuing and cancels an active socket on caller abort", async () => {
  const sink = makeTransport({ hang: true });
  const releases: ((value: any) => void)[] = [],
    controllers = Array.from({ length: 32 }, () => new AbortController());
  const adapter = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml() }),
    lookup: () => new Promise((resolve) => releases.push(resolve)),
    transport: sink.transport,
  });
  const pending = controllers.map((controller) =>
    adapter(new Request(url, { signal: controller.signal })),
  );
  expect((await adapter(new Request(url))).status).toBe(503);
  for (const controller of controllers) controller.abort();
  expect((await Promise.all(pending)).every((response) => response.status === 499)).toBe(true);
  // Aborted but unresolved DNS lookups retain their slots, preventing hidden unbounded work.
  expect((await adapter(new Request(url))).status).toBe(503);
  for (const release of releases) release([{ address: "8.8.8.8", family: 4 }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sink.calls).toEqual([]);
  const controller = new AbortController();
  const live = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml() }),
    lookup: publicDns,
    transport: sink.transport,
  });
  const result = live(new Request(url, { signal: controller.signal }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  expect((await result).status).toBe(499);
  expect(sink.requests[0].destroyed).toBe(true);
});

it("applies the real default five-second deadline to an unresponsive connection", async () => {
  const sink = makeTransport({ hang: true });
  const adapter = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml() }),
    lookup: publicDns,
    transport: sink.transport,
  });
  const started = Date.now(),
    result = await adapter(new Request(url));
  expect(result.status).toBe(504);
  expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
  expect(Date.now() - started).toBeLessThan(7000);
  expect(sink.requests[0].destroyed).toBe(true);
}, 10000);

it("deadlines cover DNS and stalled request bodies without a later connection", async () => {
  const sink = makeTransport();
  let release!: (addresses: any) => void;
  const env = () => ({ ALLOWLIST_YAML: yaml() });
  const dnsTimeout = createSafeOutbound({
    getEnv: env,
    lookup: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    transport: sink.transport,
    timeoutMs: 30,
  });
  expect((await dnsTimeout(new Request(url))).status).toBe(504);
  release([{ address: "8.8.8.8", family: 4 }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sink.calls).toEqual([]);
  let cancelled = false;
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  const bodyTimeout = createSafeOutbound({
    getEnv: env,
    lookup: publicDns,
    transport: sink.transport,
    timeoutMs: 30,
  });
  expect(
    (await bodyTimeout(new Request(url, { method: "POST", body, duplex: "half" } as RequestInit)))
      .status,
  ).toBe(504);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancelled).toBe(true);
  expect(sink.calls).toEqual([]);
}, 10000);

it("real authenticated preview endpoint uses the pinned outbound adapter without reaching a denied destination", async () => {
  const scriptPath = await ensureNitroBuilt();
  const policy = yaml(["preview.example.com", "mixed.example.com"]);
  const sink = makeTransport({
    headers: { "content-type": "text/html" },
    chunks: [Buffer.from("<title>Pinned preview</title>")],
  });
  const queried: string[] = [];
  const adapter = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: policy }),
    lookup: async (host: string) => {
      queried.push(host);
      return host === "mixed.example.com"
        ? [
            { address: "8.8.8.8", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]
        : [{ address: "8.8.8.8", family: 4 }];
    },
    transport: sink.transport,
  });
  const mf = new Miniflare({
    modules: true,
    scriptPath,
    modulesRoot: path.dirname(scriptPath),
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SIGNUP_POLICY: "open", ALLOWLIST_YAML: policy },
    outboundService: adapter as any,
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
  });
  try {
    const origin = await mf.ready,
      password = `Preview-${randomUUID()}!`;
    const request = (route: string, token?: string, method = "GET", data?: unknown) =>
      fetch(new URL(route, origin), {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    expect(
      (await request("/api/v1/auth/register", undefined, "POST", { username: "alice", password }))
        .status,
    ).toBe(201);
    const login = await request("/api/v1/auth/login", undefined, "POST", {
      username: "alice",
      password,
    });
    expect(login.status).toBe(200);
    const token = ((await login.json()) as any).token as string;
    const route = (host: string) =>
      `/api/v1/embeds?url=${encodeURIComponent(`https://${host}/page`)}`;
    expect((await request(route("preview.example.com"))).status).toBe(401);
    expect(queried).toEqual([]);
    const positive = await request(route("preview.example.com"), token);
    expect(positive.status).toBe(200);
    expect(((await positive.json()) as any).embed.title).toBe("Pinned preview");
    expect(queried).toEqual(["preview.example.com"]);
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]).toMatchObject({
      hostname: "8.8.8.8",
      servername: "preview.example.com",
      rejectUnauthorized: true,
    });
    expect((await request(route("mixed.example.com"), token)).status).toBe(404);
    expect(queried).toEqual(["preview.example.com", "mixed.example.com"]);
    expect(sink.calls).toHaveLength(1);
  } finally {
    await mf.dispose();
  }
}, 60000);

it("releases all connected close-only requests after abort without leaking capacity", async () => {
  const hanging = makeTransport({ hang: true }),
    healthy = makeTransport();
  const controllers = Array.from({ length: 32 }, () => new AbortController());
  let opened = 0;
  const adapter = createSafeOutbound({
    getEnv: () => ({ ALLOWLIST_YAML: yaml() }),
    lookup: publicDns,
    transport: (options: any, callback: any) =>
      ++opened <= 32 ? hanging.transport(options, callback) : healthy.transport(options, callback),
  });
  const pending = controllers.map((controller) =>
    adapter(new Request(url, { signal: controller.signal })),
  );
  for (let i = 0; i < 200 && hanging.calls.length < 32; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(hanging.calls).toHaveLength(32);
  for (const controller of controllers) controller.abort();
  expect((await Promise.all(pending)).every((response) => response.status === 499)).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(hanging.requests.every((request) => request.destroyed)).toBe(true);
  const result = await adapter(new Request(url));
  expect(result.status).toBe(200);
  expect(await result.text()).toBe("healthy");
  expect(healthy.calls).toHaveLength(1);
});
