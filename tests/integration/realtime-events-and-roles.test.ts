import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createProtocolServer, TestIRCClient } from "../helpers/miniflare-harness";

describe("Realtime Events, Custom Role Groups & Message Editing", () => {
  let _mf: Miniflare;
  let httpUrl: URL;
  let wsUrl: string;
  let dispose: () => Promise<void>;
  let fixture: Awaited<ReturnType<typeof createProtocolServer>>;
  let request: Awaited<ReturnType<typeof createProtocolServer>>["request"];
  const clients: TestIRCClient[] = [];

  beforeEach(async () => {
    const srv = await createProtocolServer();
    fixture = srv;
    request = srv.request;
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

  function makeClient(
    subprotocol: "text.ircv3.net" | "binary.ircv3.net" = "text.ircv3.net",
  ): TestIRCClient {
    const client = new TestIRCClient(wsUrl, subprotocol);
    clients.push(client);
    return client;
  }

  it("subscribes to /api/v1/events and receives structured domain events for role creation and message editing", async () => {
    // 1. Connect WebSocket to /api/v1/events
    const eventsWsUrl = `ws://${httpUrl.host}/api/v1/events`;
    const receivedEvents: any[] = [];
    const eventWs = new WebSocket(eventsWsUrl, {
      headers: { Authorization: `Bearer ${fixture.adminToken}` },
    });

    await new Promise<void>((resolve, reject) => {
      eventWs.on("open", () => resolve());
      eventWs.on("error", (err) => reject(err));
      eventWs.on("message", (data) => {
        try {
          receivedEvents.push(JSON.parse(data.toString()));
        } catch {}
      });
    });

    // 2. Create custom role group via REST API
    const createRoleRes = await request(`${httpUrl.origin}/api/v1/channels/%23gaming/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Moderator",
        color: "#00FF00",
        priority: 50,
        ircMode: "o",
        ircPrefix: "@",
        permissions: ["send_messages", "kick_members", "change_topic"],
      }),
    });
    expect(createRoleRes.status).toBe(201);
    const createdRoleData = (await createRoleRes.json()) as any;
    expect(createdRoleData.ok).toBe(true);
    expect(createdRoleData.role.name).toBe("Moderator");

    // 3. Connect an IRC client and send a message in #gaming
    const ircClient = makeClient();
    await ircClient.connect();
    await ircClient.register("gamer_one", "gamer", "Gamer One");
    ircClient.send("JOIN #gaming");
    await ircClient.waitForLine((l) => l.includes(" JOIN #gaming"));

    const gamer = await fixture.apiUser("gamerApi", "#gaming");
    // Send message via REST API
    const sendMsgRes = await gamer.request(`${httpUrl.origin}/api/v1/channels/%23gaming/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Hello from modern API!",
        senderNick: "gamer_one",
      }),
    });
    expect(sendMsgRes.status).toBe(201);
    const msgData = (await sendMsgRes.json()) as any;
    expect(msgData.ok).toBe(true);
    const messageId = msgData.message.id;

    // 4. Edit message via REST API
    const editMsgRes = await gamer.request(
      `${httpUrl.origin}/api/v1/channels/%23gaming/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Hello from modern API! (edited)",
          senderNick: "gamer_one",
        }),
      },
    );
    expect(editMsgRes.status).toBe(200);
    const editedData = (await editMsgRes.json()) as any;
    expect(editedData.ok).toBe(true);
    expect(editedData.message.content).toBe("Hello from modern API! (edited)");

    // 5. Verify received domain events on /api/v1/events
    await new Promise((r) => setTimeout(r, 200));
    eventWs.close();

    const roleEvent = receivedEvents.find((e) => e.type === "channel.role_created");
    expect(roleEvent).toBeDefined();
    expect(roleEvent.data.name).toBe("Moderator");

    const editEvent = receivedEvents.find((e) => e.type === "message.updated");
    expect(editEvent).toBeDefined();
    expect(editEvent.data.newContent).toBe("Hello from modern API! (edited)");
    expect(editEvent.data.editor).toBe("gamerApi");
  });

  it("serves OpenAPI 3.1 schema at /openapi.json and Scalar HTML UI at /docs", async () => {
    const specRes = await request(`${httpUrl.origin}/openapi.json`);
    expect(specRes.status).toBe(200);
    const spec = (await specRes.json()) as any;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("FlaRC");
    expect(spec.paths["/api/v1/auth/register"]).toBeDefined();
    expect(spec.paths["/api/v1/channels/{channel}/roles"]).toBeDefined();
    expect(spec.paths["/api/v1/events"]).toBeDefined();

    const docsRes = await request(`${httpUrl.origin}/docs`);
    expect(docsRes.status).toBe(200);
    expect(docsRes.headers.get("content-type")).toContain("text/html");
    const html = await docsRes.text();
    expect(html).toContain("api-reference");
    expect(html).toContain("/openapi.json");
  });
});
