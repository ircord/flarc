import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare, Response as SinkResponse } from "miniflare";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

// Named hosts are intercepted entirely by Miniflare; no DNS, private network or cloud request occurs.
it("[ABUSE-017] outbound timeout, streamed limits and response cleanup preserve isolated live state across recreation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "outbound-boundaries-"));
  const scriptPath = await ensureNitroBuilt();
  const hops: string[] = [];
  const produced = new Map<string, number>();
  const cancelled = new Set<string>();
  const timeouts: ReturnType<typeof setTimeout>[] = [];
  function body(id: string, chunks: number, size: number, first = "", last = "") {
    let count = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (count >= chunks) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(size).fill(120);
        if (count === 0) chunk.set(new TextEncoder().encode(first).slice(0, size));
        if (count === chunks - 1 && last)
          chunk.set(new TextEncoder().encode(last), size - last.length);
        count++;
        produced.set(id, count * size);
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled.add(id);
      },
    });
  }
  const options = {
    modules: true as const,
    scriptPath,
    modulesRoot: path.dirname(scriptPath),
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    durableObjectsPersist: directory,
    bindings: {
      SIGNUP_POLICY: "open",
      EMBED_ALLOWED_HOSTS: "preview.example.com,provider.example.com",
    },
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
    outboundService: async (request: import("miniflare").Request) => {
      hops.push(request.url);
      const u = new URL(request.url),
        id = u.searchParams.get("id") ?? u.pathname;
      if (u.pathname === "/slow") {
        await new Promise<void>((resolve) => {
          timeouts.push(setTimeout(resolve, 6500));
        });
        return new SinkResponse("<title>Late preview</title>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (u.pathname === "/stream" || u.pathname === "/lying" || u.pathname === "/declared")
        return new SinkResponse(body(id, 128, 16 * 1024, "<title>Oversized should fail</title>"), {
          headers: {
            "content-type": "text/html",
            ...(u.pathname === "/lying"
              ? { "content-length": "64" }
              : u.pathname === "/declared"
                ? { "content-length": "2000000" }
                : {}),
          },
        });
      if (u.pathname === "/redirect")
        return new SinkResponse(body(id, 128, 16 * 1024), {
          status: 302,
          headers: { location: "https://blocked.example/never" },
        });
      if (u.pathname === "/reject")
        return new SinkResponse(body(id, 128, 16 * 1024), { status: 503 });
      if (u.pathname === "/discover")
        return new SinkResponse(
          `<link type="application/json+oembed" href="https://provider.example.com/oversize?id=${id}"><meta property="og:title" content="Fallback preview">`,
          { headers: { "content-type": "text/html" } },
        );
      if (u.pathname === "/oversize")
        return new SinkResponse(
          body(id, 64, 8192, '{"title":"Oversized provider","padding":"', '"}'),
          {
            headers: { "content-type": "application/json" },
          },
        );
      return new SinkResponse('<meta property="og:title" content="Healthy preview">', {
        headers: { "content-type": "text/html" },
      });
    },
  };
  let mf = new Miniflare(options),
    url = await mf.ready,
    stopped = false;
  const clients: TestIRCClient[] = [],
    sockets: WebSocket[] = [];
  async function stop() {
    if (stopped) return;
    for (const socket of sockets.splice(0)) socket.terminate();
    for (const client of clients.splice(0)) client.close();
    await mf.dispose();
    stopped = true;
  }
  async function start() {
    mf = new Miniflare(options);
    url = await mf.ready;
    stopped = false;
  }
  async function req(route: string, token?: string, method = "GET", data?: unknown) {
    return fetch(new URL(route, url), {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  }
  async function actor(name: string) {
    const password = `Boundary-${name}-${randomUUID()}!`;
    expect(
      (await req("/api/v1/auth/register", undefined, "POST", { username: name, password })).status,
    ).toBe(201);
    const response = await req("/api/v1/auth/login", undefined, "POST", {
      username: name,
      password,
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    return { name, password, token: data.token as string, id: data.account.id as string };
  }
  async function connect(who: Awaited<ReturnType<typeof actor>>, channel: string) {
    const client = new TestIRCClient(`ws://${url.host}/irc`);
    clients.push(client);
    await client.connect();
    client.send(`PASS ${who.name}:${who.password}`);
    await client.register(who.name);
    for (const name of [channel, "#barrier"]) {
      const done = client.waitForNewLine((line) => line.includes(" 366 ") && line.includes(name));
      client.send(`JOIN ${name}`);
      await done;
    }
    return client;
  }
  async function events(who: Awaited<ReturnType<typeof actor>>) {
    const issued = await req("/api/v1/auth/events-ticket", who.token, "POST");
    expect(issued.status).toBe(200);
    const ws = new WebSocket(
      `ws://${url.host}/api/v1/events?ticket=${((await issued.json()) as any).ticket}`,
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
  async function wait(lines: string[], marker: string) {
    for (let i = 0; i < 500; i++) {
      if (lines.some((line) => line.includes(marker))) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`missing event ${marker}`);
  }
  function domainSnapshot() {
    function files(folder: string): string[] {
      return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(folder, entry.name))
          : entry.name.endsWith(".sqlite")
            ? [path.join(folder, entry.name)]
            : [],
      );
    }
    const state: Record<string, unknown[]> = {};
    for (const file of files(directory)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const has = (table: string) =>
          !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (has("users")) {
          for (const table of ["users", "registered_nicks", "account_roles", "api_sessions"])
            state[`accounts:${table}`] = db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
        } else if (has("channel_metadata")) {
          const channel = (
            db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as any
          )?.value;
          if (!["#protected", "#unrelated"].includes(channel)) continue;
          for (const table of [
            "messages",
            "channel_permissions",
            "channel_role_groups",
            "channel_user_roles",
          ])
            state[`${channel}:${table}`] = db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
        }
      } finally {
        db.close();
      }
    }
    return state;
  }
  try {
    const alice = await actor("alice"),
      bob = await actor("bob"),
      charlie = await actor("charlie");
    async function exercise(phase: string) {
      const a = await connect(alice, "#protected");
      if (phase === "before") {
        const mode = a.waitForNewLine((line) => line.includes(" MODE #protected +s"));
        a.send("MODE #protected +s");
        await mode;
      }
      const b = await connect(bob, "#protected"),
        c = await connect(charlie, "#unrelated");
      for (const [who, channel] of [
        [alice, "protected"],
        [charlie, "unrelated"],
      ] as const) {
        expect(
          (
            await req(`/api/v1/channels/%23${channel}/messages`, who.token, "POST", {
              content: `sentinel-${phase}-${channel}`,
            })
          ).status,
        ).toBe(201);
      }
      const streams = await Promise.all([alice, bob, charlie].map(events));
      async function barrier() {
        const marker = `boundary-barrier-${randomUUID()}`;
        const irc = [a, b, c].map((client) =>
          client.waitForNewLine((line) => line.includes(marker)),
        );
        expect(
          (
            await req("/api/v1/channels/%23barrier/messages", alice.token, "POST", {
              content: marker,
            })
          ).status,
        ).toBe(201);
        await Promise.all([...irc, ...streams.map((lines) => wait(lines, marker))]);
        return marker;
      }
      await barrier();
      const offsets = [a, b, c].map((client) => client.lines.length),
        eventOffsets = streams.map((lines) => lines.length),
        before = domainSnapshot();
      const base = "https://preview.example.com";
      async function preview(target: string) {
        return req(`/api/v1/embeds?url=${encodeURIComponent(target)}`, alice.token);
      }
      const positive = await preview(`${base}/healthy`);
      expect(positive.status).toBe(200);
      expect(((await positive.json()) as any).embed.title).toBe("Healthy preview");
      expect(hops.pop()).toBe(`${base}/healthy`);
      for (const endpoint of ["stream", "lying", "declared", "redirect", "reject"] as const) {
        const id = `${phase}-${endpoint}`,
          target = `${base}/${endpoint}?id=${id}`,
          hopStart = hops.length;
        const result = await preview(target);
        if (endpoint === "lying") {
          // The transport frames the response to the short advertised length, yielding
          // a complete small preview; the native-stream test checks untruncated lies.
          expect(result.status).toBe(200);
          expect(((await result.json()) as any).embed.title).toBe("Oversized should fail");
        } else expect(result.status).toBe(404);
        expect(hops.slice(hopStart)).toEqual([target]);
        if (endpoint === "stream")
          expect(produced.get(id) ?? 0).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024);
      }
      const oid = `${phase}-oembed`,
        page = `${base}/discover?id=${oid}`,
        provider = `https://provider.example.com/oversize?id=${oid}`,
        hopStart = hops.length;
      const fallback = await preview(page);
      expect(fallback.status).toBe(200);
      expect(((await fallback.json()) as any).embed.title).toBe("Fallback preview");
      expect(hops.slice(hopStart)).toEqual([page, provider]);
      expect(produced.get(oid) ?? 0).toBeLessThanOrEqual(128 * 1024 + 32 * 1024);
      const slow = `${base}/slow?id=${phase}`,
        slowStart = hops.length,
        started = Date.now();
      expect((await preview(slow)).status).toBe(404);
      expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
      expect(Date.now() - started).toBeLessThan(6400);
      expect(hops.slice(slowStart)).toEqual([slow]);
      const marker = await barrier();
      for (const [i, client] of [a, b, c].entries())
        expect(client.lines.slice(offsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
      for (const [i, lines] of streams.entries())
        expect(lines.slice(eventOffsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
      expect(domainSnapshot()).toEqual(before);
    }
    await exercise("before");
    await stop();
    await start();
    await exercise("restart");
  } finally {
    await stop();
    for (const timer of timeouts) clearTimeout(timer);
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);

it("[ABUSE-017] workerd-native response streams receive cancellation on redirect, rejection and byte limits, and timeout aborts fetch", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "outbound-native-"));
  const original = await ensureNitroBuilt();
  cpSync(path.dirname(original), path.join(directory, "bundle"), { recursive: true });
  const wrapper = path.join(directory, "observer.mjs");
  // This read-only observer wraps only the test runtime's outbound fetch. Authentication,
  // request routing and preview policy execute in the original frozen application.
  writeFileSync(
    wrapper,
    `
import app from './bundle/index.mjs';
export { AccountsDO, ChannelDO, SessionDO } from './bundle/index.mjs';
const records = {};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const id = url.searchParams.get('id') || url.pathname;
  const row = records[id] = { urls: [url.href], bytes: 0, cancelled: 0, aborted: 0 };
  if (url.pathname === '/slow') return await new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { row.aborted++; reject(new Error('aborted')); }, { once: true });
  });
  let count = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (count++ >= 256) { controller.close(); return; }
      const chunk = new Uint8Array(8192).fill(120);
      if (count === 1) {
        const prefix = url.pathname === '/oversize' ? '{"title":"Oversized provider","padding":"' : '<title>Oversized should fail</title>';
        chunk.set(new TextEncoder().encode(prefix));
      }
      if (url.pathname === '/oversize' && count === 256) chunk.set(new TextEncoder().encode('"}'), 8190);
      row.bytes += chunk.length; controller.enqueue(chunk);
    },
    cancel() { row.cancelled++; }
  });
  if (url.pathname === '/redirect') return new Response(stream, { status: 302, headers: { location: 'https://denied.example/no' } });
  if (url.pathname === '/reject') return new Response(stream, { status: 503 });
  if (url.pathname === '/declared') return new Response(stream, { headers: { 'content-type': 'text/html', 'content-length': '2000000' } });
  if (url.pathname === '/lying') return new Response(stream, { headers: { 'content-type': 'text/html', 'content-length': '64' } });
  if (url.pathname === '/discover') return new Response('<link type="application/json+oembed" href="https://provider.example.com/oversize?id=oversize"><title>Fallback native</title>', { headers: { 'content-type': 'text/html' } });
  if (url.pathname === '/oversize') return new Response(stream, { headers: { 'content-type': 'application/json' } });
  return new Response(stream, { headers: { 'content-type': 'text/html' } });
};
export default { async fetch(req, env, ctx) {
  if (new URL(req.url).pathname === '/__outbound_observation') return Response.json(records);
  return app.fetch(req, env, ctx);
} };`,
  );
  const mf = new Miniflare({
    modules: true,
    scriptPath: wrapper,
    modulesRoot: directory,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      SIGNUP_POLICY: "open",
      EMBED_ALLOWED_HOSTS: "preview.example.com,provider.example.com",
    },
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
  });
  try {
    const origin = await mf.ready;
    async function request(route: string, token?: string, method = "GET", data?: unknown) {
      return fetch(new URL(route, origin), {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    }
    const password = `Native-${randomUUID()}!`;
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
    const base = "https://preview.example.com";
    async function preview(route: string) {
      return request(`/api/v1/embeds?url=${encodeURIComponent(base + route)}`, token);
    }
    for (const type of ["stream", "lying", "redirect", "reject", "declared"])
      expect((await preview(`/${type}?id=${type}`)).status).toBe(404);
    const oembed = await preview("/discover?id=discover");
    expect(oembed.status).toBe(200);
    expect(((await oembed.json()) as any).embed.title).toBe("Fallback native");
    expect((await preview("/slow?id=slow")).status).toBe(404);
    const observations = (await (await request("/__outbound_observation")).json()) as any;
    for (const type of ["stream", "lying", "redirect", "reject", "declared", "oversize"])
      expect(observations[type].cancelled, type).toBe(1);
    expect(observations.stream.bytes).toBeLessThanOrEqual(1024 * 1024 + 2 * 8192);
    expect(observations.oversize.bytes).toBeLessThanOrEqual(128 * 1024 + 2 * 8192);
    expect(observations.slow.aborted).toBe(1);
    expect(observations.redirect.urls).toEqual([`${base}/redirect?id=redirect`]);
  } finally {
    await mf.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
