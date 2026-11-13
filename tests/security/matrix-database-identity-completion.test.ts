import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { compareDomainSchema, type SchemaDomain } from "../../scripts/schema/domains";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

async function sqliteFiles(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (
        await readdir(directory, { withFileTypes: true })
      ).map((entry) =>
        entry.isDirectory()
          ? sqliteFiles(path.join(directory, entry.name))
          : Promise.resolve(
              entry.name.endsWith(".sqlite") ? [path.join(directory, entry.name)] : [],
            ),
      ),
    )
  ).flat();
}
async function database(directory: string, sentinel: string): Promise<DatabaseSync> {
  for (const file of await sqliteFiles(directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(sentinel))
      return db;
    db.close();
  }
  throw new Error(`Database containing ${sentinel} was not initialized`);
}
function quote(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
function compareModels(db: DatabaseSync, domain: SchemaDomain) {
  const report = compareDomainSchema(db, domain);
  expect(
    report,
    `${domain} initialized schema: ${JSON.stringify(report.differences)}`,
  ).toMatchObject({
    status: "PASS",
    differences: [],
    unmodeledTables: [],
  });
}

it.each([
  ["Accounts", "users", "accounts"],
  ["Session", "direct_messages", "session"],
  ["Channel", "channel_metadata", "channel"],
] as const)(
  "[DB-022] initialized local %s SQLite matches declared Drizzle models",
  async (_name, sentinel, model) => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("Alice");
      const client = await f.connect(alice);
      await join(client, "#schema");
      await f.stop();
      const db = await database(f.directory, sentinel);
      try {
        if (sentinel === "users")
          expect(
            db.prepare("SELECT id, canonical_username FROM users WHERE id=?").get(alice.account.id),
          ).toEqual({ id: alice.account.id, canonical_username: "alice" });
        compareModels(db, model);
      } finally {
        db.close();
      }
    } finally {
      await f.dispose();
    }
  },
  60000,
);

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
async function eventStream(f: Fixture, actor: MatrixActor) {
  const issued = await f.request("/api/v1/auth/events-ticket", actor, "POST");
  expect(issued.status).toBe(200);
  const { ticket } = (await issued.json()) as { ticket: string };
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`);
  const lines: string[] = [];
  ws.on("message", (data) => lines.push(data.toString()));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, lines };
}
async function waitEvent(lines: string[], marker: string) {
  for (let i = 0; i < 400; i++) {
    if (lines.some((line) => line.includes(marker))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Missing event barrier ${marker}`);
}
// Read-only domain-state observation while the runtime and its observers remain live.
async function domainSnapshot(f: Fixture) {
  const result: Record<string, unknown[]> = {};
  for (const file of await sqliteFiles(f.directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const has = (name: string) =>
        !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
      let prefix = "";
      let tables: string[] = [];
      if (has("channel_metadata")) {
        const row = db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as any;
        if (!["#vault", "#other"].includes(row?.value)) continue;
        prefix = `channel:${row.value}`;
        tables = [
          "channel_metadata",
          "messages",
          "channel_role_groups",
          "channel_user_roles",
          "channel_permissions",
        ];
      } else if (has("users")) {
        prefix = "accounts";
        tables = [
          "users",
          "registered_nicks",
          "account_roles",
          "api_sessions",
          "account_tombstones",
          "media_uploads",
        ];
      } else if (has("direct_messages")) {
        prefix = "session";
        tables = ["direct_messages"];
      }
      for (const table of tables) {
        if (!has(table)) continue;
        const rows = db.prepare(`SELECT * FROM ${quote(table)}`).all();
        result[`${prefix}:${table}`] = rows.sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        );
      }
    } finally {
      db.close();
    }
  }
  return result;
}

async function join(client: TestIRCClient, name: string) {
  const result = client.waitForNewLine((line) => line.includes(" 366 ") && line.includes(name));
  client.send(`JOIN ${name}`);
  await result;
}
async function secret(client: TestIRCClient, name: string) {
  const result = client.waitForNewLine((line) => line.includes(` MODE ${name} +s`));
  client.send(`MODE ${name} +s`);
  await result;
}

