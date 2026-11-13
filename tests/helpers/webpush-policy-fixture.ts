import {
  createDecipheriv,
  createECDH,
  createHmac,
  generateKeyPairSync,
  randomUUID,
} from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { expect } from "vitest";
import { ensureNitroBuilt, TestIRCClient } from "./miniflare-harness";

const b64 = (data: Uint8Array) => Buffer.from(data).toString("base64url");
const mac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();
const expand = (key: Uint8Array, data: Uint8Array, len: number) =>
  mac(key, Buffer.concat([data, Buffer.from([1])])).subarray(0, len);
export type Actor = { username: string; password: string; token: string; account: { id: string } };
export type Delivery = { url: string; body: Buffer; authorization: string | null };

export async function waitFor(predicate: () => boolean | Promise<boolean>, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for push condition");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function pushFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "flarc-push-policy-"));
  const scriptPath = await ensureNitroBuilt();
  const bundleDir = path.join(dir, "bundle");
  await cp(path.dirname(scriptPath), bundleDir, { recursive: true });
  const wrapper = path.join(bundleDir, "push-test-wrapper.mjs");
  const relative = `./${path.basename(scriptPath)}`;
  await writeFile(
    wrapper,
    `import { AccountsDO as Base } from ${JSON.stringify(relative)};
export { default, SessionDO, ChannelDO } from ${JSON.stringify(relative)};
export class AccountsDO extends Base {
  async testPushAlarm(endpoint) {
    this.ctx.storage.sql.exec("UPDATE push_deliveries SET next_attempt=0 WHERE endpoint=?", endpoint);
    return await super.alarm();
  }
}
`,
  );
  const vapid = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    format: "jwk",
  });
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(vapid.x!, "base64url"),
    Buffer.from(vapid.y!, "base64url"),
  ]);
  const deliveries: Delivery[] = [];
  const completed: string[] = [];
  const responses = new Map<string, number>();
  let gateUrl = "",
    releaseGate: (() => void) | undefined;
  let gate = Promise.resolve();
  let mf: Miniflare;
  let origin: URL;
  const clients: TestIRCClient[] = [];
  async function start() {
    mf = new Miniflare({
      modules: true,
      scriptPath: wrapper,
      modulesRoot: bundleDir,
      compatibilityDate: "2025-02-04",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        SIGNUP_POLICY: "open",
        ADMIN_USERS: "rootadmin",
        ADMIN_TOKEN: "push-fixture-bootstrap",
        ALLOWLIST_YAML: "version: 1\nembeds: []\nwebhooks: []\npush: [push.example.com]\n",
        WEBPUSH_VAPID_PUBLIC_KEY: b64(publicKey),
        WEBPUSH_VAPID_PRIVATE_KEY: vapid.d!,
        WEBPUSH_VAPID_SUBJECT: "mailto:admin@example.com",
      },
      durableObjectsPersist: dir,
      durableObjects: {
        SESSION: { className: "SessionDO", useSQLite: true },
        CHANNELS: { className: "ChannelDO", useSQLite: true },
        ACCOUNTS: { className: "AccountsDO", useSQLite: true },
      },
      outboundService: async (request: Request) => {
        deliveries.push({
          url: request.url,
          body: Buffer.from(await request.arrayBuffer()),
          authorization: request.headers.get("authorization"),
        });
        if (request.url === gateUrl) await gate;
        completed.push(request.url);
        return new Response(null, { status: responses.get(request.url) ?? 201 });
      },
    });
    origin = await mf.ready;
  }
  await start();
  const request = (
    route: string,
    actor?: Actor,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(new URL(route, origin), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  async function actor(username: string, admin = false): Promise<Actor> {
    const password = `Password-${randomUUID()}!`;
    expect(
      (
        await request(
          "/api/v1/auth/register",
          undefined,
          "POST",
          { username, password },
          admin ? { "x-bootstrap-token": "push-fixture-bootstrap" } : {},
        )
      ).status,
    ).toBe(201);
    const response = await request("/api/v1/auth/login", undefined, "POST", { username, password });
    expect(response.status).toBe(200);
    return {
      username,
      password,
      ...((await response.json()) as { token: string; account: { id: string } }),
    };
  }
  async function subscription(user: Actor, name: string) {
    const receiver = createECDH("prime256v1"),
      receiverPublic = receiver.generateKeys(),
      auth = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
    const endpoint = `https://push.example.com/${name}`;
    expect(
      (
        await request("/api/v1/notifications/subscribe", user, "POST", {
          username: user.username,
          endpoint,
          keys: { p256dh: b64(receiverPublic), auth: b64(auth) },
        })
      ).status,
    ).toBe(200);
    const decrypt = (body: Buffer) => {
      const sender = body.subarray(21, 86),
        shared = receiver.computeSecret(sender);
      const ikm = expand(
        mac(auth, shared),
        Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, sender]),
        32,
      );
      const prk = mac(body.subarray(0, 16), ikm),
        key = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
        nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
      const ciphertext = body.subarray(86),
        decipher = createDecipheriv("aes-128-gcm", key, nonce);
      decipher.setAuthTag(ciphertext.subarray(-16));
      const clear = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
      expect(clear.at(-1)).toBe(2);
      return JSON.parse(clear.subarray(0, -1).toString());
    };
    const resubscribe = () =>
      request("/api/v1/notifications/subscribe", user, "POST", {
        username: user.username,
        endpoint,
        keys: { p256dh: b64(receiverPublic), auth: b64(auth) },
      });
    return { endpoint, decrypt, resubscribe };
  }
  async function conversation(alice: Actor, bob: Actor) {
    const response = await request("/api/v1/conversations", alice, "POST", {
      peer: bob.account.id,
      clientOperationId: `${Date.now()}.${randomUUID()}`,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { conversation: { id: string } }).conversation.id;
  }
  async function send(alice: Actor, id: string, content: string) {
    const response = await request(`/api/v1/conversations/${id}/messages`, alice, "POST", {
      content,
      clientOperationId: `${Date.now()}.${randomUUID()}`,
    });
    expect(response.status).toBe(200);
  }
  async function sqliteFiles(): Promise<string[]> {
    async function visit(folder: string): Promise<string[]> {
      const result: string[] = [];
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) result.push(...(await visit(file)));
        else if (entry.name.endsWith(".sqlite")) result.push(file);
      }
      return result;
    }
    return visit(dir);
  }
  async function db<T>(fn: (db: DatabaseSync) => T): Promise<T> {
    for (const file of await sqliteFiles()) {
      const database = new DatabaseSync(file, { readOnly: true });
      try {
        if (
          database
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='push_deliveries'")
            .get()
        )
          return fn(database);
      } finally {
        database.close();
      }
    }
    throw new Error("Accounts database missing");
  }
  return {
    request,
    actor,
    subscription,
    conversation,
    send,
    deliveries,
    completed,
    responses,
    db,
    async connect(user: Actor) {
      const client = new TestIRCClient(`ws://${origin.host}/irc`);
      clients.push(client);
      await client.connect();
      client.send(`PASS ${user.username}:${user.password}`);
      await client.register(user.username);
      return client;
    },
    hold(url: string) {
      gateUrl = url;
      gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
    },
    release() {
      releaseGate?.();
      gateUrl = "";
    },
    async restart() {
      await mf.dispose();
      await start();
    },
    async alarm(endpoint: string) {
      const ns = await mf.getDurableObjectNamespace("ACCOUNTS");
      await (ns.get(ns.idFromName("FlaRC")) as any).testPushAlarm(endpoint);
    },
    async close() {
      releaseGate?.();
      for (const client of clients) client.close();
      await mf.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
