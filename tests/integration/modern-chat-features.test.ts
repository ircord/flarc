import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMiniflareServer, TestIRCClient } from "../helpers/miniflare-harness";

const ADMIN_TOKEN = "super-secret-admin-token";

describe("Modern Chat Platform Features (Profiles, Replies, Media, Unread & WebPush)", () => {
  let mf: Miniflare;
  let httpUrl: URL;
  let wsUrl: string;
  let dispose: () => Promise<void>;
  const clients: TestIRCClient[] = [];

  beforeEach(async () => {
    const srv = await createMiniflareServer({
      bindings: {
        ADMIN_TOKEN,
      },
    });
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

  it("Phase 1: Canonical user profiles and channel categories with metadata APIs", async () => {
    // 1. Register a user
    const regRes = await mf.dispatchFetch(`${httpUrl.origin}/api/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "solomon",
        password: "securepassword123",
        displayName: "King Solomon",
        roles: ["admin", "staff"],
      }),
    });
    expect(regRes.status).toBe(201);
    const regData = (await regRes.json()) as any;
    expect(regData.ok).toBe(true);
    expect(regData.account.username).toBe("solomon");

    // 2. Fetch initial profile
    const getRes1 = await mf.dispatchFetch(`${httpUrl.origin}/api/profile/solomon`);
    expect(getRes1.status).toBe(200);
    const profData1 = (await getRes1.json()) as any;
    expect(profData1.ok).toBe(true);
    expect(profData1.profile.username).toBe("solomon");
    expect(profData1.profile.displayName).toBe("King Solomon");
    expect(profData1.profile.roles).toContain("admin");

    // 3. Update profile via PATCH /api/profile/:username
    const patchRes = await mf.dispatchFetch(`${httpUrl.origin}/api/profile/solomon`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar: "https://example.com/avatar.png",
        bio: "Wise king and builder",
        pronouns: "he/him",
        color: "#F38020",
        customStatus: "Building the temple",
        timezone: "Asia/Jerusalem",
      }),
    });
    expect(patchRes.status).toBe(200);
    const profData2 = (await patchRes.json()) as any;
    expect(profData2.ok).toBe(true);
    expect(profData2.profile.avatar).toBe("https://example.com/avatar.png");
    expect(profData2.profile.bio).toBe("Wise king and builder");
    expect(profData2.profile.pronouns).toBe("he/him");
    expect(profData2.profile.color).toBe("#F38020");
    expect(profData2.profile.customStatus).toBe("Building the temple");
    expect(profData2.profile.timezone).toBe("Asia/Jerusalem");

    // 4. Channel Categories & Metadata via PATCH /api/channels/:channel/info
    const chanPatch = await mf.dispatchFetch(
      `${httpUrl.origin}/api/channels/%23announcements/info`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatar: "https://example.com/megaphone.png",
          description: "Official server news and updates",
          category: "Information",
          color: "#5865F2",
          readOnly: true,
          topic: "Welcome to FlaRC announcements",
        }),
      },
    );
    expect(chanPatch.status).toBe(200);
    const chanData = (await chanPatch.json()) as any;
    expect(chanData.ok).toBe(true);
    expect(chanData.channel.channel).toBe("#announcements");
    expect(chanData.channel.avatar).toBe("https://example.com/megaphone.png");
    expect(chanData.channel.description).toBe("Official server news and updates");
    expect(chanData.channel.category).toBe("Information");
    expect(chanData.channel.color).toBe("#5865F2");
    expect(chanData.channel.readOnly).toBe(true);
    expect(chanData.channel.topic).toBe("Welcome to FlaRC announcements");

    // 5. Fetch Channel Info via GET /api/channels/:channel/info
    const chanGet = await mf.dispatchFetch(`${httpUrl.origin}/api/channels/%23announcements/info`);
    expect(chanGet.status).toBe(200);
    const chanGetData = (await chanGet.json()) as any;
    expect(chanGetData.ok).toBe(true);
    expect(chanGetData.channel.category).toBe("Information");
  });

  it("Phase 1 & 2: Automatic role badges and in-reply-to threading (+draft/reply and +reply)", async () => {
    // 1. Register an admin account
    await mf.dispatchFetch(`${httpUrl.origin}/api/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "adminUser",
        password: "adminPassword",
        roles: ["admin", "staff"],
      }),
    });

    // 2. Connect client A (admin) with message-tags
    const clientA = makeClient();
    await clientA.connect();
    clientA.send("CAP REQ :message-tags");
    await clientA.waitForLine((l) => l.includes("CAP") && l.includes("ACK"));
    clientA.send("CAP END");
    clientA.send("NICK AdminAlice");
    clientA.send("USER alice 0 * :Alice Administrator");
    await clientA.waitForLine((l) => l.includes(" 001 "));

    // Identify Alice
    clientA.send("PRIVMSG NickServ :IDENTIFY adminUser adminPassword");
    await clientA.waitForLine((l) => l.includes(" 900 ")); // RPL_LOGGEDIN

    // 3. Connect client B (member) with message-tags
    const clientB = makeClient();
    await clientB.connect();
    clientB.send("CAP REQ :message-tags");
    await clientB.waitForLine((l) => l.includes("CAP") && l.includes("ACK"));
    clientB.send("CAP END");
    clientB.send("NICK Bob");
    clientB.send("USER bob 0 * :Bob User");
    await clientB.waitForLine((l) => l.includes(" 001 "));

    // Both join #general
    clientA.send("JOIN #general");
    await clientA.waitForLine((l) => l.includes("JOIN") && l.includes("#general"));
    clientB.send("JOIN #general");
    await clientB.waitForLine((l) => l.includes("JOIN") && l.includes("#general"));

    // 4. AdminAlice sends a message -> Bob should see +role=admin and +badge=admin (or staff)
    clientA.send("PRIVMSG #general :Welcome to the modern server!");
    const aliceMsgOnB = await clientB.waitForLine(
      (l) => l.includes("PRIVMSG #general") && l.includes("Welcome to the modern server!"),
    );
    expect(aliceMsgOnB).toMatch(/\+role=(admin|staff)/);
    expect(aliceMsgOnB).toMatch(/\+badge=(admin|staff)/);

    // Extract msgid from Alice's message
    const msgIdMatch = aliceMsgOnB.match(/msgid=([^; ]+)/);
    expect(msgIdMatch).toBeTruthy();
    const parentMsgId = msgIdMatch![1];

    // 5. Bob replies to Alice using +draft/reply tag
    clientB.send(`@+draft/reply=${parentMsgId} PRIVMSG #general :Thanks for having us!`);
    const replyOnA = await clientA.waitForLine(
      (l) => l.includes("PRIVMSG #general") && l.includes("Thanks for having us!"),
    );
    expect(replyOnA).toContain(`+draft/reply=${parentMsgId}`);
    expect(replyOnA).toContain(`+reply=${parentMsgId}`);
  });

  it("Phase 3: Media upload pipeline with user authentication, open server guest access, and lockdown", async () => {
    const fileBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

    // 1. Unauthenticated stranger (not on IRC server, no credentials) is rejected with 401
    const unauthRes = await mf.dispatchFetch(`${httpUrl.origin}/api/media/upload`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: fileBytes,
    });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.headers.get("WWW-Authenticate")).toBe('Basic realm="FlaRC Filehost"');

    // 2. Active user on the IRC server (open server mode) can upload via Soju-Username / X-IRC-Nick
    const clientGuest = makeClient();
    await clientGuest.connect();
    clientGuest.send("NICK ActiveGuest");
    clientGuest.send("USER guest 0 * :Guest User");
    await clientGuest.waitForLine((l) => l.includes(" 001 "));

    const formData = new FormData();
    formData.append("file", new Blob([fileBytes], { type: "image/png" }), "flare-logo.png");

    const guestUpload = await mf.dispatchFetch(`${httpUrl.origin}/api/media/upload`, {
      method: "POST",
      headers: { "Soju-Username": "ActiveGuest" },
      body: formData as any,
    });
    expect(guestUpload.status).toBe(201);
    expect(guestUpload.headers.get("Location")).toMatch(/^\/media\/[a-f0-9-]+(\.png)?$/i);
    const guestData = (await guestUpload.json()) as any;
    expect(guestData.ok).toBe(true);
    expect(guestData.filename).toBe("flare-logo.png");
    expect(guestData.uploader).toBe("ActiveGuest");

    // 3. Registered account can upload using HTTP Basic Auth (SASL username/password)
    await mf.dispatchFetch(`${httpUrl.origin}/api/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "uploaderUser",
        password: "uploaderPassword",
      }),
    });
    const basicAuth = `Basic ${btoa("uploaderUser:uploaderPassword")}`;

    const textData = new TextEncoder().encode("Hello FlaRC Raw File Upload");
    const rawUpload = await mf.dispatchFetch(`${httpUrl.origin}/api/media/upload`, {
      method: "POST",
      headers: {
        Authorization: basicAuth,
        "Content-Type": "text/plain",
        "X-Filename": "notes.txt",
      },
      body: textData,
    });
    expect(rawUpload.status).toBe(201);
    const rawData = (await rawUpload.json()) as any;
    expect(rawData.ok).toBe(true);
    expect(rawData.filename).toBe("notes.txt");
    expect(rawData.uploader).toBe("uploaderUser");

    // Fetch raw file
    const rawFileRes = await mf.dispatchFetch(`${httpUrl.origin}${rawData.url}`);
    expect(rawFileRes.status).toBe(200);
    expect(await rawFileRes.text()).toBe("Hello FlaRC Raw File Upload");

    // 4. Lock down upload: require registered accounts
    await mf.dispatchFetch(`${httpUrl.origin}/admin/config`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filehostRequireRegistration: true }),
    });

    // Unregistered guest is now rejected
    const lockedGuestUpload = await mf.dispatchFetch(`${httpUrl.origin}/api/media/upload`, {
      method: "POST",
      headers: { "Soju-Username": "ActiveGuest", "Content-Type": "text/plain" },
      body: textData,
    });
    expect(lockedGuestUpload.status).toBe(401);

    // Registered account still succeeds
    const lockedUserUpload = await mf.dispatchFetch(`${httpUrl.origin}/api/media/upload`, {
      method: "POST",
      headers: { Authorization: basicAuth, "Content-Type": "text/plain" },
      body: textData,
    });
    expect(lockedUserUpload.status).toBe(201);

    // 5. Disable filehost completely via config (exploit mitigation toggle)
    await mf.dispatchFetch(`${httpUrl.origin}/admin/config`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filehostEnabled: false }),
    });

    const disabledUpload = await mf.dispatchFetch(`${httpUrl.origin}/api/media/upload`, {
      method: "POST",
      headers: { Authorization: basicAuth, "Content-Type": "text/plain" },
      body: textData,
    });
    expect(disabledUpload.status).toBe(403);
    const disabledData = (await disabledUpload.json()) as any;
    expect(disabledData.error).toContain("disabled");

    // Re-enable for subsequent tests
    await mf.dispatchFetch(`${httpUrl.origin}/admin/config`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filehostEnabled: true, filehostRequireRegistration: false }),
    });
  });

  it("Phase 3 (R2): Media upload and retrieval using Cloudflare R2 bucket binding", async () => {
    const r2Srv = await createMiniflareServer({
      bindings: { ADMIN_TOKEN },
      r2Buckets: { MEDIA_BUCKET: "flarc-media" },
    });
    try {
      const fileBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
      const formData = new FormData();
      formData.append("file", new Blob([fileBytes], { type: "image/gif" }), "animation.gif");

      const uploadRes = await r2Srv.mf.dispatchFetch(`${r2Srv.url.origin}/api/media/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        body: formData as any,
      });
      expect(uploadRes.status).toBe(201);
      const uploadData = (await uploadRes.json()) as any;
      expect(uploadData.ok).toBe(true);
      expect(uploadData.filename).toBe("animation.gif");
      expect(uploadData.mimeType).toBe("image/gif");
      expect(uploadData.url).toMatch(/^\/media\/[a-f0-9-]+\.gif$/i);

      // Verify the file was stored directly in R2 bucket
      const r2Bucket = await r2Srv.mf.getR2Bucket("MEDIA_BUCKET");
      const r2Object = await r2Bucket.get(uploadData.id);
      expect(r2Object).not.toBeNull();
      expect(r2Object?.httpMetadata?.contentType).toBe("image/gif");

      // Verify retrieval through the FlaRC public endpoint
      const getRes = await r2Srv.mf.dispatchFetch(`${r2Srv.url.origin}${uploadData.url}`);
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("Content-Type")).toBe("image/gif");
      const downloaded = await getRes.arrayBuffer();
      expect(downloaded.byteLength).toBe(fileBytes.length);
      expect(new Uint8Array(downloaded)[0]).toBe(0x47);
    } finally {
      await r2Srv.dispose();
    }
  });

  it("Phase 4: Unread counters, mention tracking, and WebPush subscriptions", async () => {
    // 1. Register user Charlie
    await mf.dispatchFetch(`${httpUrl.origin}/api/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "charlie",
        password: "charliePassword123",
      }),
    });

    // 2. Connect client Dave and send messages to #chat mentioning Charlie
    const clientDave = makeClient();
    await clientDave.connect();
    clientDave.send("NICK Dave");
    clientDave.send("USER dave 0 * :Dave User");
    await clientDave.waitForLine((l) => l.includes(" 001 "));

    clientDave.send("JOIN #chat");
    await clientDave.waitForLine((l) => l.includes("JOIN") && l.includes("#chat"));

    clientDave.send("PRIVMSG #chat :Hello anyone here?");
    clientDave.send("PRIVMSG #chat :Hey @charlie check out FlaRC!");
    await new Promise((r) => setTimeout(r, 200));

    // 3. Query unread count for Charlie on #chat
    const unreadRes1 = await mf.dispatchFetch(
      `${httpUrl.origin}/api/channels/%23chat/unread?username=charlie`,
    );
    expect(unreadRes1.status).toBe(200);
    const unreadData1 = (await unreadRes1.json()) as any;
    expect(unreadData1.ok).toBe(true);
    expect(unreadData1.unreadCount).toBeGreaterThanOrEqual(2);
    expect(unreadData1.mentionCount).toBe(1);

    // 4. Charlie marks #chat as read via MARKREAD
    const clientCharlie = makeClient();
    await clientCharlie.connect();
    clientCharlie.send("NICK CharlieGuest");
    clientCharlie.send("USER charlie 0 * :Charlie User");
    await clientCharlie.waitForLine((l) => l.includes(" 001 "));
    clientCharlie.send("PRIVMSG NickServ :IDENTIFY charlie charliePassword123");
    await clientCharlie.waitForLine((l) => l.includes(" 900 "));

    const nowIso = new Date().toISOString();
    clientCharlie.send(`MARKREAD #chat timestamp=${nowIso}`);
    await new Promise((r) => setTimeout(r, 200));

    // 5. Query unread count after MARKREAD
    const unreadRes2 = await mf.dispatchFetch(
      `${httpUrl.origin}/api/channels/%23chat/unread?username=charlie`,
    );
    const unreadData2 = (await unreadRes2.json()) as any;
    expect(unreadData2.ok).toBe(true);
    expect(unreadData2.unreadCount).toBe(0);
    expect(unreadData2.mentionCount).toBe(0);

    // 6. User summary unread endpoint
    const userUnreadRes = await mf.dispatchFetch(`${httpUrl.origin}/api/users/charlie/unread`);
    expect(userUnreadRes.status).toBe(200);
    const userUnreadData = (await userUnreadRes.json()) as any;
    expect(userUnreadData.ok).toBe(true);
    expect(Array.isArray(userUnreadData.channels)).toBe(true);

    // 7. WebPush Subscriptions
    const subRes = await mf.dispatchFetch(`${httpUrl.origin}/api/webpush/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "charlie",
        endpoint: "https://push.example.com/v1/sub-987654",
        keys: {
          p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_",
          auth: "tBHItJI5svbpez7KI4CCXg==",
        },
      }),
    });
    expect(subRes.status).toBe(200);
    const subData = (await subRes.json()) as any;
    expect(subData.ok).toBe(true);
    expect(subData.registered).toBe(true);

    // List subscriptions
    const listRes = await mf.dispatchFetch(
      `${httpUrl.origin}/api/webpush/subscriptions?username=charlie`,
    );
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.ok).toBe(true);
    expect(listData.endpoints).toContain("https://push.example.com/v1/sub-987654");

    // Delete subscription
    const delRes = await mf.dispatchFetch(
      `${httpUrl.origin}/api/webpush/subscribe?username=charlie&endpoint=${encodeURIComponent(
        "https://push.example.com/v1/sub-987654",
      )}`,
      { method: "DELETE" },
    );
    expect(delRes.status).toBe(200);
    const delData = (await delRes.json()) as any;
    expect(delData.ok).toBe(true);
    expect(delData.removed).toBe(true);
  });
});