it("[DB-026] recreated distinct channels retain their own history, roles and media despite supplied foreign identities", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await join(a, "#vault");
    await secret(a, "#vault");
    await join(b, "#vault");
    await join(c, "#other");
    await secret(c, "#other");
    expect(
      (
        await f.request("/api/v1/channels/%23other/messages", charlie, "POST", {
          content: "unrelated-sentinel",
        })
      ).status,
    ).toBe(201);
    for (const client of [a, b, c]) await join(client, "#barrier");
    const base = "/api/v1/channels/%23vault";
    const response = await f.request(`${base}/messages`, alice, "POST", {
      content: "vault-isolated-history",
    });
    expect(response.status).toBe(201);
    const message = ((await response.json()) as any).message;
    const roleResponse = await f.request(`${base}/roles`, alice, "POST", {
      name: "VaultVoice",
      ircMode: "v",
    });
    expect(roleResponse.status).toBe(201);
    const role = ((await roleResponse.json()) as any).role;
    expect(
      (
        await f.request(`${base}/roles/assign`, alice, "POST", {
          userId: bob.account.id,
          roleGroupId: role.id,
        })
      ).status,
    ).toBe(200);
    const upload = await fetch(new URL("/api/v1/media/upload?channel=%23vault", f.server.url), {
      method: "POST",
      headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "text/plain" },
      body: "vault-isolated-media",
    });
    expect(upload.status).toBe(201);
    const media = (await upload.json()) as any;
    async function verify(clients: TestIRCClient[]) {
      const streams = await Promise.all(
        [alice, bob, charlie].map((actor) => eventStream(f, actor)),
      );
      sockets.push(...streams.map((stream) => stream.ws));
      async function barrier() {
        const marker = `identity-barrier-${randomUUID()}`;
        const received = clients.map((client) =>
          client.waitForNewLine((line) => line.includes(marker)),
        );
        expect(
          (
            await f.request("/api/v1/channels/%23barrier/messages", alice, "POST", {
              content: marker,
            })
          ).status,
        ).toBe(201);
        await Promise.all([
          ...received,
          ...streams.map((stream) => waitEvent(stream.lines, marker)),
        ]);
        return marker;
      }
      await barrier();
      const offsets = clients.map((client) => client.lines.length);
      const eventOffsets = streams.map((stream) => stream.lines.length);
      const before = await domainSnapshot(f);
      expect(before["channel:#vault:messages"]).toEqual([
        expect.objectContaining({
          id: message.id,
          sender_id: alice.account.id,
          content: "vault-isolated-history",
        }),
      ]);
      expect(before["channel:#other:messages"]).toEqual([
        expect.objectContaining({ content: "unrelated-sentinel", sender_id: charlie.account.id }),
      ]);
      expect(before["channel:#vault:channel_user_roles"]).toEqual([
        expect.objectContaining({ user_id: bob.account.id, group_id: role.id }),
      ]);
      expect(before["accounts:media_uploads"]).toEqual([
        expect.objectContaining({ id: media.id, owner_id: alice.account.id }),
      ]);
      const own = await f.request("/api/v1/channels/%23other/messages", charlie);
      expect(own.status).toBe(200);
      expect(JSON.stringify(await own.json())).not.toContain(message.id);
      expect(
        (await f.request(`${base}/messages?channel=%23other&userId=${bob.account.id}`, charlie))
          .status,
      ).toBe(403);
      expect((await f.request(`${base}/roles?userId=${bob.account.id}`, charlie)).status).toBe(403);
      expect(
        (await f.request(`/media/${media.id}?channel=%23other&userId=${bob.account.id}`, charlie))
          .status,
      ).toBe(404);
      const after = await barrier();
      for (const [index, client] of clients.entries())
        expect(client.lines.slice(offsets[index]).filter((line) => !line.includes(after))).toEqual(
          [],
        );
      for (const [index, stream] of streams.entries())
        expect(
          stream.lines.slice(eventOffsets[index]).filter((line) => !line.includes(after)),
        ).toEqual([]);
      expect(await domainSnapshot(f)).toEqual(before);
      const history = await f.request(`${base}/messages`, bob);
      expect(history.status).toBe(200);
      expect(((await history.json()) as any).messages).toContainEqual(
        expect.objectContaining({ id: message.id, content: "vault-isolated-history" }),
      );
      expect(await (await f.request(media.url, bob)).text()).toBe("vault-isolated-media");
      expect(JSON.stringify(await (await f.request(`${base}/roles`, alice)).json())).toContain(
        role.id,
      );
      for (const stream of streams) stream.ws.terminate();
    }
    await verify([a, b, c]);
    await f.restart();
    const a2 = await f.connect(alice),
      b2 = await f.connect(bob),
      c2 = await f.connect(charlie);
    await join(a2, "#vault");
    await join(b2, "#vault");
    await join(c2, "#other");
    for (const client of [a2, b2, c2]) await join(client, "#barrier");
    await verify([a2, b2, c2]);
    await f.stop();
    const messages = (await f.snapshot("messages")).flat() as any[];
    expect(messages.filter((row) => row.id === message.id)).toEqual([
      expect.objectContaining({ id: message.id, sender_id: alice.account.id }),
    ]);
    const roles = (await f.snapshot("channel_user_roles")).flat() as any[];
    expect(roles.filter((row) => row.group_id === role.id)).toEqual([
      expect.objectContaining({ user_id: bob.account.id, group_id: role.id }),
    ]);
    const mediaRows = (await f.snapshot("media_uploads")).flat() as any[];
    expect(mediaRows.filter((row) => row.id === media.id)).toEqual([
      expect.objectContaining({ id: media.id, owner_id: alice.account.id, scope_target: "#vault" }),
    ]);
  } finally {
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
}, 60000);

