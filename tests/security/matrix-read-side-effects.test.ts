import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { observedAuthFixture, sameProtected } from "../helpers/auth-gap-fixture";
import type { MatrixActor } from "../helpers/matrix-fixture";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

it("USER-015: public profiles exclude real private fields and preserve a seeded unrelated profile across recreation", async () => {
  const r = await observedAuthFixture();
  try {
    for (const [actor, displayName, bio] of [
      [r.bob, "Bob Public", "bob-public-bio"],
      [r.charlie, "Charlie Independent", "charlie-unrelated-bio"],
    ] as const)
      expect(
        (
          await r.f.request(`/api/v1/profiles/${actor.username}`, actor, "PATCH", {
            displayName,
            bio,
          })
        ).status,
      ).toBe(200);
    for (const [name, value] of [
      ["bob", "bob-private-note-value"],
      ["charlie", "charlie-private-note-value"],
    ] as const)
      expect(
        (
          await r.f.request(`/admin/metadata/users/${name}`, r.root, "PUT", {
            key: "private-note",
            value,
          })
        ).status,
      ).toBe(200);
    await r.flush();
    const before = await r.f.snapshot();
    const metadataBefore = (await r.f.rows("user_metadata"))
      .flat()
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(JSON.stringify(metadataBefore)).toContain("bob-private-note-value");
    expect(JSON.stringify(metadataBefore)).toContain("charlie-private-note-value");
    const privateValues = [
      r.bob.password,
      r.bob.token,
      ...before.users.filter((row) => row.id === r.bob.account.id).map((row) => row.password_hash),
      ...before.scram_credentials
        .filter((row) => row.user_id === r.bob.account.id)
        .flatMap((row) => [row.salt, row.stored_key, row.server_key]),
    ];
    expect(privateValues.every((value) => typeof value === "string" && value.length > 8)).toBe(
      true,
    );
    await r.resume();
    async function readChecks() {
      for (const path of ["/api/v1/profiles/bob", "/api/profile/bob"]) {
        const response = await r.f.request(path, r.alice);
        expect(response.status).toBe(200);
        const body = (await response.json()) as any;
        expect(body.profile).toMatchObject({
          username: "bob",
          displayName: "Bob Public",
          bio: "bob-public-bio",
        });
        const text = JSON.stringify(body);
        for (const secret of [...privateValues, "bob-private-note-value", "private-note"])
          expect(text).not.toContain(secret);
        expect(text).not.toMatch(/password_hash|stored_key|server_key|credential_version/i);
      }
      const unrelated = await r.f.request("/api/v1/profiles/charlie", r.alice);
      expect(unrelated.status).toBe(200);
      expect(((await unrelated.json()) as any).profile).toMatchObject({
        username: "charlie",
        displayName: "Charlie Independent",
        bio: "charlie-unrelated-bio",
      });
    }
    await r.silence(readChecks);
    const after = await r.f.snapshot();
    const metadataAfter = (await r.f.rows("user_metadata"))
      .flat()
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    sameProtected(before, after);
    expect(metadataAfter).toEqual(metadataBefore);
    await r.resume();
    await r.silence(readChecks);
    const final = await r.f.snapshot();
    sameProtected(before, final);
    expect(
      (await r.f.rows("user_metadata"))
        .flat()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(metadataBefore);
  } finally {
    await r.dispose();
  }
}, 60000);

it("DB-027: denied history pagination is silent and cannot alter independent protected histories across recreation", async () => {
  const r = await observedAuthFixture();
  try {
    const protectedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await r.f.request("/api/v1/channels/%23protected/messages", r.bob, "POST", {
        content: `history-private-sentinel-${i}`,
      });
      expect(response.status).toBe(201);
      protectedIds.push(((await response.json()) as any).message.id);
    }
    await r.good.until("history-private-sentinel-2");
    await r.a.waitForLine((line) => line.includes("history-private-sentinel-2"));
    const unrelated = await r.f.request(
      "/api/v1/channels/%23unrelated/messages",
      r.charlie,
      "POST",
      { content: "history-unrelated-sentinel" },
    );
    expect(unrelated.status).toBe(201);
    const foreignId = ((await unrelated.json()) as any).message.id;
    const dmMarker = `history-private-dm-${randomUUID()}`;
    const received = r.b.waitForNewLine((line) => line.includes(dmMarker));
    r.a.send(`PRIVMSG bob :${dmMarker}`);
    await received;
    await r.flush();
    const before = await r.f.snapshot();
    expect(before.messages.filter((row) => protectedIds.includes(row.id))).toHaveLength(3);
    expect(before.messages.some((row) => row.id === foreignId)).toBe(true);
    expect(before.direct_messages.some((row) => row.content === dmMarker)).toBe(true);
    await r.resume();
    async function checks() {
      for (const cursor of ["before", "after", "around"])
        for (const limit of ["-1", "0", "999999999", "NaN"]) {
          const denied = await r.f.request(
            `/api/v1/channels/%23protected/messages?${cursor}=${foreignId}&limit=${limit}`,
            r.charlie,
          );
          expect(denied.status).toBe(403);
          const text = await denied.text();
          expect(text).not.toMatch(/history-private-sentinel|history-private-dm/);
        }
      for (const cursor of ["before", "after"]) {
        const denied = await r.f.request(
          `/api/v1/dms/bob/messages?user=alice&${cursor}=${protectedIds[0]}&limit=2`,
          r.charlie,
        );
        expect(denied.status).toBe(403);
        expect(await denied.text()).not.toContain(dmMarker);
      }
      const valid = await r.f.request("/api/v1/channels/%23protected/messages?limit=2", r.alice);
      expect(valid.status).toBe(200);
      const page = (await valid.json()) as any;
      expect(page.pagination.limit).toBe(2);
      expect(page.messages).toHaveLength(2);
      expect(page.messages.every((message: any) => protectedIds.includes(message.id))).toBe(true);
      const unrelatedRead = await r.f.request(
        "/api/v1/channels/%23unrelated/messages?limit=2",
        r.charlie,
      );
      expect(unrelatedRead.status).toBe(200);
      expect(await unrelatedRead.text()).toContain("history-unrelated-sentinel");
      const dm = await r.f.request("/api/v1/dms/bob/messages?limit=2", r.alice);
      expect(dm.status).toBe(200);
      expect(await dm.text()).toContain(dmMarker);
      const outsiderPage = await r.f.request(
        `/api/v1/channels/%23unrelated/messages?around=${protectedIds[0]}&limit=1`,
        r.charlie,
      );
      expect(outsiderPage.status).toBe(200);
      const safe = (await outsiderPage.json()) as any;
      expect(safe.messages.length).toBeLessThanOrEqual(1);
      expect(JSON.stringify(safe)).not.toContain("history-private-sentinel");
    }
    await r.silence(checks);
    const after = await r.f.snapshot();
    sameProtected(before, after);
    await r.resume();
    await r.silence(checks);
    const last = await r.f.snapshot();
    sameProtected(before, last);
  } finally {
    await r.dispose();
  }
}, 60000);

