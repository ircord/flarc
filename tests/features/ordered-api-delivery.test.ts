import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

it("committed REST delivery retries a lost RPC acknowledgement in order without duplicating IRC or granting outsider access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flarc-ordered-delivery-"));
  const controlSecret = randomUUID();
  await cp(path.dirname(await ensureNitroBuilt()), path.join(directory, "production"), {
    recursive: true,
  });
  await writeFile(
    path.join(directory, "wrapper.mjs"),
    `
export { AccountsDO } from './production/index.mjs';
import original, { SessionDO as Session, ChannelDO as Channel } from './production/index.mjs';
export default { async fetch(request, env, ctx) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith('/__test_delivery/')) {
    if (request.headers.get('x-test-secret') !== env.TEST_DELIVERY_SECRET) return new Response('', {status:403});
    const session = env.SESSION.get(env.SESSION.idFromName('FlaRC'));
    if (pathname === '/__test_delivery/proof') return new Response(await session.deliveryProof());
    if (pathname === '/__test_delivery/release' && request.method === 'POST') {
      await session.releaseDeliveryAck(); return new Response('released');
    }
    return new Response('', {status:404});
  }
  return original.fetch(request, env, ctx);
}};
export class SessionDO extends Session {
  instanceId = crypto.randomUUID();
  async deliverApiMessage(channel, message, recipients, generation, sequence) {
    const attempts = (await this.ctx.storage.get('testDeliveryAttempts')) ?? 0;
    await this.ctx.storage.put('testDeliveryAttempts', attempts + 1);
    await super.deliverApiMessage(channel, message, recipients, generation, sequence);
    if (channel === '#orderedretry' && !(await this.ctx.storage.get('testDeliveryAckReleased'))) {
      await this.ctx.storage.put('testDeliveryAckFailed', true);
      throw new Error('Injected lost delivery acknowledgement');
    }
  }
  async releaseDeliveryAck() { await this.ctx.storage.put('testDeliveryAckReleased', true); }
  async deliveryProof() {
    return JSON.stringify({ instanceId: this.instanceId, sockets: this.ctx.getWebSockets().length, failed: await this.ctx.storage.get('testDeliveryAckFailed'), attempts: await this.ctx.storage.get('testDeliveryAttempts'), receipts: this.sql.exec("SELECT actor_id,result_json FROM feature_operations WHERE operation_id='irc-channel-delivery'").toArray() });
  }
}
export class ChannelDO extends Channel {
  async pauseDeliveryRetryAlarm() { await this.ctx.storage.deleteAlarm(); }
  deliveryProof() {
    return { messages: this.sql.exec('SELECT id,sequence,sender_id,content FROM messages ORDER BY sequence').toArray(), pending: this.sql.exec('SELECT kind FROM channel_feature_outbox').toArray() };
  }
}
`,
  );
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(directory, "wrapper.mjs"),
    modulesRoot: directory,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SIGNUP_POLICY: "open", TEST_DELIVERY_SECRET: controlSecret },
    durableObjectsPersist: path.join(directory, "state"),
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
  });
  const clients: TestIRCClient[] = [];
  try {
    const url = await mf.ready;
    // Short completed HTTP contexts avoid keeping a Node-side Miniflare RPC
    // proxy alive across the very eviction whose completion is under test.
    const proof = async () => {
      const response = await fetch(new URL("/__test_delivery/proof", url), {
        headers: { "x-test-secret": controlSecret },
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<any>;
    };
    const request = (route: string, token?: string, body?: unknown) =>
      fetch(new URL(route, url), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    async function actor(username: string) {
      const password = `Delivery-${randomUUID()}!`;
      expect(
        (await request("/api/v1/auth/register", undefined, { username, password })).status,
      ).toBe(201);
      const login = await request("/api/v1/auth/login", undefined, { username, password });
      expect(login.status).toBe(200);
      const { token, account } = (await login.json()) as any;
      const client = new TestIRCClient(`ws://${url.host}/irc`);
      clients.push(client);
      await client.connect();
      client.send(`PASS ${username}:${password}`);
      await client.register(username);
      client.send("CAP REQ :message-tags");
      await client.waitForLine((line) => line.includes(" ACK "));
      return { client, token, account };
    }
    const alice = await actor("alice"),
      bob = await actor("bob"),
      outsider = await actor("charlie");
    alice.client.send("JOIN #orderedretry");
    await alice.client.waitForNumeric(366);
    alice.client.send("MODE #orderedretry +s");
    await alice.client.waitForLine((line) => line.includes(" MODE #orderedretry +s"));
    bob.client.send("JOIN #orderedretry");
    await bob.client.waitForNumeric(366);
    const channelNS = await mf.getDurableObjectNamespace("CHANNELS");
    const channel = channelNS.get(channelNS.idFromName("FlaRC:#orderedretry")) as any;
    const before = await channel.deliveryProof();
    expect(
      (
        await request("/api/v1/channels/%23orderedretry/messages", outsider.token, {
          content: "forbidden-body",
        })
      ).status,
    ).toBe(403);
    expect(await channel.deliveryProof()).toEqual(before);
    const ids: string[] = [];
    for (const content of ["ordered-first", "ordered-second"]) {
      const delivered = bob.client.waitForNewLine((line) =>
        line.includes(` PRIVMSG #orderedretry :${content}`),
      );
      const response = await request("/api/v1/channels/%23orderedretry/messages", alice.token, {
        content,
      });
      expect(response.status).toBe(201);
      const message = ((await response.json()) as any).message;
      ids.push(message.id);
      expect(await delivered).toContain(`msgid=${message.id}`);
      if (content === "ordered-first") {
        // Pause only the injected failure retry wakeup; keep the durable intent.
        await channel.pauseDeliveryRetryAlarm();
        const beforeWake = await proof();
        expect(beforeWake.failed).toBe(true);
        expect(beforeWake.receipts).toHaveLength(1);
        // Keep the real sockets hibernated while the lost-ack receipt reloads
        // from SQLite; release only the test fault, never authorization state.
        await mf.unsafeEvictDurableObject("", "SessionDO", {
          name: "FlaRC",
          webSockets: "hibernate",
        });
        const afterWake = await proof();
        expect(afterWake.instanceId).not.toBe(beforeWake.instanceId);
        expect(afterWake.sockets).toBe(3);
        expect(afterWake.receipts).toEqual(beforeWake.receipts);
        const released = await fetch(new URL("/__test_delivery/release", url), {
          method: "POST",
          headers: { "x-test-secret": controlSecret },
        });
        expect(released.status).toBe(200);
        expect(await released.text()).toBe("released");
      }
    }
    for (const { client } of [alice, bob, outsider]) {
      const marker = randomUUID();
      const barrier = client.waitForNewLine(
        (line) => line.includes(" PONG ") && line.includes(marker),
      );
      client.send(`PING :${marker}`);
      await barrier;
    }
    const delivered = bob.client.lines.filter((line) =>
      line.includes(" PRIVMSG #orderedretry :ordered-"),
    );
    expect(delivered.map((line) => line.match(/msgid=([^; ]+)/)?.[1])).toEqual(ids);
    expect(outsider.client.lines.join("\n")).not.toContain("ordered-first");
    expect(outsider.client.lines.join("\n")).not.toContain("ordered-second");
    const state = await channel.deliveryProof();
    expect(state.pending).toEqual([]);
    expect(state.messages.map((message: any) => message.id)).toEqual(ids);
    expect(state.messages.every((message: any) => message.sender_id === alice.account.id)).toBe(
      true,
    );
    const finalProof = await proof();
    expect(finalProof.failed).toBe(true);
    expect(finalProof.attempts).toBeGreaterThanOrEqual(3);
    expect(finalProof.receipts).toHaveLength(1);
    expect(finalProof.receipts[0].actor_id).toBe("channel-irc:#orderedretry");
  } finally {
    for (const client of clients) client.close();
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
