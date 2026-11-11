import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProtocolServer, TestIRCClient } from "../helpers/miniflare-harness";

let ADMIN_TOKEN = "super-secret-admin-token";

describe("IRCord Edit Protocol, FTS5 Search & Incoming Webhooks", () => {
  let url: URL;
  let wsUrl: string;
  let dispose: () => Promise<void>;
  let fixture: Awaited<ReturnType<typeof createProtocolServer>>;
  let request: Awaited<ReturnType<typeof createProtocolServer>>["request"];
  const clients: TestIRCClient[] = [];

  beforeEach(async () => {
    const srv = await createProtocolServer({
      bindings: { ADMIN_TOKEN, OUTGOING_WEBHOOK_ALLOWED_HOSTS: "example.com" },
    });
    fixture = srv;
    request = srv.request;
    ADMIN_TOKEN = srv.adminToken;
    url = srv.url;
    wsUrl = srv.wsUrl;
    dispose = srv.dispose;
  });

  afterEach(async () => {
    for (const c of clients.splice(0, clients.length)) {
      c.close();
    }
    if (dispose) await dispose();
  });

  function makeClient(): TestIRCClient {
    const client = new TestIRCClient(wsUrl);
    clients.push(client);
    return client;
  }

  it("supports IRCord message editing protocol (+ircord/edit) and ISUPPORT CLIENTTAGDENY", async () => {
    const clientA = makeClient();
    const clientB = makeClient();
    await clientA.connect();
    await clientB.connect();

    // 1. Verify ISUPPORT CLIENTTAGDENY explicitly allows ircord/edit
    clientA.send("CAP LS 302");
    await clientA.waitForLine((l) => l.includes("CAP * LS"));
    clientA.send("CAP REQ :message-tags echo-message account-tag server-time");
    await clientA.waitForLine((l) => l.includes("CAP * ACK"));
    clientA.send("NICK Alice");
    clientA.send("USER alice 0 * :Alice User");
    clientA.send("CAP END");

    let isupportLine = "";
    await clientA.waitForLine((l) => {
      if (l.includes("005 Alice") && l.includes("CLIENTTAGDENY")) {
        isupportLine = l;
        return true;
      }
      return false;
    });
    expect(isupportLine).toContain("-ircord/edit");

    // Connect Bob
    clientB.send("CAP REQ :message-tags server-time");
    clientB.send("NICK Bob");
    clientB.send("USER bob 0 * :Bob User");
    clientB.send("CAP END");
    await clientB.waitForLine((l) => l.includes(" 001 Bob "));

    // Both join #chat
    clientA.send("JOIN #chat");
    clientB.send("JOIN #chat");
    await clientA.waitForLine((l) => l.includes(" 366 Alice #chat"));
    await clientB.waitForLine((l) => l.includes(" 366 Bob #chat"));

    // Alice sends initial message with a typo
    clientA.send("PRIVMSG #chat :Heelo world!");
    let origMsgId = "";
    await clientA.waitForLine((l) => {
      if (l.includes("PRIVMSG #chat :Heelo world!")) {
        const match = l.match(/msgid=([^; ]+)/);
        if (match) origMsgId = match[1];
        return true;
      }
      return false;
    });
    expect(origMsgId).toBeTruthy();

    // Alice sends correction using +ircord/edit tag
    clientA.send(`@+ircord/edit=${origMsgId} PRIVMSG #chat :Hello world!`);

    // Bob receives correction with +ircord/edit preserved
    let bobReceivedEdit = "";
    await clientB.waitForLine((l) => {
      if (l.includes("PRIVMSG #chat :Hello world!")) {
        bobReceivedEdit = l;
        return true;
      }
      return false;
    });
    expect(bobReceivedEdit).toContain(`+ircord/edit=${origMsgId}`);

    // Verify REST API reflects edited message
    const res = await request(`${url.origin}/api/v1/channels/%23chat/messages`);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    const origMsg = data.messages.find((m: any) => m.id === origMsgId);
    expect(origMsg).toBeDefined();
    expect(origMsg.content).toBe("Hello world!");
  });

  it("indexes messages in SQLite FTS5 and supports search via REST and IRC SEARCH command", async () => {
    const engineer = await fixture.apiUser("Engineer", "#tech");
    const dev = await fixture.apiUser("Dev", "#tech");
    const writer = await fixture.apiUser("DocWriter", "#tech");
    const architect = await fixture.apiUser("Architect", "#tech");
    // Post distinct messages via REST API
    await engineer.request(`${url.origin}/api/v1/channels/%23tech/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Deploying Flare Relay Chat on Cloudflare Workers with SQLite DO",
        senderNick: "Engineer",
      }),
    });

    await dev.request(`${url.origin}/api/v1/channels/%23tech/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Rust and Go are great for standalone servers",
        senderNick: "Dev",
      }),
    });

    await writer.request(`${url.origin}/api/v1/channels/%23tech/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Check out https://github.com/flarc/cfcord for source code and specs",
        senderNick: "DocWriter",
      }),
    });

    // 1. Search via REST API (keyword query)
    const searchRes = await request(
      `${url.origin}/api/v1/channels/%23tech/messages/search?q=Cloudflare`,
    );
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as any;
    expect(searchData.ok).toBe(true);
    expect(searchData.count).toBe(1);
    expect(searchData.messages[0].content).toContain("Cloudflare Workers");

    // 2. Search via REST API with Discord/IRCord filters (from: and has:link)
    const filterRes = await request(
      `${url.origin}/api/v1/channels/%23tech/messages/search?q=from:DocWriter+has:link`,
    );
    expect(filterRes.status).toBe(200);
    const filterData = (await filterRes.json()) as any;
    expect(filterData.ok).toBe(true);
    expect(filterData.count).toBe(1);
    expect(filterData.messages[0].content).toContain("https://github.com/flarc/cfcord");

    // 3. Search via REST API with query parameters (?from=Dev)
    const devRes = await request(`${url.origin}/api/v1/channels/%23tech/messages/search?from=Dev`);
    expect(devRes.status).toBe(200);
    const devData = (await devRes.json()) as any;
    expect(devData.ok).toBe(true);
    expect(devData.count).toBe(1);
    expect(devData.messages[0].content).toContain("Rust and Go");

    // 4. Search via IRC SEARCH command with filter token (has:link)
    const client = makeClient();
    await client.connect();
    client.send("NICK Searcher\r\nUSER searcher 0 * :Searcher\r\n");
    await client.waitForLine((l) => l.includes(" 001 Searcher "));

    const searcherToken = await fixture.apiUser("AuthenticatedSearcher", "#tech");
    const searchClient = searcherToken.client;
    searchClient.send("SEARCH #tech has:link");
    let ircSearchResult = "";
    await searchClient.waitForLine((l) => {
      if (l.includes("https://github.com/flarc/cfcord")) {
        ircSearchResult = l;
        return true;
      }
      return false;
    });
    expect(ircSearchResult).toContain("DocWriter");

    // 5. Post message with tags (reply & pinned) and test tag-based search
    await architect.request(`${url.origin}/api/v1/channels/%23tech/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Replying to previous discussion about sqlite durable objects",
        senderNick: "Architect",
        tags: {
          "+draft/reply": "msg-prev-123",
          "+pinned": true,
        },
      }),
    });

    // 6. Test IRCord compatible /api/v1/search endpoint with tag and conversationId
    const tagSearchRes = await request(
      `${url.origin}/api/v1/search?conversationId=%23tech&tag=reply`,
    );
    expect(tagSearchRes.status).toBe(200);
    const tagSearchData = (await tagSearchRes.json()) as any;
    expect(tagSearchData.ok).toBe(true);
    expect(tagSearchData.items).toBeDefined();
    expect(tagSearchData.items.length).toBeGreaterThanOrEqual(1);
    expect(tagSearchData.items[0].message.text).toContain("Replying to previous discussion");
    expect(tagSearchData.items[0].conversation.name).toBe("tech");

    // 7. Test inline tag search: q="tag:pinned" or q="+draft/reply"
    const inlineTagRes = await request(`${url.origin}/api/v1/search?q=in:tech+tag:pinned`);
    expect(inlineTagRes.status).toBe(200);
    const inlineTagData = (await inlineTagRes.json()) as any;
    expect(inlineTagData.ok).toBe(true);
    expect(
      inlineTagData.messages.some((m: any) => m.content.includes("Replying to previous")),
    ).toBe(true);

    // 8. Test IRC SEARCH command with tag filter (+draft/reply)
    searchClient.send("SEARCH #tech +draft/reply");
    let ircTagResult = "";
    await searchClient.waitForLine((l) => {
      if (l.includes("Replying to previous")) {
        ircTagResult = l;
        return true;
      }
      return false;
    });
    expect(ircTagResult).toContain("Architect");
  });

  it("supports Discord/Slack compatible incoming webhooks", async () => {
    // 1. Create Webhook for #alerts
    const createRes = await request(`${url.origin}/api/v1/channels/%23alerts/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({
        name: "GitHub Actions",
        avatar_url: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
      }),
    });
    expect(createRes.status).toBe(201);
    const webhookData = (await createRes.json()) as any;
    expect(webhookData.ok).toBe(true);
    expect(webhookData.webhook.token).toBeDefined();
    const token = webhookData.webhook.token;

    // 2. Connect IRC client to #alerts to observe webhook delivery
    const client = makeClient();
    await client.connect();
    client.send("CAP REQ :message-tags server-time");
    client.send("NICK MonitorBot\r\nUSER monitor 0 * :Monitor\r\nCAP END\r\n");
    await client.waitForLine((l) => l.includes(" 001 MonitorBot "));
    client.send("JOIN #alerts");
    await client.waitForLine((l) => l.includes(" 366 MonitorBot #alerts"));

    // 3. Post webhook payload (Discord/Slack style)
    const execRes = await request(`${url.origin}/api/v1/webhooks/${token}?channel=%23alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Build #42 passed on branch main!",
        username: "CI/CD Bot",
      }),
    });
    expect(execRes.status).toBe(200);
    const execData = (await execRes.json()) as any;
    expect(execData.ok).toBe(true);

    // 4. Verify IRC client receives message tagged with +role=webhook and +badge=bot
    let hookMsgLine = "";
    await client.waitForLine((l) => {
      if (l.includes("Build #42 passed on branch main!")) {
        hookMsgLine = l;
        return true;
      }
      return false;
    });
    expect(hookMsgLine).toContain(":hook_CI_CD_Bot!webhook@discord.bot PRIVMSG #alerts");
    expect(hookMsgLine).toContain("+role=webhook");
    expect(hookMsgLine).toContain("+badge=bot");

    // 5. Test Discord embed-only payload through standard /api/webhooks/:id/:token route
    const mismatchedHook = await request(
      `${url.origin}/api/webhooks/wrong/${token}?channel=%23alerts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "mismatched hook must not write" }),
      },
    );
    expect(mismatchedHook.status).toBe(400);
    const discordHookRes = await request(
      `${url.origin}/api/webhooks/${webhookData.webhook.id}/${token}?channel=%23alerts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Release Bot",
          embeds: [
            {
              title: "FlaRC v1.0 Released",
              url: "https://github.com/example/flarc",
              description: "Major milestone with modular commands and search!",
              fields: [
                { name: "Author", value: "karbowiak" },
                { name: "Status", value: "Production Ready" },
              ],
              footer: { text: "FlaRC Automation" },
            },
          ],
        }),
      },
    );
    expect(discordHookRes.status).toBe(200);

    let embedMsgLine = "";
    await client.waitForLine((l) => {
      if (l.includes("FlaRC v1.0 Released")) {
        embedMsgLine = l;
        return true;
      }
      return false;
    });
    expect(embedMsgLine).toContain(":hook_Release_Bot!webhook@discord.bot PRIVMSG #alerts");
    expect(embedMsgLine).toContain("+role=webhook");
    expect(embedMsgLine).toContain("FlaRC Automation");
  });

  it("supports channel notification preferences, outgoing webhooks, prometheus metrics, and paginated message history", async () => {
    // 1. Prometheus Metrics endpoint
    const metricsRes = await request(`${url.origin}/metrics`);
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.headers.get("content-type")).toContain("text/plain");
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain("flarc_up 1");
    expect(metricsText).toContain("flarc_build_info{");
    expect(metricsText).toContain("flarc_active_connections");

    // 2. Outgoing Webhooks CRUD
    const outCreateRes = await request(
      `${url.origin}/api/v1/channels/%23alerts/outgoing-webhooks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({
          target_url: "https://example.com/webhook-receiver",
          events: ["message.created"],
        }),
      },
    );
    expect(outCreateRes.status).toBe(200);
    const outData = (await outCreateRes.json()) as any;
    expect(outData.ok).toBe(true);
    expect(outData.webhook.target_url).toBe("https://example.com/webhook-receiver");
    const hookId = outData.webhook.id;

    const outListRes = await request(`${url.origin}/api/v1/channels/%23alerts/outgoing-webhooks`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const outListData = (await outListRes.json()) as any;
    expect(outListData.ok).toBe(true);
    expect(outListData.webhooks.some((w: any) => w.id === hookId)).toBe(true);

    const outDeleteRes = await request(
      `${url.origin}/api/v1/channels/%23alerts/outgoing-webhooks/${hookId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      },
    );
    expect(outDeleteRes.status).toBe(200);

    // 3. Channel Notification Preferences
    // First register user if not already present
    await request(`${url.origin}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "notifyuser",
        password: "Password123!",
      }),
    });

    const notifyToken = await fixture.login("notifyuser", "Password123!");
    const notifyRequest = fixture.authenticatedFetch(notifyToken);
    const notifier = await fixture.apiUser("Notifier", "#alerts");
    const setNotifRes = await notifyRequest(
      `${url.origin}/api/v1/users/notifyuser/notifications/%23alerts`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "all",
          muted_until: null,
        }),
      },
    );
    expect(setNotifRes.status).toBe(200);
    const setNotifData = (await setNotifRes.json()) as any;
    expect(setNotifData.ok).toBe(true);
    expect(setNotifData.level).toBe("all");

    const getNotifRes = await notifyRequest(`${url.origin}/api/v1/users/notifyuser/notifications`);
    expect(getNotifRes.status).toBe(200);
    const getNotifData = (await getNotifRes.json()) as any;
    expect(getNotifData.ok).toBe(true);
    expect(
      getNotifData.notifications.some((n: any) => n.channel === "#alerts" && n.level === "all"),
    ).toBe(true);

    // 4. Cursor-paginated message history
    // Post a message to #alerts first so it has history
    await notifier.request(`${url.origin}/api/v1/channels/%23alerts/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "tester",
        content: "Hello paginated world!",
      }),
    });

    const paginatedRes = await request(`${url.origin}/api/v1/channels/%23alerts/messages?limit=10`);
    expect(paginatedRes.status).toBe(200);
    const paginatedData = (await paginatedRes.json()) as any;
    expect(paginatedData.ok).toBe(true);
    expect(paginatedData.pagination).toBeDefined();
    expect(paginatedData.pagination.limit).toBe(10);
    expect(paginatedData.pagination.count).toBeGreaterThanOrEqual(1);
    expect(paginatedData.pagination.newest_id).toBeDefined();
  });
});
