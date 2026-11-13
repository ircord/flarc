import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import { createMiniflareServer, TestIRCClient } from "../helpers/miniflare-harness";

// R2 is a real Miniflare bucket, never a mocked handler or a public bucket URL.
async function mediaFixture(provider: "sqlite" | "r2") {
  if (provider === "sqlite") return createMatrixFixture();
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-matrix-r2-"));
  const server = await createMiniflareServer({
    durableObjectsPersist: directory,
    r2Buckets: ["MEDIA_BUCKET"],
  });
  const clients: TestIRCClient[] = [];
  const request = (route: string, actor?: MatrixActor | null, method = "GET", body?: unknown) =>
    fetch(new URL(route, server.url), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    server,
    directory,
    request,
    async createActor(username: string): Promise<MatrixActor> {
      const password = `Pw-${username}-${randomUUID()}!`;
      expect(
        (await request("/api/v1/auth/register", null, "POST", { username, password })).status,
      ).toBe(201);
      const response = await request("/api/v1/auth/login", null, "POST", { username, password });
      expect(response.status).toBe(200);
      const { token, account } = (await response.json()) as any;
      return { username, password, token, account };
    },
    async connect(actor: MatrixActor) {
      const client = new TestIRCClient(server.wsUrl);
      clients.push(client);
      await client.connect();
      client.send(`PASS ${actor.username}:${actor.password}`);
      await client.register(actor.username);
      return client;
    },
    async stop() {
      for (const c of clients) c.close();
      await server.dispose();
    },
    async dispose() {
      for (const c of clients) c.close();
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function mediaRows(directory: string): Promise<any[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const rows: any[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...(await mediaRows(file)));
    else if (file.endsWith(".sqlite")) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT name FROM sqlite_master WHERE name='media_uploads'").get())
          rows.push(
            ...db
              .prepare(
                "SELECT id, owner_id, size, scope_kind, scope_target, storage_kind, length(data) AS stored_bytes FROM media_uploads ORDER BY id",
              )
              .all(),
          );
      } finally {
        db.close();
      }
    }
  }
  return rows;
}

async function storedKey(directory: string, id: string): Promise<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      try {
        return await storedKey(file, id);
      } catch {
        /* search other databases */
      }
    } else if (file.endsWith(".sqlite")) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT name FROM sqlite_master WHERE name='media_uploads'").get()) {
          const row = db.prepare("SELECT object_key FROM media_uploads WHERE id=?").get(id) as
            | { object_key: string | null }
            | undefined;
          if (row) return row.object_key ?? id;
        }
      } finally {
        db.close();
      }
    }
  }
  throw new Error(`No stored media key for ${id}`);
}

function upload(
  f: Awaited<ReturnType<typeof mediaFixture>>,
  actor: MatrixActor | null,
  body: string | Uint8Array,
  query = "",
  filename = "file.txt",
  type = "text/plain",
  alias = "/api/v1/media/upload",
) {
  return fetch(new URL(`${alias}${query}`, f.server.url), {
    method: "POST",
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      "Content-Type": type,
      "X-Filename": filename,
    },
    body: body as any,
  });
}

async function barrier(client: TestIRCClient) {
  const nonce = randomUUID();
  const pong = client.waitForNewLine((l) => l.includes(" PONG ") && l.includes(nonce));
  client.send(`PING :${nonce}`);
  await pong;
}