for (const provider of ["sqlite", "r2"] as const) {
  it(`DB-020 DB-023: ${provider} pre-chunk media migration denies wrong-owner reads without side effects`, async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "read-side-effects-"));
    const scriptPath = await ensureNitroBuilt();
    const options = {
      modules: true as const,
      scriptPath,
      modulesRoot: path.dirname(scriptPath),
      compatibilityDate: "2025-02-04",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { SIGNUP_POLICY: "open" },
      durableObjectsPersist: path.join(dir, "do"),
      ...(provider === "r2"
        ? { r2Buckets: ["MEDIA_BUCKET"], r2Persist: path.join(dir, "r2") }
        : {}),
      durableObjects: {
        SESSION: { className: "SessionDO", useSQLite: true },
        CHANNELS: { className: "ChannelDO", useSQLite: true },
        ACCOUNTS: { className: "AccountsDO", useSQLite: true },
      },
    };
    let mf = new Miniflare(options),
      url = await mf.ready,
      stopped = false;
    const clients: TestIRCClient[] = [],
      sockets: WebSocket[] = [];
    async function request(route: string, actor?: MatrixActor, method = "GET", body?: unknown) {
      return fetch(new URL(route, url), {
        method,
        headers: {
          ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function create(username: string): Promise<MatrixActor> {
      const password = `Read-side-${username}-${randomUUID()}!`;
      expect(
        (await request("/api/v1/auth/register", undefined, "POST", { username, password })).status,
      ).toBe(201);
      const response = await request("/api/v1/auth/login", undefined, "POST", {
        username,
        password,
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      return { username, password, token: body.token, account: body.account };
    }
    async function upload(actor: MatrixActor, data: string) {
      const response = await fetch(new URL("/api/v1/media/upload", url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${actor.token}`,
          "content-type": "text/plain",
          "x-filename": "legacy.txt",
        },
        body: data,
      });
      expect(response.status).toBe(201);
      return (await response.json()) as any;
    }
    async function stop() {
      if (!stopped) {
        for (const socket of sockets.splice(0)) socket.terminate();
        for (const client of clients.splice(0)) client.close();
        await mf.dispose();
        stopped = true;
      }
    }
    async function start() {
      mf = new Miniflare(options);
      url = await mf.ready;
      stopped = false;
    }
    function files(folder = path.join(dir, "do")): string[] {
      return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(folder, entry.name))
          : entry.name.endsWith(".sqlite")
            ? [path.join(folder, entry.name)]
            : [],
      );
    }
    function accountDb() {
      expect(stopped).toBe(true);
      for (const file of files()) {
        const db = new DatabaseSync(file);
        if (
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_uploads'")
            .get()
        )
          return db;
        db.close();
      }
      throw new Error("Accounts SQLite not found");
    }
    function snapshot() {
      const db = accountDb();
      try {
        return {
          media: db
            .prepare(
              "SELECT id, owner_id, filename, mime_type, size, scope_kind, scope_target, scope_generation, storage_kind, upload_state, data_layout, data_sha256, hex(data) AS bytes FROM media_uploads ORDER BY id",
            )
            .all(),
          chunks: db
            .prepare(
              "SELECT media_id, chunk_index, hex(data) AS bytes FROM media_upload_chunks ORDER BY media_id, chunk_index",
            )
            .all(),
          users: db
            .prepare(
              "SELECT id, username, password_hash, credential_version, disabled_at FROM users ORDER BY id",
            )
            .all(),
          credentials: db
            .prepare(
              "SELECT user_id, salt, stored_key, server_key FROM scram_credentials ORDER BY user_id",
            )
            .all(),
        };
      } finally {
        db.close();
      }
    }
    async function observe(actors: MatrixActor[]) {
      const c: TestIRCClient[] = [],
        ev: { received: string[]; until(marker: string): Promise<void> }[] = [];
      for (const actor of actors) {
        const client = new TestIRCClient(`ws://${url.host}/irc`);
        clients.push(client);
        c.push(client);
        await client.connect();
        client.send(`PASS ${actor.username}:${actor.password}`);
        await client.register(actor.username);
        const joined = client.waitForNewLine(
          (line) => line.includes(" 366 ") && line.includes("#readmarkers"),
        );
        client.send("JOIN #readmarkers");
        await joined;
        const ticket = await request("/api/v1/auth/events-ticket", actor, "POST", {});
        expect(ticket.status).toBe(200);
        const ws = new WebSocket(
          `ws://${url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
        );
        sockets.push(ws);
        const received: string[] = [];
        ws.on("message", (data) => received.push(data.toString()));
        await new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
        ev.push({
          received,
          async until(marker) {
            for (let i = 0; i < 400; i++) {
              if (received.some((line) => line.includes(marker))) return;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error("Missing observer barrier");
          },
        });
      }
      async function barrier() {
        const marker = `read-marker-${randomUUID()}`;
        expect(
          (
            await request("/api/v1/channels/%23readmarkers/messages", actors[0], "POST", {
              content: marker,
            })
          ).status,
        ).toBe(201);
        await Promise.all([
          ...c.map((client) => client.waitForLine((line) => line.includes(marker))),
          ...ev.map((e) => e.until(marker)),
        ]);
        return marker;
      }
      async function silent(action: () => Promise<void>) {
        await barrier();
        const ircStart = c.map((client) => client.lines.length),
          eventStart = ev.map((e) => e.received.length);
        await action();
        const marker = await barrier();
        for (const [i, client] of c.entries())
          expect(client.lines.slice(ircStart[i]).filter((line) => !line.includes(marker))).toEqual(
            [],
          );
        for (const [i, e] of ev.entries())
          expect(e.received.slice(eventStart[i]).filter((line) => !line.includes(marker))).toEqual(
            [],
          );
      }
      return { silent };
    }
    try {
      const alice = await create("alice"),
        bob = await create("bob"),
        charlie = await create("charlie");
      const secret = "legacy-media-private-sentinel",
        other = "legacy-media-independent-sentinel";
      const target = await upload(alice, secret),
        unrelated = await upload(charlie, other);
      expect(await (await request(target.url, alice)).text()).toBe(secret);
      expect(await (await request(unrelated.url, charlie)).text()).toBe(other);
      await stop();
      const db = accountDb();
      try {
        db.exec("BEGIN");
        if (provider === "sqlite") {
          db.prepare("UPDATE media_uploads SET data = ? WHERE id = ?").run(
            Buffer.from(secret),
            target.id,
          );
          db.prepare("UPDATE media_uploads SET data = ? WHERE id = ?").run(
            Buffer.from(other),
            unrelated.id,
          );
        }
        db.exec(
          "DROP TABLE media_upload_chunks; ALTER TABLE media_uploads DROP COLUMN data_layout; ALTER TABLE media_uploads DROP COLUMN data_sha256; ALTER TABLE media_uploads DROP COLUMN upload_state; COMMIT",
        );
        expect(
          (db.prepare("PRAGMA table_info(media_uploads)").all() as any[]).some((column) =>
            ["data_layout", "data_sha256", "upload_state"].includes(column.name),
          ),
        ).toBe(false);
      } finally {
        db.close();
      }
      await start();
      expect((await request("/api/v1/profiles/alice", alice)).status).toBe(200);
      expect(await (await request(target.url, alice)).text()).toBe(secret);
      expect(await (await request(unrelated.url, charlie)).text()).toBe(other);
      const objectBefore =
        provider === "r2"
          ? (await (await mf.getR2Bucket("MEDIA_BUCKET")).list()).objects.map((o) => o.key).sort()
          : [];
      await stop();
      const before = snapshot();
      expect(before.media).toContainEqual(
        expect.objectContaining({
          id: target.id,
          owner_id: alice.account.id,
          data_layout: "inline",
          upload_state: "ready",
          storage_kind: provider,
        }),
      );
      expect(before.media).toContainEqual(
        expect.objectContaining({
          id: unrelated.id,
          owner_id: charlie.account.id,
          data_layout: "inline",
          upload_state: "ready",
          storage_kind: provider,
        }),
      );
      async function verify() {
        const observer = await observe([alice, bob, charlie]);
        await observer.silent(async () => {
          for (const suffix of ["", "?download=1"]) {
            const denied = await request(`${target.url}${suffix}`, bob);
            expect(denied.status).toBe(404);
            const text = await denied.text();
            expect(text).not.toContain(secret);
            expect(text).not.toContain(target.id);
          }
          expect(await (await request(target.url, alice)).text()).toBe(secret);
          expect(await (await request(unrelated.url, charlie)).text()).toBe(other);
          expect((await request(unrelated.url, bob)).status).toBe(404);
        });
        const objects =
          provider === "r2"
            ? (await (await mf.getR2Bucket("MEDIA_BUCKET")).list()).objects.map((o) => o.key).sort()
            : [];
        expect(objects).toEqual(objectBefore);
      }
      await start();
      await verify();
      await stop();
      expect(snapshot()).toEqual(before);
      await start();
      await verify();
      await stop();
      expect(snapshot()).toEqual(before);
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
}
