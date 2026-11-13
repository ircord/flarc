import {
  createDecipheriv,
  createECDH,
  createHmac,
  generateKeyPairSync,
  randomUUID,
} from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const mac = (key: Uint8Array, value: Uint8Array) =>
  createHmac("sha256", key).update(value).digest();
const expand = (key: Uint8Array, info: Uint8Array, length: number) =>
  mac(key, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

async function persistedPushHandoff(directory: string) {
  const state: {
    intents: Array<{ event_id: string; account_id: string; accepted: number }>;
    accepted: Array<{ event_id: string; account_id: string }>;
  } = { intents: [], accepted: [] };
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!entry.name.endsWith(".sqlite")) continue;
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((row) => row.name);
        if (tables.includes("event_push_intents"))
          state.intents.push(
            ...(db
              .prepare("SELECT event_id,account_id,accepted FROM event_push_intents")
              .all() as typeof state.intents),
          );
        if (tables.includes("push_events"))
          state.accepted.push(
            ...(db
              .prepare("SELECT event_id,account_id FROM push_events")
              .all() as typeof state.accepted),
          );
      } finally {
        db.close();
      }
    }
  }
  await visit(directory);
  return state;
}

it.each(["without channel membership", "after channel membership"])(
  "delivers an encrypted private event only to the intended active subscription %s",
  async (membership) => {
    const dir = await mkdtemp(path.join(tmpdir(), "flarc-push-feature-"));
    const scriptPath = await ensureNitroBuilt();
    const receiver = createECDH("prime256v1"),
      receiverPublic = receiver.generateKeys(),
      outsiderReceiver = createECDH("prime256v1"),
      outsiderReceiverPublic = outsiderReceiver.generateKeys();
    const auth = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const outsiderAuth = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
    const vapid = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
      format: "jwk",
    });
    const publicKey = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(vapid.x!, "base64url"),
      Buffer.from(vapid.y!, "base64url"),
    ]);
    const delivered: Array<{ url: string; body: Buffer; authorization: string | null }> = [];
    const options = {
      modules: true,
      scriptPath,
      modulesRoot: path.dirname(scriptPath),
      compatibilityDate: "2025-02-04",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        SIGNUP_POLICY: "open",
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
        delivered.push({
          url: request.url,
          body: Buffer.from(await request.arrayBuffer()),
          authorization: request.headers.get("authorization"),
        });
        return new Response(null, { status: 201 });
      },
    };
    let mf = new Miniflare(options);
    let url = await mf.ready;
    const clients: TestIRCClient[] = [];
    const eventSockets: WebSocket[] = [];
    let disposed = false;
    try {
      const request = (route: string, token?: string, method = "GET", body?: unknown) =>
        fetch(new URL(route, url), {
          method,
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const actor = async (username: string) => {
        const password = `Pwd-${username}-${randomUUID()}!`;
        expect(
          (await request("/api/v1/auth/register", undefined, "POST", { username, password }))
            .status,
        ).toBe(201);
        const login = await request("/api/v1/auth/login", undefined, "POST", {
          username,
          password,
        });
        expect(login.status).toBe(200);
        return {
          username,
          password,
          ...((await login.json()) as { token: string; account: { id: string } }),
        };
      };
      const alice = await actor("alice"),
        bob = await actor("bob"),
        outsider = await actor("charlie");
      const connectClients = async () => {
        for (const account of [alice, bob, outsider]) {
          const client = new TestIRCClient(`ws://${url.host}/irc`);
          clients.push(client);
          await client.connect();
          client.send(`PASS ${account.username}:${account.password}`);
          await client.register(account.username);
        }
      };
      await connectClients();
      if (membership === "after channel membership") {
        const room = await request("/api/v1/channels", alice.token, "POST", {
          name: "#before-push",
          privacy: "secret",
        });
        expect(room.status).toBe(201);
      }
      const create = await request("/api/v1/conversations", alice.token, "POST", {
        peer: bob.account.id,
        clientOperationId: `${Date.now()}.${randomUUID()}`,
      });
      expect(create.status).toBe(200);
      const { conversation } = (await create.json()) as { conversation: { id: string } };
      const subscription = {
        username: "bob",
        endpoint: "https://push.example.com/bob",
        keys: { p256dh: b64(receiverPublic), auth: b64(auth) },
      };
      expect(
        (await request("/api/v1/notifications/subscribe", bob.token, "POST", subscription)).status,
      ).toBe(200);
      const denied = await request(
        "/api/v1/notifications/subscribe",
        outsider.token,
        "POST",
        subscription,
      );
      expect(denied.status).toBe(403);
      const outsiderSubscription = {
        username: "charlie",
        endpoint: "https://push.example.com/charlie",
        keys: { p256dh: b64(outsiderReceiverPublic), auth: b64(outsiderAuth) },
      };
      expect(
        (
          await request(
            "/api/v1/notifications/subscribe",
            outsider.token,
            "POST",
            outsiderSubscription,
          )
        ).status,
      ).toBe(200);
      const frames: string[][] = [[], []];
      const connectEventStreams = async () => {
        for (const [index, account] of [bob, outsider].entries()) {
          const ticketResponse = await request("/api/v1/auth/events-ticket", account.token, "POST");
          expect(ticketResponse.status).toBe(200);
          const { ticket } = (await ticketResponse.json()) as { ticket: string };
          const socket = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${ticket}`);
          eventSockets.push(socket);
          socket.on("message", (data) => frames[index].push(data.toString()));
          await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
          });
        }
      };
      await connectEventStreams();
      const assertEventStreamsLive = async () => {
        const eventBarriers = eventSockets.map(() => randomUUID());
        for (const [index, socket] of eventSockets.entries())
          socket.send(JSON.stringify({ type: "bootstrap", requestId: eventBarriers[index] }));
        const barrierDeadline = Date.now() + 15000;
        while (
          !eventBarriers.every((marker, index) =>
            frames[index].some((frame) => frame.includes(marker)),
          ) &&
          Date.now() < barrierDeadline
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        expect(
          eventBarriers.every((marker, index) =>
            frames[index].some((frame) => frame.includes(marker)),
          ),
        ).toBe(true);
      };
      const reconnect = async () => {
        for (const socket of eventSockets.splice(0)) socket.terminate();
        for (const client of clients.splice(0)) client.close();
        await mf.dispose();
        mf = new Miniflare(options);
        url = await mf.ready;
        await connectClients();
        await connectEventStreams();
      };
      const message = await request(
        `/api/v1/conversations/${conversation.id}/messages`,
        alice.token,
        "POST",
        {
          content: "encrypted-notification-secret",
          clientOperationId: `${Date.now()}.${randomUUID()}`,
        },
      );
      expect(message.status).toBe(200);
      const decrypt = (
        body: Buffer,
        recipient = receiver,
        recipientPublicKey = receiverPublic,
        recipientAuth = auth,
      ) => {
        const senderPublic = body.subarray(21, 86),
          shared = recipient.computeSecret(senderPublic);
        const ikm = expand(
          mac(recipientAuth, shared),
          Buffer.concat([Buffer.from("WebPush: info\0"), recipientPublicKey, senderPublic]),
          32,
        );
        const prk = mac(body.subarray(0, 16), ikm),
          key = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
          nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
        const ciphertext = body.subarray(86),
          decipher = createDecipheriv("aes-128-gcm", key, nonce);
        decipher.setAuthTag(ciphertext.subarray(-16));
        const clear = Buffer.concat([
          decipher.update(ciphertext.subarray(0, -16)),
          decipher.final(),
        ]);
        expect(clear.at(-1)).toBe(2);
        return JSON.parse(clear.subarray(0, -1).toString());
      };
      const deadline = Date.now() + 15000;
      while (
        !delivered.some((item) => decrypt(item.body).type === "conversation.message_created") &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      const actual = delivered.find(
        (item) => decrypt(item.body).type === "conversation.message_created",
      );
      expect(actual).toBeDefined();
      expect(
        delivered.every(
          (item) =>
            item.url === subscription.endpoint && item.authorization?.startsWith("vapid t="),
        ),
      ).toBe(true);
      expect(delivered.some((item) => item.url === outsiderSubscription.endpoint)).toBe(false);
      expect(actual!.body.includes(Buffer.from("encrypted-notification-secret"))).toBe(false);
      expect(decrypt(actual!.body)).toMatchObject({
        type: "conversation.message_created",
        conversationId: conversation.id,
      });
      while (
        !frames[0].some((frame) => frame.includes("encrypted-notification-secret")) &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(frames[0].join("\n")).toContain("encrypted-notification-secret");
      await assertEventStreamsLive();
      expect(frames[1].join("\n")).not.toContain("encrypted-notification-secret");
      const barrier = randomUUID();
      const pong = clients[2].waitForNewLine(
        (line) => line.includes(" PONG ") && line.includes(barrier),
      );
      clients[2].send(`PING :${barrier}`);
      await pong;
      expect(clients[2].lines.join("\n")).not.toContain("encrypted-notification-secret");
      await reconnect();
      expect(
        (
          (await (
            await request("/api/v1/notifications/subscriptions?username=bob", bob.token)
          ).json()) as any
        ).endpoints,
      ).toEqual([subscription.endpoint]);
      expect(
        (
          (await (
            await request("/api/v1/notifications/subscriptions?username=charlie", outsider.token)
          ).json()) as any
        ).endpoints,
      ).toEqual([outsiderSubscription.endpoint]);
      await assertEventStreamsLive();
      const restartedSecret = "encrypted-after-restart-intended-secret";
      const restartedMessage = await request(
        `/api/v1/conversations/${conversation.id}/messages`,
        alice.token,
        "POST",
        { content: restartedSecret, clientOperationId: `${Date.now()}.${randomUUID()}` },
      );
      expect(restartedMessage.status).toBe(200);
      const intendedDeadline = Date.now() + 15000;
      while (
        !delivered.some(
          (item) =>
            item.url === subscription.endpoint &&
            JSON.stringify(decrypt(item.body)).includes(restartedSecret),
        ) &&
        Date.now() < intendedDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      const intendedDelivery = delivered.find(
        (item) =>
          item.url === subscription.endpoint &&
          JSON.stringify(decrypt(item.body)).includes(restartedSecret),
      );
      expect(intendedDelivery).toBeDefined();
      expect(decrypt(intendedDelivery!.body)).toMatchObject({
        type: "conversation.message_created",
        conversationId: conversation.id,
      });
      expect(intendedDelivery!.body.includes(Buffer.from(restartedSecret))).toBe(false);
      const intendedEventDeadline = Date.now() + 15000;
      while (
        !frames[0].some((frame) => frame.includes(restartedSecret)) &&
        Date.now() < intendedEventDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(frames[0].join("\n")).toContain(restartedSecret);
      expect(
        delivered
          .filter((item) => item.url === outsiderSubscription.endpoint)
          .every(
            (item) =>
              !JSON.stringify(
                decrypt(item.body, outsiderReceiver, outsiderReceiverPublic, outsiderAuth),
              ).includes(restartedSecret),
          ),
      ).toBe(true);
      expect(frames[1].join("\n")).not.toContain(restartedSecret);
      const unrelatedConversationResponse = await request(
        "/api/v1/conversations",
        alice.token,
        "POST",
        {
          peer: outsider.account.id,
          clientOperationId: `${Date.now()}.${randomUUID()}`,
        },
      );
      expect(unrelatedConversationResponse.status).toBe(200);
      const unrelatedConversation = ((await unrelatedConversationResponse.json()) as any)
        .conversation.id as string;
      const unrelatedControlSecret = "encrypted-after-restart-unrelated-control";
      const unrelatedMessage = await request(
        `/api/v1/conversations/${unrelatedConversation}/messages`,
        alice.token,
        "POST",
        {
          content: unrelatedControlSecret,
          clientOperationId: `${Date.now()}.${randomUUID()}`,
        },
      );
      expect(unrelatedMessage.status).toBe(200);
      const unrelatedDeadline = Date.now() + 15000;
      while (
        !delivered.some(
          (item) =>
            item.url === outsiderSubscription.endpoint &&
            JSON.stringify(
              decrypt(item.body, outsiderReceiver, outsiderReceiverPublic, outsiderAuth),
            ).includes(unrelatedControlSecret),
        ) &&
        Date.now() < unrelatedDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      const unrelatedDelivery = delivered.find(
        (item) =>
          item.url === outsiderSubscription.endpoint &&
          JSON.stringify(
            decrypt(item.body, outsiderReceiver, outsiderReceiverPublic, outsiderAuth),
          ).includes(unrelatedControlSecret),
      );
      expect(unrelatedDelivery).toBeDefined();
      expect(
        decrypt(unrelatedDelivery!.body, outsiderReceiver, outsiderReceiverPublic, outsiderAuth),
      ).toMatchObject({
        type: "conversation.message_created",
        conversationId: unrelatedConversation,
      });
      expect(unrelatedDelivery!.authorization).toMatch(/^vapid t=/);
      expect(unrelatedDelivery!.body.includes(Buffer.from(unrelatedControlSecret))).toBe(false);
      const outsiderEventDeadline = Date.now() + 15000;
      while (
        !frames[1].some((frame) => frame.includes(unrelatedControlSecret)) &&
        Date.now() < outsiderEventDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(frames[1].join("\n")).toContain(unrelatedControlSecret);
      expect(
        delivered
          .filter((item) => item.url === subscription.endpoint)
          .every((item) => !JSON.stringify(decrypt(item.body)).includes(unrelatedControlSecret)),
      ).toBe(true);
      expect(frames[0].join("\n")).not.toContain(unrelatedControlSecret);
      expect(frames[1].join("\n")).toContain(unrelatedControlSecret);
      const postRestartBarrier = randomUUID();
      const postRestartPong = clients[2].waitForNewLine(
        (line) => line.includes(" PONG ") && line.includes(postRestartBarrier),
      );
      clients[2].send(`PING :${postRestartBarrier}`);
      await postRestartPong;
      expect(clients[2].lines.join("\n")).not.toContain(restartedSecret);
      if (membership === "after channel membership") {
        for (const socket of eventSockets) socket.terminate();
        for (const client of clients) client.close();
        await mf.dispose();
        disposed = true;
        const state = await persistedPushHandoff(dir);
        const membershipIntents = state.intents.filter(
          (row) => row.event_id.startsWith("membership:") && row.event_id.length > 128,
        );
        expect(membershipIntents.length).toBeGreaterThan(0);
        for (const intent of membershipIntents) {
          expect(intent.accepted).toBe(1);
          expect(intent.account_id).toBe(alice.account.id);
          expect(state.accepted).toContainEqual({
            event_id: intent.event_id,
            account_id: intent.account_id,
          });
        }
      }
    } finally {
      for (const socket of eventSockets) socket.terminate();
      for (const client of clients) client.close();
      if (!disposed) await mf.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  },
  45000,
);
