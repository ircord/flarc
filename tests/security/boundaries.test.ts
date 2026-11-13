import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "../helpers/event-reader";
import { createMiniflareServer, TestIRCClient } from "../helpers/miniflare-harness";

const PASSWORD = "Audit-password-123!";
const BOOTSTRAP = "audit-bootstrap-secret-only";

describe("Security boundaries with independent authenticated accounts", () => {
  let server: Awaited<ReturnType<typeof createMiniflareServer>>;
  const clients: TestIRCClient[] = [];
  const sockets: WebSocket[] = [];
  const tokens: Record<string, string> = {};

  const request = (
    path: string,
    user?: string,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(`${server.url.origin}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(user ? { Authorization: `Bearer ${tokens[user]}` } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  async function createAccount(username: string, bootstrap = false) {
    const res = await request(
      "/api/v1/auth/register",
      undefined,
      "POST",
      { username, password: PASSWORD },
      bootstrap ? { "x-bootstrap-token": BOOTSTRAP } : undefined,
    );
    expect(res.status).toBe(201);
    const login = await request("/api/v1/auth/login", undefined, "POST", {
      username,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    const data = (await login.json()) as any;
    tokens[username] = data.token;
    return data.account;
  }

  async function connect(username: string, nick = username) {
    const client = new TestIRCClient(server.wsUrl);
    clients.push(client);
    await client.connect();
    client.send(`PASS ${username}:${PASSWORD}`);
    await client.register(nick);
    return client;
  }

  async function channel(owner: TestIRCClient, name = "#vault", modes = "+si") {
    owner.send(`JOIN ${name}`);
    await owner.waitForLine((l) => l.includes(` 366 `) && l.includes(name));
    if (modes) {
      owner.send(`MODE ${name} ${modes}`);
      await owner.waitForLine((l) => l.includes(` MODE ${name} ${modes}`));
    }
    return `/api/v1/channels/${encodeURIComponent(name)}`;
  }

  beforeEach(async () => {
    server = await createMiniflareServer({
      bindings: { ADMIN_USERS: "AuditAdmin,SpareAdmin", ADMIN_TOKEN: BOOTSTRAP },
    });
    await createAccount("AuditAdmin", true);
    await createAccount("Alice");
    await createAccount("Bob");
    await createAccount("Charlie");
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    for (const socket of sockets.splice(0)) socket.close();
    await server?.dispose();
  });

  it("does not turn NICK/USER into a usable account session", async () => {
    const guest = new TestIRCClient(server.wsUrl);
    clients.push(guest);
    await guest.connect();
    guest.send(
      "NICK Unregistered\r\nUSER guest 0 * :Guest\r\nJOIN #vault\r\nPRIVMSG Alice :unauthorized",
    );
    await guest.waitForNumeric(451);
    guest.send("PING :barrier");
    await guest.waitForLine((l) => l.includes(" PONG "));
    expect(guest.lines.some((l) => l.includes(" 001 ") || l.includes(" JOIN #"))).toBe(false);
    const existing = new TestIRCClient(server.wsUrl);
    clients.push(existing);
    await existing.connect();
    existing.send(
      "NICK Bob\r\nUSER Bob 0 * :Existing account without credentials\r\nJOIN #vault\r\nPING :existing-account-barrier",
    );
    await existing.waitForLine(
      (l) => l.includes(" PONG ") && l.includes("existing-account-barrier"),
    );
    expect(existing.lines.some((l) => l.includes(" 001 ") || l.includes(" JOIN #"))).toBe(false);
  });

  it("requires real bot credentials and keeps assigned bot identity separate from service privileges", async () => {
    await createAccount("Automation");
    expect(
      (
        await request("/admin/accounts/Automation/roles", "AuditAdmin", "POST", {
          role: "bot",
          action: "grant",
        })
      ).status,
    ).toBe(200);
    const owner = await connect("Bob", "BobOwnerDevice");
    await channel(owner, "#bots", "+s");
    const bot = await connect("Automation");
    bot.send("JOIN #bots");
    await bot.waitForLine((line) => line.includes(" 366 ") && line.includes("#bots"));
    bot.send("PRIVMSG #bots :authenticated-bot-message");
    await owner.waitForLine(
      (line) => line.includes(":Automation!") && line.includes("authenticated-bot-message"),
    );
    expect((await request("/admin/accounts", "Automation")).status).toBe(403);
    bot.send("NS SADROP Bob");
    await bot.waitForLine((line) => line.includes("Insufficient privileges"));
    bot.send("NICK NickServ\r\nPING :bot-service-barrier");
    await bot.waitForLine(
      (line) => line.includes(" PONG ") && line.includes("bot-service-barrier"),
    );
    expect(
      bot.lines.some((line) => line.includes(" NICK NickServ") || line.includes(" NICK :NickServ")),
    ).toBe(false);
    bot.send("NICK Bob");
    await bot.waitForNumeric(433);
    bot.send("PRIVMSG #bots :identity-after-failed-takeover");
    await owner.waitForLine(
      (line) => line.includes(":Automation!") && line.includes("identity-after-failed-takeover"),
    );
    expect((await request("/api/v1/profiles/Bob", "Bob")).status).toBe(200);
    const closed = new Promise<void>((resolve) => bot.ws.once("close", () => resolve()));
    expect((await request("/admin/accounts/Automation/disable", "AuditAdmin", "POST")).status).toBe(
      200,
    );
    await closed;
    expect((await request("/api/v1/profiles/Automation", "Automation")).status).toBe(401);
  });

  it("rejects public privilege assignment and reserves bootstrap names", async () => {
    const escalation = await request("/api/v1/auth/register", undefined, "POST", {
      username: "Attacker",
      password: PASSWORD,
      roles: ["admin"],
    });
    expect(escalation.status).toBe(400);
    for (const headers of [
      { "x-user": "AuditAdmin" },
      { "soju-username": "AuditAdmin" },
      { "x-admin-token": BOOTSTRAP },
      { Authorization: `Bearer ${BOOTSTRAP}` },
      { Authorization: `Basic ${btoa(`AuditAdmin:${PASSWORD}`)}` },
    ] as Record<string, string>[]) {
      expect((await request("/admin/accounts", undefined, "GET", undefined, headers)).status).toBe(
        401,
      );
    }
    expect((await request("/admin/accounts", "Alice")).status).toBe(403);
    expect((await request("/admin/accounts", "AuditAdmin")).status).toBe(200);
  });

  it("requires a session for every protected REST resource and legacy alias", async () => {
    for (const path of [
      "/api/v1/channels",
      "/api/v1/search?q=secret",
      "/api/v1/messages/search?q=secret",
      "/api/v1/profiles/Alice",
      "/api/profile/Alice",
      "/api/v1/channels/%23public/messages",
      "/api/channels/%23public/info",
      "/api/v1/notifications/subscriptions?username=Alice",
      "/api/webpush/subscriptions?username=Alice",
      "/api/v1/users/Alice/unread",
      "/media/guessed.png",
      "/metrics",
    ]) {
      expect((await request(path)).status, path).toBe(401);
    }
    expect(
      (
        await request("/api/v1/channels/%23public/messages", undefined, "POST", {
          content: "forged",
          senderNick: "Alice",
        })
      ).status,
    ).toBe(401);
    expect(
      (await request("/api/v1/channels/%23public/messages/id", undefined, "DELETE")).status,
    ).toBe(401);
  });

  it.each(["+s", "+p", "+i", "+k swordfish"])(
    "isolates %s channels across discovery, metadata, history, unread and search",
    async (mode) => {
      const alice = await connect("Alice", "AliceDevice");
      const path = await channel(alice, "#vault", mode);
      const sent = await request(`${path}/messages`, "Alice", "POST", {
        content: "restricted-needle",
      });
      expect(sent.status).toBe(201);
      for (const suffix of [
        "/info",
        "/messages",
        "/messages/search?q=restricted",
        "/roles",
        "/unread",
      ]) {
        expect((await request(path + suffix, "Charlie")).status, suffix).toBe(403);
        expect((await request(path + suffix, "Alice")).status, suffix).toBe(200);
      }
      const listing = await (await request("/api/v1/channels", "Charlie")).json();
      expect(JSON.stringify(listing)).not.toContain("#vault");
      const search = await (await request("/api/v1/search?q=restricted", "Charlie")).json();
      expect(JSON.stringify(search)).not.toContain("#vault");
      expect((await request("/api/v1/search?q=restricted&in=%23vault", "Charlie")).status).toBe(
        403,
      );
      const unread = await (await request("/api/v1/users/Charlie/unread", "Charlie")).json();
      expect(JSON.stringify(unread)).not.toContain("#vault");
    },
  );

  it("derives message ownership from the session and enforces writes and deletes", async () => {
    const alice = await connect("Alice", "AliceDevice");
    const bob = await connect("Bob");
    const path = await channel(alice, "#public", "");
    bob.send("JOIN #public");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#public"));
    const sent = await request(`${path}/messages`, "Alice", "POST", {
      content: "first body",
      senderNick: "Bob",
      tags: {
        account: "Bob",
        msgid: "forged",
        "+reply": "reference",
        "+role": "admin",
        "+badge": "staff",
      },
    });
    expect(sent.status).toBe(201);
    const message = ((await sent.json()) as any).message;
    expect(message.senderAccount).toBe("Alice");
    expect(message.senderNick).toBe("AliceDevice");
    expect(message.tags.account).toBeUndefined();
    expect(message.tags["+role"]).toBe("member");
    expect(message.tags["+badge"]).toBe("member");
    expect(
      (await request(`${path}/messages`, "Alice", "POST", { content: "invalid\x00payload" }))
        .status,
    ).toBe(400);
    await bob.waitForLine(
      (l) => l.startsWith(":AliceDevice!") && l.includes("PRIVMSG #public :first body"),
    );
    expect(
      (
        await request(`${path}/messages/${message.id}`, "Bob", "PATCH", {
          content: "stolen",
          senderNick: "AliceDevice",
        })
      ).status,
    ).toBe(403);
    expect((await request(`${path}/messages/${message.id}`, "Bob", "DELETE")).status).toBe(403);
    const edited = await request(`${path}/messages/${message.id}`, "Alice", "PATCH", {
      content: "replacement",
    });
    expect(edited.status).toBe(200);
    const history = (await (await request(`${path}/messages`, "Alice")).json()) as any;
    expect(history.messages.find((m: any) => m.id === message.id).content).toBe("replacement");
    expect((await request(`${path}/messages/${message.id}`, "Alice", "DELETE")).status).toBe(200);
    const deleted = await (await request(`${path}/messages`, "Alice")).json();
    expect(JSON.stringify(deleted)).not.toContain("replacement");
    expect(
      (
        await request(`${path}/messages/${message.id}`, "Alice", "PATCH", {
          content: "resurrection",
        })
      ).status,
    ).toBe(403);
  });

  it("confines DMs to actual account participants across nickname changes", async () => {
    const alice = await connect("Alice", "AliceDevice");
    const bob = await connect("Bob", "BobDevice");
    alice.send("PRIVMSG BobDevice :dm-confidential-needle");
    await bob.waitForLine((l) => l.includes("dm-confidential-needle"));
    const getDm = (target: string, user: string, query = "") =>
      request(`/api/v1/dms/${target}/messages${query}`, user);
    const aliceData = await (await getDm("Bob", "Alice")).json();
    const bobData = await (await getDm("Alice", "Bob")).json();
    expect(JSON.stringify(aliceData)).toContain("dm-confidential-needle");
    expect(JSON.stringify(bobData)).toContain("dm-confidential-needle");
    expect((await getDm("Bob", "Charlie", "?user=Alice")).status).toBe(403);
    // Administrators are not DM participants either.
    expect((await getDm("Bob", "AuditAdmin", "?user=Alice")).status).toBe(403);
    expect(JSON.stringify(await (await getDm("Bob", "Charlie")).json())).not.toContain(
      "dm-confidential-needle",
    );
  });

  it("enforces ownership of profiles, notifications and subscriptions", async () => {
    const before = await (await request("/api/v1/profiles/Bob", "Bob")).json();
    for (const [path, method, body] of [
      ["/api/v1/profiles/Bob", "PATCH", { bio: "hijacked" }],
      [
        "/api/v1/notifications/subscribe",
        "POST",
        { username: "Bob", endpoint: "https://push.example.test/attacker" },
      ],
      [
        "/api/v1/notifications/subscribe?username=Bob&endpoint=https://push.example.test/attacker",
        "DELETE",
        undefined,
      ],
      ["/api/v1/users/Bob/notifications/%23vault", "PUT", { level: "nothing" }],
      ["/api/v1/users/Bob/notifications", "GET", undefined],
      ["/api/v1/users/Bob/unread", "GET", undefined],
    ] as const)
      expect((await request(path, "Alice", method, body)).status, path).toBe(403);
    expect(await (await request("/api/v1/profiles/Bob", "Bob")).json()).toEqual(before);
    expect(
      (await request("/api/v1/profiles/Alice", "Alice", "PATCH", { bio: "my profile" })).status,
    ).toBe(200);
  });

  it("rejects hardcoded OPER credentials and unauthenticated EXTERNAL", async () => {
    const alice = await connect("Alice");
    alice.send("OPER admin admin");
    await alice.waitForNumeric(464);
    alice.send("OPER operuser operpassword\r\nOPER foo operpass\r\nAUTHENTICATE EXTERNAL");
    await alice.waitForNumeric(904);
    alice.send("PING :checked");
    await alice.waitForLine((l) => l.includes(" PONG ") && l.includes("checked"));
    expect(alice.lines.some((l) => l.includes(" 381 ") || l.includes(" 903 "))).toBe(false);
  });

  it("revokes API sessions on logout, password reset and account disable", async () => {
    const bob = await connect("Bob");
    const charlie = await connect("Charlie");
    const bobClosed = new Promise<void>((resolve) => bob.ws.once("close", () => resolve()));
    const charlieClosed = new Promise<void>((resolve) => charlie.ws.once("close", () => resolve()));
    expect((await request("/api/v1/auth/logout", "Alice", "POST")).status).toBe(200);
    expect((await request("/api/v1/profiles/Alice", "Alice")).status).toBe(401);
    expect(
      (
        await request("/admin/accounts/Bob/password", "AuditAdmin", "POST", {
          password: "new-password!",
        })
      ).status,
    ).toBe(200);
    expect((await request("/api/v1/profiles/Bob", "Bob")).status).toBe(401);
    await bobClosed;
    expect((await request("/admin/accounts/Charlie/disable", "AuditAdmin", "POST")).status).toBe(
      200,
    );
    expect((await request("/api/v1/profiles/Charlie", "Charlie")).status).toBe(401);
    await charlieClosed;
  });

  it("restores existing ChanServ founder access, without granting access to unrelated accounts", async () => {
    const alice = await connect("Alice", "AliceOne");
    const path = await channel(alice, "#restored", "");
    const info = (await (await request(`${path}/info`, "Alice")).json()) as any;
    expect(info.channel.registered).toBe(true);
    expect(info.channel.founder).toBe("Alice");
    const bob = await connect("Bob");
    bob.send("JOIN #restored");
    await bob.waitForLine((l) => l.includes(" 366 "));
    expect((await request(`${path}/info`, "Bob", "PATCH", { topic: "takeover" })).status).toBe(403);
    alice.send("PART #restored");
    await alice.waitForLine((l) => l.includes(" PART #restored"));
    alice.send("JOIN #restored");
    await alice.waitForLine((l) => l.includes(" 353 ") && l.includes("AliceOne"));
    expect(
      (await request(`${path}/info`, "Alice", "PATCH", { topic: "restored owner" })).status,
    ).toBe(200);
  });

  it("authenticates event sockets with one-use tickets and filters restricted events", async () => {
    const alice = await connect("Alice");
    const path = await channel(alice);
    const streams: Record<string, any[]> = { Alice: [], Charlie: [] };
    for (const user of ["Alice", "Charlie"]) {
      const res = await request("/api/v1/auth/events-ticket", user, "POST");
      expect(res.status).toBe(200);
      const { ticket } = (await res.json()) as any;
      const ws = new WebSocket(`ws://${server.url.host}/api/v1/events?ticket=${ticket}`, [
        "flarc.events.v2",
      ]);
      sockets.push(ws);
      ws.on("message", (data) => {
        if (!isReaderControl(ws, data)) streams[user].push(JSON.parse(data.toString()));
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      const replay = await server.mf.dispatchFetch(
        `${server.url.origin}/api/v1/events?ticket=${ticket}`,
        { headers: { Upgrade: "websocket" } },
      );
      expect(replay.status).toBe(401);
    }
    const sent = await request(`${path}/messages`, "Alice", "POST", { content: "event-original" });
    const { message } = (await sent.json()) as any;
    expect(
      (
        await request(`${path}/messages/${message.id}`, "Alice", "PATCH", {
          content: "event-secret",
        })
      ).status,
    ).toBe(200);
    await vi.waitFor(() => expect(JSON.stringify(streams.Alice)).toContain("event-secret"));
    expect(JSON.stringify(streams.Charlie)).not.toContain("event-secret");
    const charlie = await connect("Charlie");
    alice.send("INVITE Charlie #vault");
    await charlie.waitForLine((l) => l.includes("INVITE Charlie #vault"));
    charlie.send("JOIN #vault");
    await charlie.waitForLine((l) => l.includes(" 366 ") && l.includes("#vault"));
    expect(
      (await request(`${path}/messages`, "Alice", "POST", { content: "event-authorized-join" }))
        .status,
    ).toBe(201);
    await vi.waitFor(() =>
      expect(JSON.stringify(streams.Charlie)).toContain("event-authorized-join"),
    );
    alice.send("KICK #vault Charlie :removed");
    await charlie.waitForLine((l) => l.includes("KICK #vault Charlie"));
    const eventClosed = new Promise<void>((resolve) => sockets[0].once("close", () => resolve()));
    expect((await request("/api/v1/auth/logout", "Alice", "POST")).status).toBe(200);
    alice.send("PRIVMSG #vault :event-after-revocation");
    await eventClosed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(JSON.stringify(streams.Alice)).not.toContain("event-after-revocation");
    expect(JSON.stringify(streams.Charlie)).not.toContain("event-after-revocation");
  });
  it("protects media ownership and channel/DM scopes, including active HTML", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    await channel(alice);
    const malformedName = new FormData();
    malformedName.append(
      "file",
      new File(["safe-upload-roundtrip"], "payload.svg?query=1", { type: "text/plain" }),
    );
    const malformedUpload = await fetch(`${server.url.origin}/api/v1/media/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.Alice}` },
      body: malformedName,
    });
    expect(malformedUpload.status).toBe(201);
    const normalizedMedia = (await malformedUpload.json()) as any;
    expect(normalizedMedia.id).toMatch(/^[a-f0-9-]+$/);
    expect(await (await request(normalizedMedia.url, "Alice")).text()).toBe(
      "safe-upload-roundtrip",
    );
    const upload = async (scope = "", type = "text/plain") => {
      const response = await fetch(`${server.url.origin}/api/v1/media/upload${scope}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.Alice}`,
          "Content-Type": type,
          "X-Filename": "private.html",
        },
        body: "<script>private-media-needle</script>",
      });
      expect(response.status).toBe(201);
      return (await response.json()) as any;
    };
    const privateFile = await upload("", "text/html");
    const authorized = await request(privateFile.url, "Alice");
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("content-disposition")).toContain("attachment");
    expect(authorized.headers.get("content-security-policy")).toContain("sandbox");
    expect(authorized.headers.get("cache-control")).toContain("no-store");
    for (const user of ["Bob", "Charlie", "AuditAdmin"])
      expect((await request(privateFile.url, user)).status).toBe(404);
    const dmFile = await upload("?dm=Bob");
    expect((await request(dmFile.url, "Bob")).status).toBe(200);
    expect((await request(dmFile.url, "Charlie")).status).toBe(404);
    const channelFile = await upload("?channel=%23vault");
    expect((await request(channelFile.url, "Bob")).status).toBe(404);
    alice.send("INVITE Bob #vault");
    await bob.waitForLine((l) => l.includes(" INVITE "));
    bob.send("JOIN #vault");
    await bob.waitForLine((l) => l.includes(" 366 "));
    expect((await request(channelFile.url, "Bob")).status).toBe(200);
    alice.send("KICK #vault Bob :removed");
    await bob.waitForLine((l) => l.includes(" KICK #vault Bob"));
    expect((await request(channelFile.url, "Bob")).status).toBe(404);
    expect((await request(`/api/v1/media/${dmFile.id}`, "Bob", "DELETE")).status).toBe(404);
    expect((await request(`/api/v1/media/${privateFile.id}`, "Alice", "DELETE")).status).toBe(200);
    expect((await request(privateFile.url, "Alice")).status).toBe(404);
  });

  it("does not let services delete another account or another author's messages", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    const base = await channel(alice, "#service", "");
    bob.send("JOIN #service");
    await bob.waitForNumeric(366);
    const sent = await request(`${base}/messages`, "Alice", "POST", {
      content: "service-protected-content",
    });
    const { message } = (await sent.json()) as any;
    bob.send(`HS SET Alice malicious.example
NS UNREGISTER Alice
NS CLIENTS Alice
HISTSERV DELETE #service ${message.id}`);
    await bob.waitForLine((l) => l.includes("Could not delete message"));
    expect((await request("/api/v1/profiles/Alice", "Alice")).status).toBe(200);
    expect(JSON.stringify(await (await request(`${base}/messages`, "Alice")).json())).toContain(
      "service-protected-content",
    );
    expect(
      bob.lines.filter((l) => l.includes("Insufficient privileges")).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("prevents channel operators from promoting themselves to founder or managing founder-only roles", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    const base = await channel(alice, "#ranks", "");
    bob.send("JOIN #ranks");
    await bob.waitForNumeric(366);
    alice.send("MODE #ranks +o Bob");
    await bob.waitForLine((l) => l.includes(" MODE #ranks +o Bob"));
    bob.send("MODE #ranks +q Bob");
    await bob.waitForNumeric(482);
    bob.send("CS AMODE #ranks +q Bob");
    await bob.waitForLine((l) => l.includes("Only the founder"));
    expect(
      (await request(`${base}/roles`, "Bob", "POST", { name: "Takeover", ircMode: "q" })).status,
    ).toBe(403);
    expect(
      (await request(`${base}/info`, "Bob", "PATCH", { description: "operator-managed" })).status,
    ).toBe(200);
  });

  it("enforces service rank limits and revokes live access when the ChanServ ACL is cleared", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    const base = await channel(alice, "#service-ranks", "+s");
    bob.send("JOIN #service-ranks");
    await bob.waitForLine((line) => line.includes(" 366 ") && line.includes("#service-ranks"));
    alice.send("CS AMODE #service-ranks +h Bob");
    await bob.waitForLine((line) => line.includes("MODE #service-ranks +h Bob"));
    for (const command of [
      "CS OP #service-ranks Bob",
      "CS AMODE #service-ranks +o Bob",
      "F CHANLEV #service-ranks Bob +o",
      "CS AMODE #service-ranks +v Alice",
    ]) {
      const denied = bob.waitForNewLine(
        (line) =>
          line.includes("NOTICE Bob") &&
          /higher channel privileges|Insufficient privileges/.test(line),
      );
      bob.send(command);
      await denied;
    }
    alice.send("CS AMODE #service-ranks +o Bob");
    await bob.waitForLine((line) => line.includes("MODE #service-ranks +o Bob"));
    const deniedDeop = bob.waitForNewLine((line) => line.includes("higher channel privileges"));
    bob.send("CS DEOP #service-ranks Alice");
    await deniedDeop;
    expect(
      (await request(`${base}/roles`, "Alice", "POST", { name: "Still founder" })).status,
    ).toBe(201);
    alice.send("CS CLEAR #service-ranks access");
    await alice.waitForLine((line) => line.includes("Successfully cleared access list"));
    bob.send("TOPIC #service-ranks :stale persistent role");
    await bob.waitForNumeric(482);
    expect(
      (await request(`${base}/info`, "Bob", "PATCH", { topic: "stale persistent role" })).status,
    ).toBe(403);
  });

  it("denies banned and kicked members across IRC and REST history/search", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    const base = await channel(alice, "#bans", "+s");
    bob.send("JOIN #bans");
    await bob.waitForNumeric(366);
    const charlie = await connect("Charlie");
    charlie.send("JOIN #bans");
    await charlie.waitForLine((line) => line.includes(" 366 ") && line.includes("#bans"));
    alice.send("MODE #bans +b $a:Bob");
    await bob.waitForLine((l) => l.includes(" MODE #bans +b $a:Bob"));
    for (const suffix of ["/messages", "/info", "/messages/search?q=secret", "/unread"])
      expect((await request(base + suffix, "Bob")).status).toBe(403);
    alice.send("PRIVMSG #bans :private-after-ban");
    await charlie.waitForLine((line) => line.includes("private-after-ban"));
    bob.send("PING :banned-delivery-barrier");
    await bob.waitForLine(
      (line) => line.includes(" PONG ") && line.includes("banned-delivery-barrier"),
    );
    expect(bob.lines.some((line) => line.includes("private-after-ban"))).toBe(false);
    bob.send("CHATHISTORY LATEST #bans * 10");
    await bob.waitForLine((l) => l.includes("FAIL CHATHISTORY"));
    bob.send("SEARCH #bans secret");
    await bob.waitForNumeric(442);
    alice.send("MODE #bans -b $a:Bob");
    await bob.waitForLine((l) => l.includes(" MODE #bans -b $a:Bob"));
    expect((await request(`${base}/messages`, "Bob")).status).toBe(200);
    alice.send("PRIVMSG #bans :delivery-after-unban");
    await bob.waitForLine((line) => line.includes("delivery-after-unban"));
    alice.send("KICK #bans Bob :removed");
    await bob.waitForLine((l) => l.includes(" KICK #bans Bob"));
    expect((await request(`${base}/messages`, "Bob")).status).toBe(403);
  });

  it("keeps concurrent idempotent message retries from creating duplicate records", async () => {
    const alice = await connect("Alice");
    const base = await channel(alice, "#retry", "");
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(
          `${base}/messages`,
          "Alice",
          "POST",
          { content: "one committed message" },
          { "idempotency-key": "retry-request-1" },
        ),
      ),
    );
    const ids = [];
    for (const response of responses) {
      expect(response.status).toBe(201);
      ids.push(((await response.json()) as any).message.id);
    }
    expect(new Set(ids).size).toBe(1);
    const history = (await (await request(`${base}/messages`, "Alice")).json()) as any;
    expect(history.messages.filter((m: any) => m.content === "one committed message")).toHaveLength(
      1,
    );
    expect(
      (
        await request(
          `${base}/messages`,
          "Alice",
          "POST",
          { content: "conflicting retry" },
          { "idempotency-key": "retry-request-1" },
        )
      ).status,
    ).toBe(400);
  });

  it("enforces canonical identity uniqueness during simultaneous registration", async () => {
    const responses = await Promise.all(
      ["Same[Name", "same{name"].map((username) =>
        request("/api/v1/auth/register", undefined, "POST", { username, password: PASSWORD }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
  });

  it("rejects oversized API bodies and unapproved browser origins", async () => {
    expect(
      (await request("/api/v1/profiles/Alice", "Alice", "PATCH", { bio: "x".repeat(70 * 1024) }))
        .status,
    ).toBe(413);
    const upgrade = await server.mf.dispatchFetch(`${server.url.origin}/irc`, {
      headers: { Upgrade: "websocket", Origin: "https://attacker.example" },
    });
    expect(upgrade.status).toBe(403);
    const reusedToken = await server.mf.dispatchFetch(
      `${server.url.origin}/api/v1/events?token=${tokens.Alice}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(reusedToken.status).toBe(401);
  });

  it("bounds IRC frames and charges every command in a batched frame", async () => {
    const oversized = await connect("Alice");
    const largeClose = new Promise<string>((resolve) =>
      oversized.ws.once("close", (_code, reason) => resolve(reason.toString())),
    );
    oversized.ws.send("x".repeat(65537));
    expect(await largeClose).toContain("Input frame too large");
    const flood = await connect("Bob");
    const floodClose = new Promise<string>((resolve) =>
      flood.ws.once("close", (_code, reason) => resolve(reason.toString())),
    );
    flood.send(Array.from({ length: 151 }, (_, i) => `PING :flood-${i}`).join("\r\n"));
    expect(await floodClose).toContain("Excess Flood");
  });

  it("does not deliver direct messages to a pre-authentication socket", async () => {
    const alice = await connect("Alice");
    const pending = new TestIRCClient(server.wsUrl);
    clients.push(pending);
    await pending.connect();
    pending.send("NICK PendingVisitor\r\nPING :pending-ready");
    await pending.waitForLine((l) => l.includes("pending-ready"));
    alice.send("PRIVMSG PendingVisitor :must-not-reach-anonymous-socket");
    await alice.waitForNumeric(401);
    pending.send("PING :pending-end");
    await pending.waitForLine((l) => l.includes("pending-end"));
    expect(pending.lines.some((l) => l.includes("must-not-reach"))).toBe(false);
  });

  it("binds channel invitations to the recipient account rather than a reusable nickname", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob", "BobDevice");
    const charlie = await connect("Charlie", "CharlieDevice");
    await channel(alice, "#invitations", "+si");
    alice.send("INVITE BobDevice #invitations");
    await bob.waitForLine((l) => l.includes(" INVITE BobDevice "));
    bob.send("NICK BobElsewhere");
    await bob.waitForLine((l) => / NICK :?BobElsewhere/.test(l));
    charlie.send("NICK BobDevice");
    await charlie.waitForLine((l) => / NICK :?BobDevice/.test(l));
    charlie.send("JOIN #invitations");
    await charlie.waitForNumeric(473);
    bob.send("JOIN #invitations");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#invitations"));
    expect((await request("/api/v1/channels/%23invitations/messages", "Charlie")).status).toBe(403);
    expect((await request("/api/v1/channels/%23invitations/messages", "Bob")).status).toBe(200);
  });

  it("keeps archived private history and attachments private and revokes old webhook capabilities", async () => {
    const alice = await connect("Alice");
    const base = await channel(alice, "#archive", "+s");
    const sent = await request(`${base}/messages`, "Alice", "POST", {
      content: "archived-private-needle",
    });
    expect(sent.status).toBe(201);
    const hookResponse = await request(`${base}/webhooks`, "Alice", "POST", { name: "old-hook" });
    expect(hookResponse.status).toBe(201);
    const hook = ((await hookResponse.json()) as any).webhook;
    const upload = await fetch(`${server.url.origin}/api/v1/media/upload?channel=%23archive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.Alice}`, "Content-Type": "text/plain" },
      body: "archived private file",
    });
    expect(upload.status).toBe(201);
    const file = (await upload.json()) as any;
    const malformed = await request("/admin/channels/%23archive", "AuditAdmin", "DELETE", {
      purgeMessages: "false",
    });
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(await (await request(`${base}/messages`, "Alice")).json())).toContain(
      "archived-private-needle",
    );
    const destroyed = await request("/admin/channels/%23archive", "AuditAdmin", "DELETE", {
      purgeMessages: false,
    });
    expect(destroyed.status).toBe(200);
    expect((await request(`${base}/messages`, "Charlie")).status).toBe(403);
    expect((await request(file.url, "Charlie")).status).toBe(404);
    const archived = await (
      await request("/admin/channels/%23archive/messages", "AuditAdmin")
    ).json();
    expect(JSON.stringify(archived)).toContain("archived-private-needle");
    expect(
      (
        await request(`/api/v1/webhooks/${hook.token}?channel=%23archive`, undefined, "POST", {
          content: "stale capability",
        })
      ).status,
    ).toBe(400);
    const charlie = await connect("Charlie");
    charlie.send("JOIN #archive");
    await charlie.waitForNumeric(403);
    expect((await request(`${base}/messages`, "Charlie")).status).toBe(403);
  });

  it("prevents account reauthentication from carrying old private memberships or founder rights", async () => {
    const alice = await connect("Alice", "SharedDevice");
    const base = await channel(alice, "#identity", "+s");
    alice.send(`NS IDENTIFY Bob ${PASSWORD}`);
    await alice.waitForLine((l) => l.includes(" 900 ") && l.includes(" Bob "));
    expect((await request(`${base}/info`, "Bob")).status).toBe(403);
    expect((await request(`${base}/roles`, "Bob", "POST", { name: "forged owner" })).status).toBe(
      403,
    );
    alice.send("CHATHISTORY LATEST #identity * 10");
    await alice.waitForLine((l) => l.includes("FAIL CHATHISTORY"));
  });

  it("allows only the author to redact a DM and scrubs its stored payload", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    alice.send("CAP REQ :message-tags echo-message draft/message-redaction");
    await alice.waitForLine((l) => l.includes(" CAP Alice ACK "));
    bob.send("CAP REQ :message-tags draft/message-redaction");
    await bob.waitForLine((l) => l.includes(" CAP Bob ACK "));
    alice.send("PRIVMSG Bob :redact-private-needle");
    const echo = await alice.waitForLine((l) => l.includes(" PRIVMSG Bob :redact-private-needle"));
    const id = echo.match(/msgid=([^; ]+)/)![1];
    await bob.waitForLine((l) => l.includes("redact-private-needle"));
    bob.send(`REDACT Alice ${id}`);
    await bob.waitForLine((l) => l.includes("REDACT_FORBIDDEN"));
    alice.send(`REDACT Bob ${id}`);
    await bob.waitForLine((l) => l.includes(` REDACT Bob ${id}`));
    expect(
      JSON.stringify(await (await request("/api/v1/dms/Bob/messages", "Alice")).json()),
    ).not.toContain("redact-private-needle");
  });
  it("revokes derived role privileges on every device without persisting them through MODE or reattachment", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    const base = await channel(alice, "#roledevices", "");
    bob.send("JOIN #roledevices");
    await bob.waitForNumeric(366);
    const created = await request(`${base}/roles`, "Alice", "POST", {
      name: "Moderator",
      ircMode: "o",
      permissions: [],
    });
    const groupId = ((await created.json()) as any).role.id;
    const bobProfile = (await (await request("/admin/accounts/Bob", "AuditAdmin")).json()) as any;
    const assignment = { userId: bobProfile.account.id, roleGroupId: groupId };
    expect((await request(`${base}/roles/assign`, "Alice", "POST", assignment)).status).toBe(200);
    const second = await connect("Bob", "BobSecond");
    second.send("JOIN #roledevices");
    await second.waitForNumeric(366);
    bob.send("MODE #roledevices +v Bob");
    const voiced = await bob.waitForLine((line) => / MODE #roledevices \+v+ /.test(line));
    // Account-wide modes update both devices in one canonical multi-target MODE.
    expect(voiced).toContain(" MODE #roledevices +vv Bob BobSecond");
    await second.waitForLine((line) => line === voiced);
    expect(
      (await request(`${base}/roles/assign`, "Alice", "POST", { ...assignment, remove: true }))
        .status,
    ).toBe(200);
    for (const device of [bob, second]) {
      device.send("MODE #roledevices +i");
      await device.waitForNumeric(482);
    }
    expect(
      (await request(`${base}/info`, "Bob", "PATCH", { description: "stale role" })).status,
    ).toBe(403);
  });
  it("persists roleplay DMs and rejects cross-author DM edits", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    alice.send("CAP REQ :message-tags echo-message");
    await alice.waitForLine((l) => l.includes(" CAP Alice ACK "));
    bob.send("CAP REQ :message-tags draft/message-redaction");
    await bob.waitForLine((l) => l.includes(" CAP Bob ACK "));
    bob.send("MODE Bob +E");
    await bob.waitForLine((l) => l.includes("MODE Bob +E"));
    alice.send("NPC Bob Guard :persistent-roleplay-needle");
    await bob.waitForLine((l) => l.includes("persistent-roleplay-needle"));
    const before = (await (await request("/api/v1/dms/Bob/messages", "Alice")).json()) as any;
    expect(
      before.messages.some((message: any) =>
        message.content.includes("persistent-roleplay-needle"),
      ),
    ).toBe(true);
    alice.send("PRIVMSG Bob :dm-edit-original");
    const line = await alice.waitForLine((l) => l.includes(" PRIVMSG Bob :dm-edit-original"));
    const id = line.match(/msgid=([^; ]+)/)![1];
    const liveTime = line.match(/(?:^|;)time=([^; ]+)/)![1];
    await bob.waitForLine((l) => l.includes("dm-edit-original"));
    bob.send(`@+ircord/edit=${id} PRIVMSG Alice :forged DM edit`);
    await bob.waitForNumeric(404);
    const stored = (await (await request("/api/v1/dms/Alice/messages", "Bob")).json()) as any;
    expect(
      new Date(stored.messages.find((message: any) => message.id === id).createdAt).toISOString(),
    ).toBe(liveTime);
    expect(stored.messages.find((message: any) => message.id === id).content).toBe(
      "dm-edit-original",
    );
    alice.send(`@+ircord/edit=${id} PRIVMSG Bob :dm-edited-content`);
    const editLine = await bob.waitForLine((l) => l.includes("dm-edited-content"));
    const editId = editLine.match(/msgid=([^; ]+)/)![1];
    expect(
      JSON.stringify(await (await request("/api/v1/dms/Bob/messages", "Alice")).json()),
    ).toContain("dm-edited-content");
    alice.send(`@+ircord/edit=${editId} PRIVMSG Bob :nested-dm-edited-content`);
    await bob.waitForLine((l) => l.includes("nested-dm-edited-content"));
    alice.send(`REDACT Bob ${id} :remove logical message`);
    await bob.waitForLine((l) => l.includes(" REDACT Bob "));
    const redacted = JSON.stringify(
      await (await request("/api/v1/dms/Bob/messages", "Alice")).json(),
    );
    expect(redacted).not.toContain("dm-edit-original");
    expect(redacted).not.toContain("dm-edited-content");
    expect(redacted).toContain("persistent-roleplay-needle");
  });

  it("preserves a participant's DM history after the other account is deleted, without allowing username reuse", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    alice.send("PRIVMSG Bob :retained-deleted-peer-history");
    await bob.waitForLine((l) => l.includes("retained-deleted-peer-history"));
    expect((await request("/admin/accounts/Alice/disable", "AuditAdmin", "POST")).status).toBe(200);
    expect(
      JSON.stringify(await (await request("/api/v1/dms/Alice/messages", "Bob")).json()),
    ).toContain("retained-deleted-peer-history");
    expect((await request("/admin/accounts/Alice", "AuditAdmin", "DELETE")).status).toBe(200);
    expect((await request("/api/v1/profiles/Alice", "Alice")).status).toBe(401);
    expect(
      JSON.stringify(await (await request("/api/v1/dms/Alice/messages", "Bob")).json()),
    ).toContain("retained-deleted-peer-history");
    expect(
      (
        await request("/api/v1/auth/register", undefined, "POST", {
          username: "Alice",
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
  });

  it("denies unrelated rename requests and refuses to overwrite an existing destination", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    const source = await channel(alice, "#source-private", "+si");
    const destination = await channel(bob, "#destination-private", "+si");
    expect(
      (await request(`${source}/messages`, "Alice", "POST", { content: "source-secret" })).status,
    ).toBe(201);
    expect(
      (await request(`${destination}/messages`, "Bob", "POST", { content: "destination-secret" }))
        .status,
    ).toBe(201);
    bob.send("RENAME #source-private #stolen");
    await bob.waitForNumeric(482);
    expect((await request(`${source}/info`, "Bob")).status).toBe(403);
    alice.send("RENAME #source-private #destination-private");
    await alice.waitForLine((l) => l.includes("FAIL RENAME CANNOT_RENAME"));
    expect(JSON.stringify(await (await request(`${source}/messages`, "Alice")).json())).toContain(
      "source-secret",
    );
    expect(
      JSON.stringify(await (await request(`${destination}/messages`, "Bob")).json()),
    ).toContain("destination-secret");
    expect((await request(`${destination}/messages`, "Alice")).status).toBe(403);
    expect(
      (await request(`${source}/messages`, "Alice", "POST", { content: "source-still-writable" }))
        .status,
    ).toBe(201);
  });

  it("moves private history, roles, edit lineage and media during rename without exposing the old name", async () => {
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    const charlie = await connect("Charlie");
    alice.send("CAP REQ :draft/channel-rename");
    await alice.waitForLine((l) => l.includes("CAP Alice ACK"));
    const base = await channel(alice, "#move-private", "+s");
    bob.send("JOIN #move-private");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#move-private"));
    const sent = await request(`${base}/messages`, "Alice", "POST", {
      content: "moved-private-history",
    });
    const messageId = ((await sent.json()) as any).message.id;
    const roleResponse = await request(`${base}/roles`, "Alice", "POST", {
      name: "Moved voice",
      ircMode: "v",
    });
    const roleId = ((await roleResponse.json()) as any).role.id;
    const bobId = ((await (await request("/admin/accounts/Bob", "AuditAdmin")).json()) as any)
      .account.id;
    expect(
      (
        await request(`${base}/roles/assign`, "Alice", "POST", {
          userId: bobId,
          roleGroupId: roleId,
        })
      ).status,
    ).toBe(200);
    const upload = await fetch(`${server.url.origin}/api/v1/media/upload?channel=%23move-private`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.Alice}`, "Content-Type": "text/plain" },
      body: "moved-private-media",
    });
    const media = (await upload.json()) as any;
    expect(upload.status).toBe(201);
    alice.send("RENAME #move-private #moved-private");
    await alice.waitForLine((l) => l.includes(" RENAME #move-private #moved-private"));
    const moved = "/api/v1/channels/%23moved-private";
    expect(JSON.stringify(await (await request(`${moved}/messages`, "Bob")).json())).toContain(
      "moved-private-history",
    );
    expect((await request(`${moved}/messages`, "Charlie")).status).toBe(403);
    expect(JSON.stringify(await (await request(`${moved}/roles`, "Alice")).json())).toContain(
      "Moved voice",
    );
    expect(await (await request(media.url, "Bob")).text()).toBe("moved-private-media");
    charlie.send("JOIN #move-private");
    await charlie.waitForLine((l) => l.includes(" 366 ") && l.includes("#move-private"));
    expect(
      JSON.stringify(await (await request(`${base}/messages`, "Charlie")).json()),
    ).not.toContain("moved-private-history");
    expect((await request(media.url, "Charlie")).status).toBe(404);
    expect((await request(`${moved}/messages/${messageId}`, "Alice", "DELETE")).status).toBe(200);
    expect(JSON.stringify(await (await request(`${moved}/messages`, "Bob")).json())).not.toContain(
      "moved-private-history",
    );
    alice.send("MODE #moved-private +m");
    await alice.waitForLine((l) => l.includes("MODE #moved-private +m"));
    bob.send("PRIVMSG #moved-private :restored-role-can-speak");
    await alice.waitForLine((l) => l.includes("restored-role-can-speak"));
  });

  it("lets administrators close or restrict signup and consumes bootstrap authority once", async () => {
    expect(
      (
        await request(
          "/api/v1/auth/register",
          undefined,
          "POST",
          { username: "SpareAdmin", password: PASSWORD },
          { "x-bootstrap-token": BOOTSTRAP },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/v1/auth/register", undefined, "POST", {
          username: "WeakPassword",
          password: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/admin/config", "AuditAdmin", "POST", { signupPolicy: "closed" })).status,
    ).toBe(200);
    expect(
      (
        await request("/api/v1/auth/register", undefined, "POST", {
          username: "ClosedSignup",
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/admin/accounts", "AuditAdmin", "POST", {
          username: "ManagedAccount",
          password: PASSWORD,
        })
      ).status,
    ).toBe(201);
    expect(
      (await request("/admin/config", "AuditAdmin", "POST", { signupPolicy: "invite" })).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/api/v1/auth/register",
          undefined,
          "POST",
          { username: "WrongInvite", password: PASSWORD },
          { "x-signup-token": "wrong" },
        )
      ).status,
    ).toBe(400);
  });

  it("rejects fake verification and enforces push validation and quotas through IRC as well as REST", async () => {
    const alice = await connect("Alice");
    alice.send("VERIFY Alice invented-code");
    await alice.waitForLine((l) => l.includes("FAIL VERIFY INVALID_CODE"));
    alice.send("WEBPUSH VAPID");
    await alice.waitForLine((l) => l.includes("FAIL WEBPUSH TEMPORARILY_UNAVAILABLE"));
    expect(
      (
        await request("/api/v1/notifications/subscribe", "Alice", "POST", {
          username: "Alice",
          endpoint: "http://127.0.0.1/private",
        })
      ).status,
    ).toBe(400);
    alice.send("WEBPUSH REGISTER http://127.0.0.1/private");
    alice.send("PING :invalid-push-barrier");
    await alice.waitForLine((l) => l.includes(" PONG ") && l.includes("invalid-push-barrier"));
    expect(
      JSON.stringify(
        await (await request("/api/v1/notifications/subscriptions?username=Alice", "Alice")).json(),
      ),
    ).not.toContain("127.0.0.1");
    for (let i = 0; i < 20; i++) {
      alice.send(`WEBPUSH REGISTER https://push.example.com/sub-${i}`);
      await alice.waitForLine((l) =>
        l.endsWith(`WEBPUSH REGISTER https://push.example.com/sub-${i}`),
      );
    }
    alice.send("WEBPUSH REGISTER https://push.example.com/over-quota");
    alice.send("PING :quota-push-barrier");
    await alice.waitForLine((l) => l.includes(" PONG ") && l.includes("quota-push-barrier"));
    const subscriptions = (await (
      await request("/api/v1/notifications/subscriptions?username=Alice", "Alice")
    ).json()) as any;
    expect(subscriptions.endpoints).toHaveLength(20);
    expect(JSON.stringify(subscriptions)).not.toContain("over-quota");
  });
});
