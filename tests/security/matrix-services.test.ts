import { describe, expect, it } from "vitest";
import { createMatrixFixture } from "../helpers/matrix-fixture";

describe("matrix channel services", () => {
  it("SVC-009 SVC-017: ChanServ and F enforce rank ceilings and channel scope", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      a.send("JOIN #roles");
      await a.waitForNumeric(366);
      b.send("JOIN #roles");
      await b.waitForNumeric(366);
      c.send("JOIN #staff");
      await c.waitForNumeric(366);
      b.send("JOIN #staff");
      await b.waitForNewLine((l) => l.includes(" 366 ") && l.includes("#staff"));
      a.send("CS AMODE #roles +h bob");
      await b.waitForLine((l) => l.includes("MODE #roles +h bob"));
      for (const command of [
        "CS OP #roles bob",
        "CS AMODE #roles +o bob",
        "F CHANLEV #roles bob +o",
        "CS AMODE #roles +v alice",
        "CS OP #staff bob",
      ]) {
        const denied = b.waitForNewLine(
          (l) =>
            l.includes("NOTICE bob") && /higher channel privileges|Insufficient privileges/.test(l),
        );
        b.send(command);
        await denied;
      }
      a.send("CS AMODE #roles +o bob");
      await b.waitForLine((l) => l.includes("MODE #roles +o bob"));
      const denied = b.waitForNewLine((l) => l.includes("higher channel privileges"));
      b.send("CS DEOP #roles alice");
      await denied;
      await Promise.all([f.barrier(a), f.barrier(c)]);
      expect(c.lines.some((l) => l.includes("MODE #staff +o bob"))).toBe(false);
      expect(
        (
          await f.request("/api/v1/channels/%23staff/info", bob, "PATCH", {
            description: "cross-channel-forgery",
          })
        ).status,
      ).toBe(403);
      expect(
        await (await f.request("/api/v1/channels/%23staff/info", charlie)).text(),
      ).not.toContain("cross-channel-forgery");
    } finally {
      await f.dispose();
    }
  });
});

import { TestIRCClient } from "../helpers/miniflare-harness";

async function command(client: TestIRCClient, text: string, pattern: RegExp) {
  const reply = client.waitForNewLine((line) => pattern.test(line));
  client.send(text);
  return reply;
}

async function join(client: TestIRCClient, channel: string) {
  await command(client, `JOIN ${channel}`, new RegExp(` 366 .* ${channel} `));
}

describe("matrix service authentication and identities", () => {
  it("SVC-001 SVC-004 SVC-014: pre-auth service commands and unregistered channel requests are denied", async () => {
    const f = await createMatrixFixture();
    const guest = new TestIRCClient(f.server.wsUrl);
    try {
      const alice = await f.createActor("alice");
      const a = await f.connect(alice);
      await guest.connect();
      for (const text of [
        "CS REGISTER #unregistered",
        "F OP #unregistered guest",
        "PRIVMSG ChanServ :REGISTER #unregistered",
      ]) {
        await command(guest, text, / 451 .*Authenticate before using this command/);
      }
      await command(a, "CS REGISTER #unregistered", /You must be on #unregistered to register it/);
      await command(a, "F REQUESTBOT #unregistered", /is not registered/);
      await command(a, "F CHANLEV #unregistered alice +q", /Channel is not registered/);
      await join(a, "#control");
      await command(a, "CS INFO #control", /Founder: alice/);
      await f.stop();
      const permissions = JSON.stringify(await f.snapshot("channel_permissions"));
      expect(permissions).toContain('"account_name":"alice"');
      expect(permissions.match(/"permission":"q"/g)).toHaveLength(1);
    } finally {
      guest.close();
      await f.dispose();
    }
  });

  it("SVC-002 SVC-003 SVC-015: failed service identity changes and reserved nicknames cannot impersonate accounts or services", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice),
        b = await f.connect(bob);
      await join(a, "#identity");
      await join(b, "#identity");
      for (const text of [
        "NS IDENTIFY alice wrong-password",
        "PRIVMSG NickServ :IDENTIFY alice wrong-password",
        "F AUTH alice wrong-password",
      ]) {
        await command(b, text, /Invalid account or password|Authentication failed/);
        await command(b, "F CHANLEV #identity bob +q", /sufficient privileges/);
      }
      await command(b, "NICK alice", / 433 /);
      for (const nick of ["NickServ", "ChanServ", "F", "Q", "FlareServ"]) {
        await command(b, `NICK ${nick}`, / 432 | 433 /);
      }
      await command(b, "NS DROP alice", /Could not drop nickname alice/);
      await command(b, "NICK BobExtra", / NICK :?BobExtra/);
      await command(b, "NS GROUP", /Successfully grouped nickname BobExtra/);
      const aliceDetails = (await (await f.request("/admin/accounts/alice", root)).json()) as any;
      const bobDetails = (await (await f.request("/admin/accounts/bob", root)).json()) as any;
      expect(aliceDetails.registeredNicks).toContain("alice");
      expect(bobDetails.registeredNicks).not.toContain("alice");
      expect(bobDetails.registeredNicks).toContain("bobextra");
      await Promise.all([f.barrier(a), f.barrier(b)]);
      expect(a.lines.some((l) => / MODE #identity \+q bob/.test(l))).toBe(false);
      await f.stop();
      const nicks = JSON.stringify(await f.snapshot("registered_nicks"));
      expect(nicks).toContain('"nickname":"alice"');
      expect(nicks).toContain('"nickname":"bobextra"');
    } finally {
      await f.dispose();
    }
  });
});

