import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProtocolServer, TestIRCClient } from "../helpers/miniflare-harness";

let ADMIN_TOKEN = "super-secret-admin-token";

describe("FlaRC Administration REST API & F Bot Integration", () => {
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

  function adminHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    };
  }

  it("enforces authentication and provides full account lifecycle management", async () => {
    // 1. Unauthorized request without token
    const unauthRes = await mf.dispatchFetch(`${httpUrl.origin}/admin/accounts`);
    expect(unauthRes.status).toBe(401);

    // 2. Authorized request using X-Admin-Token header
    const authRes = await request(`${httpUrl.origin}/admin/accounts`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(authRes.status).toBe(200);

    // 3. Register a new user via admin endpoint
    const regRes = await request(`${httpUrl.origin}/admin/accounts`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        username: "adminuser",
        password: "securepassword123",
        displayName: "Admin User",
        roles: ["admin", "moderator"],
      }),
    });
    expect(regRes.status).toBe(201);
    const regData = (await regRes.json()) as any;
    expect(regData.ok).toBe(true);
    expect(regData.account.username).toBe("adminuser");

    // 4. Get account details
    const getRes = await request(`${httpUrl.origin}/admin/accounts/adminuser`, {
      headers: adminHeaders(),
    });
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as any;
    expect(getData.ok).toBe(true);
    expect(getData.account.displayName).toBe("Admin User");
    expect(getData.account.roles).toContain("admin");
    expect(getData.account.disabled).toBe(false);

    // 5. Update account details (PATCH)
    const patchRes = await request(`${httpUrl.origin}/admin/accounts/adminuser`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({
        displayName: "Super Administrator",
        roles: ["admin", "operator", "root"],
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchData = (await patchRes.json()) as any;
    expect(patchData.account.displayName).toBe("Super Administrator");
    expect(patchData.account.roles).toContain("root");

    // 6. Reset password
    const pwRes = await request(`${httpUrl.origin}/admin/accounts/adminuser/password`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ password: "newsuperpassword456" }),
    });
    expect(pwRes.status).toBe(200);

    // 7. Disable account & re-enable
    const disRes = await request(`${httpUrl.origin}/admin/accounts/adminuser/disable`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(disRes.status).toBe(200);

    const getDis = await request(`${httpUrl.origin}/admin/accounts/adminuser`, {
      headers: adminHeaders(),
    });
    const disData = (await getDis.json()) as any;
    expect(disData.account.disabled).toBe(true);

    const enRes = await request(`${httpUrl.origin}/admin/accounts/adminuser/enable`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(enRes.status).toBe(200);

    // 8. Delete account
    const delRes = await request(`${httpUrl.origin}/admin/accounts/adminuser`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(delRes.status).toBe(200);

    const getAfterDel = await request(`${httpUrl.origin}/admin/accounts/adminuser`, {
      headers: adminHeaders(),
    });
    expect(getAfterDel.status).toBe(404);
  });

  it("manages channels, bot F settings, and delivers welcome greeting upon user join", async () => {
    await request(`${httpUrl.origin}/admin/accounts`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ username: "netadmin", password: "netadmin-account-password" }),
    });
    // 1. Admin registers channel #flare
    const regChanRes = await request(`${httpUrl.origin}/admin/channels/%23flare/register`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ founder: "netadmin" }),
    });
    expect(regChanRes.status).toBe(200);

    // 2. Configure F bot welcome greeting via REST API
    const botRes = await request(`${httpUrl.origin}/admin/channels/%23flare/bot`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        enabled: true,
        welcomeMessage: "Welcome to #flare! Enjoy your stay on FlaRC.",
      }),
    });
    expect(botRes.status).toBe(200);
    const botData = (await botRes.json()) as any;
    expect(botData.bot.enabled).toBe(true);
    expect(botData.bot.welcomeMessage).toContain("Welcome to #flare");

    // 3. Admin sets topic
    const topicRes = await request(`${httpUrl.origin}/admin/channels/%23flare/topic`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ topic: "Official FlaRC Channel" }),
    });
    expect(topicRes.status).toBe(200);

    // 4. Verify channel full details via REST API
    const detailsRes = await request(`${httpUrl.origin}/admin/channels/%23flare`, {
      headers: adminHeaders(),
    });
    expect(detailsRes.status).toBe(200);
    const details = (await detailsRes.json()) as any;
    expect(details.channel.registered).toBe(true);
    expect(details.channel.founder).toBe("netadmin");
    expect(details.channel.topic).toBe("Official FlaRC Channel");
    expect(details.channel.bot.enabled).toBe(true);

    // 5. User joins channel #flare via IRC
    const alice = makeClient();
    await alice.connect();
    await alice.register("alice");

    alice.send("JOIN #flare");

    // Client should see F bot in names list
    const namesLine = await alice.waitForLine((l) => l.includes(" 353 ") && l.includes("#flare"));
    expect(namesLine).toMatch(/~F|@F/);

    // Client should receive the welcome notice from F
    const welcomeLine = await alice.waitForLine(
      (l) =>
        l.startsWith(":F!services@") && l.includes("NOTICE alice :[#flare] Welcome to #flare!"),
    );
    expect(welcomeLine).toContain("Enjoy your stay on FlaRC.");

    // 6. Admin kicks user via REST API
    const kickRes = await request(`${httpUrl.origin}/admin/channels/%23flare/kick`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ nickname: "alice", reason: "Administrative maintenance" }),
    });
    expect(kickRes.status).toBe(200);

    // 7. Admin purges messages
    const purgeRes = await request(`${httpUrl.origin}/admin/channels/%23flare/messages/purge`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ all: true }),
    });
    expect(purgeRes.status).toBe(200);
  });

  it("broadcasts live metadata 3 updates to clients when set via REST API", async () => {
    const bob = makeClient();
    await bob.connect();

    // Negotiate draft/metadata-3
    bob.send("CAP REQ :draft/metadata-3");
    await bob.waitForLine((l) => l.includes("CAP * ACK :draft/metadata-3"));
    bob.send("CAP END");
    bob.send("NICK bob");
    bob.send("USER bob 0 * :Bob The Builder");
    await bob.waitForLine((l) => l.includes(" 001 "));

    // Subscribe to all metadata keys (target: *, subcmd: SUB, keys: *)
    bob.send("METADATA * SUB *");
    await bob.waitForLine((l) => l.includes(" 770 ") || l.includes(" 766 ") || l.includes(" 762 "));

    // 1. Admin sets user metadata via REST API
    const setMetaRes = await request(`${httpUrl.origin}/admin/metadata/users/bob`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({
        key: "avatar",
        value: "https://flarc.chat/avatars/bob.png",
      }),
    });
    expect(setMetaRes.status).toBe(200);

    // Bob receives real-time 761 RPL_KEYVALUE without having issued any IRC METADATA SET command!
    const metaEvent = await bob.waitForLine(
      (l) =>
        l.includes(" 761 ") &&
        l.includes("avatar") &&
        l.includes("https://flarc.chat/avatars/bob.png"),
    );
    expect(metaEvent).toContain("bob avatar * https://flarc.chat/avatars/bob.png");

    // 2. Admin retrieves metadata via REST API
    const getMetaRes = await request(`${httpUrl.origin}/admin/metadata/users/bob`, {
      headers: adminHeaders(),
    });
    expect(getMetaRes.status).toBe(200);
    const getMetaData = (await getMetaRes.json()) as any;
    expect(getMetaData.metadata.avatar).toBe("https://flarc.chat/avatars/bob.png");

    // 3. Admin deletes metadata via REST API
    const delMetaRes = await request(`${httpUrl.origin}/admin/metadata/users/bob/avatar`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(delMetaRes.status).toBe(200);

    // Bob receives real-time 766 RPL_KEYNOTSET announcing the key removal
    const unsetEvent = await bob.waitForLine((l) => l.includes(" 766 ") && l.includes("avatar"));
    expect(unsetEvent).toContain("avatar");
  });

  it("supports F bot QuakeNet-compatible IRC commands (HELP, AUTH, OP, VOICE, STATUS, UNREQUESTBOT)", async () => {
    // 1. Pre-register account for testing AUTH
    await request(`${httpUrl.origin}/admin/accounts`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ username: "quaker", password: "quakesecretpassword" }),
    });

    const user = makeClient();
    await user.connect();
    await user.register("guest_quaker");

    // 2. User messages F HELP
    user.send("PRIVMSG F :HELP");
    const helpLine = await user.waitForLine(
      (l) => l.startsWith(":F!services@") && l.includes("FlareServ (F) Channel Service Bot"),
    );
    expect(helpLine).toContain("FlareServ");

    // 3. User authenticates via F AUTH
    user.send("PRIVMSG F :AUTH quaker quakesecretpassword");
    const authNotice = await user.waitForLine(
      (l) => l.startsWith(":F!services@") && l.includes("AUTH successful"),
    );
    expect(authNotice).toContain("quaker");

    // Now switch nickname to registered nick
    user.send("NICK quaker");
    await user.waitForLine((l) => l.includes("NICK :quaker") || l.includes("quaker"));

    // 4. Register channel #quakeroom via ChanServ
    user.send("JOIN #quakeroom");
    await user.waitForLine((l) => l.includes(" 366 ") && l.includes("#quakeroom"));
    user.send("CS REGISTER #quakeroom");
    await user.waitForLine((l) => l.includes("ChanServ!") && l.includes("successfully registered"));

    // 5. Query F STATUS
    user.send("PRIVMSG F :STATUS #quakeroom");
    const statusLine = await user.waitForLine(
      (l) => l.startsWith(":F!services@") && l.includes("Status for channel #quakeroom"),
    );
    expect(statusLine).toContain("Status for channel #quakeroom");

    // 6. User de-ops self, then uses F OP to regain op
    user.send("MODE #quakeroom -o quaker");
    await user.waitForLine((l) => l.includes("MODE #quakeroom -o quaker"));

    user.send("PRIVMSG F :OP #quakeroom quaker");
    const opLine = await user.waitForLine(
      (l) => l.startsWith(":F!services@") && l.includes("MODE #quakeroom +o quaker"),
    );
    expect(opLine).toContain("+o quaker");

    // 7. Request F to leave channel via UNREQUESTBOT
    user.send("PRIVMSG F :UNREQUESTBOT #quakeroom");
    const partLine = await user.waitForLine(
      (l) => l.startsWith(":F!services@") && l.includes("PART #quakeroom"),
    );
    expect(partLine).toContain("Requested by quaker");

    // 8. Request F to rejoin via REQUESTBOT
    user.send("PRIVMSG F :REQUESTBOT #quakeroom");
    const rejoinLine = await user.waitForLine(
      (l) => l.startsWith(":F!services@") && l.includes("JOIN #quakeroom"),
    );
    expect(rejoinLine).toContain("JOIN #quakeroom");

    // 9. Verify kicking F is prohibited
    user.send("KICK #quakeroom F :bye bot");
    const kickErr = await user.waitForLine(
      (l) => l.includes(" 484 ") || l.includes("Cannot kick") || l.includes("service bots"),
    );
    expect(kickErr).toContain("484");
  });

  it("manages live sessions and broadcasts network announcements", async () => {
    const user1 = makeClient();
    await user1.connect();
    await user1.register("tester1");

    // 1. List sessions via REST API
    const sessRes = await request(`${httpUrl.origin}/admin/sessions`, {
      headers: adminHeaders(),
    });
    expect(sessRes.status).toBe(200);
    const sessData = (await sessRes.json()) as any;
    expect(sessData.sessions.some((s: any) => s.nickname === "tester1")).toBe(true);

    // 2. Broadcast network announcement via REST API
    const bcastRes = await request(`${httpUrl.origin}/admin/broadcast`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ message: "Network maintenance at midnight UTC" }),
    });
    expect(bcastRes.status).toBe(200);

    const bcastLine = await user1.waitForLine(
      (l) => l.includes("NOTICE") && l.includes("Network maintenance at midnight UTC"),
    );
    expect(bcastLine).toContain("Network maintenance at midnight UTC");

    // 3. Disconnect user via REST API
    const dcRes = await request(`${httpUrl.origin}/admin/sessions/disconnect`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ nickname: "tester1", reason: "Administrative test disconnect" }),
    });
    expect(dcRes.status).toBe(200);

    const errorLine = await user1.waitForLine((l) => l.includes("ERROR :Closing Link"));
    expect(errorLine).toContain("Administrative test disconnect");
  });

  it("enforces role management, webhook op permissions, and exposes non-secret public health/status", async () => {
    // 1. Public health and status are accessible without any authentication
    const healthRes = await request(`${httpUrl.origin}/health`);
    expect(healthRes.status).toBe(200);
    const healthData = (await healthRes.json()) as any;
    expect(healthData.ok).toBe(true);
    expect(healthData.service).toBe("flarc");
    expect(healthData.adminToken).toBeUndefined();

    const statusRes = await request(`${httpUrl.origin}/status`);
    expect(statusRes.status).toBe(200);
    const statusData = (await statusRes.json()) as any;
    expect(statusData.ok).toBe(true);
    expect(statusData.status).toBe("healthy");
    expect(statusData.adminToken).toBeUndefined();

    // 2. Role grant and revoke via Admin API
    const regRes = await request(`${httpUrl.origin}/admin/accounts`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        username: "moduser",
        password: "password123",
      }),
    });
    expect(regRes.status).toBe(201);

    const grantRes = await request(`${httpUrl.origin}/admin/accounts/moduser/roles`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ role: "admin", action: "grant" }),
    });
    expect(grantRes.status).toBe(200);

    const rolesRes = await request(`${httpUrl.origin}/admin/accounts/moduser/roles`, {
      headers: adminHeaders(),
    });
    expect(rolesRes.status).toBe(200);
    const rolesData = (await rolesRes.json()) as any;
    expect(rolesData.roles).toContain("admin");

    // 3. Webhooks are restricted to channel owners/operators
    // An unauthenticated request to create webhooks should be rejected (401)
    const unauthHookRes = await mf.dispatchFetch(
      `${httpUrl.origin}/api/v1/channels/%23priv/webhooks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Rogue Hook" }),
      },
    );
    expect(unauthHookRes.status).toBe(401);

    // A regular user who is not owner/op should be rejected (403)
    const regUserRes = await request(`${httpUrl.origin}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "regularjoe", password: "password123" }),
    });
    expect(regUserRes.status).toBe(201);

    const forbiddenHookRes = await request(`${httpUrl.origin}/api/v1/channels/%23priv/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await fixture.login("regularjoe", "password123")}`,
      },
      body: JSON.stringify({ name: "Unauthorized Hook" }),
    });
    expect(forbiddenHookRes.status).toBe(403);

    // Channel founder/owner or Admin CAN configure webhooks
    const adminHookRes = await request(`${httpUrl.origin}/api/v1/channels/%23priv/webhooks`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Admin Hook" }),
    });
    expect(adminHookRes.status).toBe(201);
  });
});
