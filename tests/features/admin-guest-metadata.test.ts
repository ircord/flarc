import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createProtocolServer, TestIRCClient } from "../helpers/miniflare-harness";

it("open-network guest metadata preserves administrator compatibility without bypassing account scopes or private metadata", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flarc-guest-metadata-"));
  const f = await createProtocolServer({ durableObjectsPersist: directory });
  const bob = new TestIRCClient(f.wsUrl);
  const request = (route: string, token: string, method = "GET", body?: unknown) =>
    fetch(new URL(route, f.url), {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const alice = await f.apiUser("alice", "#guestproof");
    await bob.connect();
    bob.send("CAP REQ :draft/metadata-3");
    await bob.waitForLine((line) => line.includes(" ACK :draft/metadata-3"));
    bob.send("CAP END");
    await bob.register("bob");
    bob.send("METADATA * SUB *");
    await bob.waitForLine((line) => / 770 | 766 | 762 /.test(line));
    for (const prefix of ["/admin", "/api/v1/admin"]) {
      const route = `${prefix}/metadata/users/bob`;
      const value = `https://example.com/${randomUUID()}.png`;
      const delivered = bob.waitForNewLine(
        (line) => line.includes(" 761 ") && line.includes(value),
      );
      expect((await request(route, f.adminToken, "PUT", { key: "avatar", value })).status).toBe(
        200,
      );
      await delivered;
      const before = await (await request(route, f.adminToken)).json();
      expect(before).toMatchObject({ metadata: { avatar: value } });
      const offset = bob.lines.length;
      expect(
        (
          await request(route, alice.token, "PUT", {
            key: "avatar",
            value: "forbidden-guest-metadata",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(route, f.adminToken, "PUT", {
            key: "private:secret",
            value: "forbidden-private",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(`${prefix}/metadata/users/absent`, f.adminToken, "PUT", {
            key: "avatar",
            value: "forbidden-absent",
          })
        ).status,
      ).toBe(404);
      const credentialResponse = await request("/api/v1/auth/credentials", f.adminToken, "POST", {
        label: "guest-wrong-target",
        expiresAt: Date.now() + 60000,
        scopes: [
          { operation: "rest.put", resource: route },
          { operation: "admin.route.metadata.put", resource: "*" },
          { operation: "admin.metadata.write", resource: "alice" },
        ],
      });
      expect(credentialResponse.status).toBe(200);
      const credential = ((await credentialResponse.json()) as any).credential;
      expect(
        (
          await request(route, credential.token, "PUT", {
            key: "avatar",
            value: "forbidden-scoped",
          })
        ).status,
      ).toBe(403);
      const marker = randomUUID();
      const barrier = bob.waitForNewLine(
        (line) => line.includes(" PONG ") && line.includes(marker),
      );
      bob.send(`PING :${marker}`);
      await barrier;
      expect(bob.lines.slice(offset).join("\n")).not.toContain("forbidden-");
      expect(await (await request(route, f.adminToken)).json()).toEqual(before);
    }
    bob.close();
    await f.dispose();
    async function inspect(folder: string): Promise<void> {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) await inspect(file);
        else if (entry.name.endsWith(".sqlite")) {
          const db = new DatabaseSync(file, { readOnly: true });
          try {
            if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='users'").get()) continue;
            expect(
              db.prepare("SELECT username FROM users WHERE canonical_username='bob'").all(),
            ).toEqual([]);
            const rows = db.prepare("SELECT target_key,key,value FROM user_metadata").all();
            expect(rows).toContainEqual(
              expect.objectContaining({ target_key: "bob", key: "avatar" }),
            );
            expect(JSON.stringify(rows)).not.toContain("forbidden-");
            expect(
              db.prepare("SELECT username FROM users WHERE canonical_username='alice'").all(),
            ).toHaveLength(1);
          } finally {
            db.close();
          }
        }
      }
    }
    await inspect(directory);
  } finally {
    bob.close();
    await f.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