describe("matrix F command authority", () => {
  it("SVC-005 SVC-006 SVC-008 SVC-009 SVC-010 SVC-011 SVC-017: grants and denials respect ranks and channel boundaries", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie"),
        outsider = await f.createActor("outsider");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie),
        x = await f.connect(outsider);
      for (const client of [a, b, c]) await join(client, "#service");
      await join(x, "#other");
      await join(b, "#other");
      const base = "/api/v1/channels/%23service";
      expect(
        (await f.request(`${base}/roles`, bob, "POST", { name: "forged", ircMode: "q" })).status,
      ).toBe(403);
      for (const text of [
        "F OP #service bob",
        "F VOICE #service bob",
        "F CHANLEV #service bob +q",
        "PRIVMSG F :CHANLEV #service bob +o",
      ]) {
        await command(b, text, /Access denied|sufficient privileges/);
      }
      await command(a, "F OP #service bob", /OP applied for bob/);
      await b.waitForLine((l) => l.includes(" MODE #service +o bob"));
      await command(b, "F CHANLEV #service bob +q", /Only the founder/);
      await command(b, "F OP #other bob", /Access denied/);
      await command(b, "F VOICE #service charlie", /VOICE applied for charlie/);
      await c.waitForLine((l) => l.includes(" MODE #service +v charlie"));
      await command(b, "F DEVOICE #service charlie", /DEVOICE applied for charlie/);
      await c.waitForLine((l) => l.includes(" MODE #service -v charlie"));
      await command(a, "F DEOP #service bob", /DEOP applied for bob/);
      await b.waitForLine((l) => l.includes(" MODE #service -o bob"));
      await command(b, "F DEVOICE #service charlie", /Access denied/);
      expect(
        (await f.request(`${base}/roles`, bob, "POST", { name: "still-forged", ircMode: "q" }))
          .status,
      ).toBe(403);
      expect(
        (await f.request(`${base}/info`, alice, "PATCH", { description: "founder-control" }))
          .status,
      ).toBe(200);
      expect(await (await f.request(`${base}/info`, alice)).text()).toContain("founder-control");
      await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c), f.barrier(x)]);
      expect(x.lines.some((l) => l.includes(" MODE #service "))).toBe(false);
      expect(a.lines.some((l) => l.includes(" MODE #service -o alice"))).toBe(false);
      expect(x.lines.some((l) => l.includes(" MODE #other +o bob"))).toBe(false);
      await f.stop();
      const permissions = JSON.stringify(await f.snapshot("channel_permissions"));
      expect(permissions).not.toContain('"account_name":"bob"');
      expect(permissions).not.toContain('"account_name":"charlie"');
      const roles = JSON.stringify(await f.snapshot("channel_role_groups"));
      expect(roles).not.toContain("forged");
    } finally {
      await f.dispose();
    }
  });

  it("SVC-010 SVC-011: persistent F grants and REST authorization agree across aliases", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      for (const client of [a, b, c]) await join(client, "#grants");
      await command(c, "Q CHANLEV #grants charlie +o", /sufficient privileges/);
      expect(
        (
          await f.request("/api/v1/channels/%23grants/info", charlie, "PATCH", {
            description: "forbidden",
          })
        ).status,
      ).toBe(403);
      await command(a, "PRIVMSG F :CHANLEV #grants bob +o", /persistent mode|successfully|set/i);
      expect(
        (
          await f.request("/api/v1/channels/%23grants/info", bob, "PATCH", {
            description: "authorized-grant",
          })
        ).status,
      ).toBe(200);
      await command(b, "FLARESERV VOICE #grants charlie", /VOICE applied for charlie/);
      await c.waitForLine((l) => l.includes(" MODE #grants +v charlie"));
      await command(a, "F CHANLEV #grants bob -o", /persistent mode|successfully|removed/i);
      await command(b, "Q OP #grants charlie", /Access denied/);
      expect(
        (
          await f.request("/api/v1/channels/%23grants/info", bob, "PATCH", {
            description: "after-revoke",
          })
        ).status,
      ).toBe(403);
      const info = await (await f.request("/api/v1/channels/%23grants/info", alice)).text();
      expect(info).toContain("authorized-grant");
      expect(info).not.toContain("forbidden");
      expect(info).not.toContain("after-revoke");
      await f.barrier(c);
      expect(c.lines.some((l) => l.includes(" MODE #grants +o charlie"))).toBe(false);
      await f.stop();
      const permissions = JSON.stringify(await f.snapshot("channel_permissions"));
      expect(permissions).not.toContain('"account_name":"bob"');
      expect(permissions).not.toContain('"account_name":"charlie"');
    } finally {
      await f.dispose();
    }
  });

  it("SVC-007: F DEOP cannot strip a founder's operator mode", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice),
        b = await f.connect(bob);
      await join(a, "#hierarchy");
      await join(b, "#hierarchy");
      await command(a, "F OP #hierarchy bob", /OP applied for bob/);
      const reply = b.waitForNewLine((l) => l.includes(" NOTICE bob "));
      b.send("F DEOP #hierarchy alice");
      expect(await reply).toMatch(/higher channel privileges/);
      await f.barrier(a);
      expect(a.lines.some((l) => l.includes(" MODE #hierarchy -o alice"))).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("SVC-012 SVC-013: persistent ChanServ access survives reconnect and removal revokes multiple devices", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      let a = await f.connect(alice),
        b = await f.connect(bob),
        b2 = await f.connect(bob, "bobtwo"),
        c = await f.connect(charlie);
      for (const client of [a, b, b2, c]) await join(client, "#persist");
      await command(a, "CS AMODE #persist +o bob", /persistent mode|successfully|set/i);
      await b.waitForLine((l) => l.includes(" MODE #persist +o bob"));
      await f.restart();
      a = await f.connect(alice);
      b = await f.connect(bob);
      b2 = await f.connect(bob, "bobtwo");
      c = await f.connect(charlie);
      for (const client of [a, b, b2, c]) await join(client, "#persist");
      await command(b, "F VOICE #persist charlie", /VOICE applied for charlie/);
      await c.waitForLine((l) => l.includes(" MODE #persist +v charlie"));
      await command(a, "CS AMODE #persist -o bob", /persistent mode|successfully|removed/i);
      for (const client of [b, b2]) await command(client, "F OP #persist charlie", /Access denied/);
      expect(
        (
          await f.request("/api/v1/channels/%23persist/info", bob, "PATCH", {
            description: "revoked",
          })
        ).status,
      ).toBe(403);
      await Promise.all([f.barrier(a), f.barrier(c)]);
      expect(c.lines.some((l) => l.includes(" MODE #persist +o charlie"))).toBe(false);
      await f.stop();
      const permissions = JSON.stringify(await f.snapshot("channel_permissions"));
      expect(permissions).not.toContain('"account_name":"bob"');
      expect(permissions).toContain('"account_name":"alice"');
    } finally {
      await f.dispose();
    }
  });
});