it("[USER-020] deletion preserves stable participant history and unrelated DMs while reserving the username across recreation", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    const secret = `deleted-peer-${randomUUID()}`,
      unrelated = `unrelated-peer-${randomUUID()}`;
    const bobDelivery = b.waitForNewLine((line) => line.includes(secret));
    a.send(`PRIVMSG bob :${secret}`);
    await bobDelivery;
    const charlieDelivery = c.waitForNewLine((line) => line.includes(unrelated));
    b.send(`PRIVMSG charlie :${unrelated}`);
    await charlieDelivery;
    expect(c.lines.join("\n")).not.toContain(secret);
    await f.stop();
    const before = (await f.snapshot("direct_messages")).flat() as any[];
    expect(before).toHaveLength(2);
    expect(before).toContainEqual(
      expect.objectContaining({
        sender_id: alice.account.id,
        target_id: bob.account.id,
        content: secret,
      }),
    );
    expect(before).toContainEqual(
      expect.objectContaining({
        sender_id: bob.account.id,
        target_id: charlie.account.id,
        content: unrelated,
      }),
    );
    await f.restart();
    const aa = await f.connect(alice),
      bb = await f.connect(bob),
      cc = await f.connect(charlie);
    for (const client of [aa, bb, cc]) await join(client, "#barrier");
    const quit = bb.waitForNewLine((line) => line.includes(" QUIT ") && line.includes("alice!"));
    expect((await f.request("/admin/accounts/alice", root, "DELETE")).status).toBe(200);
    await quit;
    async function deniedWindow(clients: TestIRCClient[]) {
      const streams = await Promise.all([bob, charlie].map((actor) => eventStream(f, actor)));
      sockets.push(...streams.map((stream) => stream.ws));
      async function barrier() {
        const marker = `post-deletion-${randomUUID()}`;
        const received = clients.map((client) =>
          client.waitForNewLine((line) => line.includes(marker)),
        );
        expect(
          (
            await f.request("/api/v1/channels/%23barrier/messages", bob, "POST", {
              content: marker,
            })
          ).status,
        ).toBe(201);
        await Promise.all([
          ...received,
          ...streams.map((stream) => waitEvent(stream.lines, marker)),
        ]);
        return marker;
      }
      await barrier();
      const offsets = clients.map((client) => client.lines.length);
      const eventOffsets = streams.map((stream) => stream.lines.length);
      const snapshot = await domainSnapshot(f);
      expect((await f.request("/api/v1/dms/alice/messages?user=bob", charlie)).status).toBe(403);
      expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(401);
      expect(
        (
          await f.request("/api/v1/auth/login", null, "POST", {
            username: alice.username,
            password: alice.password,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await f.request("/api/v1/auth/register", null, "POST", {
            username: "ALICE",
            password: `Replacement-${randomUUID()}!`,
          })
        ).status,
      ).toBe(400);
      const after = await barrier();
      for (const [i, client] of clients.entries())
        expect(client.lines.slice(offsets[i]).filter((line) => !line.includes(after))).toEqual([]);
      for (const [i, stream] of streams.entries())
        expect(stream.lines.slice(eventOffsets[i]).filter((line) => !line.includes(after))).toEqual(
          [],
        );
      expect(await domainSnapshot(f)).toEqual(snapshot);
      for (const stream of streams) stream.ws.terminate();
    }
    expect(cc.lines.join("\n")).not.toContain(secret);
    await deniedWindow([bb, cc]);
    await f.stop();
    expect((await f.snapshot("direct_messages")).flat()).toEqual(before);
    expect((await f.snapshot("account_tombstones")).flat()).toContainEqual(
      expect.objectContaining({ canonical_username: "alice", user_id: alice.account.id }),
    );
    expect(
      ((await f.snapshot("api_sessions")).flat() as any[]).some(
        (row) => row.user_id === alice.account.id,
      ),
    ).toBe(false);
    await f.restart();
    const b2 = await f.connect(bob),
      c2 = await f.connect(charlie);
    await join(b2, "#barrier");
    await join(c2, "#barrier");
    await deniedWindow([b2, c2]);
    const retained = await f.request("/api/v1/dms/alice/messages", bob);
    expect(retained.status).toBe(200);
    expect(JSON.stringify(await retained.json())).toContain(secret);
    const untouched = await f.request("/api/v1/dms/charlie/messages", bob);
    expect(untouched.status).toBe(200);
    expect(JSON.stringify(await untouched.json())).toContain(unrelated);
  } finally {
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
}, 60000);
