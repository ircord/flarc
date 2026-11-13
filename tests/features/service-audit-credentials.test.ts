import { expect, it } from "vitest";
import { hashSessionToken } from "../../server/core/authentication/tokens";
import { createServiceAuditFixture } from "../helpers/service-audit-fixture";
import { wire } from "./helpers/session-features";

it.each([true, false])(
  "service mutation audit is accurate and default off (enabled=%s)",
  async (enabled) => {
    const f = await createServiceAuditFixture(enabled);
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const a = await f.connect(alice),
        b = await f.connect(bob);
      await wire(a, "JOIN #auditroom", / 366 .*#auditroom/);
      await wire(b, "JOIN #auditroom", / 366 .*#auditroom/);
      await wire(a, "CS REGISTER #auditroom", /successfully registered/i);
      await wire(b, "PRIVMSG ChanServ :OP #auditroom bob", /(?:denied|access|privilege)/i);
      await wire(a, "F REQUESTBOT #auditroom", /F has joined/);
      await wire(b, "PRIVMSG F :UNREQUESTBOT #auditroom", /(?:denied|operator|owner)/i);
      await wire(a, "NS GROUP", /Successfully grouped/);
      await wire(b, "PRIVMSG NickServ :DROP alice", /Could not drop/);
      const membersResponse = await f.request("/api/v1/channels/%23auditroom/members", alice);
      expect(membersResponse.status).toBe(200);
      const members = ((await membersResponse.json()) as any).members;
      expect(members).toContainEqual(
        expect.objectContaining({ userId: alice.account.id, modes: expect.stringMatching(/[qo]/) }),
      );
      const bobMember = members.find((member: any) => member.userId === bob.account.id);
      expect(bobMember).toBeDefined();
      expect(bobMember.modes).not.toMatch(/[qoa]/);
      const audit = await f.request("/admin/audit", root);
      expect(audit.status).toBe(200);
      const records = ((await audit.json()) as any).records;
      if (!enabled) expect(records).toEqual([]);
      else {
        const channelTarget = `channel:${(await hashSessionToken("#auditroom")).slice(0, 24)}`;
        const accountTarget = `account:${(await hashSessionToken("alice")).slice(0, 24)}`;
        for (const [actor, action, outcome, target] of [
          [alice, "service.chanserv.register", "allowed", channelTarget],
          [bob, "service.chanserv.op", "denied", channelTarget],
          [alice, "service.f.requestbot", "allowed", channelTarget],
          [bob, "service.f.unrequestbot", "denied", channelTarget],
          [alice, "service.nickserv.group", "allowed", accountTarget],
          [bob, "service.nickserv.drop", "denied", accountTarget],
        ] as const)
          expect(records).toContainEqual(
            expect.objectContaining({
              actor_id: actor.account.id,
              action,
              target,
              outcome,
              transport: "service",
            }),
          );
        expect(JSON.stringify(records)).not.toContain(alice.password);
        expect(JSON.stringify(records)).not.toContain(root.token);
      }
      await f.stop();
      const channels = (await f.snapshot("channel_metadata")) as any[][];
      expect(channels).toContainEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "founder", value: "alice" }),
          expect.objectContaining({ key: "registered", value: "1" }),
          expect.objectContaining({ key: "f_bot_enabled", value: "1" }),
        ]),
      );
      const nicks = (await f.snapshot("registered_nicks")).flat();
      expect(nicks).toContainEqual(
        expect.objectContaining({ nickname: "alice", user_id: alice.account.id }),
      );
      const stored = (await f.snapshot("security_audit")).flat() as any[];
      expect(stored.filter((row) => row.transport === "service").length).toBe(enabled ? 6 : 0);
      await f.restart();
      const after = ((await (await f.request("/admin/audit", root)).json()) as any).records;
      expect(after.filter((row: any) => row.transport === "service").length).toBe(enabled ? 6 : 0);
    } finally {
      await f.dispose();
    }
  },
  90000,
);

