import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMiniflareServer, TestIRCClient } from "./miniflare-harness";

export type MatrixActor = {
  username: string;
  password: string;
  token: string;
  account: any;
};

/** Each fixture owns a workerd runtime and persistent SQLite directory. */
export async function createMatrixFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-matrix-"));
  const bootstrap = `bootstrap-${randomUUID()}`;
  const options = {
    durableObjectsPersist: directory,
    bindings: { ADMIN_USERS: "rootadmin", ADMIN_TOKEN: bootstrap },
  };
  let server = await createMiniflareServer(options);
  const clients: TestIRCClient[] = [];
  let stopped = false;
  const request = (
    route: string,
    actor?: MatrixActor | null,
    method = "GET",
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ) =>
    fetch(new URL(route, server.url), {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function login(username: string, password: string): Promise<MatrixActor> {
    const response = await request("/api/v1/auth/login", null, "POST", {
      username,
      password,
    });
    const data = (await response.json()) as any;
    if (response.status !== 200 || !data.token)
      throw new Error(`login ${username}: ${response.status} ${JSON.stringify(data)}`);
    return { username, password, token: data.token, account: data.account };
  }
  async function createActor(username: string, root = false): Promise<MatrixActor> {
    const password = `Pw-${username}-${randomUUID()}!`;
    const response = await request(
      "/api/v1/auth/register",
      null,
      "POST",
      { username, password },
      root ? { "x-bootstrap-token": bootstrap } : undefined,
    );
    if (response.status !== 201)
      throw new Error(`register ${username}: ${response.status} ${await response.text()}`);
    return login(username, password);
  }
  async function connect(actor: MatrixActor, nick = actor.username): Promise<TestIRCClient> {
    const client = new TestIRCClient(server.wsUrl);
    clients.push(client);
    await client.connect();
    client.send(`PASS ${actor.username}:${actor.password}`);
    await client.register(nick);
    return client;
  }
  async function barrier(client: TestIRCClient): Promise<void> {
    const nonce = randomUUID();
    const done = client.waitForNewLine((line) => line.includes(" PONG ") && line.includes(nonce));
    client.send(`PING :${nonce}`);
    await done;
  }
  async function stop() {
    if (!stopped) {
      for (const client of clients) client.close();
      await server.dispose();
      stopped = true;
    }
  }
  async function restart() {
    await stop();
    server = await createMiniflareServer(options);
    stopped = false;
  }
  async function snapshot(table: string): Promise<unknown[][]> {
    if (!stopped) throw new Error("Stop the runtime before inspecting SQLite");
    if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid table name");
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
    const result: unknown[][] = [];
    for (const file of await files(directory)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
          result.push(db.prepare(`SELECT * FROM ${table}`).all());
      } finally {
        db.close();
      }
    }
    return result;
  }
  async function dispose() {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
  return {
    get server() {
      return server;
    },
    directory,
    request,
    login,
    createActor,
    connect,
    barrier,
    stop,
    restart,
    snapshot,
    dispose,
  };
}
