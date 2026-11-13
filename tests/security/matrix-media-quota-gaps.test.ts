import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { MatrixActor } from "../helpers/matrix-fixture";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

const blockSize = 10 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
for (const [provider, unit, count] of [
  ["sqlite", blockSize, 10],
  ["sqlite", 1024 * 1024, 100],
  ["r2", blockSize, 10],
] as const) {
  describe(`${provider} ${unit} byte real upload limits`, () => {
    it("MEDIA-009 MEDIA-012 ABUSE-007: oversized and exhausted quota denials are silent and inert across restart", async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "media-quota-gaps-"));
      const bundle = await ensureNitroBuilt();
      cpSync(path.dirname(bundle), path.join(dir, "production"), { recursive: true });
      writeFileSync(
        path.join(dir, "wrapper.mjs"),
        `
export { SessionDO, ChannelDO } from './production/index.mjs';
import original, { AccountsDO as Original } from './production/index.mjs';
export class AccountsDO extends Original {
  inspectMedia() { return this.sql.exec('SELECT id, owner_id, filename, mime_type, size, scope_kind, scope_target, storage_kind, data_layout, data_sha256, length(data) AS stored_bytes, (SELECT count(*) FROM media_upload_chunks c WHERE c.media_id = media_uploads.id) AS chunk_count FROM media_uploads ORDER BY id').toArray(); }
}
export default { async fetch(request, env, ctx) {
  if (new URL(request.url).pathname === '/__test_media') return Response.json(await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('FlaRC')).inspectMedia());
  return original.fetch(request, env, ctx);
} };
`,
      );
      const config = {
        modules: true as const,
        scriptPath: path.join(dir, "wrapper.mjs"),
        modulesRoot: dir,
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
      let mf = new Miniflare(config),
        url = await mf.ready;
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
      async function actor(username: string): Promise<MatrixActor> {
        const password = `Quota-${username}-${randomUUID()}!`;
        expect(
          (await request("/api/v1/auth/register", undefined, "POST", { username, password }))
            .status,
        ).toBe(201);
        const response = await request("/api/v1/auth/login", undefined, "POST", {
          username,
          password,
        });
        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        return { username, password, token: data.token, account: data.account };
      }
      async function connect(who: MatrixActor) {
        const client = new TestIRCClient(`ws://${url.host}/irc`);
        clients.push(client);
        await client.connect();
        client.send(`PASS ${who.username}:${who.password}`);
        await client.register(who.username);
        return client;
      }
      async function join(client: TestIRCClient, channel: string) {
        const done = client.waitForNewLine(
          (line) => line.includes(" 366 ") && line.includes(channel),
        );
        client.send(`JOIN ${channel}`);
        await done;
      }
      async function events(who: MatrixActor) {
        const response = await request("/api/v1/auth/events-ticket", who, "POST", {});
        expect(response.status).toBe(200);
        const { ticket } = (await response.json()) as any;
        const ws = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${ticket}`);
        sockets.push(ws);
        const lines: string[] = [];
        ws.on("message", (data) => lines.push(data.toString()));
        await new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
        return {
          lines,
          async until(marker: string) {
            for (let i = 0; i < 500; i++) {
              if (lines.some((line) => line.includes(marker))) return;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error(`Missing observer marker ${marker}`);
          },
        };
      }
      async function upload(
        who: MatrixActor,
        body: Uint8Array | string,
        alias = "/api/v1/media/upload",
        scoped = true,
        filename = "quota.bin",
      ) {
        return fetch(new URL(`${alias}${scoped ? "?channel=%23quota" : ""}`, url), {
          method: "POST",
          headers: {
            authorization: `Bearer ${who.token}`,
            "content-type": "application/octet-stream",
            "x-filename": filename,
          },
          body: body as any,
        });
      }
      async function rows() {
        return (await (await fetch(new URL("/__test_media", url))).json()) as any[];
      }
      async function objects() {
        if (provider === "sqlite") return [];
        return (await (await mf.getR2Bucket("MEDIA_BUCKET")).list()).objects
          .map((o) => ({ key: o.key, size: o.size }))
          .sort((a, b) => a.key.localeCompare(b.key));
      }
      try {
        const alice = await actor("alice"),
          bob = await actor("bob"),
          charlie = await actor("charlie");
        const a = await connect(alice),
          b = await connect(bob),
          c = await connect(charlie);
        await join(a, "#quota");
        const privateMode = a.waitForNewLine((line) => line.includes(" MODE #quota +s"));
        a.send("MODE #quota +s");
        await privateMode;
        await join(b, "#quota");
        for (const client of [a, b, c]) await join(client, "#quota-barrier");
        const ae = await events(alice),
          be = await events(bob),
          ce = await events(charlie);
        const eventStreams = [ae, be, ce],
          irc = [a, b, c];
        async function barrier() {
          const marker = `quota-barrier-${randomUUID()}`;
          const res = await request("/api/v1/channels/%23quota-barrier/messages", alice, "POST", {
            content: marker,
          });
          expect(res.status).toBe(201);
          await Promise.all([
            ...eventStreams.map((e) => e.until(marker)),
            ...irc.map((client) => client.waitForLine((line) => line.includes(marker))),
          ]);
          return marker;
        }
        async function denial(
          action: () => Promise<{
            status: number;
            headers: { get(name: string): string | null };
            text(): Promise<string>;
          }>,
          status: number,
          sentinel: string,
        ) {
          await barrier();
          const ircOffsets = irc.map((client) => client.lines.length),
            eventOffsets = eventStreams.map((e) => e.lines.length);
          const before = await rows(),
            objectBefore = await objects();
          const response = await action();
          expect(response.status).toBe(status);
          expect(response.headers.get("location")).toBeNull();
          const text = await response.text();
          expect(text).not.toContain(sentinel);
          expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          expect(await rows()).toEqual(before);
          expect(await objects()).toEqual(objectBefore);
          const marker = await barrier();
          for (const [index, client] of irc.entries())
            expect(
              client.lines.slice(ircOffsets[index]).filter((line) => !line.includes(marker)),
            ).toEqual([]);
          for (const [index, e] of eventStreams.entries())
            expect(
              e.lines.slice(eventOffsets[index]).filter((line) => !line.includes(marker)),
            ).toEqual([]);
          return before;
        }
        const unrelatedResponse = await upload(
          bob,
          "bob-independent-content",
          "/api/v1/media/upload",
          false,
          "bob.txt",
        );
        expect(unrelatedResponse.status).toBe(201);
        const unrelated = (await unrelatedResponse.json()) as any;
        expect(await (await request(unrelated.url, bob)).text()).toBe("bob-independent-content");
        const oversize = new Uint8Array(blockSize + 1).fill(88);
        oversize.set(new TextEncoder().encode("oversized-private-content"));
        for (const alias of ["/api/v1/media/upload", "/api/media/upload"]) {
          await denial(
            () =>
              mf.dispatchFetch(new URL(`${alias}?channel=%23quota`, url).href, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${alice.token}`,
                  "content-type": "application/octet-stream",
                  "x-filename": "oversize.bin",
                },
                body: oversize,
              }),
            413,
            "oversized-private-content",
          );
        }
        const block = new Uint8Array(unit).fill(65),
          expectedHash = digest(block),
          ids: string[] = [];
        for (let i = 0; i < count; i++) {
          const response = await upload(alice, block);
          expect(response.status, `block ${i}: ${await response.clone().text()}`).toBe(201);
          const file = (await response.json()) as any;
          expect(file.size).toBe(unit);
          ids.push(file.id);
        }
        expect(new Set(ids).size).toBe(count);
        const full = await rows();
        expect(full.filter((row) => row.owner_id === alice.account.id)).toHaveLength(count);
        expect(
          full
            .filter((row) => row.owner_id === alice.account.id)
            .reduce((n, row) => n + row.size, 0),
        ).toBe(100 * 1024 * 1024);
        expect(full.find((row) => row.id === unrelated.id)).toMatchObject({
          owner_id: bob.account.id,
          size: 23,
          storage_kind: provider,
        });
        const fetched = await request(`/media/${ids[0]}`, bob);
        expect(fetched.status).toBe(200);
        expect(digest(new Uint8Array(await fetched.arrayBuffer()))).toBe(expectedHash);
        expect((await request(`/media/${ids[0]}`, charlie)).status).toBe(404);
        for (const alias of ["/api/v1/media/upload", "/api/media/upload"]) {
          await denial(
            () => upload(alice, "quota-denied-content", alias),
            403,
            "quota-denied-content",
          );
        }
        expect(await (await request(unrelated.url, bob)).text()).toBe("bob-independent-content");
        if (provider === "r2") expect(await objects()).toHaveLength(count + 1);
        expect((await request(`/api/v1/media/${ids[0]}`, alice, "DELETE")).status).toBe(200);
        const reclaimed = await upload(alice, block, "/api/media/upload");
        expect(reclaimed.status).toBe(201);
        const replacement = (await reclaimed.json()) as any;
        expect(replacement.id).not.toBe(ids[0]);
        expect(replacement.size).toBe(unit);
        await denial(() => upload(alice, "quota-again", "/api/media/upload"), 403, "quota-again");
        expect((await request(`/media/${ids[0]}`, alice)).status).toBe(404);
        const beforeStop = await rows(),
          beforeObjects = await objects();
        for (const socket of sockets) socket.terminate();
        for (const client of clients) client.close();
        await mf.dispose();
        function sqliteFiles(folder: string): string[] {
          return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
              ? sqliteFiles(path.join(folder, entry.name))
              : entry.name.endsWith(".sqlite")
                ? [path.join(folder, entry.name)]
                : [],
          );
        }
        const stored: any[] = [];
        for (const file of sqliteFiles(path.join(dir, "do"))) {
          const db = new DatabaseSync(file, { readOnly: true });
          try {
            if (db.prepare("SELECT name FROM sqlite_master WHERE name='media_uploads'").get())
              stored.push(
                ...db
                  .prepare(
                    "SELECT id, owner_id, filename, mime_type, size, scope_kind, scope_target, storage_kind, data_layout, data_sha256, length(data) AS stored_bytes, (SELECT count(*) FROM media_upload_chunks c WHERE c.media_id = media_uploads.id) AS chunk_count FROM media_uploads ORDER BY id",
                  )
                  .all(),
              );
          } finally {
            db.close();
          }
        }
        expect(stored).toEqual(beforeStop);
        expect(stored).toHaveLength(count + 1);
        expect(stored.find((row) => row.id === ids[0])).toBeUndefined();
        expect(stored.find((row) => row.id === replacement.id)).toMatchObject({
          owner_id: alice.account.id,
          size: unit,
          storage_kind: provider,
          stored_bytes: 0,
          data_layout: provider === "sqlite" ? "chunked" : "inline",
          chunk_count: provider === "sqlite" ? Math.ceil(unit / (512 * 1024)) : 0,
        });
        mf = new Miniflare(config);
        url = await mf.ready;
        expect(await rows()).toEqual(beforeStop);
        expect(await objects()).toEqual(beforeObjects);
        const restoredAlice = await connect(alice),
          restoredBob = await connect(bob);
        await join(restoredAlice, "#quota");
        await join(restoredBob, "#quota");
        const restored = await request(`/media/${replacement.id}`, bob);
        expect(restored.status).toBe(200);
        expect(digest(new Uint8Array(await restored.arrayBuffer()))).toBe(expectedHash);
        expect(await (await request(unrelated.url, bob)).text()).toBe("bob-independent-content");
        expect((await request(`/media/${ids[0]}`, alice)).status).toBe(404);
        const restoredCharlie = await connect(charlie);
        const restoredIrc = [restoredAlice, restoredBob, restoredCharlie];
        for (const client of restoredIrc) await join(client, "#quota-barrier");
        const restoredEvents = await Promise.all([alice, bob, charlie].map((who) => events(who)));
        async function restoredBarrier() {
          const marker = `quota-restart-${randomUUID()}`;
          expect(
            (
              await request("/api/v1/channels/%23quota-barrier/messages", alice, "POST", {
                content: marker,
              })
            ).status,
          ).toBe(201);
          await Promise.all([
            ...restoredIrc.map((client) => client.waitForLine((line) => line.includes(marker))),
            ...restoredEvents.map((e) => e.until(marker)),
          ]);
          return marker;
        }
        await restoredBarrier();
        const restoredIrcOffsets = restoredIrc.map((client) => client.lines.length);
        const restoredEventOffsets = restoredEvents.map((event) => event.lines.length);
        const postRestartDenied = await upload(alice, "quota-after-restart", "/api/media/upload");
        expect(postRestartDenied.status).toBe(403);
        expect(postRestartDenied.headers.get("location")).toBeNull();
        expect(await postRestartDenied.text()).not.toContain("quota-after-restart");
        const restoredMarker = await restoredBarrier();
        for (const [index, client] of restoredIrc.entries())
          expect(
            client.lines
              .slice(restoredIrcOffsets[index])
              .filter((line) => !line.includes(restoredMarker)),
          ).toEqual([]);
        for (const [index, event] of restoredEvents.entries())
          expect(
            event.lines
              .slice(restoredEventOffsets[index])
              .filter((line) => !line.includes(restoredMarker)),
          ).toEqual([]);
        expect(await rows()).toEqual(beforeStop);
        expect(await objects()).toEqual(beforeObjects);
      } finally {
        for (const socket of sockets) socket.terminate();
        for (const client of clients) client.close();
        await mf.dispose();
        rmSync(dir, { recursive: true, force: true });
      }
    }, 120000);
  });
}
