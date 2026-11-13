import { createHash, createHmac, pbkdf2Sync, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { observedAuthFixture, sameProtected, wire } from "../helpers/auth-gap-fixture";
import { isReaderControl } from "../helpers/event-reader";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

// Reviewed against docs/security/authorization-matrix.md, not the dispatcher guard.
const allowed = [
  "CAP",
  "AUTHENTICATE",
  "PASS",
  "NICK",
  "USER",
  "REGISTER",
  "VERIFY",
  "PING",
  "PONG",
  "QUIT",
  "WEBIRC",
];
const denied: Record<string, string> = {
  BOUNCER: "LISTNETWORKS",
  METADATA: "#protected LIST",
  ISUPPORT: "",
  AWAY: ":absent",
  JOIN: "#protected",
  PART: "#protected",
  PRIVMSG: "#protected :preauth-secret",
  NOTICE: "bob :preauth-secret",
  TAGMSG: "#protected",
  BATCH: "+test draft/multiline #protected",
  REDACT: "#protected fake-id",
  MARKREAD: "#protected timestamp=2025-01-01T00:00:00Z",
  SETNAME: ":pretender",
  CHGHOST: "bob example.test",
  SEARCH: "#protected :protected-auth-control",
  MONITOR: "+ bob",
  RENAME: "#protected #stolen :test",
  WHOAMI: "",
  RELAYMSG: "#protected bob :forged",
  WEBPUSH: "LIST",
  PERSISTENCE: "ON",
  NS: "INFO bob",
  NICKSERV: "INFO bob",
  CS: "INFO #protected",
  CHANSERV: "INFO #protected",
  HS: "ON",
  HOSTSERV: "ON",
  HISTSERV: "HELP",
  F: "INFO #protected",
  FLARESERV: "INFO #protected",
  Q: "INFO #protected",
  ZNC: "HELP",
  NAMES: "#protected",
  TOPIC: "#protected :preauth-topic",
  MODE: "#protected +o anonymous",
  SAMODE: "#protected +o anonymous",
  KICK: "#protected bob :preauth",
  INVITE: "charlie #protected",
  UNINVITE: "charlie #protected",
  WHO: "#protected",
  WHOIS: "bob",
  WHOWAS: "bob",
  USERHOST: "bob",
  ISON: "bob",
  TIME: "",
  VERSION: "",
  INFO: "",
  HELP: "",
  HELPOP: "",
  LANGUAGE: "en",
  ACCEPT: "+bob",
  OPER: "rootadmin invalid",
  DEOPER: "",
  SAJOIN: "anonymous #protected",
  SANICK: "bob stolen",
  KILL: "bob :preauth",
  NPC: "#protected fake :preauth",
  NPCA: "#protected fake :preauth",
  SCENE: "#protected :preauth",
  AMBIANCE: "#protected :preauth",
  HISTORY: "#protected",
  MOTD: "",
  LUSERS: "",
  LIST: "",
  CHATHISTORY: "LATEST #protected * 10",
  CONVERSATION: "LIST",
  WALLOPS: ":preauth",
  LINKS: "",
};

describe("pre-authentication dispatcher inventory", () => {
  it("AUTH-030: classified dispatcher roots are denied on real sockets without protected state or events", async () => {
    const source = readFileSync("server/protocol/irc/commands/dispatcher.ts", "utf8");
    const discovered = [
      ...new Set([...source.matchAll(/case "([A-Z0-9]+)":/g)].map((m) => m[1])),
    ].sort();
    expect([...allowed, ...Object.keys(denied)].sort()).toEqual(discovered);
    const policy = readFileSync("docs/security/authorization-matrix.md", "utf8");
    expect(policy).toContain(
      "CAP, AUTHENTICATE, PASS, NICK, USER, REGISTER, VERIFY, PING, PONG, QUIT",
    );
    expect(policy).toContain("WEBIRC | Pre-auth only");
    const r = await observedAuthFixture();
    try {
      await r.flush();
      const before = await r.f.snapshot();
      await r.resume();
      await r.silence(async () => {
        let guest = await r.f.guest();
        let count = 0;
        for (const [root, params] of Object.entries(denied)) {
          if (count++ && count % 11 === 1) {
            guest.close();
            guest = await r.f.guest();
          }
          const reply = await wire(guest, `${root}${params ? ` ${params}` : ""}`, / 451 /);
          expect(reply).toContain("Authenticate before using this command");
          expect(reply).not.toContain("protected-auth-control");
        }
        await wire(guest, "CAP LS 302", / CAP .* LS /);
        await wire(guest, "PING :preauth-control", / PONG .*preauth-control/);
      });
      const after = await r.f.snapshot();
      sameProtected(before, after);
      await r.resume();
      const signup = await r.f.guest();
      const signupPassword = `Signup-${randomUUID()}!`;
      await r.silence(async () => {
        await wire(signup, `REGISTER authinventory * ${signupPassword}`, / 920 /);
      });
      const signedUp = await r.f.login("authinventory", signupPassword);
      await r.resume();
      expect((await r.f.login("authinventory", signupPassword)).account.id).toBe(
        signedUp.account.id,
      );
      const renewed = await r.f.guest();
      await wire(renewed, "JOIN #protected", / 451 /);
      expect((await r.f.request("/api/v1/profiles/bob", r.bob)).status).toBe(200);
      expect((await r.f.request("/api/v1/profiles/charlie", r.charlie)).status).toBe(200);
      expect(
        (
          await r.f.request("/api/v1/channels/%23protected/messages", r.alice, "POST", {
            content: "preauth-positive-control",
          })
        ).status,
      ).toBe(201);
      await r.good.until("preauth-positive-control");
      await r.flush();
    } finally {
      await r.dispose();
    }
  });
});

describe("real WebSocket attachments", () => {
  it("WS-008: PASS SASL and ticket attachments omit reusable credentials across hibernation", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "preauth-attachments-"));
    const bundle = await ensureNitroBuilt();
    cpSync(path.dirname(bundle), path.join(dir, "production"), { recursive: true });
    writeFileSync(
      path.join(dir, "wrapper.mjs"),
      `
export { ChannelDO } from './production/index.mjs';
import { AccountsDO as OriginalAccounts } from './production/index.mjs';
export class AccountsDO extends OriginalAccounts { inspectCredentials() { return this.sql.exec('SELECT u.id, u.password_hash, u.credential_version, s.stored_key, s.server_key FROM users u JOIN scram_credentials s ON s.user_id = u.id').toArray(); } }
import original from './production/index.mjs';
export default { async fetch(request, env, ctx) { if (new URL(request.url).pathname === '/__test_inspect') { const central = env.SESSION.get(env.SESSION.idFromName('FlaRC')); const leases = await central.inspectLeases(); const edges = []; for (const shard of [...new Set(leases.map(x => x.shard))]) edges.push(...await env.SESSION.get(env.SESSION.idFromName('FlaRC:events:' + shard)).inspectAttachments()); return Response.json({ all: await central.inspectAttachments(), leases, edges }); } if (new URL(request.url).pathname === '/__test_credentials') return Response.json(await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('FlaRC')).inspectCredentials()); return original.fetch(request, env, ctx); } };
import { SessionDO as Original } from './production/index.mjs';
export class SessionDO extends Original {
  inspectAttachments() { return this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()); }
  inspectLeases() { return this.sql.exec('SELECT lease_id, account_id, session_hash, shard FROM event_connection_leases WHERE expires_at>?', Date.now()).toArray(); }
}
`,
    );
    const bootstrap = randomUUID();
    const mf = new Miniflare({
      modules: true,
      scriptPath: path.join(dir, "wrapper.mjs"),
      modulesRoot: dir,
      compatibilityDate: "2025-02-04",
      compatibilityFlags: ["nodejs_compat"],
      durableObjectsPersist: path.join(dir, "state"),
      bindings: { SIGNUP_POLICY: "open", ADMIN_USERS: "rootadmin", ADMIN_TOKEN: bootstrap },
      durableObjects: {
        SESSION: { className: "SessionDO", useSQLite: true },
        CHANNELS: { className: "ChannelDO", useSQLite: true },
        ACCOUNTS: { className: "AccountsDO", useSQLite: true },
      },
    });
    let disposed = false;
    let restarted: Miniflare | undefined;
    const clients: TestIRCClient[] = [];
    const sockets: WebSocket[] = [];
    try {
      const url = await mf.ready;
      async function request(
        route: string,
        body: unknown,
        token?: string,
        extra: Record<string, string> = {},
      ) {
        return fetch(new URL(route, url), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...extra,
          },
          body: JSON.stringify(body),
        });
      }
      async function account(name: string, root = false) {
        const password = `Password-${name}-${randomUUID()}!`;
        expect(
          (
            await request(
              "/api/v1/auth/register",
              { username: name, password },
              undefined,
              root ? { "x-bootstrap-token": bootstrap } : {},
            )
          ).status,
        ).toBe(201);
        const login = await request("/api/v1/auth/login", { username: name, password });
        expect(login.status).toBe(200);
        const data = (await login.json()) as any;
        return { name, password, token: data.token as string, id: data.account.id as string };
      }
      const root = await account("rootadmin", true);
      const alice = await account("alice"),
        bob = await account("bob"),
        charlie = await account("charlie");
      const stored = (await (await fetch(new URL("/__test_credentials", url))).json()) as any[];
      expect(stored).toHaveLength(4);
      async function guest() {
        const c = new TestIRCClient(`ws://${url.host}/irc`);
        clients.push(c);
        await c.connect();
        return c;
      }
      const pass = await guest();
      pass.send(`PASS alice:${alice.password}`);
      await pass.register("alice");
      const second = await guest();
      second.send(`PASS alice:${alice.password}`);
      await second.register("alice2");
      const nickserv = await guest();
      nickserv.send(`PASS bob:${bob.password}`);
      await nickserv.register("bob2");
      await wire(nickserv, `NS IDENTIFY alice ${alice.password}`, / 900 .* alice /);
      const sasl = await guest();
      await wire(sasl, "CAP LS 302", / CAP .* LS /);
      await wire(sasl, "CAP REQ :sasl", / CAP .* ACK /);
      await wire(sasl, "AUTHENTICATE PLAIN", /AUTHENTICATE \+/);
      const payload = Buffer.from(`bob\0bob\0${bob.password}`).toString("base64");
      await wire(sasl, `AUTHENTICATE ${payload}`, / 903 /);
      const welcome = sasl.waitForNewLine((line) => line.includes(" 001 "));
      sasl.send("NICK bob\r\nUSER bob 0 * :Bob\r\nCAP END");
      await welcome;
      const scram = await guest();
      await wire(scram, "CAP LS 302", / CAP .* LS /);
      await wire(scram, "CAP REQ :sasl", / CAP .* ACK /);
      await wire(scram, "AUTHENTICATE SCRAM-SHA-256", /AUTHENTICATE \+/);
      const first = "n=alice,r=attachnonce";
      const scramFirst = Buffer.from(`n,,${first}`).toString("base64");
      const challenge = scram.waitForNewLine(
        (line) => line.includes(" AUTHENTICATE ") && !line.endsWith(" +"),
      );
      scram.send(`AUTHENTICATE ${scramFirst}`);
      const serverFirst = Buffer.from((await challenge).split(" ").at(-1)!, "base64").toString();
      const attrs = Object.fromEntries(
        serverFirst.split(",").map((v: string) => [v[0], v.slice(2)]),
      );
      const final = `c=biws,r=${attrs.r}`,
        auth = `${first},${serverFirst},${final}`;
      const salted = pbkdf2Sync(
        alice.password,
        Buffer.from(attrs.s, "base64"),
        Number(attrs.i),
        32,
        "sha256",
      );
      const key = createHmac("sha256", salted).update("Client Key").digest();
      const storedKey = createHash("sha256").update(key).digest();
      const signature = createHmac("sha256", storedKey).update(auth).digest();
      const proof = Buffer.from(key.map((value, index) => value ^ signature[index])).toString(
        "base64",
      );
      const scramFinal = Buffer.from(`${final},p=${proof}`).toString("base64");
      const serverReply = scram.waitForNewLine((line) => line.includes(" AUTHENTICATE "));
      scram.send(`AUTHENTICATE ${scramFinal}`);
      const serverSig = createHmac(
        "sha256",
        createHmac("sha256", salted).update("Server Key").digest(),
      )
        .update(auth)
        .digest("base64");
      expect(Buffer.from((await serverReply).split(" ").at(-1)!, "base64").toString()).toBe(
        `v=${serverSig}`,
      );
      await wire(scram, "AUTHENTICATE +", / 903 /);
      const scramWelcome = scram.waitForNewLine((line) => line.includes(" 001 "));
      scram.send("NICK alice3\r\nUSER alice3 0 * :Alice\r\nCAP END");
      await scramWelcome;
      const outsider = await guest();
      outsider.send(`PASS charlie:${charlie.password}`);
      await outsider.register("charlie");
      for (const c of [pass, second, nickserv, scram, sasl])
        await wire(c, "JOIN #vault", / 366 .*#vault/);
      await wire(pass, "MODE #vault +s", / MODE #vault \+s/);
      for (const c of [pass, sasl, outsider]) await wire(c, "JOIN #barrier", / 366 .*#barrier/);
      const issued = await request("/api/v1/auth/events-ticket", {}, alice.token);
      expect(issued.status).toBe(200);
      const ticket = ((await issued.json()) as any).ticket as string;
      const event = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${ticket}`, [
        "flarc.events.v2",
      ]);
      sockets.push(event);
      const received: string[] = [];
      event.on("message", (data) => {
        if (!isReaderControl(event, data)) received.push(data.toString());
      });
      await new Promise<void>((resolve, reject) => {
        event.once("open", resolve);
        event.once("error", reject);
      });
      async function stream(actor: typeof bob) {
        const response = await request("/api/v1/auth/events-ticket", {}, actor.token);
        expect(response.status).toBe(200);
        const issued = ((await response.json()) as any).ticket as string;
        const ws = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${issued}`, [
          "flarc.events.v2",
        ]);
        sockets.push(ws);
        const lines: string[] = [];
        ws.on("message", (data) => {
          if (!isReaderControl(ws, data)) lines.push(data.toString());
        });
        await new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
        return { ws, lines, ticket: issued };
      }
      const bobEvent = await stream(bob),
        outsideEvent = await stream(charlie);
      async function until(lines: string[], marker: string) {
        for (let i = 0; i < 400; i++) {
          if (lines.some((line) => line.includes(marker))) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Missing event marker ${marker}`);
      }
      async function send(channel: string, content: string) {
        expect(
          (await request(`/api/v1/channels/%23${channel}/messages`, { content }, alice.token))
            .status,
        ).toBe(201);
      }
      const inspect = async () =>
        (await (await fetch(new URL("/__test_inspect", url))).json()) as {
          all: any[];
          leases: any[];
          edges: any[];
        };
      async function check() {
        const { all, leases, edges } = await inspect();
        const a = all.find((x) => x.accountName === "alice"),
          b = all.find((x) => x.accountName === "bob"),
          e = leases.find((x) => x.account_id === alice.id);
        expect(all.filter((x) => x.accountName === "alice")).toHaveLength(4);
        expect(
          all
            .filter((x) => x.accountName === "alice")
            .every((x) => x.userId === alice.id && x.authenticated),
        ).toBe(true);
        const permittedFields = new Set([
          "acceptList",
          "accountName",
          "authenticated",
          "awayMessage",
          "capNegotiating",
          "capabilities",
          "connectedAt",
          "credentialVersion",
          "hostname",
          "ip",
          "isBot",
          "isDirectWebSocket",
          "isOper",
          "languages",
          "lastActiveAt",
          "metadataSubs",
          "nickname",
          "peerSource",
          "realname",
          "readerWindow",
          "readerClosed",
          "registered",
          "requestedNick",
          "roles",
          "saslBuffer",
          "saslMechanism",
          "sessionId",
          "subprotocol",
          "userId",
          "userModes",
          "username",
          "vhost",
        ]);
        for (const attachment of all.filter((x) => x.sessionId)) {
          expect(Object.keys(attachment).filter((key) => !permittedFields.has(key))).toEqual([]);
          if (attachment.peerSource) {
            expect(Object.keys(attachment.peerSource).sort()).toEqual(["ip", "kind"]);
            expect(attachment.peerSource).toMatchObject({
              ip: expect.any(String),
              kind: expect.any(String),
            });
          }
          expect(attachment.saslBuffer).toBe("");
        }
        expect(a).toMatchObject({ userId: alice.id, authenticated: true });
        expect(b).toMatchObject({ userId: bob.id, authenticated: true });
        expect(Number.isSafeInteger(a.credentialVersion)).toBe(true);
        expect(Number.isSafeInteger(b.credentialVersion)).toBe(true);
        expect(e.session_hash).toMatch(/^[a-f0-9]{64}$/);
        const serialized = JSON.stringify({ all, leases, edges });
        for (const secret of [
          bootstrap,
          root.password,
          root.token,
          alice.password,
          bob.password,
          alice.token,
          bob.token,
          payload,
          scramFirst,
          scramFinal,
          charlie.password,
          charlie.token,
          ...stored.flatMap((row) => [row.password_hash, row.stored_key, row.server_key]),
        ])
          expect(serialized).not.toContain(secret);
        for (const ticketValue of [ticket, bobEvent.ticket, outsideEvent.ticket])
          expect(serialized).not.toContain(ticketValue);
        for (const attachment of all.filter((x) => x.sessionId)) {
          const row = stored.find((x) => x.id === attachment.userId);
          expect(row).toBeDefined();
          const expected =
            attachment.nickname === "bob"
              ? bob
              : attachment.nickname === "charlie"
                ? charlie
                : alice;
          expect(attachment.userId).toBe(expected.id);
          expect(attachment.accountName).toBe(expected.name);
          expect(attachment.credentialVersion).toBe(row.credential_version);
        }
        for (const [actor, actorTicket] of [
          [alice, ticket],
          [bob, bobEvent.ticket],
          [charlie, outsideEvent.ticket],
        ] as const) {
          const entry = leases.find((x) => x.account_id === actor.id);
          expect(entry.session_hash).toBe(createHash("sha256").update(actor.token).digest("hex"));
          const edge = edges.find((x) => x.edgeLease === entry.lease_id);
          expect(edge).toMatchObject({ shard: entry.shard, eventProtocol: 2 });
          expect(
            Object.keys(edge).every((key) =>
              [
                "edgeLease",
                "eventProtocol",
                "shard",
                "leaseExpiresAt",
                "readerWindow",
                "ackCursor",
                "readerClosed",
              ].includes(key),
            ),
          ).toBe(true);
          expect(JSON.stringify(entry)).not.toContain(actorTicket);
        }
        return {
          a,
          b,
          e,
          shards: leases.map((lease) => lease.shard),
          devices: all
            .filter((x) => x.sessionId)
            .map((x) => ({
              sessionId: x.sessionId,
              userId: x.userId,
              nickname: x.nickname,
              credentialVersion: x.credentialVersion,
            }))
            .sort((x, y) => x.nickname.localeCompare(y.nickname)),
        };
      }
      const before = await check();
      await mf.unsafeEvictDurableObject("", "SessionDO", {
        name: "FlaRC",
        webSockets: "hibernate",
      });
      for (const shard of new Set(before.shards))
        await mf.unsafeEvictDurableObject("", "SessionDO", {
          name: `FlaRC:events:${shard}`,
          webSockets: "hibernate",
        });
      const after = await check();
      expect(after.devices).toEqual(before.devices);
      expect(after.a.sessionId).toBe(before.a.sessionId);
      expect(after.b.sessionId).toBe(before.b.sessionId);
      expect(after.e).toEqual(before.e);
      await wire(pass, "PING :pass-after-hibernate", / PONG .*pass-after-hibernate/);
      await wire(sasl, "PING :sasl-after-hibernate", / PONG .*sasl-after-hibernate/);
      await wire(second, "PING :device-after-hibernate", / PONG .*device-after-hibernate/);
      await wire(nickserv, "PING :nickserv-after-hibernate", / PONG .*nickserv-after-hibernate/);
      await wire(scram, "PING :scram-after-hibernate", / PONG .*scram-after-hibernate/);
      const protectedMarker = `protected-after-hibernate-${randomUUID()}`;
      const receivers = [second, nickserv, scram, sasl].map((c) =>
        c.waitForNewLine((line) => line.includes(protectedMarker)),
      );
      pass.send(`PRIVMSG #vault :${protectedMarker}`);
      await Promise.all([
        ...receivers,
        until(received, protectedMarker),
        until(bobEvent.lines, protectedMarker),
      ]);
      const marker = `barrier-after-hibernate-${randomUUID()}`;
      await send("barrier", marker);
      await Promise.all([
        until(received, marker),
        until(bobEvent.lines, marker),
        until(outsideEvent.lines, marker),
        outsider.waitForLine((line) => line.includes(marker)),
      ]);
      expect(outsideEvent.lines.join("\n")).not.toContain(protectedMarker);
      expect(outsider.lines.join("\n")).not.toContain(protectedMarker);
      expect(
        (
          await fetch(new URL("/api/v1/channels/%23vault/messages", url), {
            headers: { authorization: `Bearer ${charlie.token}` },
          })
        ).status,
      ).toBe(403);
      const closed = new Promise<void>((resolve) => bobEvent.ws.once("close", () => resolve()));
      expect((await request("/api/v1/auth/logout", {}, bob.token)).status).toBe(200);
      await mf.unsafeEvictDurableObject("", "SessionDO", {
        name: "FlaRC",
        webSockets: "hibernate",
      });
      const afterRevoke = `protected-after-revoke-${randomUUID()}`;
      await send("vault", afterRevoke);
      await Promise.all([until(received, afterRevoke), closed]);
      const lastMarker = `barrier-after-revoke-${randomUUID()}`;
      await send("barrier", lastMarker);
      await Promise.all([
        until(received, lastMarker),
        until(outsideEvent.lines, lastMarker),
        outsider.waitForLine((line) => line.includes(lastMarker)),
      ]);
      expect(bobEvent.lines.join("\n")).not.toContain(afterRevoke);
      expect(outsideEvent.lines.join("\n")).not.toContain(afterRevoke);
      expect(outsider.lines.join("\n")).not.toContain(afterRevoke);
      expect(
        (
          await fetch(new URL("/api/v1/profiles/bob", url), {
            headers: { authorization: `Bearer ${bob.token}` },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await request(
            "/api/v1/channels/%23vault/messages",
            { content: "denied-revoked-post" },
            bob.token,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(new URL("/api/v1/channels/%23vault/messages", url), {
            headers: { authorization: `Bearer ${bob.token}` },
          })
        ).status,
      ).toBe(401);
      const history = await fetch(new URL("/api/v1/channels/%23vault/messages", url), {
        headers: { authorization: `Bearer ${alice.token}` },
      });
      expect(history.status).toBe(200);
      const historyText = await history.text();
      expect(historyText).toContain(protectedMarker);
      expect(historyText).toContain(afterRevoke);
      expect(historyText).not.toContain("denied-revoked-post");
      for (const c of clients) c.close();
      for (const socket of sockets) socket.terminate();
      await mf.dispose();
      disposed = true;
      function sqliteFiles(folder: string): string[] {
        return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? sqliteFiles(path.join(folder, entry.name))
            : entry.name.endsWith(".sqlite")
              ? [path.join(folder, entry.name)]
              : [],
        );
      }
      const persisted: any[] = [];
      for (const file of sqliteFiles(path.join(dir, "state"))) {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          if (
            db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
              .get()
          )
            persisted.push(
              ...db
                .prepare("SELECT content, sender_id FROM messages WHERE content IN (?, ?)")
                .all(protectedMarker, afterRevoke),
            );
        } finally {
          db.close();
        }
      }
      expect(
        persisted.filter((row) => row.content === protectedMarker && row.sender_id === alice.id),
      ).toHaveLength(1);
      expect(
        persisted.filter((row) => row.content === afterRevoke && row.sender_id === alice.id),
      ).toHaveLength(1);
      restarted = new Miniflare({
        modules: true,
        scriptPath: path.join(dir, "wrapper.mjs"),
        modulesRoot: dir,
        compatibilityDate: "2025-02-04",
        compatibilityFlags: ["nodejs_compat"],
        durableObjectsPersist: path.join(dir, "state"),
        bindings: { SIGNUP_POLICY: "open", ADMIN_USERS: "rootadmin", ADMIN_TOKEN: bootstrap },
        durableObjects: {
          SESSION: { className: "SessionDO", useSQLite: true },
          CHANNELS: { className: "ChannelDO", useSQLite: true },
          ACCOUNTS: { className: "AccountsDO", useSQLite: true },
        },
      });
      const restartedUrl = await restarted.ready;
      const profile = await fetch(new URL("/api/v1/profiles/alice", restartedUrl), {
        headers: { authorization: `Bearer ${alice.token}` },
      });
      expect(profile.status).toBe(200);
      expect(
        (
          await fetch(new URL("/api/v1/profiles/bob", restartedUrl), {
            headers: { authorization: `Bearer ${bob.token}` },
          })
        ).status,
      ).toBe(401);
      const loginAgain = await fetch(new URL("/api/v1/auth/login", restartedUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: alice.password }),
      });
      expect(loginAgain.status).toBe(200);
      expect(((await loginAgain.json()) as any).account.id).toBe(alice.id);
    } finally {
      for (const c of clients) c.close();
      for (const s of sockets) s.terminate();
      if (!disposed) await mf.dispose();
      if (restarted) await restarted.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
