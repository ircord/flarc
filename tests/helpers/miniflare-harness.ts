import fs from "node:fs";
import path from "node:path";
import { Miniflare } from "miniflare";
import WebSocket from "ws";

export async function ensureNitroBuilt(): Promise<string> {
  const scriptPath =
    process.env.FLARC_TEST_BUNDLE ?? path.resolve(process.cwd(), ".output/server/index.mjs");
  if (!fs.existsSync(scriptPath))
    throw new Error("Build snapshot is missing; run through Vitest globalSetup");
  return scriptPath;
}

export async function createMiniflareServer(options?: {
  durableObjectsPersist?: string;
  bindings?: Record<string, string>;
  r2Buckets?: Record<string, string> | string[];
}): Promise<{
  mf: Miniflare;
  url: URL;
  wsUrl: string;
  dispose: () => Promise<void>;
}> {
  const scriptPath = await ensureNitroBuilt();
  const mf = new Miniflare({
    modules: true,
    scriptPath,
    modulesRoot: path.dirname(scriptPath),
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SIGNUP_POLICY: "open", ...options?.bindings },
    durableObjectsPersist: options?.durableObjectsPersist,
    r2Buckets: options?.r2Buckets,
    durableObjects: {
      SESSION: {
        className: "SessionDO",
        useSQLite: true,
      },
      CHANNELS: {
        className: "ChannelDO",
        useSQLite: true,
      },
      ACCOUNTS: {
        className: "AccountsDO",
        useSQLite: true,
      },
    },
  });

  let url: URL;
  try {
    url = await mf.ready;
  } catch (error) {
    await mf.dispose();
    throw error;
  }
  const wsUrl = `ws://${url.host}/irc`;

  let disposed = false;
  return {
    mf,
    url,
    wsUrl,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await mf.dispose();
    },
  };
}

export class TestIRCClient {
  public ws!: WebSocket;
  public lines: string[] = [];
  private waiters: Array<{
    predicate: (line: string) => boolean;
    resolve: (line: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    private readonly wsUrl: string,
    private readonly subprotocol: "text.ircv3.net" | "binary.ircv3.net" = "text.ircv3.net",
  ) {}

  public async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, [this.subprotocol]);
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
      this.ws.on("message", (data, isBinary) => {
        const text = isBinary
          ? Buffer.from(data as ArrayBuffer).toString("utf-8")
          : data.toString();
        this.lines.push(text);
        const ping = /^(?::[^ ]+ )?PING (.+?)(?:\r?\n)?$/.exec(text);
        if (ping && this.ws.readyState === WebSocket.OPEN) this.send(`PONG ${ping[1]}`);
        for (let i = this.waiters.length - 1; i >= 0; i--) {
          const w = this.waiters[i];
          if (w.predicate(text)) {
            clearTimeout(w.timer);
            this.waiters.splice(i, 1);
            w.resolve(text);
          }
        }
      });
    });
  }

  public send(line: string): void {
    const payload = line.endsWith("\r\n") ? line : `${line}\r\n`;
    if (this.subprotocol === "binary.ircv3.net") {
      this.ws.send(Buffer.from(payload, "utf-8"));
    } else {
      this.ws.send(payload);
    }
  }

  public waitForLine(predicate: (line: string) => boolean, timeoutMs = 4000): Promise<string> {
    for (const existing of this.lines) {
      if (predicate(existing)) {
        return Promise.resolve(existing);
      }
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for IRC line. Received so far:\n${this.lines.join("\n")}`),
        );
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public waitForNewLine(predicate: (line: string) => boolean, timeoutMs = 4000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for new IRC line. Received so far:\n${this.lines.join("\n")}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public async waitForNumeric(numeric: string | number, timeoutMs = 4000): Promise<string> {
    const numStr = String(numeric).padStart(3, "0");
    return this.waitForLine((line) => {
      const parts = line.split(" ");
      return parts.length > 1 && parts[1] === numStr;
    }, timeoutMs);
  }

  public async register(nick: string, user = nick, realname = `${nick} User`): Promise<void> {
    this.send(`NICK ${nick}`);
    this.send(`USER ${user} 0 * :${realname}`);
    await this.waitForLine((l) => l.includes(" 001 ") && l.includes(nick));
    await this.waitForLine((l) => l.includes(" 376 "));
  }

  public close(): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("Client closed before predicate matched"));
    }
    this.waiters = [];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

/** Explicit open-network fixture for independent protocol tests; security suites use secure defaults. */
export async function createProtocolServer(options?: Parameters<typeof createMiniflareServer>[0]) {
  const bootstrapSecret = options?.bindings?.ADMIN_TOKEN ?? "fixture-bootstrap-only";
  const server = await createMiniflareServer({
    ...options,
    bindings: {
      REQUIRE_ACCOUNTS: "0",
      AUTO_REGISTER_CHANNELS: "0",
      SIGNUP_POLICY: "open",
      ADMIN_USERS: "FixtureAdmin",
      ...options?.bindings,
      ADMIN_TOKEN: bootstrapSecret,
    },
  });
  const rawFetch = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);
  const register = await rawFetch("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bootstrap-token": bootstrapSecret },
    body: JSON.stringify({ username: "FixtureAdmin", password: "fixture-admin-password" }),
  });
  if (register.status !== 201)
    throw new Error(`Fixture provisioning failed: ${await register.text()}`);
  async function login(username: string, password: string) {
    const response = await rawFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = (await response.json()) as any;
    if (!response.ok || !data.token)
      throw new Error(`Fixture login failed: ${JSON.stringify(data)}`);
    return data.token as string;
  }
  const adminToken = await login("FixtureAdmin", "fixture-admin-password");
  const authenticatedFetch =
    (token: string) =>
    (url: string | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
      return fetch(new URL(url, server.url), { ...init, headers });
    };
  const request = authenticatedFetch(adminToken);
  const apiClients: TestIRCClient[] = [];
  async function apiUser(username: string, channel: string) {
    const password = "fixture-user-password";
    const registered = await rawFetch("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (registered.status !== 201)
      throw new Error(`Fixture user failed: ${await registered.text()}`);
    const token = await login(username, password);
    const client = new TestIRCClient(server.wsUrl);
    apiClients.push(client);
    await client.connect();
    client.send(`PASS ${username}:${password}`);
    await client.register(username);
    client.send(`JOIN ${channel}`);
    await client.waitForLine((line) => line.includes(" 366 ") && line.includes(channel));
    return { token, client, request: authenticatedFetch(token) };
  }
  return {
    ...server,
    adminToken,
    request,
    login,
    authenticatedFetch,
    apiUser,
    dispose: async () => {
      for (const client of apiClients) client.close();
      await server.dispose();
    },
  };
}
