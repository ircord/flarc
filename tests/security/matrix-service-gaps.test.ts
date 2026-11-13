import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import { TestIRCClient } from "../helpers/miniflare-harness";
import { channelGrants } from "../helpers/service-gap-fixture";

async function command(client: TestIRCClient, text: string, reply: RegExp) {
  const pending = client.waitForNewLine((line) => reply.test(line));
  client.send(text);
  return await pending;
}
async function join(client: TestIRCClient, channel: string) {
  await command(client, `JOIN ${channel}`, new RegExp(` 366 .* ${channel} `));
}

it("[SVC-005 SVC-006 SVC-007 SVC-008 SVC-009 SVC-010 SVC-011 SVC-013 SVC-017] F aliases enforce rank and persistent grant removal after recreation", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const founder = await f.createActor("founder"),
      admin = await f.createActor("chanadmin"),
      op = await f.createActor("operator"),
      member = await f.createActor("member"),
      outsider = await f.createActor("outsider");
    let a = await f.connect(founder),
      d = await f.connect(admin),
      o = await f.connect(op),
      m = await f.connect(member),
      x = await f.connect(outsider);
    for (const c of [a, d, o, m]) await join(c, "#service");
    await join(x, "#other");
    await join(o, "#other");
    await command(x, "F CHANLEV #other operator +v", /persistent mode|successfully|set/i);
    await command(a, "F CHANLEV #service chanadmin +a", /persistent mode|successfully|set/i);
    await command(
      a,
      "PRIVMSG F :CHANLEV #service operator +o",
      /persistent mode|successfully|set/i,
    );
    const base = "/api/v1/channels/%23service";
    expect(
      (await f.request(`${base}/info`, op, "PATCH", { description: "operator-positive" })).status,
    ).toBe(200);
    const seen: string[][] = [[], []];
    for (const [i, actor] of [founder, outsider].entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(ticket.status).toBe(200);
      const socket = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
      );
      sockets.push(socket);
      socket.on("message", (data) => seen[i].push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
    }
    // Both event subscribers and IRC observers receive these public barrier messages.
    for (const c of [a, x]) await join(c, "#barrier");
    const barrier = async (marker: string) => {
      const waits = sockets.map(
        (socket) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`missing event barrier ${marker}`)),
              4000,
            );
            socket.on("message", function listener(data) {
              if (data.toString().includes(marker)) {
                clearTimeout(timer);
                socket.off("message", listener);
                resolve();
              }
            });
          }),
      );
      const response = await f.request("/api/v1/channels/%23barrier/messages", founder, "POST", {
        content: marker,
      });
      expect(response.status).toBe(201);
      await Promise.all([
        ...waits,
        a.waitForLine((l) => l.includes(marker)),
        x.waitForLine((l) => l.includes(marker)),
      ]);
    };
    // Actual aliases, positive MODE delivery, and operator's lower rank target.
    for (const [cmd, mode] of [
      ["F OP #service member", "+o"],
      ["PRIVMSG F :DEOP #service member", "-o"],
      ["F VOICE #service member", "+v"],
      ["PRIVMSG F :DEVOICE #service member", "-v"],
    ]) {
      const delivered = m.waitForNewLine((l) => l.includes(` MODE #service ${mode} member`));
      await command(o, cmd, /applied for member/);
      await delivered;
    }
    const role = await f.request(`${base}/roles`, founder, "POST", {
      name: "authorized-role",
      permissions: [],
    });
    expect(role.status).toBe(201);
    await command(a, "MODE #service +v member", / MODE #service \+v member/);
    await command(a, "MODE #service -v member", / MODE #service -v member/);
    await barrier("service-before-denials");
    const offsets = seen.map((v) => v.length),
      ircOffsets = [a.lines.length, m.lines.length, x.lines.length];
    for (const text of [
      "F CHANLEV #service member +q",
      "PRIVMSG F :CHANLEV #service member +o",
      "F OP #service member",
      "F DEOP #service operator",
      "F VOICE #service member",
      "F DEVOICE #service operator",
    ])
      await command(m, text, /Access denied|sufficient privileges/i);
    await command(o, "F DEOP #service founder", /higher channel privileges/i);
    await command(o, "F OP #service chanadmin", /higher channel privileges/i);
    await command(d, "F DEVOICE #service founder", /higher channel privileges/i);
    await command(d, "F DEOP #service founder", /higher channel privileges/i);
    await command(
      o,
      "F CHANLEV #service operator +q",
      /Only the founder|higher channel privileges/i,
    );
    await command(o, "F OP #other operator", /Access denied/i);
    expect(
      (await f.request(`${base}/roles`, member, "POST", { name: "forged", permissions: [] }))
        .status,
    ).toBe(403);
    await barrier("service-after-denials");
    for (const [i, events] of seen.entries())
      expect(events.slice(offsets[i]).every((v) => v.includes("service-after-denials"))).toBe(true);
    for (const [i, client] of [a, m, x].entries())
      expect(client.lines.slice(ircOffsets[i]).filter((l) => l.includes(" MODE "))).toEqual([]);
    await command(a, "F CHANLEV #service operator -o", /persistent mode|successfully|removed/i);
    await command(o, "F VOICE #service member", /Access denied/i);
    expect(
      (await f.request(`${base}/info`, op, "PATCH", { description: "denied-after-removal" }))
        .status,
    ).toBe(403);
    const grantMode = m.waitForNewLine((l) => l.includes(" MODE #service +o operator"));
    await command(a, "CS AMODE #service +o operator", /persistent mode|successfully|set/i);
    await grantMode;
    await barrier("service-cs-grant-control");
    await command(o, "F VOICE #service member", /VOICE applied for member/i);
    await command(a, "CS AMODE #service -o operator", /persistent mode|successfully|removed/i);
    await command(o, "F OP #service member", /Access denied/i);
    sockets.forEach((s) => {
      s.terminate();
    });
    await f.restart();
    a = await f.connect(founder);
    d = await f.connect(admin);
    o = await f.connect(op);
    m = await f.connect(member);
    x = await f.connect(outsider);
    for (const c of [a, d, o, m]) await join(c, "#service");
    await join(x, "#other");
    await join(o, "#other");
    await command(o, "F OP #service member", /Access denied/i);
    await command(m, "F CHANLEV #service member +q", /sufficient privileges/i);
    await command(m, "F VOICE #service member", /Access denied/i);
    await command(m, "MODE #service +o member", / 482 /);
    await command(d, "F DEVOICE #service founder", /higher channel privileges/i);
    await command(d, "F DEOP #service founder", /higher channel privileges/i);
    await command(
      o,
      "PRIVMSG F :CHANLEV #service operator +q",
      /sufficient privileges|Only the founder/i,
    );
    expect(
      (await f.request(`${base}/info`, op, "PATCH", { description: "denied-recreated" })).status,
    ).toBe(403);
    expect(await (await f.request(`${base}/info`, founder)).text()).toContain("operator-positive");
    await command(d, "F VOICE #service member", /VOICE applied for member/i);
    await f.stop();
    const perms = (await f.snapshot("channel_permissions")).flat() as any[];
    expect(perms.filter((p) => p.account_name === "operator").map((p) => p.permission)).toEqual([
      "v",
    ]);
    expect(perms.some((p) => p.account_name === "chanadmin" && p.permission === "a")).toBe(true);
    expect(perms.filter((p) => p.account_name === "member")).toEqual([]);
  } finally {
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
});

