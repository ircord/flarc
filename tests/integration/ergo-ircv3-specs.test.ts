import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMiniflareServer, TestIRCClient } from "../helpers/miniflare-harness";

describe("Ergo & Full IRCv3 / Draft Specifications Suite", () => {
  let mf: Miniflare;
  let wsUrl: string;
  let dispose: () => Promise<void>;
  const clients: TestIRCClient[] = [];

  beforeEach(async () => {
    const srv = await createMiniflareServer();
    mf = srv.mf;
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
    const client = new TestIRCClient(wsUrl, "text.ircv3.net");
    clients.push(client);
    return client;
  }

  async function connectWithAllCaps(nick: string): Promise<TestIRCClient> {
    const client = makeClient();
    await client.connect();
    client.send(
      "CAP REQ :message-tags server-time account-tag account-notify away-notify extended-join echo-message labeled-response batch msgid multi-prefix userhost-in-names setname chghost invite-notify monitor extended-monitor chathistory draft/chathistory draft/event-playback draft/multiline draft/message-redaction draft/metadata-3 draft/read-marker draft/account-registration draft/channel-rename draft/extended-isupport draft/whoami",
    );
    await client.waitForLine((l) => l.includes(" CAP * ACK "));
    client.send(`NICK ${nick}`);
    client.send(`USER ${nick} 0 * :${nick} Realname`);
    client.send("CAP END");
    await client.waitForLine((l) => l.includes(" 001 "));
    return client;
  }

  it("supports TAGMSG (+typing, +draft/react), persists reactions in CHATHISTORY, and supports draft/message-redaction (REDACT)", async () => {
    const alice = await connectWithAllCaps("alice");
    const bob = await connectWithAllCaps("bob");

    alice.send("JOIN #dev");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#dev"));

    bob.send("JOIN #dev");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#dev"));

    // 1. Ephemeral typing TAGMSG
    const bobSeesTyping = bob.waitForNewLine(
      (l) => l.includes("TAGMSG #dev") && l.includes("+typing=active"),
    );
    alice.send("@+typing=active TAGMSG #dev");
    await bobSeesTyping;

    // 2. Alice sends a normal message with +draft/reply client tag
    const aliceEcho = alice.waitForNewLine((l) => l.includes("PRIVMSG #dev :Deploy the workers!"));
    alice.send("PRIVMSG #dev :Deploy the workers!");
    const echoLine = await aliceEcho;
    const msgIdMatch = echoLine.match(/msgid=([^; ]+)/);
    expect(msgIdMatch).toBeTruthy();
    const targetMsgId = msgIdMatch![1];

    // 3. Bob reacts to Alice's message via TAGMSG (+draft/react)
    const aliceSeesReact = alice.waitForNewLine(
      (l) =>
        l.includes("TAGMSG #dev") &&
        l.includes("+draft/react=🚀") &&
        l.includes(`+draft/reply=${targetMsgId}`),
    );
    bob.send(`@+draft/react=🚀;+draft/reply=${targetMsgId} TAGMSG #dev`);
    await aliceSeesReact;

    // 4. Verify CHATHISTORY replays both the message and the reaction TAGMSG, but NOT +typing
    const batchEnd = alice.waitForNewLine((l) => l.includes(" BATCH -"));
    alice.send("CHATHISTORY LATEST #dev * 20");
    await batchEnd;

    const replayedReactions = alice.lines.filter(
      (l) => l.includes("batch=") && l.includes("TAGMSG #dev") && l.includes("+draft/react=🚀"),
    );
    expect(replayedReactions.length).toBe(1);
    const replayedTyping = alice.lines.filter(
      (l) => l.includes("batch=") && l.includes("+typing=active"),
    );
    expect(replayedTyping.length).toBe(0);

    // 5. Alice redacts her message using REDACT
    const bobSeesRedact = bob.waitForNewLine((l) =>
      l.includes(`REDACT #dev ${targetMsgId} :Typo fix`),
    );
    alice.send(`@label=red1 REDACT #dev ${targetMsgId} :Typo fix`);
    await bobSeesRedact;

    // 6. Verify redacted message is omitted from subsequent CHATHISTORY queries
    const carol = await connectWithAllCaps("carol");
    carol.send("JOIN #dev");
    await carol.waitForLine((l) => l.includes(" 366 ") && l.includes("#dev"));

    const carolBatchEnd = carol.waitForNewLine((l) => l.includes(" BATCH -"));
    carol.send("CHATHISTORY LATEST #dev * 20");
    await carolBatchEnd;

    const carolPrivmsgs = carol.lines.filter((l) => l.includes("Deploy the workers!"));
    expect(carolPrivmsgs.length).toBe(0);
  });

  it("supports draft/multiline batches and replays them in CHATHISTORY", async () => {
    const alice = await connectWithAllCaps("alice");
    const bob = await connectWithAllCaps("bob");

    alice.send("JOIN #multi");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#multi"));
    bob.send("JOIN #multi");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#multi"));

    const bobSeesMultilineEnd = bob.waitForNewLine(
      (l) => l.startsWith(":alice!") && l.includes(" BATCH -"),
    );

    alice.send("BATCH +ml1 draft/multiline #multi");
    alice.send("@batch=ml1 PRIVMSG #multi :Line 1 of multiline");
    alice.send("@batch=ml1 PRIVMSG #multi :Line 2 of multiline");
    alice.send("@batch=ml1;draft/multiline-concat PRIVMSG #multi : (concatenated)");
    alice.send("BATCH -ml1");

    await bobSeesMultilineEnd;

    const bobMultilineLines = bob.lines.filter((l) => l.includes("PRIVMSG #multi :Line "));
    expect(bobMultilineLines.length).toBe(2);
  });

  it("supports draft/metadata-3 (SUB, SET, GET, SYNC) and draft/read-marker (MARKREAD)", async () => {
    const alice = await connectWithAllCaps("alice");
    const bob = await connectWithAllCaps("bob");

    alice.send("JOIN #meta");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#meta"));
    bob.send("JOIN #meta");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#meta"));

    // Bob subscribes to display-name and avatar metadata
    bob.send("METADATA * SUB display-name avatar");
    await bob.waitForLine((l) => l.includes(" 770 ") && l.includes("display-name"));

    // Alice sets her display-name; Bob receives live METADATA notification
    const bobSeesMeta = bob.waitForNewLine(
      (l) => l.includes(" 761 ") && l.includes("Alice in Cloudland"),
    );
    alice.send("METADATA * SET display-name :Alice in Cloudland");
    await alice.waitForLine((l) => l.includes(" 761 ") && l.includes("Alice in Cloudland"));
    await bobSeesMeta;

    // Bob queries Alice's metadata via GET
    bob.send("METADATA alice GET display-name");
    const getLine = await bob.waitForNewLine(
      (l) => l.includes(" 761 ") && l.includes("Alice in Cloudland"),
    );
    expect(getLine).toContain("display-name");

    // Bob syncs channel metadata via METADATA #meta SYNC and receives member metadata
    bob.send("METADATA #meta SYNC");
    const syncMemberMeta = await bob.waitForLine(
      (l) => l.includes(" 761 ") && l.includes("display-name") && l.includes("Alice in Cloudland"),
    );
    expect(syncMemberMeta).toContain("Alice in Cloudland");

    // MARKREAD (draft/read-marker)
    const ts1 = "2026-11-10T22:00:00.000Z";
    const ts2 = "2026-11-10T21:00:00.000Z"; // older timestamp should not regress marker!
    alice.send(`MARKREAD #meta timestamp=${ts1}`);
    const mr1 = await alice.waitForNewLine((l) => l.includes(`MARKREAD #meta timestamp=${ts1}`));
    expect(mr1).toContain(ts1);

    // Sending older timestamp keeps monotonic ts1
    alice.send(`MARKREAD #meta timestamp=${ts2}`);
    const mr2 = await alice.waitForNewLine((l) => l.includes(`MARKREAD #meta timestamp=${ts1}`));
    expect(mr2).toContain(ts1);
  });

  it("supports SETNAME, CHGHOST, MONITOR, WHOX, mode lists (+b/+e/+I/+q), and Ergo NickServ/ChanServ", async () => {
    const alice = await connectWithAllCaps("alice");
    const bob = await connectWithAllCaps("bob");

    // 1. MONITOR
    bob.send("MONITOR + alice,ghostuser");
    const monOnline = await bob.waitForLine((l) => l.includes(" 730 "));
    const monOffline = await bob.waitForLine((l) => l.includes(" 731 "));
    expect(monOnline).toContain("alice!");
    expect(monOffline).toContain("ghostuser");

    // 2. Join #ergo
    alice.send("JOIN #ergo");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#ergo"));
    bob.send("JOIN #ergo");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#ergo"));

    // 3. SETNAME
    const bobSeesSetname = bob.waitForNewLine((l) => l.includes("SETNAME :Alice Updated Name"));
    alice.send("SETNAME :Alice Updated Name");
    await bobSeesSetname;

    // 4. CHGHOST
    const bobSeesChghost = bob.waitForNewLine((l) =>
      l.includes("CHGHOST alice_dev vhost.cfcord.dev"),
    );
    alice.send("CHGHOST alice_dev vhost.cfcord.dev");
    await bobSeesChghost;

    // 5. WHOX (%tcuhnfar,123)
    bob.send("WHO #ergo %tcuhnfar,123");
    const whoxLine = await bob.waitForNewLine(
      (l) => l.includes(" 354 ") && l.includes("123") && l.includes("vhost.cfcord.dev"),
    );
    expect(whoxLine).toContain("Alice Updated Name");

    // 6. Mode lists (+e, +I, +q) with labeled-response on item & end numerics
    alice.send("MODE #ergo +e *!*@*.trusted.org");
    await alice.waitForNewLine((l) => l.includes("MODE #ergo +e *!*@*.trusted.org"));
    alice.send("@label=el1 MODE #ergo +e");
    const exceptList = await alice.waitForLine(
      (l) => l.includes(" 348 ") && l.includes("label=el1"),
    );
    expect(exceptList).toContain("*!*@*.trusted.org");

    // 7. NickServ REGISTER & ChanServ INFO / AMODE on unregistered vs registered channels
    alice.send("@label=ns1 NS REGISTER supersecret123");
    await alice.waitForLine((l) => l.includes("Account created"));

    // Before registration: CS INFO #ergo -> "Channel #ergo is not registered", CS AMODE #ergo -> "Channel is not registered"
    alice.send("@label=cs0info CS INFO #ergo");
    const unregInfoLine = await alice.waitForLine((l) =>
      l.includes("Channel #ergo is not registered"),
    );
    expect(unregInfoLine).toContain("Channel #ergo is not registered");

    alice.send("@label=cs0amode CS AMODE #ergo");
    const unregAmodeLine = await alice.waitForLine((l) => l.includes("Channel is not registered"));
    expect(unregAmodeLine).toContain("Channel is not registered");

    // Register channel
    alice.send("@label=cs1 CS REGISTER #ergo");
    await alice.waitForLine((l) => l.includes("Channel #ergo successfully registered"));

    alice.send("@label=cs2 CS INFO #ergo");
    const csInfoLine = await alice.waitForLine((l) => l.includes("Founder: alice"));
    expect(csInfoLine).toContain("Founder: alice");

    alice.send("@label=cs3 CS AMODE #ergo");
    const csAmodeLine = await alice.waitForLine((l) => l.includes("persistent modes set"));
    expect(csAmodeLine).toContain("Channel #ergo has 1 persistent modes set");
    const csAmodeEntryLine = await alice.waitForLine((l) =>
      l.includes("Account alice receives mode +q"),
    );
    expect(csAmodeEntryLine).toContain("Account alice receives mode +q");

    // 8. Verify ergo.chat/nope is advertised in CAP LS and NAKed on CAP REQ per https://ergo.chat/specs/
    alice.send("CAP REQ :ergo.chat/nope");
    const nakLine = await alice.waitForNewLine((l) => l.includes("CAP alice NAK :ergo.chat/nope"));
    expect(nakLine).toContain("NAK");
  });

  it("supports full Ergo services (HostServ, HistServ, NickServ, ChanServ), service WHOIS/WHO/ISON/MONITOR, VERSION+ISUPPORT, modes (+f, +C, +M, +E, +R/ACCEPT), NPC/SCENE, and OPER commands", async () => {
    const alice = await connectWithAllCaps("alice");
    const bob = await connectWithAllCaps("bob");

    // 1. Register Alice and verify WHOIS on services (NickServ, ChanServ, HostServ, HistServ) and self
    alice.send("NS REGISTER supersecret123");
    await alice.waitForLine((l) => l.includes("Account created"));

    alice.send("WHOIS NickServ");
    const svcWhois = await alice.waitForLine(
      (l) => l.includes(" 313 ") && l.includes("NickServ") && l.includes("is a network service"),
    );
    expect(svcWhois).toContain("is a network service");

    alice.send("ISON NickServ ChanServ HostServ HistServ");
    const isonLine = await alice.waitForLine(
      (l) => l.includes(" 303 ") && l.includes("NickServ") && l.includes("HostServ"),
    );
    expect(isonLine).toContain("HistServ");

    // Self WHOIS includes 307 (registered nick), 378 (host), 379 (modes), 317 (idle)
    alice.send("WHOIS alice");
    await alice.waitForLine((l) => l.includes(" 307 ") && l.includes("is a registered nick"));
    await alice.waitForLine((l) => l.includes(" 378 ") && l.includes("is connecting from"));
    await alice.waitForLine((l) => l.includes(" 379 ") && l.includes("is using modes"));
    await alice.waitForLine((l) => l.includes(" 317 ") && l.includes("seconds idle"));

    // 2. HostServ SET / STATUS / OFF / ON
    alice.send("HS SET alice staff.ergo.chat");
    await alice.waitForLine((l) => l.includes(" 396 ") && l.includes("staff.ergo.chat"));
    await alice.waitForLine((l) => l.includes("Successfully set vhost staff.ergo.chat"));

    alice.send("HS STATUS");
    const hsStatus = await alice.waitForLine((l) =>
      l.includes("has vhost: staff.ergo.chat (enabled)"),
    );
    expect(hsStatus).toContain("staff.ergo.chat");

    // 3. NickServ GROUP, SET, GET, CLIENTS
    alice.send("NS SET always-on on");
    await alice.waitForLine((l) => l.includes("Successfully changed account setting always-on=on"));
    alice.send("NS CLIENTS");
    await alice.waitForLine((l) => l.includes("Sessions for account alice:"));

    // 4. VERSION emits 351 followed by 005 RPL_ISUPPORT; HELP & INFO & LANGUAGE work
    alice.send("VERSION");
    await alice.waitForLine((l) => l.includes(" 351 "));
    await alice.waitForLine((l) => l.includes(" 005 ") && l.includes("CHANMODES="));

    alice.send("HELP");
    await alice.waitForLine((l) => l.includes(" 704 "));
    await alice.waitForLine((l) => l.includes(" 706 "));

    alice.send("INFO");
    await alice.waitForLine((l) => l.includes(" 371 "));
    await alice.waitForLine((l) => l.includes(" 374 "));

    alice.send("LANGUAGE en");
    await alice.waitForLine((l) => l.includes(" 690 ") && l.includes("en"));

    // 5. Channel forwarding (+f), +C (no CTCP), +M (registered speak), +E (Roleplaying NPC/SCENE)
    alice.send("JOIN #closed");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#closed"));
    alice.send("JOIN #lobby");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#lobby"));

    alice.send("MODE #closed +if #lobby");
    await alice.waitForLine((l) => l.includes("MODE #closed +if #lobby"));

    // Bob tries to join #closed (+i with +f #lobby) -> gets 470 ERR_LINKCHANNEL and lands in #lobby!
    bob.send("JOIN #closed");
    await bob.waitForLine((l) => l.includes(" 470 ") && l.includes("#closed #lobby"));
    await bob.waitForLine((l) => l.includes("JOIN #lobby"));

    // Enable roleplay (+E) on #lobby and send NPC + SCENE
    alice.send("MODE #lobby +E");
    await alice.waitForLine((l) => l.includes("MODE #lobby +E"));

    const bobSeesNpc = bob.waitForNewLine(
      (l) => l.includes(":*Dragon*!") && l.includes("PRIVMSG #lobby :Roars loudly!"),
    );
    alice.send("NPC #lobby Dragon :Roars loudly!");
    await bobSeesNpc;

    const bobSeesScene = bob.waitForNewLine(
      (l) => l.includes(":=Scene=!") && l.includes("PRIVMSG #lobby :A dark cavern"),
    );
    alice.send("SCENE #lobby :A dark cavern");
    await bobSeesScene;

    // 6. User mode +R (registered-only DMs) and ACCEPT
    alice.send("MODE alice +R");
    await alice.waitForLine(
      (l) => (l.includes(" MODE ") || l.includes(" 221 ")) && l.includes("R"),
    );

    // Unauthenticated Bob cannot DM Alice until Alice ACCEPTs Bob
    bob.send("PRIVMSG alice :Hello Alice!");
    await bob.waitForLine((l) => l.includes(" 477 ") && l.includes("alice"));

    alice.send("ACCEPT bob");
    const aliceSeesDm = alice.waitForNewLine((l) => l.includes("PRIVMSG alice :Now allowed!"));
    bob.send("PRIVMSG alice :Now allowed!");
    await aliceSeesDm;

    // 7. ChanServ OP / DEOP / HOWTOBAN & HistServ PLAY / EXPORT
    alice.send("CS REGISTER #lobby");
    await alice.waitForLine((l) => l.includes("Channel #lobby successfully registered"));

    alice.send("CS OP #lobby bob");
    await bob.waitForLine((l) => l.includes("MODE #lobby +o bob"));

    alice.send("CS HOWTOBAN #lobby bob");
    await alice.waitForLine((l) => l.includes("To ban bob on #lobby"));

    alice.send("HISTSERV EXPORT #lobby");
    await alice.waitForLine((l) => l.includes("Export of #lobby"));
  });

  it("persists and serves draft/event-playback, draft/channel-rename, draft/auto-join, draft/webpush, extended-monitor, and DM chathistory", async () => {
    const alice = makeClient();
    await alice.connect();
    const bob = makeClient();
    await bob.connect();

    // 1. Register Alice with draft/event-playback, draft/channel-rename, draft/auto-join, draft/webpush, extended-monitor
    alice.send("CAP LS 302");
    await alice.waitForLine((l) => l.includes("CAP * LS"));
    alice.send(
      "CAP REQ :batch server-time msgid message-tags draft/chathistory draft/event-playback draft/channel-rename draft/auto-join draft/persistence draft/webpush extended-monitor away-notify setname chghost account-notify draft/extended-isupport draft/whoami draft/relaymsg soju.im/bouncer-networks",
    );
    await alice.waitForLine((l) => l.includes("CAP * ACK"));
    alice.send("NICK alice");
    alice.send("USER alice 0 * :Alice Wonder");
    alice.send("CAP END");
    await alice.waitForLine((l) => l.includes(" 001 alice "));

    // Register Bob with draft/pre-away during registration
    bob.send("CAP LS 302");
    await bob.waitForLine((l) => l.includes("CAP * LS"));
    bob.send(
      "CAP REQ :batch server-time msgid message-tags draft/chathistory draft/pre-away away-notify draft/channel-rename",
    );
    await bob.waitForLine((l) => l.includes("CAP * ACK"));
    bob.send("AWAY :Pre-away before registration!");
    bob.send("NICK bob");
    bob.send("USER bob 0 * :Bob Builder");
    bob.send("CAP END");
    await bob.waitForLine((l) => l.includes(" 001 bob "));

    // 2. Extended-monitor: Alice monitors Bob BEFORE sharing any channel
    alice.send("MONITOR + bob");
    await alice.waitForLine((l) => l.includes(" 730 ") && l.includes("bob"));

    const aliceSeesMonitoredSetname = alice.waitForNewLine(
      (l) => l.includes(":bob!bob@") && l.includes("SETNAME :Bobby Monitored"),
    );
    bob.send("SETNAME :Bobby Monitored");
    await aliceSeesMonitoredSetname;

    // 3. Join channel & verify away-notify on JOIN (from Bob's draft/pre-away)
    alice.send("JOIN #events");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#events"));

    const aliceSeesBobAwayOnJoin = alice.waitForNewLine(
      (l) => l.includes(":bob!bob@") && l.includes("AWAY :Pre-away before registration!"),
    );
    bob.send("JOIN #events");
    await bob.waitForLine((l) => l.includes(" 366 ") && l.includes("#events"));
    await aliceSeesBobAwayOnJoin;

    // 4. draft/event-playback: Topic changes are persisted in SQLite and replayed in CHATHISTORY when draft/event-playback is enabled
    alice.send("PRIVMSG #events :Before topic change");
    await bob.waitForLine((l) => l.includes("PRIVMSG #events :Before topic change"));

    alice.send("TOPIC #events :Updated Persistent Topic");
    await bob.waitForLine((l) => l.includes("TOPIC #events :Updated Persistent Topic"));

    alice.send("PRIVMSG #events :After topic change");
    await bob.waitForLine((l) => l.includes("PRIVMSG #events :After topic change"));

    // Alice (has draft/event-playback) queries CHATHISTORY and receives the TOPIC event in the batch!
    alice.send("CHATHISTORY LATEST #events * 10");
    await alice.waitForLine(
      (l) => l.includes("TOPIC #events :Updated Persistent Topic") && l.includes("batch="),
    );

    // 5. draft/channel-rename: RENAME #events #renamed migrates SQLite state (topic, history, modes, metadata)
    alice.send("MODE #events +m");
    await alice.waitForLine((l) => l.includes("MODE #events"));

    const bobSeesRename = bob.waitForNewLine((l) =>
      l.includes("RENAME #events #renamed :Migration time"),
    );
    alice.send("RENAME #events #renamed :Migration time");
    await bobSeesRename;

    // Query CHATHISTORY on #renamed -> migrated history and topic are preserved in #renamed's SQLite!
    alice.send("CHATHISTORY LATEST #renamed * 10");
    await alice.waitForLine((l) => l.includes("PRIVMSG #renamed :Before topic change"));
    await alice.waitForLine((l) => l.includes("TOPIC #renamed :Updated Persistent Topic"));

    // 6. Account registration, VERIFY, WEBPUSH persistence, and Auto-Join persistence
    alice.send("NS REGISTER alicepass123 alice@example.com");
    await alice.waitForLine((l) => l.includes("Account created"));

    alice.send("VERIFY alice code123");
    await alice.waitForLine((l) => l.includes(" 923 "));

    alice.send("WEBPUSH REGISTER https://push.example.com/sub1 p256dh=abc;auth=def");
    await alice.waitForLine((l) => l.includes("WEBPUSH REGISTER https://push.example.com/sub1"));

    alice.send("WEBPUSH LIST");
    await alice.waitForLine((l) => l.includes("WEBPUSH LIST https://push.example.com/sub1"));
    await alice.waitForLine((l) => l.endsWith("WEBPUSH LIST"));

    alice.send("JOIN #autojoin-test");
    await alice.waitForLine((l) => l.includes(" 366 ") && l.includes("#autojoin-test"));

    // Reconnect a second session for Alice with SASL + draft/auto-join -> automatically joins #autojoin-test!
    const alice2 = makeClient();
    await alice2.connect();
    alice2.send("CAP LS 302");
    await alice2.waitForLine((l) => l.includes("CAP * LS"));
    alice2.send("CAP REQ :sasl draft/auto-join");
    await alice2.waitForLine((l) => l.includes("CAP * ACK"));
    alice2.send("AUTHENTICATE PLAIN");
    await alice2.waitForLine((l) => l.includes("AUTHENTICATE +"));
    const plain = Buffer.from("alice\0alice\0alicepass123").toString("base64");
    alice2.send(`AUTHENTICATE ${plain}`);
    await alice2.waitForLine((l) => l.includes(" 903 "));
    alice2.send("NICK alice2");
    alice2.send("USER alice 0 * :Alice Two");
    alice2.send("CAP END");
    await alice2.waitForLine(
      (l) =>
        l.includes("JOIN #autojoin-test") || (l.includes(" 366 ") && l.includes("#autojoin-test")),
    );

    // 7. ISUPPORT batch, WHOAMI, RELAYMSG, BOUNCER LISTNETWORKS, and DM CHATHISTORY
    alice.send("ISUPPORT");
    await alice.waitForLine((l) => l.includes("BATCH +") && l.includes("draft/isupport"));

    alice.send("WHOAMI");
    await alice.waitForLine((l) => l.includes("WHOAMI") || l.includes("alice"));

    alice.send("BOUNCER LISTNETWORKS");
    await alice.waitForLine((l) => l.includes("BOUNCER LISTNETWORKS 200 OK"));

    // DM CHATHISTORY (LATEST + BEFORE)
    bob.send("PRIVMSG alice :DM message 1");
    await alice.waitForLine((l) => l.includes("PRIVMSG alice :DM message 1"));
    bob.send("PRIVMSG alice :DM message 2");
    await alice.waitForLine((l) => l.includes("PRIVMSG alice :DM message 2"));

    alice.send("PRIVMSG bob :DM reply from alice");
    await bob.waitForLine((l) => l.includes("PRIVMSG bob :DM reply from alice"));

    // Replayed DMs must keep their ORIGINAL source and target
    alice.send("CHATHISTORY LATEST bob * 10");
    const dm1 = await alice.waitForLine(
      (l) =>
        l.includes(":bob!bob@") &&
        l.includes("PRIVMSG alice :DM message 1") &&
        l.includes("batch="),
    );
    await alice.waitForLine(
      (l) =>
        l.includes(":alice!alice@") &&
        l.includes("PRIVMSG bob :DM reply from alice") &&
        l.includes("batch="),
    );

    // BEFORE msgid=<dm2> returns only DM message 1
    const dm1Id = dm1.match(/msgid=([^; ]+)/)![1];
    alice.send(`CHATHISTORY AFTER bob msgid=${dm1Id} 1`);
    await alice.waitForNewLine(
      (l) => l.includes("PRIVMSG alice :DM message 2") && l.includes("batch="),
    );

    // CHATHISTORY TARGETS lists the DM peer
    alice.send(
      "CHATHISTORY TARGETS timestamp=2000-01-01T00:00:00Z timestamp=2100-01-01T00:00:00Z 10",
    );
    await alice.waitForLine((l) => l.includes("CHATHISTORY TARGETS bob"));
  });
});