describe("matrix media", () => {
  for (const provider of ["sqlite", "r2"] as const) {
    it(`${provider} MEDIA-001 MEDIA-002 MEDIA-003 MEDIA-006 MEDIA-013 MEDIA-014 private ownership and deletion persist`, async () => {
      const f = await mediaFixture(provider);
      try {
        const alice = await f.createActor("alice"),
          bob = await f.createActor("bob");
        const aClient = await f.connect(alice),
          bClient = await f.connect(bob);
        await barrier(aClient);
        await barrier(bClient);
        const offsets = [aClient.lines.length, bClient.lines.length];
        const a = await upload(f, alice, "alice-private-bytes");
        expect(a.status).toBe(201);
        const media = (await a.json()) as any;
        const b = await upload(f, bob, "unrelated-bob-bytes");
        expect(b.status).toBe(201);
        const unrelated = (await b.json()) as any;
        const mediaKey = provider === "r2" ? await storedKey(f.directory, media.id) : media.id;
        const unrelatedKey =
          provider === "r2" ? await storedKey(f.directory, unrelated.id) : unrelated.id;
        expect((await upload(f, null, "anonymous-bytes")).status).toBe(401);
        for (const id of [media.id, `${media.id}0`, randomUUID()]) {
          const denied = await f.request(`/media/${id}`, bob);
          expect(denied.status).toBe(404);
          expect(await denied.text()).not.toContain("alice-private-bytes");
        }
        expect((await f.request(media.url)).status).toBe(401);
        expect((await f.request(`/api/v1/media/${media.id}`, bob, "DELETE")).status).toBe(404);
        expect(await (await f.request(media.url, alice)).text()).toBe("alice-private-bytes");
        if (provider === "r2") {
          const bucket = await f.server.mf.getR2Bucket("MEDIA_BUCKET");
          expect(await (await bucket.get(mediaKey))!.text()).toBe("alice-private-bytes");
          expect((await bucket.list()).objects).toHaveLength(2);
        }
        expect((await f.request(`/api/v1/media/${media.id}`, alice, "DELETE")).status).toBe(200);
        for (const suffix of ["", "?download=1", "?token=expired&username=alice"])
          expect((await f.request(`${media.url}${suffix}`, alice)).status).toBe(404);
        expect(await (await f.request(unrelated.url, bob)).text()).toBe("unrelated-bob-bytes");
        if (provider === "r2") {
          const bucket = await f.server.mf.getR2Bucket("MEDIA_BUCKET");
          expect(await bucket.get(mediaKey)).toBeNull();
          expect((await bucket.list()).objects.map((o) => o.key)).toEqual([unrelatedKey]);
        }
        for (const [client, offset] of [
          [aClient, offsets[0]],
          [bClient, offsets[1]],
        ] as const) {
          const nonce = randomUUID();
          const pong = client.waitForNewLine((l) => l.includes(" PONG ") && l.includes(nonce));
          client.send(`PING :${nonce}`);
          await pong;
          expect(client.lines.slice(offset).every((l) => l.includes(" PONG "))).toBe(true);
        }
        await f.stop();
        expect(await mediaRows(f.directory)).toEqual([
          expect.objectContaining({
            id: unrelated.id,
            owner_id: bob.account.id,
            size: 19,
            storage_kind: provider,
          }),
        ]);
        if ("restart" in f) {
          await f.restart();
          expect((await f.request(media.url, alice)).status).toBe(404);
          expect(await (await f.request(unrelated.url, bob)).text()).toBe("unrelated-bob-bytes");
          expect((await f.request(unrelated.url, alice)).status).toBe(404);
        }
      } finally {
        await f.dispose();
      }
    });

    it(`${provider} MEDIA-004 MEDIA-005 MEDIA-008 MEDIA-010 MEDIA-011 channel and DM scopes protect bytes and headers`, async () => {
      const f = await mediaFixture(provider);
      try {
        const alice = await f.createActor("alice"),
          bob = await f.createActor("bob"),
          charlie = await f.createActor("charlie");
        const a = await f.connect(alice),
          b = await f.connect(bob),
          c = await f.connect(charlie);
        a.send("JOIN #private");
        await a.waitForLine((l) => l.includes(" 366 "));
        a.send("MODE #private +s");
        await a.waitForLine((l) => l.includes(" MODE #private +s"));
        b.send("JOIN #private");
        await b.waitForLine((l) => l.includes(" 366 "));
        const offsets = [a.lines.length, b.lines.length, c.lines.length];
        const sent = await upload(
          f,
          alice,
          "<script>private()</script>",
          "?channel=%23private",
          '..\\evil/".html',
          "text/html",
          "/api/media/upload",
        );
        expect(sent.status).toBe(201);
        const media = (await sent.json()) as any;
        expect(media.id).toMatch(/^[a-f0-9-]+\.html$/);
        expect(media.filename).not.toMatch(/[\\/\x00-\x1f]/);
        for (const actor of [alice, bob]) {
          const read = await f.request(media.url, actor);
          expect(read.status).toBe(200);
          expect(read.headers.get("cache-control")).toBe("private, no-store");
          expect(read.headers.get("content-type")).toContain("text/html");
          expect(read.headers.get("content-disposition")).toBe(
            `attachment; filename*=UTF-8''${encodeURIComponent(media.filename)}`,
          );
          expect(read.headers.get("x-content-type-options")).toBe("nosniff");
          expect(read.headers.get("content-security-policy")).toContain("sandbox");
          expect(await read.text()).toBe("<script>private()</script>");
        }
        expect((await f.request(media.url, charlie)).status).toBe(404);
        expect((await upload(f, charlie, "forbidden", "?channel=%23private")).status).toBe(403);
        const dm = await upload(f, alice, "dm-alice-bob", "?dm=bob");
        expect(dm.status).toBe(201);
        const dmMedia = (await dm.json()) as any;
        expect(await (await f.request(dmMedia.url, bob)).text()).toBe("dm-alice-bob");
        expect(
          (await f.request(`${dmMedia.url}?username=bob&accountId=${bob.account.id}`, charlie))
            .status,
        ).toBe(404);
        expect((await f.request(`/api/v1/media/${dmMedia.id}`, bob, "DELETE")).status).toBe(404);
        // Media is stored before message publication; neither bytes nor IDs are IRC events.
        for (const [client, offset] of [
          [a, offsets[0]],
          [b, offsets[1]],
          [c, offsets[2]],
        ] as const) {
          const nonce = randomUUID();
          const pong = client.waitForNewLine((l) => l.includes(" PONG ") && l.includes(nonce));
          client.send(`PING :${nonce}`);
          await pong;
          expect(client.lines.slice(offset).join("\n")).not.toMatch(
            new RegExp(`${media.id}|${dmMedia.id}|private\\(\\)|dm-alice-bob`),
          );
        }
        b.send("PART #private");
        await b.waitForLine((l) => l.includes(" PART #private"));
        expect((await f.request(media.url, bob)).status).toBe(404);
        expect(await (await f.request(dmMedia.url, bob)).text()).toBe("dm-alice-bob");
        await f.stop();
        const rows = await mediaRows(f.directory);
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.id === media.id)).toMatchObject({
          owner_id: alice.account.id,
          scope_kind: "channel",
          scope_target: "#private",
          storage_kind: provider,
        });
        expect(JSON.parse(rows.find((r) => r.id === dmMedia.id).scope_target)).toEqual(
          [alice.account.id, bob.account.id].sort(),
        );
        if (provider === "r2") expect(rows.every((r) => r.stored_bytes === 0)).toBe(true);
        if ("restart" in f) {
          await f.restart();
          expect((await f.request(media.url, alice)).status).toBe(200);
          expect((await f.request(media.url, bob)).status).toBe(404);
          expect((await f.request(media.url, charlie)).status).toBe(404);
          expect(await (await f.request(dmMedia.url, bob)).text()).toBe("dm-alice-bob");
          expect((await f.request(dmMedia.url, charlie)).status).toBe(404);
        }
      } finally {
        await f.dispose();
      }
    });
  }

  it("r2 MEDIA-009 MEDIA-012 ABUSE-007 enforces byte limit and cumulative quota without harming another owner", async () => {
    const f = await mediaFixture("r2");
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const oversized = await f.server.mf.dispatchFetch(
        new URL("/api/v1/media/upload", f.server.url).href,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${alice.token}`,
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(10 * 1024 * 1024 + 1),
        },
      );
      expect(oversized.status).toBe(413);
      const block = new Uint8Array(10 * 1024 * 1024).fill(65);
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const response = await upload(f, alice, block);
        expect(response.status).toBe(201);
        ids.push(((await response.json()) as any).id);
      }
      expect((await upload(f, alice, "x")).status).toBe(403);
      const bobUpload = await upload(f, bob, "bob-independent-quota");
      expect(bobUpload.status).toBe(201);
      const bm = (await bobUpload.json()) as any;
      const bucket = await f.server.mf.getR2Bucket("MEDIA_BUCKET");
      const firstKey = await storedKey(f.directory, ids[0]);
      expect((await bucket.list()).objects).toHaveLength(11);
      expect((await f.request(`/api/v1/media/${ids[0]}`, alice, "DELETE")).status).toBe(200);
      const reclaimed = await upload(f, alice, block);
      expect(reclaimed.status).toBe(201);
      const last = (await reclaimed.json()) as any;
      expect(
        (await upload(f, alice, "x", "", "other.txt", "text/plain", "/api/media/upload")).status,
      ).toBe(403);
      expect(await (await f.request(bm.url, bob)).text()).toBe("bob-independent-quota");
      expect((await bucket.list()).objects).toHaveLength(11);
      expect(await bucket.get(firstKey)).toBeNull();
      expect((await bucket.head(await storedKey(f.directory, last.id)))!.size).toBe(
        block.byteLength,
      );
      await f.stop();
      const rows = await mediaRows(f.directory);
      expect(
        rows.filter((r) => r.owner_id === alice.account.id).reduce((n, r) => n + r.size, 0),
      ).toBe(100 * 1024 * 1024);
      expect(rows.filter((r) => r.owner_id === bob.account.id)).toHaveLength(1);
    } finally {
      await f.dispose();
    }
  });

  it("r2 missing object fails closed while unrelated object and persisted metadata remain intact", async () => {
    const f = await mediaFixture("r2");
    try {
      const alice = await f.createActor("alice");
      const missingResponse = await upload(f, alice, "lost-by-provider"),
        keptResponse = await upload(f, alice, "kept-by-provider");
      expect(missingResponse.status).toBe(201);
      expect(keptResponse.status).toBe(201);
      const missing = (await missingResponse.json()) as any,
        kept = (await keptResponse.json()) as any;
      const bucket = await f.server.mf.getR2Bucket("MEDIA_BUCKET");
      await bucket.delete(await storedKey(f.directory, missing.id));
      const response = await f.request(missing.url, alice);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("lost-by-provider");
      expect(await (await f.request(kept.url, alice)).text()).toBe("kept-by-provider");
      await f.stop();
      expect((await mediaRows(f.directory)).map((r) => r.id).sort()).toEqual(
        [missing.id, kept.id].sort(),
      );
    } finally {
      await f.dispose();
    }
  });
});
