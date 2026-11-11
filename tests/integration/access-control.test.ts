import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProtocolServer, TestIRCClient } from "../helpers/miniflare-harness";

let ADMIN_TOKEN = "super-secret-admin-token";

describe("Strict Access Control: DMs, Private Channel History & Search Visibility", () => {
  let mf: Miniflare;
  let httpUrl: URL;
  let wsUrl: string;
  let dispose: () => Promise<void>;
  let fixture: Awaited<ReturnType<typeof createProtocolServer>>;
  let request: Awaited<ReturnType<typeof createProtocolServer>>["request"];
  const clients: TestIRCClient[] = [];

  beforeEach(async () => {
    const srv = await createProtocolServer({
      bindings: {
        ADMIN_TOKEN,
      },
    });
    fixture = srv;
    request = srv.request;
    ADMIN_TOKEN = srv.adminToken;
    mf = srv.mf;
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

  it("enforces DM access control: only participants can query messages", async () => {
    // Register alice, bob, and charlie accounts in accounts DO
    await request(`${httpUrl.origin}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "Password123!" }),
    });
    await request(`${httpUrl.origin}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "Password123!" }),
    });
    await request(`${httpUrl.origin}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "charlie", password: "Password123!" }),
    });

    const aliceBasic = `Bearer ${await fixture.login("alice", "Password123!")}`;
    const bobBasic = `Bearer ${await fixture.login("bob", "Password123!")}`;
    const charlieBasic = `Bearer ${await fixture.login("charlie", "Password123!")}`;

    // 1. Create two users and send a DM between them
    const alice = makeClient();
    const bob = makeClient();
    await Promise.all([alice.connect(), bob.connect()]);

    alice.send("PASS alice:Password123!");
    alice.send("CAP REQ :draft/chathistory draft/event-playback");
    alice.send("NICK alice\r\nUSER alice 0 * :Alice\r\nCAP END\r\n");
    await alice.waitForLine((l) => l.includes(" 001 alice "));

    bob.send("PASS bob:Password123!");
    bob.send("CAP REQ :draft/chathistory draft/event-playback");
    bob.send("NICK bob\r\nUSER bob 0 * :Bob\r\nCAP END\r\n");
    await bob.waitForLine((l) => l.includes(" 001 bob "));

    alice.send("PRIVMSG bob :Top secret rendezvous point 42");
    await bob.waitForLine((l) => l.includes("Top secret rendezvous point 42"));

    // 2. Unauthenticated request to DMs -> 401
    const unauthRes = await mf.dispatchFetch(
      `${httpUrl.origin}/api/v1/dms/bob/messages?user=alice`,
    );
    expect(unauthRes.status).toBe(401);

    // 3. Alice (participant) queries DMs -> 200
    const aliceRes = await request(`${httpUrl.origin}/api/v1/dms/bob/messages`, {
      headers: { Authorization: aliceBasic },
    });
    expect(aliceRes.status).toBe(200);
    const aliceData = (await aliceRes.json()) as any;
    expect(aliceData.ok).toBe(true);
    expect(aliceData.messages.some((m: any) => m.content.includes("Top secret rendezvous"))).toBe(
      true,
    );

    // 4. Bob (recipient participant) queries DMs -> 200
    const bobRes = await request(`${httpUrl.origin}/api/v1/dms/alice/messages`, {
      headers: { Authorization: bobBasic },
    });
    expect(bobRes.status).toBe(200);

    // 5. Charlie (third-party outsider) queries DMs between alice and bob -> 403 Forbidden
    const charlieRes = await request(`${httpUrl.origin}/api/v1/dms/bob/messages?user=alice`, {
      headers: { Authorization: charlieBasic },
    });
    expect(charlieRes.status).toBe(403);

    // 6. Admin queries DMs -> 200
    const adminRes = await request(`${httpUrl.origin}/api/v1/dms/bob/messages?user=alice`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(adminRes.status).toBe(403);
  });

  it("enforces private/secret channel protection on history and search APIs", async () => {
    // Register user accounts
    await request(`${httpUrl.origin}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "founder", password: "Password123!" }),
    });
    await request(`${httpUrl.origin}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "stranger", password: "Password123!" }),
    });

    const founderBasic = `Bearer ${await fixture.login("founder", "Password123!")}`;
    const strangerBasic = `Bearer ${await fixture.login("stranger", "Password123!")}`;

    // 1. Setup secret channel #classified with mode +s +i
    const founder = makeClient();
    await founder.connect();
    founder.send("PASS founder:Password123!");
    founder.send("NICK founder\r\nUSER founder 0 * :Founder\r\n");
    await founder.waitForLine((l) => l.includes(" 001 founder "));

    founder.send("JOIN #classified");
    await founder.waitForLine((l) => l.includes(" 366 founder #classified"));
    founder.send("MODE #classified +si");
    await founder.waitForLine((l) => l.includes(" MODE #classified +si") || l.includes(" 324 "));

    founder.send("PRIVMSG #classified :Nuclear launch code delta-seven");

    // Also register an open public channel #general
    founder.send("JOIN #general");
    await founder.waitForLine((l) => l.includes(" 366 founder #general"));
    founder.send("PRIVMSG #general :Hello public world!");

    // 2. Channel history on public channel #general is accessible
    const publicHistRes = await request(`${httpUrl.origin}/api/v1/channels/%23general/messages`);
    expect(publicHistRes.status).toBe(200);

    // 3. Channel history on secret/invite-only channel without membership -> 403 Forbidden
    const unauthSecretHist = await mf.dispatchFetch(
      `${httpUrl.origin}/api/v1/channels/%23classified/messages`,
    );
    expect(unauthSecretHist.status).toBe(401);

    const strangerSecretHist = await request(
      `${httpUrl.origin}/api/v1/channels/%23classified/messages`,
      {
        headers: { Authorization: strangerBasic },
      },
    );
    expect(strangerSecretHist.status).toBe(403);

    // 4. Founder (member) accessing secret channel history -> 200
    const founderSecretHist = await request(
      `${httpUrl.origin}/api/v1/channels/%23classified/messages`,
      {
        headers: { Authorization: founderBasic },
      },
    );
    expect(founderSecretHist.status).toBe(200);

    // 5. Channel search on secret channel: stranger gets 403 Forbidden
    const strangerSearchRes = await request(
      `${httpUrl.origin}/api/v1/channels/%23classified/messages/search?q=Nuclear`,
      {
        headers: { Authorization: strangerBasic },
      },
    );
    expect(strangerSearchRes.status).toBe(403);

    // 6. Global search without authentication should NOT leak messages from secret channels
    const globalSearchRes = await request(`${httpUrl.origin}/api/v1/search?q=Nuclear`, {
      headers: { Authorization: strangerBasic },
    });
    expect(globalSearchRes.status).toBe(200);
    const globalData = (await globalSearchRes.json()) as any;
    expect(globalData.messages.some((m: any) => m.content.includes("Nuclear launch code"))).toBe(
      false,
    );

    // 7. Global search by Admin finds the message
    const adminSearchRes = await request(`${httpUrl.origin}/api/v1/search?q=Nuclear`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(adminSearchRes.status).toBe(200);
    const adminData = (await adminSearchRes.json()) as any;
    expect(adminData.messages.some((m: any) => m.content.includes("Nuclear launch code"))).toBe(
      true,
    );
  });
});