it("[SVC-010 SVC-011 SVC-012 SVC-013] actual F and ChanServ persistent removals survive independent recreations", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie"),
      outsider = await f.createActor("outsider");
    let a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie),
      x = await f.connect(outsider);
    const connectChannels = async () => {
      for (const client of [a, b, c]) await join(client, "#grants");
      for (const client of [a, x]) await join(client, "#observe");
    };
    await connectChannels();
    await join(c, "#sentinel");
    await command(c, "CS AMODE #sentinel +v bob", /persistent mode|successfully|set/i);
    const endpoint = "/api/v1/channels/%23grants/info";
    const rolePath = "/api/v1/channels/%23grants/roles";
    const baseline = await channelGrants(f.directory, "#grants"),
      sentinel = await channelGrants(f.directory, "#sentinel");
    expect(sentinel.some((r: any) => r.account_name === "bob" && r.permission === "v")).toBe(true);
    const observeDenial = async (tag: string) => {
      const streams: string[][] = [[], []],
        current: WebSocket[] = [];
      for (const [i, actor] of [alice, outsider].entries()) {
        const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
        expect(ticket.status).toBe(200);
        const socket = new WebSocket(
          `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
        );
        sockets.push(socket);
        current.push(socket);
        socket.on("message", (data) => streams[i].push(data.toString()));
        await new Promise<void>((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
      }
      const barrier = async (phase: string) => {
        const marker = `${tag}-${phase}`;
        const pending = current.map(
          (socket) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error(`Missing ${marker}`)), 4000);
              socket.on("message", function listener(data) {
                if (data.toString().includes(marker)) {
                  clearTimeout(timer);
                  socket.off("message", listener);
                  resolve();
                }
              });
            }),
        );
        expect(
          (
            await f.request("/api/v1/channels/%23observe/messages", alice, "POST", {
              content: marker,
            })
          ).status,
        ).toBe(201);
        await Promise.all([
          ...pending,
          a.waitForLine((l) => l.includes(marker)),
          x.waitForLine((l) => l.includes(marker)),
        ]);
      };
      await barrier("before");
      const eventsStart = streams.map((v) => v.length),
        ircStart = [a.lines.length, c.lines.length, x.lines.length];
      const protectedBefore = await channelGrants(f.directory, "#grants"),
        unrelatedBefore = await channelGrants(f.directory, "#sentinel");
      await command(b, "F OP #grants charlie", /Access denied/i);
      expect(
        (await f.request(endpoint, bob, "PATCH", { description: `denied-${tag}` })).status,
      ).toBe(403);
      expect(
        (await f.request(rolePath, bob, "POST", { name: `denied-${tag}`, permissions: [] })).status,
      ).toBe(403);
      await barrier("after");
      for (const [i, stream] of streams.entries())
        expect(stream.slice(eventsStart[i]).every((value) => value.includes(`${tag}-after`))).toBe(
          true,
        );
      for (const [i, client] of [a, c, x].entries())
        expect(
          client.lines.slice(ircStart[i]).filter((line) => line.includes(" MODE #grants ")),
        ).toEqual([]);
      expect(await channelGrants(f.directory, "#grants")).toEqual(protectedBefore);
      expect(await channelGrants(f.directory, "#sentinel")).toEqual(unrelatedBefore);
      expect(unrelatedBefore).toEqual(sentinel);
      for (const socket of current) socket.terminate();
    };
    for (const [index, [grant, remove]] of [
      ["F CHANLEV #grants bob +o", "F CHANLEV #grants bob -o"],
      ["CS AMODE #grants +o bob", "CS AMODE #grants -o bob"],
    ].entries()) {
      await command(a, grant, /persistent mode|successfully|set/i);
      const withGrant = await channelGrants(f.directory, "#grants");
      expect(withGrant.some((r: any) => r.account_name === "bob" && r.permission === "o")).toBe(
        true,
      );
      expect(await channelGrants(f.directory, "#sentinel")).toEqual(sentinel);
      expect(
        (await f.request(endpoint, bob, "PATCH", { description: "authorized-control" })).status,
      ).toBe(200);
      await command(b, "F VOICE #grants charlie", /VOICE applied for charlie/i);
      await f.restart();
      a = await f.connect(alice);
      b = await f.connect(bob);
      c = await f.connect(charlie);
      x = await f.connect(outsider);
      await connectChannels();
      expect(await channelGrants(f.directory, "#grants")).toEqual(withGrant);
      expect(
        (await f.request(endpoint, bob, "PATCH", { description: "grant-after-restart" })).status,
      ).toBe(200);
      await command(b, "F OP #grants charlie", /OP applied for charlie/i);
      await command(a, remove, /persistent mode|successfully|removed/i);
      expect(await channelGrants(f.directory, "#grants")).toEqual(baseline);
      await observeDenial(`service-${index}-immediate`);
      await f.restart();
      a = await f.connect(alice);
      b = await f.connect(bob);
      c = await f.connect(charlie);
      x = await f.connect(outsider);
      await connectChannels();
      expect(await channelGrants(f.directory, "#grants")).toEqual(baseline);
      await observeDenial(`service-${index}-recreated`);
      expect(await (await f.request(endpoint, alice)).text()).toContain("grant-after-restart");
    }
  } finally {
    for (const socket of sockets) socket.terminate();
    await f.dispose();
  }
});

it("[SVC-001 SVC-002 SVC-003 SVC-004 SVC-014 SVC-015] service authentication and identity gates retain independent grants after restart", async () => {
  const f = await createMatrixFixture();
  let guest = new TestIRCClient(f.server.wsUrl);
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    let a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await join(a, "#registered");
    await join(b, "#registered");
    await join(c, "#unrelated");
    await command(c, "CS AMODE #unrelated +v bob", /persistent mode|successfully|set/i);
    await command(a, "CS INFO #registered", /Founder: alice/);
    const botJoin = b.waitForNewLine(
      (l) => l.includes(" JOIN #registered") && l.includes("F!services@"),
    );
    await command(a, "F REQUESTBOT #registered", /F has joined/);
    await botJoin;
    await guest.connect();
    for (const text of [
      "CS REGISTER #never",
      "F CHANLEV #never alice +q",
      "PRIVMSG ChanServ :REGISTER #never",
    ])
      await command(guest, text, / 451 .*Authenticate before using this command/);
    await command(b, "CS REGISTER #never", /You must be on #never to register/);
    await command(b, "F REQUESTBOT #never", /is not registered/i);
    await command(b, "F CHANLEV #never bob +q", /Channel is not registered/i);
    await command(b, "F OP #never bob", /Access denied/i);
    const unregister = await command(a, "CS UNREGISTER #registered", /CS UNREGISTER #registered/i);
    const code = unregister.match(/UNREGISTER #registered ([a-f0-9]+)/i)?.[1];
    expect(code).toBeTruthy();
    await command(a, `CS UNREGISTER #registered ${code}`, /now unregistered/i);
    await command(b, "F REQUESTBOT #registered", /not registered/i);
    await command(b, "CS REGISTER #registered", /must be a channel operator/i);
    await command(a, "CS REGISTER #registered", /registered/i);
    await command(b, `F AUTH bob ${bob.password}`, /AUTH successful.*bob/i);
    await command(b, "NICK BobExtra", / NICK :?BobExtra/i);
    await command(b, "NS GROUP", /Successfully grouped nickname BobExtra/i);
    await join(a, "#identitybarrier");
    await join(c, "#identitybarrier");
    const seen: string[][] = [[], []];
    for (const [i, actor] of [alice, charlie].entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(ticket.status).toBe(200);
      const socket = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
      );
      sockets.push(socket);
      socket.on("message", (data) => seen[i].push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
    }
    const barrier = async (marker: string) => {
      const waits = sockets.map(
        (socket) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Missing barrier ${marker}`)), 4000);
            socket.on("message", function listener(data) {
              if (data.toString().includes(marker)) {
                clearTimeout(timer);
                socket.off("message", listener);
                resolve();
              }
            });
          }),
      );
      expect(
        (
          await f.request("/api/v1/channels/%23identitybarrier/messages", alice, "POST", {
            content: marker,
          })
        ).status,
      ).toBe(201);
      await Promise.all([
        ...waits,
        a.waitForLine((l) => l.includes(marker)),
        c.waitForLine((l) => l.includes(marker)),
      ]);
    };
    await barrier("identity-before-denials");
    const offsets = seen.map((x) => x.length),
      starts = [a.lines.length, c.lines.length];
    await command(b, "F REQUESTBOT #never", /not registered/i);
    await command(b, "CS REGISTER #never", /You must be on #never to register/i);
    await command(guest, "F CHANLEV #never alice +q", / 451 /);
    for (const text of [
      "NS IDENTIFY alice wrong-password",
      "PRIVMSG NickServ :IDENTIFY alice wrong-password",
      "F AUTH alice wrong-password",
    ])
      await command(b, text, /Invalid account or password|Authentication failed/);
    for (const nick of ["F", "NickServ", "ChanServ"])
      await command(b, `NICK ${nick}`, / 432 | 433 /);
    await command(b, "NICK alice", / 433 .*Nickname belongs to another account/i);
    await command(b, "NS GROUP alice", /Successfully grouped nickname BobExtra to account bob/i);
    await command(b, "NS SAREGISTER alice attacker-password", /Insufficient privileges/i);
    await command(b, "NS DROP alice", /Could not drop nickname alice/i);
    await barrier("identity-after-denials");
    for (const [i, events] of seen.entries())
      expect(events.slice(offsets[i]).every((x) => x.includes("identity-after-denials"))).toBe(
        true,
      );
    for (const [i, client] of [a, c].entries())
      expect(
        client.lines
          .slice(starts[i])
          .filter((l) => l.includes(" MODE ") || /:(F|NickServ|ChanServ)!.* PRIVMSG /.test(l)),
      ).toEqual([]);
    const spoof = a.waitForNewLine((l) => l.includes(" PRIVMSG #registered :spoof-source-control"));
    b.send(":F!services@irc.flarc.local PRIVMSG #registered :spoof-source-control");
    expect(await spoof).toMatch(/:BobExtra!/i);
    for (const socket of sockets) socket.terminate();
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
    expect(a.lines.filter((l) => l.includes(" MODE #registered +q bob"))).toEqual([]);
    await f.restart();
    a = await f.connect(alice);
    b = await f.connect(bob);
    c = await f.connect(charlie);
    await join(a, "#registered");
    await join(b, "#registered");
    await join(c, "#unrelated");
    guest = new TestIRCClient(f.server.wsUrl);
    await guest.connect();
    await command(guest, "F CHANLEV #never alice +q", / 451 /);
    await command(
      b,
      "NS IDENTIFY alice wrong-password",
      /Invalid account or password|Authentication failed/,
    );
    await command(b, "NICK F", / 432 | 433 /);
    await command(b, "NICK alice", / 433 .*Nickname belongs to another account/i);
    await command(b, "NICK BobExtra", / NICK :?BobExtra/i);
    await command(b, "NS GROUP alice", /Successfully grouped nickname BobExtra to account bob/i);
    await command(b, "NS SAREGISTER alice attacker-password", /Insufficient privileges/i);
    await command(b, "NICK bob", / NICK :?bob/i);
    await command(b, "F AUTH alice wrong-password", /Authentication failed/i);
    await command(b, "NS DROP alice", /Could not drop nickname alice/i);
    await command(b, "CS REGISTER #never", /You must be on #never to register/);
    await command(b, "F CHANLEV #registered bob +q", /sufficient privileges/i);
    await command(b, "F REQUESTBOT #never", /is not registered/i);
    await command(a, "CS INFO #registered", /Founder: alice/);
    await f.stop();
    const permissions = (await f.snapshot("channel_permissions")).flat() as any[];
    expect(permissions.filter((p) => p.account_name === "bob").map((p) => p.permission)).toEqual([
      "v",
    ]);
    expect(permissions.some((p) => p.account_name === "alice" && p.permission === "q")).toBe(true);
    const nicks = (await f.snapshot("registered_nicks")).flat() as any[];
    expect(nicks.find((n) => n.nickname === "alice")?.user_id).toBe(alice.account.id);
    expect(nicks.find((n) => n.nickname === "bob")?.user_id).toBe(bob.account.id);
    expect(nicks.find((n) => n.nickname === "bobextra")?.user_id).toBe(bob.account.id);
  } finally {
    for (const socket of sockets) socket.terminate();
    guest.close();
    await f.dispose();
  }
});
