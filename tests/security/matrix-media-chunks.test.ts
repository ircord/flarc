import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { filehostMaxUploadBytes } from "~/core/config";
import type { MatrixActor } from "../helpers/matrix-fixture";
import { ensureNitroBuilt } from "../helpers/miniflare-harness";

// Send the real Content-Length and read a complete HTTP response even if the server
// rejects before the body is fully written. A write error can arrive before Node emits
// the already-in-flight response; allow that event ordering to settle, but a reset with
// no complete HTTP response remains a hard test failure.
async function observeEarlyResponse(url: URL, token: string, size: number) {
  return await new Promise<{ status: number; bytesWritten: number; writeError: string | null }>(
    (resolve, reject) => {
      let finished = false,
        written = 0,
        writeError: string | null = null;
      const chunk = Buffer.alloc(64 * 1024);
      const req = httpRequest(url.toString(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
          "content-length": String(size),
        },
        agent: false,
      });
      const timer = setTimeout(() => {
        req.destroy();
        reject(
          new Error(
            `Early-response HTTP request timed out without a complete response${writeError ? ` after ${writeError}` : ""}`,
          ),
        );
      }, 10000);
      req.on("response", (response) => {
        finished = true;
        response.resume();
        response.on("end", () => {
          clearTimeout(timer);
          req.destroy();
          resolve({ status: response.statusCode ?? 0, bytesWritten: written, writeError });
        });
        response.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      req.on("error", (error: NodeJS.ErrnoException) => {
        writeError = error.code ?? error.name;
      });
      function pump() {
        while (!finished && written < size) {
          const count = Math.min(chunk.length, size - written);
          written += count;
          if (!req.write(chunk.subarray(0, count))) {
            req.once("drain", pump);
            return;
          }
        }
        if (!finished) {
          finished = true;
          req.end();
        }
      }
      pump();
    },
  );
}

async function fixture(provider: "sqlite" | "r2", limit?: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "media-chunks-"));
  cpSync(path.dirname(await ensureNitroBuilt()), path.join(dir, "production"), { recursive: true });
  writeFileSync(
    path.join(dir, "wrapper.mjs"),
    `
export { SessionDO, ChannelDO } from './production/index.mjs';
import original, { AccountsDO as Original } from './production/index.mjs';
export class AccountsDO extends Original {
  testMedia(op, id) {
    if (op === 'fail') this.sql.exec("CREATE TRIGGER test_chunk_failure BEFORE INSERT ON media_upload_chunks WHEN NEW.chunk_index = 1 BEGIN SELECT RAISE(ABORT, 'injected chunk failure'); END");
    if (op === 'clear') this.sql.exec('DROP TRIGGER IF EXISTS test_chunk_failure');
    if (op === 'missing') this.sql.exec('DELETE FROM media_upload_chunks WHERE media_id = ? AND chunk_index = 0', id);
    if (op === 'corrupt') this.sql.exec("UPDATE media_upload_chunks SET data = zeroblob(length(data)) WHERE media_id = ? AND chunk_index = 0", id);
    if (op === 'inline') { this.sql.exec("UPDATE media_uploads SET data = ?, data_layout = 'inline', data_sha256 = NULL WHERE id = ?", new TextEncoder().encode('legacy-inline').buffer, id); this.sql.exec('DELETE FROM media_upload_chunks WHERE media_id = ?', id); }
    if (op === 'unowned') this.sql.exec("INSERT INTO media_uploads (id, filename, mime_type, size, data, created_at) VALUES ('legacy-unowned', 'legacy.txt', 'text/plain', 6, ?, 1)", new TextEncoder().encode('secret').buffer);
    return { files: this.sql.exec('SELECT id, owner_id, size, data_layout, upload_state FROM media_uploads ORDER BY id').toArray(), chunks: this.sql.exec('SELECT media_id, chunk_index, length(data) AS size FROM media_upload_chunks ORDER BY media_id, chunk_index').toArray() };
  }
}
export default { async fetch(request, env, ctx) {
 const url = new URL(request.url);
 if (url.pathname === '/__test_media_control') return Response.json(await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('FlaRC')).testMedia(url.searchParams.get('op'), url.searchParams.get('id')));
 return original.fetch(request, env, ctx);
} };
`,
  );
  const options = {
    modules: true as const,
    scriptPath: path.join(dir, "wrapper.mjs"),
    modulesRoot: dir,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      SIGNUP_POLICY: "open",
      ...(limit === undefined ? {} : { FILEHOST_MAX_UPLOAD_BYTES: limit }),
    },
    durableObjectsPersist: path.join(dir, "do"),
    ...(provider === "r2" ? { r2Buckets: ["MEDIA_BUCKET"], r2Persist: path.join(dir, "r2") } : {}),
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
  };
  let mf = new Miniflare(options),
    url = await mf.ready;
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
  async function actor(username: string): Promise<MatrixActor> {
    const password = `Chunks-${username}-${randomUUID()}!`;
    expect(
      (await request("/api/v1/auth/register", undefined, "POST", { username, password })).status,
    ).toBe(201);
    const res = await request("/api/v1/auth/login", undefined, "POST", { username, password });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    return { username, password, token: data.token, account: data.account };
  }
  async function upload(
    who: MatrixActor,
    body: BodyInit,
    alias = "/api/v1/media/upload",
    type = "application/octet-stream",
    extra: Record<string, unknown> = {},
  ) {
    return fetch(new URL(alias, url), {
      method: "POST",
      headers: { authorization: `Bearer ${who.token}`, "content-type": type },
      body,
      ...extra,
    } as RequestInit);
  }
  async function control(op = "list", id = "") {
    return (await (
      await fetch(new URL(`/__test_media_control?op=${op}&id=${encodeURIComponent(id)}`, url))
    ).json()) as any;
  }
  return {
    get url() {
      return url;
    },
    request,
    actor,
    upload,
    control,
    async restart() {
      await mf.dispose();
      mf = new Miniflare(options);
      url = await mf.ready;
    },
    async rewindLegacy(id: string, bytes: string) {
      await mf.dispose();
      function files(folder: string): string[] {
        return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? files(path.join(folder, entry.name))
            : entry.name.endsWith(".sqlite")
              ? [path.join(folder, entry.name)]
              : [],
        );
      }
      let converted = 0;
      for (const file of files(path.join(dir, "do"))) {
        const db = new DatabaseSync(file);
        try {
          if (
            !db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_uploads'")
              .get()
          )
            continue;
          db.exec("BEGIN");
          if (provider === "sqlite")
            db.prepare("UPDATE media_uploads SET data = ? WHERE id = ?").run(
              Buffer.from(bytes),
              id,
            );
          db.exec(
            "DROP TABLE media_upload_chunks; ALTER TABLE media_uploads DROP COLUMN data_layout; ALTER TABLE media_uploads DROP COLUMN data_sha256; ALTER TABLE media_uploads DROP COLUMN upload_state; COMMIT",
          );
          const columns = db.prepare("PRAGMA table_info(media_uploads)").all() as any[];
          expect(
            columns.some((column) =>
              ["data_layout", "data_sha256", "upload_state"].includes(column.name),
            ),
          ).toBe(false);
          converted++;
        } finally {
          db.close();
        }
      }
      expect(converted).toBe(1);
      mf = new Miniflare(options);
      url = await mf.ready;
    },
    async dispose() {
      await mf.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("media configuration and chunk integrity", () => {
  it("reads each environment independently and rejects malformed limits", () => {
    for (const invalid of [
      undefined,
      "",
      "0",
      "-1",
      "1.5",
      "NaN",
      "Infinity",
      "9007199254740992",
      " 5",
      "1e3",
    ])
      expect(filehostMaxUploadBytes({ FILEHOST_MAX_UPLOAD_BYTES: invalid })).toBe(10485760);
    expect(filehostMaxUploadBytes({ FILEHOST_MAX_UPLOAD_BYTES: "2048" })).toBe(2048);
    expect(filehostMaxUploadBytes({})).toBe(10485760);
    expect(filehostMaxUploadBytes({ FILEHOST_MAX_UPLOAD_BYTES: "10485761" })).toBe(10485761);
  });
  for (const provider of ["sqlite", "r2"] as const) {
    it(`${provider}: old media rows migrate to ready and stay readable across repeated runtime recreation`, async () => {
      const f = await fixture(provider);
      try {
        const alice = await f.actor("alice"),
          bob = await f.actor("bob");
        const original = await f.upload(alice, "legacy-provider-bytes");
        expect(original.status).toBe(201);
        const old = (await original.json()) as any;
        await f.rewindLegacy(old.id, "legacy-provider-bytes");
        expect(await (await f.request(old.url, alice)).text()).toBe("legacy-provider-bytes");
        expect((await f.request(old.url, bob)).status).toBe(404);
        expect((await f.control()).files.find((row: any) => row.id === old.id)).toMatchObject({
          data_layout: "inline",
          upload_state: "ready",
          owner_id: alice.account.id,
        });
        const fresh = await f.upload(alice, "new-after-legacy");
        expect(fresh.status).toBe(201);
        const newer = (await fresh.json()) as any;
        await f.restart();
        expect(await (await f.request(old.url, alice)).text()).toBe("legacy-provider-bytes");
        expect(await (await f.request(newer.url, alice)).text()).toBe("new-after-legacy");
        expect((await f.control()).files.find((row: any) => row.id === old.id)).toMatchObject({
          data_layout: "inline",
          upload_state: "ready",
        });
      } finally {
        await f.dispose();
      }
    }, 60000);
    it(`${provider}: raw multipart and streaming enforce per-environment file bytes through both aliases`, async () => {
      const f = await fixture(provider, "1024");
      try {
        const alice = await f.actor("alice");
        expect(
          (
            await f.request("/api/v1/auth/login", undefined, "POST", {
              username: "alice",
              password: "x".repeat(65536),
            })
          ).status,
        ).toBe(413);
        for (const alias of ["/api/v1/media/upload", "/api/media/upload"]) {
          const exact = await f.upload(alice, new Uint8Array(1024).fill(65), alias);
          expect(exact.status).toBe(201);
          const body = (await exact.json()) as any;
          expect(new Uint8Array(await (await f.request(body.url, alice)).arrayBuffer())).toEqual(
            new Uint8Array(1024).fill(65),
          );
          expect((await f.upload(alice, new Uint8Array(1025), alias)).status).toBe(413);
          for (const [size, status] of [
            [1024, 201],
            [1025, 413],
          ] as const) {
            const form = new FormData();
            form.set("file", new Blob([new Uint8Array(size).fill(66)]), "x.bin");
            const response = await fetch(new URL(alias, f.url), {
              method: "POST",
              headers: { authorization: `Bearer ${alice.token}` },
              body: form,
            });
            expect(response.status).toBe(status);
            if (status === 201) {
              const data = (await response.json()) as any;
              expect(
                new Uint8Array(await (await f.request(data.url, alice)).arrayBuffer()),
              ).toEqual(new Uint8Array(size).fill(66));
            }
          }
          for (const [size, status] of [
            [1024, 201],
            [1025, 413],
          ] as const) {
            const source = new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(size));
                controller.close();
              },
            });
            const response = await f.upload(alice, source, alias, "application/octet-stream", {
              duplex: "half",
            });
            expect(response.status).toBe(status);
          }
        }
        await f.restart();
        expect((await f.upload(alice, new Uint8Array(1025))).status).toBe(413);
      } finally {
        await f.dispose();
      }
    }, 60000);
    it(`${provider}: default multipart exact 10 MiB succeeds and plus one fails on both aliases`, async () => {
      const f = await fixture(provider);
      try {
        const alice = await f.actor("alice");
        for (const alias of [
          "/api/v1/media/upload?boundary=default",
          "/api/media/upload?boundary=default",
        ]) {
          for (const [size, status] of [
            [10485760, 201],
            [10485761, 413],
          ] as const) {
            const bytes = new Uint8Array(size).fill(68);
            const form = new FormData();
            form.set("file", new Blob([bytes]), "default.bin");
            const response = await fetch(new URL(alias, f.url), {
              method: "POST",
              headers: { authorization: `Bearer ${alice.token}` },
              body: form,
            });
            expect(response.status).toBe(status);
            if (status === 201) {
              const media = (await response.json()) as any;
              expect(
                new Uint8Array(await (await f.request(media.url, alice)).arrayBuffer()),
              ).toEqual(bytes);
              expect((await f.request(`/api/v1/media/${media.id}`, alice, "DELETE")).status).toBe(
                200,
              );
            }
          }
        }
      } finally {
        await f.dispose();
      }
    }, 120000);
    it(`${provider}: above-default raw and multipart file boundaries apply to both aliases`, async () => {
      const f = await fixture(provider, "10485761");
      try {
        const alice = await f.actor("alice"),
          bytes = new Uint8Array(10485761).fill(67);
        let retained: any;
        for (const alias of [
          "/api/v1/media/upload?boundary=configured",
          "/api/media/upload?boundary=configured",
        ]) {
          const exact = await f.upload(alice, bytes, alias);
          expect(exact.status).toBe(201);
          const media = (await exact.json()) as any;
          expect(new Uint8Array(await (await f.request(media.url, alice)).arrayBuffer())).toEqual(
            bytes,
          );
          if (!retained) retained = media;
          else
            expect((await f.request(`/api/v1/media/${media.id}`, alice, "DELETE")).status).toBe(
              200,
            );
          const rawOversize = await observeEarlyResponse(
            new URL(alias, f.url),
            alice.token,
            10485762,
          );
          expect(rawOversize.status).toBe(413);
          for (const [size, status] of [
            [10485761, 201],
            [10485762, 413],
          ] as const) {
            const form = new FormData();
            form.set("file", new Blob([new Uint8Array(size).fill(69)]), "configured.bin");
            const response = await fetch(new URL(alias, f.url), {
              method: "POST",
              headers: { authorization: `Bearer ${alice.token}` },
              body: form,
            });
            expect(response.status).toBe(status);
            if (status === 201) {
              const uploaded = (await response.json()) as any;
              expect(
                new Uint8Array(await (await f.request(uploaded.url, alice)).arrayBuffer()),
              ).toEqual(new Uint8Array(size).fill(69));
              expect(
                (await f.request(`/api/v1/media/${uploaded.id}`, alice, "DELETE")).status,
              ).toBe(200);
            }
          }
        }
        await f.restart();
        expect(new Uint8Array(await (await f.request(retained.url, alice)).arrayBuffer())).toEqual(
          bytes,
        );
        expect((await f.request(`/api/v1/media/${retained.id}`, alice, "DELETE")).status).toBe(200);
        expect((await f.request(retained.url, alice)).status).toBe(404);
      } finally {
        await f.dispose();
      }
    }, 120000);
    for (const setting of [undefined, "0", "-1", "invalid", "9007199254740992"]) {
      it(`${provider}: ${setting ?? "unset"} limit keeps the default bound`, async () => {
        const f = await fixture(provider, setting);
        try {
          const alice = await f.actor("alice");
          const oversized = await observeEarlyResponse(
            new URL("/api/v1/media/upload", f.url),
            alice.token,
            10485761,
          );
          expect(oversized.status).toBe(413);
        } finally {
          await f.dispose();
        }
      }, 60000);
    }
  }
  it("SQLite chunk failure rolls back metadata and quota, while corrupt and missing chunks fail closed and inline legacy data stays protected", async () => {
    const f = await fixture("sqlite");
    try {
      const alice = await f.actor("alice"),
        bob = await f.actor("bob");
      const unrelatedResponse = await f.upload(bob, "unrelated-object");
      expect(unrelatedResponse.status).toBe(201);
      const unrelated = (await unrelatedResponse.json()) as any;
      const before = await f.control("fail");
      const failed = await f.upload(alice, new Uint8Array(1024 * 1024).fill(17));
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toMatch(/SQLITE|chunk|injected/i);
      expect(await f.control()).toEqual(before);
      await f.control("clear");
      expect(await (await f.request(unrelated.url, bob)).text()).toBe("unrelated-object");
      const valid = await f.upload(alice, new Uint8Array(1024 * 1024).fill(17));
      expect(valid.status).toBe(201);
      const media = (await valid.json()) as any;
      const state = await f.control();
      expect(state.chunks.filter((x: any) => x.media_id === media.id)).toHaveLength(2);
      await f.control("corrupt", media.id);
      expect((await f.request(media.url, bob)).status).toBe(404);
      const corrupt = await f.request(media.url, alice);
      expect(corrupt.status).toBe(503);
      expect(await corrupt.text()).not.toMatch(/SQLITE|chunk|integrity/i);
      expect((await f.request(`/api/v1/media/${media.id}`, alice, "DELETE")).status).toBe(200);
      expect((await f.control()).chunks.some((x: any) => x.media_id === media.id)).toBe(false);
      const missingUpload = await f.upload(alice, new Uint8Array(1024 * 1024).fill(18));
      expect(missingUpload.status).toBe(201);
      const missing = (await missingUpload.json()) as any;
      await f.control("missing", missing.id);
      expect((await f.request(missing.url, alice)).status).toBe(503);
      const legacyUpload = await f.upload(alice, "legacy-inline");
      expect(legacyUpload.status).toBe(201);
      const legacy = (await legacyUpload.json()) as any;
      await f.control("inline", legacy.id);
      await f.control("unowned");
      expect(await (await f.request(legacy.url, alice)).text()).toBe("legacy-inline");
      expect((await f.request(legacy.url, bob)).status).toBe(404);
      expect((await f.request("/media/legacy-unowned", alice)).status).toBe(404);
      await f.restart();
      expect((await f.request(missing.url, alice)).status).toBe(503);
      expect(await (await f.request(legacy.url, alice)).text()).toBe("legacy-inline");
      expect(await (await f.request(unrelated.url, bob)).text()).toBe("unrelated-object");
      expect((await f.request(`/api/v1/media/${missing.id}`, alice, "DELETE")).status).toBe(200);
      expect((await f.control()).chunks.some((x: any) => x.media_id === missing.id)).toBe(false);
    } finally {
      await f.dispose();
    }
  }, 60000);
});
