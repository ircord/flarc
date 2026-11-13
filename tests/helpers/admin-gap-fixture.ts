import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "./event-reader";
import type { createMatrixFixture, MatrixActor } from "./matrix-fixture";
import type { TestIRCClient } from "./miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
export async function ircCommand(client: TestIRCClient, text: string, pattern: RegExp) {
  const done = client.waitForNewLine((line) => pattern.test(line));
  client.send(text);
  return await done;
}
export async function join(client: TestIRCClient, channel: string) {
  await ircCommand(client, `JOIN ${channel}`, new RegExp(` 366 .* ${channel} `));
}
export async function observers(f: Fixture, actors: MatrixActor[], clients: TestIRCClient[]) {
  const sockets: WebSocket[] = [],
    received: string[][] = actors.map(() => []);
  try {
    for (const [i, actor] of actors.entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(ticket.status).toBe(200);
      const socket = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
        ["flarc.events.v2"],
      );
      sockets.push(socket);
      socket.on("message", (data) => {
        if (!isReaderControl(socket, data)) received[i].push(data.toString());
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
    }
  } catch (error) {
    for (const socket of sockets) socket.terminate();
    throw error;
  }
  const barrier = async () => {
    const marker = `identity-barrier-${randomUUID()}`;
    const promises = sockets.map(
      (socket) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("missing identity event barrier")), 4000);
          socket.on("message", function listener(data) {
            if (data.toString().includes(marker)) {
              clearTimeout(timer);
              socket.off("message", listener);
              resolve();
            }
          });
        }),
    );
    expect(
      (
        await f.request("/api/v1/channels/%23identitybarrier/messages", actors[0], "POST", {
          content: marker,
        })
      ).status,
    ).toBe(201);
    await Promise.all([
      ...promises,
      ...clients.map((c) => c.waitForLine((l) => l.includes(marker))),
    ]);
    return marker;
  };
  return {
    received,
    barrier,
    close() {
      for (const socket of sockets) socket.terminate();
    },
  };
}

export async function channelDisk(directory: string, channel: string) {
  const { readdir } = await import("node:fs/promises");
  const { default: path } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  async function files(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
          e.isDirectory()
            ? files(path.join(dir, e.name))
            : Promise.resolve(e.name.endsWith(".sqlite") ? [path.join(dir, e.name)] : []),
        ),
      )
    ).flat();
  }
  for (const file of await files(directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (
        !db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_metadata'")
          .get()
      )
        continue;
      if (
        (db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as any)?.value !==
        channel
      )
        continue;
      return {
        metadata: db.prepare("SELECT key,value FROM channel_metadata ORDER BY key").all(),
        kv: db.prepare("SELECT * FROM channel_kv_metadata ORDER BY key").all(),
        roles: db.prepare("SELECT * FROM channel_role_groups ORDER BY id").all(),
        assignments: db.prepare("SELECT * FROM channel_user_roles ORDER BY user_id,group_id").all(),
        permissions: db
          .prepare(
            "SELECT user_id,account_name,permission FROM channel_permissions ORDER BY account_name,permission",
          )
          .all(),
      };
    } finally {
      db.close();
    }
  }
  throw new Error(`Channel database not found ${channel}`);
}

/** Exact account and grant state; credential values are represented only by digests. */
export async function accountDisk(directory: string) {
  const { readdir } = await import("node:fs/promises");
  const { default: path } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash } = await import("node:crypto");
  async function files(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
          e.isDirectory()
            ? files(path.join(dir, e.name))
            : Promise.resolve(e.name.endsWith(".sqlite") ? [path.join(dir, e.name)] : []),
        ),
      )
    ).flat();
  }
  for (const file of await files(directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get())
        continue;
      const hash = (value: unknown) =>
        createHash("sha256").update(JSON.stringify(value)).digest("hex");
      const users = db
        .prepare(
          "SELECT id,username,canonical_username,display_name,disabled_at,credential_version FROM users ORDER BY id",
        )
        .all();
      const credentials = hash({
        users: db.prepare("SELECT id,password_hash FROM users ORDER BY id").all(),
        scram: db.prepare("SELECT * FROM scram_credentials ORDER BY user_id").all(),
      });
      return {
        users,
        credentials,
        roles: db.prepare("SELECT user_id,role FROM account_roles ORDER BY user_id,role").all(),
        nicks: db.prepare("SELECT * FROM registered_nicks ORDER BY nickname").all(),
        metadata: db.prepare("SELECT * FROM user_metadata ORDER BY target_key,key").all(),
      };
    } finally {
      db.close();
    }
  }
  throw new Error("Accounts database not found");
}
