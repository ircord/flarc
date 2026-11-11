import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMiniflareServer, TestIRCClient } from "../helpers/miniflare-harness";

describe("CFCord IRCv3 Server Integration (Miniflare)", () => {
  let mf: Miniflare;
  let httpUrl: URL;
  let wsUrl: string;
  let dispose: () => Promise<void>;
  const clients: TestIRCClient[] = [];

  beforeEach(async () => {
    const srv = await createMiniflareServer();
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

  function makeClient(
    subprotocol: "text.ircv3.net" | "binary.ircv3.net" = "text.ircv3.net",
  ): TestIRCClient {
    const client = new TestIRCClient(wsUrl, subprotocol);
    clients.push(client);
    return client;
  }

  it("completes IRC registration, negotiates subprotocol, handles PING/PONG, and exchanges channel & private messages", async () => {
    const alice = makeClient("text.ircv3.net");
    const bob = makeClient("binary.ircv3.net");

    await alice.connect();
    await bob.connect();

    await alice.register("alice", "alice_u", "Alice Wonderland");
    await bob.register("bob", "bob_u", "Bob Builder");

    // PING/PONG
    alice.send("PING :hello-token-123");
    const pong = await alice.waitForLine(
      (l) => l.includes(" PONG ") && l.includes("hello-token-123"),
    );
    expect(pong).toContain("PONG");

    // Alice joins #general (becomes founder/op @alice)
    alice.send("JOIN #general");
    await alice.waitForLine((l) => l.includes(" JOIN #general"));
    const aliceNames = await alice.waitForLine((l) => l.includes(" 353 ") && l.includes("@alice"));
    expect(aliceNames).toContain("@alice");

    // Bob joins #general
    const aliceSeesBobJoin = alice.waitForNewLine(
      (l) => l.startsWith(":bob!") && l.includes(" JOIN #general"),
    );
    bob.send("JOIN #general");
    await bob.waitForLine((l) => l.startsWith(":bob!") && l.includes(" JOIN #general"));
    await aliceSeesBobJoin;

    // Alice sends PRIVMSG to #general
    const bobReceivesMsg = bob.waitForNewLine(
      (l) =>
        l.startsWith(":alice!") && l.includes("PRIVMSG #general :Hello from Cloudflare Workers!"),
    );
    alice.send("PRIVMSG #general :Hello from Cloudflare Workers!");
    const received = await bobReceivesMsg;
    expect(received).toContain("Hello from Cloudflare Workers!");

    // Bob sends private message to Alice
    const aliceReceivesDm = alice.waitForNewLine(
      (l) => l.startsWith(":bob!") && l.includes("PRIVMSG alice :Hey Alice, DM works!"),
    );
    bob.send("PRIVMSG alice :Hey Alice, DM works!");
    await aliceReceivesDm;
  });

  it("enforces channel modes (+t, +m, +v, +i, +k, +b) and KICK/INVITE", async () => {
    const alice = makeClient();
    const bob = makeClient();

    await alice.connect();
    await bob.connect();
    await alice.register("alice");
    await bob.register("bob");

    alice.send("JOIN #ops");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#ops"));

    bob.send("JOIN #ops");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#ops"));

    // +t is on by default: Bob (not op) cannot set topic
    bob.send("TOPIC #ops :Unauthorized topic");
    await bob.waitForLine((l) => l.includes(" 482 ")); // ERR_CHANOPRIVSNEEDED

    // Alice (op) sets topic
    const bobSeesTopic = bob.waitForNewLine((l) => l.includes(" TOPIC #ops :Welcome to #ops"));
    alice.send("TOPIC #ops :Welcome to #ops");
    await bobSeesTopic;

    // Alice sets +m (moderated)
    const bobSeesModeM = bob.waitForNewLine((l) => l.includes(" MODE #ops +m"));
    alice.send("MODE #ops +m");
    await bobSeesModeM;

    // Bob cannot speak in +m without voice
    bob.send("PRIVMSG #ops :Can anyone hear me?");
    await bob.waitForLine((l) => l.includes(" 404 ")); // ERR_CANNOTSENDTOCHAN

    // Alice voices Bob (+v)
    const bobSeesVoice = bob.waitForNewLine((l) => l.includes(" MODE #ops +v bob"));
    alice.send("MODE #ops +v bob");
    await bobSeesVoice;

    // Now Bob can speak
    const aliceHearsBob = alice.waitForNewLine((l) =>
      l.includes("PRIVMSG #ops :Now I have voice!"),
    );
    bob.send("PRIVMSG #ops :Now I have voice!");
    await aliceHearsBob;

    // Alice kicks Bob
    const bobSeesKick = bob.waitForNewLine((l) => l.includes(" KICK #ops bob :Behave!"));
    alice.send("KICK #ops bob :Behave!");
    await bobSeesKick;

    // Alice sets channel invite-only (+i)
    alice.send("MODE #ops +i");
    await alice.waitForNewLine((l) => l.includes(" MODE #ops +i"));

    // Bob tries to rejoin -> 473 ERR_INVITEONLYCHAN
    bob.send("JOIN #ops");
    await bob.waitForNewLine((l) => l.includes(" 473 "));

    // Alice invites Bob
    const bobSeesInvite = bob.waitForNewLine((l) => l.includes(" INVITE bob #ops"));
    alice.send("INVITE bob #ops");
    await bobSeesInvite;

    // Now Bob can join
    bob.send("JOIN #ops");
    await bob.waitForNewLine((l) => l.startsWith(":bob!") && l.includes(" JOIN #ops"));
  });

  it("supports account registration, SASL PLAIN authentication, IRCv3 tags, and CHATHISTORY replay", async () => {
    // 1. Register an account via HTTP API
    const regRes = await mf.dispatchFetch(`${httpUrl.origin}/api/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "charlie",
        password: "supersecretpassword",
        displayName: "Charlie Root",
        roles: ["oper"],
      }),
    });
    expect(regRes.status).toBe(201);
    const regBody = (await regRes.json()) as { ok: boolean; account: { username: string } };
    expect(regBody.ok).toBe(true);
    expect(regBody.account.username).toBe("charlie");

    // 2. Connect client and negotiate IRCv3 capabilities + SASL PLAIN
    const charlie = makeClient();
    await charlie.connect();

    charlie.send("CAP LS 302");
    const capLs = await charlie.waitForLine((l) => l.includes(" CAP * LS "));
    expect(capLs).toContain("sasl=PLAIN");
    expect(capLs).toContain("chathistory");

    charlie.send(
      "CAP REQ :sasl message-tags server-time account-tag echo-message batch chathistory labeled-response",
    );
    await charlie.waitForLine((l) => l.includes(" CAP * ACK "));

    charlie.send("AUTHENTICATE PLAIN");
    await charlie.waitForLine(
      (l) => l === `:${"irc.flarc.local"} AUTHENTICATE +` || l.includes("AUTHENTICATE +"),
    );

    const saslPayload = Buffer.from("charlie\x00charlie\x00supersecretpassword", "utf-8").toString(
      "base64",
    );
    charlie.send(`AUTHENTICATE ${saslPayload}`);
    await charlie.waitForLine((l) => l.includes(" 900 ")); // RPL_LOGGEDIN
    await charlie.waitForLine((l) => l.includes(" 903 ")); // RPL_SASLSUCCESS

    charlie.send("NICK charlie");
    charlie.send("USER charlie 0 * :Charlie");
    charlie.send("CAP END");
    await charlie.waitForLine((l) => l.includes(" 001 "));

    // 3. Join #history and send messages
    charlie.send("JOIN #history");
    await charlie.waitForLine((l) => l.includes(" JOIN #history"));

    const echo1 = charlie.waitForNewLine(
      (l) => l.includes("PRIVMSG #history :First persisted message") && l.startsWith("@"),
    );
    charlie.send("PRIVMSG #history :First persisted message");
    const msg1Line = await echo1;
    expect(msg1Line).toContain("account=charlie");
    expect(msg1Line).toContain("msgid=");
    expect(msg1Line).toContain("time=");

    const echo2 = charlie.waitForNewLine(
      (l) => l.includes("PRIVMSG #history :Second persisted message") && l.startsWith("@"),
    );
    charlie.send("PRIVMSG #history :Second persisted message");
    await echo2;

    // 4. Connect a second client (dave) and request CHATHISTORY
    const dave = makeClient();
    await dave.connect();
    dave.send("CAP REQ :message-tags server-time account-tag batch chathistory");
    await dave.waitForLine((l) => l.includes(" CAP * ACK "));
    dave.send("CAP END");
    await dave.register("dave");

    dave.send("JOIN #history");
    await dave.waitForLine((l) => l.includes(" 366 ") && l.includes("#history"));

    const batchStart = dave.waitForNewLine(
      (l) => l.includes(" BATCH +") && l.includes("chathistory #history"),
    );
    const batchEnd = dave.waitForNewLine((l) => l.includes(" BATCH -"));

    dave.send("CHATHISTORY LATEST #history * 10");
    await batchStart;
    await batchEnd;

    const historyLines = dave.lines.filter((l) => l.includes("PRIVMSG #history :"));
    expect(historyLines.length).toBe(2);
    expect(historyLines[0]).toContain("First persisted message");
    expect(historyLines[1]).toContain("Second persisted message");
  });

  it("supports WEBIRC gateway spoofing and hostname resolution", async () => {
    const webUser = makeClient();
    await webUser.connect();
    webUser.send("WEBIRC secret kiwi client.webirc.net 203.0.113.42 secure");
    await webUser.register("webbie");
    await webUser.waitForLine((l) => l.includes(" 001 "));
    const welcomeLine = webUser.lines.find((l) => l.includes(" 001 "));
    expect(welcomeLine).toContain("webbie!webbie@client.webirc.net");
  });
});
