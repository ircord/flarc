import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProtocolServer, TestIRCClient } from "../helpers/miniflare-harness";

let ADMIN_TOKEN = "super-secret-admin-token";

describe("CFCord Durability, Retention & Admin Controls (Miniflare)", () => {
  let _mf: Miniflare;
  let httpUrl: URL;
  let wsUrl: string;
  let dispose: () => Promise<void>;
  let _fixture: Awaited<ReturnType<typeof createProtocolServer>>;
  let request: Awaited<ReturnType<typeof createProtocolServer>>["request"];
  const clients: TestIRCClient[] = [];

  beforeEach(async () => {
    const srv = await createProtocolServer({
      bindings: { ADMIN_TOKEN },
    });
    _fixture = srv;
    request = srv.request;
    ADMIN_TOKEN = srv.adminToken;
    _mf = srv.mf;
    httpUrl = srv.url;
    wsUrl = srv.wsUrl;
    dispose = srv.dispose;
  });

  afterEach(async () => {
    for (const c of clients.splice(0, clients.length)) {
      c.close();
    }
    await dispose();
  });

  function makeClient(): TestIRCClient {
    const client = new TestIRCClient(wsUrl);
    clients.push(client);
    return client;
  }

  it("handles disconnect & reconnect cleanly, releasing nickname occupancy and preserving channel state", async () => {
    const alice1 = makeClient();
    const bob = makeClient();

    await alice1.connect();
    await bob.connect();
    await alice1.register("alice");
    await bob.register("bob");

    alice1.send("JOIN #durable");
    await alice1.waitForLine((l) => l.includes(" 366 ") && l.includes("#durable"));

    bob.send("JOIN #durable");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#durable"));

    alice1.send("TOPIC #durable :Persistent Topic Across Reconnects");
    await bob.waitForNewLine((l) =>
      l.includes(" TOPIC #durable :Persistent Topic Across Reconnects"),
    );

    // Alice quits
    const bobSeesQuit = bob.waitForNewLine(
      (l) => l.startsWith(":alice!") && l.includes(" QUIT :Quit: Going offline briefly"),
    );
    alice1.send("QUIT :Going offline briefly");
    await bobSeesQuit;

    // Alice reconnects and reclaims 'alice' nickname immediately
    const alice2 = makeClient();
    await alice2.connect();
    await alice2.register("alice");

    alice2.send("JOIN #durable");
    const topicLine = await alice2.waitForLine(
      (l) => l.includes(" 332 ") && l.includes("Persistent Topic Across Reconnects"),
    );
    expect(topicLine).toContain("Persistent Topic Across Reconnects");
  });

  it("exposes health, admin stats, channel inspection, and account revocation with live cache invalidation", async () => {
    // 1. Check /health
    const healthRes = await request(`${httpUrl.origin}/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { ok: boolean; service: string };
    expect(health.ok).toBe(true);
    expect(health.service).toBe("flarc");

    // 2. Register account and connect
    await request(`${httpUrl.origin}/api/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "eve",
        password: "evepassword123",
      }),
    });

    const eve = makeClient();
    const watcher = makeClient();
    await eve.connect();
    await watcher.connect();

    watcher.send("CAP REQ :account-notify");
    await watcher.waitForLine((l) => l.includes(" CAP * ACK "));
    watcher.send("CAP END");
    await watcher.register("watcher");

    eve.send("PASS eve:evepassword123");
    await eve.register("eve");

    eve.send("JOIN #sec");
    await eve.waitForLine((l) => l.includes(" 366 ") && l.includes("#sec"));
    watcher.send("JOIN #sec");
    await watcher.waitForLine((l) => l.includes(" 366 ") && l.includes("#sec"));

    // 3. Check /admin/stats
    const statsRes = await request(`${httpUrl.origin}/admin/stats`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const stats = (await statsRes.json()) as {
      ok: boolean;
      activeConnections: number;
      registeredSessions: number;
      activeChannels: number;
    };
    expect(stats.ok).toBe(true);
    expect(stats.registeredSessions).toBe(2);
    expect(stats.activeChannels).toBe(1);

    // 4. Check /admin/channels/%23sec
    const chanRes = await request(`${httpUrl.origin}/admin/channels/%23sec`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const chanData = (await chanRes.json()) as {
      ok: boolean;
      channel: { name: string; memberCount: number };
    };
    expect(chanData.ok).toBe(true);
    expect(chanData.channel.name).toBe("#sec");
    expect(chanData.channel.memberCount).toBe(2);

    // 5. Disable Eve's account via admin endpoint and verify live ACCOUNT * notification
    const watcherSeesLogout = watcher.waitForNewLine(
      (l) => l.startsWith(":eve!") && l.includes(" ACCOUNT *"),
    );
    const disableRes = await request(`${httpUrl.origin}/admin/accounts/disable`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({ username: "eve" }),
    });
    const disableData = (await disableRes.json()) as {
      ok: boolean;
      invalidatedSessions: number;
    };
    expect(disableData.ok).toBe(true);
    expect(disableData.invalidatedSessions).toBe(1);
    await watcherSeesLogout;
  });

  it("handles multiple concurrent clients and burst channel messages in deterministic sequence order", async () => {
    const sender = makeClient();
    const receiver1 = makeClient();
    const receiver2 = makeClient();

    await Promise.all([sender.connect(), receiver1.connect(), receiver2.connect()]);
    await Promise.all([
      sender.register("sender"),
      receiver1.register("rec1"),
      receiver2.register("rec2"),
    ]);

    for (const c of [sender, receiver1, receiver2]) {
      c.send("JOIN #burst");
      await c.waitForLine((l) => l.includes(" 366 ") && l.includes("#burst"));
    }

    const totalMessages = 15;
    for (let i = 1; i <= totalMessages; i++) {
      sender.send(`PRIVMSG #burst :Burst message #${i}`);
    }

    await receiver1.waitForLine((l) => l.includes(`Burst message #${totalMessages}`));
    await receiver2.waitForLine((l) => l.includes(`Burst message #${totalMessages}`));

    const r1Burst = receiver1.lines
      .filter((l) => l.includes("PRIVMSG #burst :Burst message #"))
      .map((l) => l.split("PRIVMSG #burst :")[1]);
    const r2Burst = receiver2.lines
      .filter((l) => l.includes("PRIVMSG #burst :Burst message #"))
      .map((l) => l.split("PRIVMSG #burst :")[1]);

    expect(r1Burst.length).toBe(totalMessages);
    expect(r1Burst).toEqual(r2Burst);
    expect(r1Burst[0]).toBe("Burst message #1");
    expect(r1Burst[totalMessages - 1]).toBe(`Burst message #${totalMessages}`);
  });
});