it("administrator revokes another account integration credential and audit records exact actor IDs", async () => {
  const { TestIRCClient } = await import("../helpers/miniflare-harness");
  const { adminAuditTarget } = await import("../../server/utils/admin-audit");
  const f = await createServiceAuditFixture();
  let bot: InstanceType<typeof TestIRCClient> | undefined;
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      servicebot = await f.createActor("servicebot"),
      bob = await f.createActor("bob");
    const passwordDevice = await f.connect(servicebot),
      witness = await f.connect(bob);
    const create = async (label: string) => {
      const res = await f.request("/api/v1/auth/credentials", servicebot, "POST", {
        label,
        expiresAt: Date.now() + 300000,
        scopes: [{ operation: "*", resource: "*" }],
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as any).credential;
    };
    const compromised = await create("compromised"),
      safe = await create("independent");
    bot = new TestIRCClient(f.server.wsUrl);
    await bot.connect();
    bot.send(`PASS token:${compromised.token}`);
    await bot.register("BotDevice");
    const received = witness.waitForNewLine((line) => line.includes("before-revoke-proof"));
    bot.send("PRIVMSG bob :before-revoke-proof");
    await received;
    await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
      name: "FlaRC",
      webSockets: "hibernate",
    });
    await f.barrier(passwordDevice);
    const path = `/api/v1/admin/accounts/servicebot/sessions/${compromised.id}`;
    expect((await f.request(path, alice, "DELETE")).status).toBe(403);
    expect(
      (await f.request("/api/v1/profiles/servicebot", { ...servicebot, token: compromised.token }))
        .status,
    ).toBe(200);
    expect((await f.request(path, root, "DELETE")).status).toBe(200);
    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("revoked bot remained connected")), 5000);
      bot!.ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    bot.send("PING :revoked-probe");
    await closed;
    expect(
      (await f.request("/api/v1/profiles/servicebot", { ...servicebot, token: compromised.token }))
        .status,
    ).toBe(401);
    expect(
      (await f.request("/api/v1/profiles/servicebot", { ...servicebot, token: safe.token })).status,
    ).toBe(200);
    await Promise.all([f.barrier(passwordDevice), f.barrier(witness)]);
    const auditResponse = await f.request("/admin/audit", root);
    expect(auditResponse.status).toBe(200);
    const records = ((await auditResponse.json()) as any).records;
    const target = await adminAuditTarget(path);
    for (const [actor, outcome] of [
      [root, "allowed"],
      [alice, "denied"],
    ] as const)
      expect(records).toContainEqual(
        expect.objectContaining({
          actor_id: actor.account.id,
          action: "session.revoke",
          target,
          outcome,
          transport: "rest",
        }),
      );
    for (const secret of [
      root.token,
      alice.token,
      servicebot.password,
      compromised.token,
      safe.token,
    ])
      expect(JSON.stringify(records)).not.toContain(secret);
    await f.stop();
    const rows = (await f.snapshot("security_audit")).flat();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: root.account.id,
          action: "session.revoke",
          target,
          outcome: "allowed",
        }),
        expect.objectContaining({
          actor_id: alice.account.id,
          action: "session.revoke",
          target,
          outcome: "denied",
        }),
      ]),
    );
    expect(JSON.stringify(await f.snapshot("api_sessions"))).not.toContain(compromised.token);
    await f.restart();
    for (const prefix of ["/admin", "/api/v1/admin"]) {
      const auditAfterRestart = await f.request(`${prefix}/audit`, root);
      expect(auditAfterRestart.status).toBe(200);
      const restoredRecords = ((await auditAfterRestart.json()) as any).records;
      for (const record of records.filter(
        (entry: any) => entry.action === "session.revoke" && entry.target === target,
      ))
        expect(restoredRecords).toContainEqual(record);
    }
    expect(
      (await f.request("/api/v1/profiles/servicebot", { ...servicebot, token: compromised.token }))
        .status,
    ).toBe(401);
    expect(
      (await f.request("/api/v1/profiles/servicebot", { ...servicebot, token: safe.token })).status,
    ).toBe(200);
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
  } finally {
    bot?.close();
    await f.dispose();
  }
}, 90000);

it("HostServ and HistServ audit real authorized mutations and rejected foreign actions", async () => {
  const f = await createServiceAuditFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const r = await f.connect(root),
      a = await f.connect(alice),
      b = await f.connect(bob);
    await wire(a, "JOIN #hist-audit", / 366 .*#hist-audit/);
    await wire(b, "JOIN #hist-audit", / 366 .*#hist-audit/);
    await wire(b, "HS SET alice rejected.example", /Insufficient privileges/);
    await wire(r, "PRIVMSG HostServ :SET alice audit.example", /Successfully set vhost/);
    const sent = await f.request("/api/v1/channels/%23hist-audit/messages", alice, "POST", {
      content: "hist-audit-secret",
    });
    expect(sent.status).toBe(201);
    const id = ((await sent.json()) as any).message.id;
    await wire(b, `HISTSERV DELETE #hist-audit ${id}`, /Could not delete/);
    await wire(a, `PRIVMSG HistServ :DELETE #hist-audit ${id}`, /Successfully deleted/);
    const history = await f.request("/api/v1/channels/%23hist-audit/messages", alice);
    expect(await history.text()).not.toContain("hist-audit-secret");
    const records = ((await (await f.request("/admin/audit", root)).json()) as any).records;
    const accountTarget = `account:${(await hashSessionToken("alice")).slice(0, 24)}`;
    const channelTarget = `channel:${(await hashSessionToken("#hist-audit")).slice(0, 24)}`;
    for (const [actor, action, target, outcome] of [
      [bob, "service.hostserv.set", accountTarget, "denied"],
      [root, "service.hostserv.set", accountTarget, "allowed"],
      [bob, "service.histserv.delete", channelTarget, "denied"],
      [alice, "service.histserv.delete", channelTarget, "allowed"],
    ] as const)
      expect(records).toContainEqual(
        expect.objectContaining({
          actor_id: actor.account.id,
          action,
          target,
          outcome,
          transport: "service",
        }),
      );
    expect(JSON.stringify(records)).not.toContain("hist-audit-secret");
    expect(JSON.stringify(records)).not.toContain("audit.example");
    await f.restart();
    const stored = ((await (await f.request("/admin/audit", root)).json()) as any).records;
    expect(stored.filter((item: any) => item.transport === "service")).toHaveLength(4);
  } finally {
    await f.dispose();
  }
}, 90000);
