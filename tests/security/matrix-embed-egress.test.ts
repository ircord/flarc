import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare, Response as SinkResponse } from "miniflare";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

// The sink witnesses actual workerd fetches; it never connects to the named hosts.
// Exact hostname grants are operator capabilities, not DNS or provider-IP validation.
it("ABUSE-017: authenticated previews constrain every network hop and preserve state across recreation", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "embed-egress-"));
  const scriptPath = await ensureNitroBuilt();
  const egress: string[] = [];
  const options = {
    modules: true as const,
    scriptPath,
    modulesRoot: path.dirname(scriptPath),
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      SIGNUP_POLICY: "open",
      EMBED_ALLOWED_HOSTS: "preview.example.com,provider.example.com",
    },
    durableObjectsPersist: dir,
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
    outboundService: async (request: import("miniflare").Request) => {
      egress.push(request.url);
      const u = new URL(request.url);
      if (u.pathname === "/redirect")
        return new SinkResponse(null, {
          status: 302,
          headers: { location: u.searchParams.get("to")! },
        });
      if (u.pathname === "/loop")
        return new SinkResponse(null, { status: 302, headers: { location: "/loop" } });
      if (u.pathname === "/large")
        return new SinkResponse("x".repeat(1024 * 1024 + 1), {
          headers: { "content-type": "text/html" },
        });
      if (u.pathname === "/oembed")
        return new SinkResponse(
          JSON.stringify({
            title: "Provider title",
            provider_name: "Provider",
            type: "video",
            html: "<script>bad()</script>",
          }),
          { headers: { "content-type": "application/json" } },
        );
      const discovery = u.searchParams.get("discovery");
      return new SinkResponse(
        `${discovery ? `<link type="application/json+oembed" href="${discovery}">` : ""}<meta property="og:title" content="Safe preview">`,
        { headers: { "content-type": "text/html" } },
      );
    },
  };
  let mf = new Miniflare(options),
    url = await mf.ready,
    stopped = false;
  const clients: TestIRCClient[] = [],
    sockets: WebSocket[] = [];
  async function stop() {
    if (stopped) return;
    for (const s of sockets.splice(0)) s.terminate();
    for (const c of clients.splice(0)) c.close();
    await mf.dispose();
    stopped = true;
  }
  async function start() {
    mf = new Miniflare(options);
    url = await mf.ready;
    stopped = false;
  }
  async function req(route: string, token?: string, method = "GET", body?: unknown) {
    return fetch(new URL(route, url), {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function actor(name: string) {
    const password = `Embed-${name}-${randomUUID()}!`;
    expect(
      (await req("/api/v1/auth/register", undefined, "POST", { username: name, password })).status,
    ).toBe(201);
    const login = await req("/api/v1/auth/login", undefined, "POST", { username: name, password });
    expect(login.status).toBe(200);
    return { name, password, token: ((await login.json()) as any).token as string };
  }
  function snapshots() {
    function files(folder: string): string[] {
      return readdirSync(folder, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(path.join(folder, e.name))
          : e.name.endsWith(".sqlite")
            ? [path.join(folder, e.name)]
            : [],
      );
    }
    return files(dir)
      .flatMap((file) => {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          if (
            !db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
              .get()
          )
            return [];
          return db
            .prepare("SELECT * FROM messages WHERE content LIKE 'embed-state-%' ORDER BY id")
            .all();
        } finally {
          db.close();
        }
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  try {
    const alice = await actor("alice"),
      charlie = await actor("charlie");
    async function connect(a: typeof alice, channel: string) {
      const c = new TestIRCClient(`ws://${url.host}/irc`);
      clients.push(c);
      await c.connect();
      c.send(`PASS ${a.name}:${a.password}`);
      await c.register(a.name);
      const joined = c.waitForNewLine((line) => line.includes(" 366 ") && line.includes(channel));
      c.send(`JOIN ${channel}`);
      await joined;
      return c;
    }
    const a = await connect(alice, "#protected"),
      c = await connect(charlie, "#unrelated");
    for (const [who, channel] of [
      [alice, "protected"],
      [charlie, "unrelated"],
    ] as const) {
      expect(
        (
          await req(`/api/v1/channels/%23${channel}/messages`, who.token, "POST", {
            content: `embed-state-${channel}`,
          })
        ).status,
      ).toBe(201);
    }
    await stop();
    const before = snapshots();
    expect(before.map((row: any) => row.content).sort()).toEqual([
      "embed-state-protected",
      "embed-state-unrelated",
    ]);
    async function exercise() {
      await start();
      const observer = await connect(alice, "#protected");
      const ticket = await req("/api/v1/auth/events-ticket", alice.token, "POST");
      expect(ticket.status).toBe(200);
      const ws = new WebSocket(
        `ws://${url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
      );
      sockets.push(ws);
      const events: string[] = [];
      ws.on("message", (data) => events.push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      async function barrier() {
        const marker = `embed-barrier-${randomUUID()}`;
        const irc = observer.waitForNewLine((line) => line.includes(marker));
        expect(
          (
            await req("/api/v1/channels/%23protected/messages", alice.token, "POST", {
              content: marker,
            })
          ).status,
        ).toBe(201);
        await irc;
        for (let i = 0; i < 500 && !events.some((line) => line.includes(marker)); i++)
          await new Promise((r) => setTimeout(r, 10));
        expect(events.some((line) => line.includes(marker))).toBe(true);
        return marker;
      }
      async function preview(target: string) {
        return req(`/api/v1/embeds?url=${encodeURIComponent(target)}`, alice.token);
      }
      async function good(target: string, title: string, expected: string[]) {
        const start = egress.length;
        const response = await preview(target);
        expect(response.status).toBe(200);
        const body = (await response.json()) as any;
        expect(body.embed.title).toBe(title);
        if (title === "Provider title") expect(body.embed.html).toBeNull();
        expect(egress.slice(start)).toEqual(expected);
      }
      const base = "https://preview.example.com";
      await good(`${base}/page`, "Safe preview", [`${base}/page`]);
      const allowedRedirect = `${base}/redirect?to=${encodeURIComponent(`${base}/page`)}`;
      await good(allowedRedirect, "Safe preview", [allowedRedirect, `${base}/page`]);
      const discovery = "https://provider.example.com/oembed";
      const page = `${base}/page?discovery=${encodeURIComponent(discovery)}`;
      await good(page, "Provider title", [page, discovery]);
      await barrier();
      const ircStart = observer.lines.length,
        eventStart = events.length;
      for (const target of [
        "http://127.0.0.1/",
        "https://127.0.0.1/",
        "https://169.254.169.254/latest/meta-data/",
        "https://metadata.google.internal/",
        "https://[::1]/",
        "https://[fe80::1]/",
        "https://2130706433/",
        "https://0x7f000001/",
        "https://preview.example.com@127.0.0.1/",
        "https://preview.example.com:444/",
        "https://preview.example.com.evil.example/",
        "https://preview.example.com./",
        "https://preview%2eexample%2ecom.evil.example/",
      ]) {
        const start = egress.length;
        expect((await preview(target)).status).toBe(404);
        expect(egress.slice(start)).toEqual([]);
      }
      for (const target of [
        "https://127.0.0.1/",
        "https://metadata.google.internal/",
        "https://evil.example/",
      ]) {
        const redirect = `${base}/redirect?to=${encodeURIComponent(target)}`;
        const start = egress.length;
        expect((await preview(redirect)).status).toBe(404);
        expect(egress.slice(start)).toEqual([redirect]);
        const disallowed = `${base}/page?discovery=${encodeURIComponent(target)}`;
        await good(disallowed, "Safe preview", [disallowed]);
      }
      const secondaryRedirect = `https://provider.example.com/redirect?to=${encodeURIComponent("https://169.254.169.254/")}`;
      const secondaryPage = `${base}/page?discovery=${encodeURIComponent(secondaryRedirect)}`;
      await good(secondaryPage, "Safe preview", [secondaryPage, secondaryRedirect]);
      const loopStart = egress.length;
      expect((await preview(`${base}/loop`)).status).toBe(404);
      expect(egress.slice(loopStart)).toEqual(Array(4).fill(`${base}/loop`));
      const large = egress.length;
      expect((await preview(`${base}/large`)).status).toBe(404);
      expect(egress.slice(large)).toEqual([`${base}/large`]);
      const marker = await barrier();
      expect(observer.lines.slice(ircStart).filter((line) => !line.includes(marker))).toEqual([]);
      expect(events.slice(eventStart).filter((line) => !line.includes(marker))).toEqual([]);
      await stop();
      expect(snapshots()).toEqual(before);
    }
    await exercise();
    await exercise();
    void a;
    void c;
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
