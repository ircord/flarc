import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "../helpers/event-reader";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
const route = (channel: string, suffix = "") =>
  `/api/v1/channels/${encodeURIComponent(channel)}${suffix}`;
async function command(f: Fixture, c: TestIRCClient, text: string) {
  const start = c.lines.length;
  c.send(text);
  await f.barrier(c);
  return c.lines.slice(start);
}
async function join(f: Fixture, c: TestIRCClient, channel: string, key = "") {
  const lines = await command(f, c, `JOIN ${channel}${key ? ` ${key}` : ""}`);
  expect(lines.join("\n"), `join ${channel}`).toContain(` 366 `);
  return lines;
}
async function mode(f: Fixture, c: TestIRCClient, channel: string, value: string) {
  const lines = await command(f, c, `MODE ${channel} ${value}`);
  expect(lines.join("\n")).toContain(` MODE ${channel} ${value.split(" ")[0]}`);
}
async function post(f: Fixture, actor: MatrixActor, channel: string, content: string) {
  const res = await f.request(route(channel, "/messages"), actor, "POST", { content });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as any).message;
}
async function history(f: Fixture, actor: MatrixActor, channel: string) {
  const res = await f.request(route(channel, "/messages"), actor);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}
async function info(f: Fixture, actor: MatrixActor, channel: string) {
  const res = await f.request(route(channel, "/info"), actor);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}
async function fixture() {
  const f = await createMatrixFixture();
  const founder = await f.createActor("founder");
  const alice = await f.createActor("alice");
  const bob = await f.createActor("bob");
  const charlie = await f.createActor("charlie");
  const owner = await f.connect(founder),
    a = await f.connect(alice),
    b = await f.connect(bob),
    c = await f.connect(charlie);
  // Independent unrelated resource in every fixture; Alice has authority here only.
  await join(f, a, "#public");
  await post(f, alice, "#public", "unrelated-public-control");
  const unrelated = JSON.stringify(await history(f, alice, "#public"));
  return { f, founder, alice, bob, charlie, owner, a, b, c, unrelated };
}
async function unchanged(x: Awaited<ReturnType<typeof fixture>>) {
  expect(JSON.stringify(await history(x.f, x.alice, "#public"))).toBe(x.unrelated);
}
async function events(f: Fixture, actor: MatrixActor) {
  const received: any[] = [];
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events`, ["flarc.events.v2"], {
    headers: { Authorization: `Bearer ${actor.token}` },
  });
  ws.on("message", (data) => {
    if (!isReaderControl(ws, data)) received.push(JSON.parse(data.toString()));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, received };
}
async function drain(f: Fixture, clients: TestIRCClient[]) {
  await Promise.all(clients.map((c) => f.barrier(c)));
  // Delivery uses waitUntil; allow already committed local workerd deliveries to finish.
  await new Promise((resolve) => setTimeout(resolve, 80));
}
async function sqliteFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, e.name);
    if (e.isDirectory()) out.push(...(await sqliteFiles(file)));
    else if (e.name.endsWith(".sqlite")) out.push(file);
  }
  return out;
}
async function expireInvites(f: Fixture) {
  // Invites are created publicly first. Only their clock is moved while stopped.
  for (const file of await sqliteFiles(f.directory)) {
    const db = new DatabaseSync(file);
    try {
      if (db.prepare("SELECT name FROM sqlite_master WHERE name='channel_invites'").get())
        db.prepare("UPDATE channel_invites SET created_at=?").run(Date.now() - 25 * 60 * 60 * 1000);
    } finally {
      db.close();
    }
  }
}

describe("matrix channel membership and access", () => {
  it("CHAN-001 CHAN-002 CHAN-003 CHAN-004: public membership has real send and PART effects", async () => {
    const x = await fixture();
    const { f, founder, bob, owner, b } = x;
    try {
      await join(f, owner, "#history");
      await join(f, b, "#history");
      await post(f, bob, "#history", "member-rest-control");
      expect((await command(f, b, "PRIVMSG #history :member-irc-control")).join()).not.toContain(
        " 404 ",
      );
      await owner.waitForLine((l) => l.includes("member-irc-control"));
      expect((await command(f, b, "PART #history :leave-control")).join()).toContain(":bob!");
      expect((await command(f, b, "PRIVMSG #history :part-forbidden-irc")).join()).toContain(
        " 404 ",
      );
      expect(
        (
          await f.request(route("#history", "/messages"), bob, "POST", {
            content: "part-forbidden-rest",
          })
        ).status,
      ).toBe(403);
      await drain(f, [owner, b]);
      expect(owner.lines.join()).not.toContain("part-forbidden");
      const names = await command(f, owner, "NAMES #history");
      expect(names.filter((l) => l.includes(" 353 ")).join()).not.toMatch(/\bbob\b/);
      expect(JSON.stringify(await history(f, founder, "#history"))).not.toContain("part-forbidden");
      await unchanged(x);
      await f.stop();
      const members = JSON.stringify(await f.snapshot("channel_members"));
      expect(members).not.toContain(`"user_id":"${bob.account.id}"`);
      const messages = JSON.stringify(await f.snapshot("messages"));
      expect(messages).toContain("member-rest-control");
      expect(messages).toContain("member-irc-control");
      expect(messages).not.toContain("part-forbidden");
      await f.restart();
      expect(JSON.stringify(await history(f, founder, "#history"))).toContain("member-irc-control");
      expect(
        (
          await f.request(route("#history", "/messages"), bob, "POST", {
            content: "restart-part-forbidden",
          })
        ).status,
      ).toBe(403);
    } finally {
      await f.dispose();
    }
  });

  it("CHAN-005: forged JOIN prefix and account tags retain the authenticated account", async () => {
    const x = await fixture();
    const { f, alice, bob, owner, a, b } = x;
    try {
      await join(f, owner, "#staff");
      await mode(f, owner, "#staff", "+si");
      await command(f, owner, "INVITE bob #staff");
      const deniedStart = owner.lines.length;
      const denied = await command(f, a, "@account=bob;+account=bob :bob!owner@server JOIN #staff");
      expect(denied.join()).toContain(" 473 ");
      await drain(f, [owner, a]);
      expect(owner.lines.slice(deniedStart).some((l) => l.includes(" JOIN #staff"))).toBe(false);
      const accepted = await command(f, b, "@account=founder :founder!services@server JOIN #staff");
      expect(accepted.join()).toContain(" 366 ");
      const msg = await post(f, bob, "#staff", "identity-control");
      expect(msg.senderId).toBe(bob.account.id);
      expect(msg.senderAccount).toBe("bob");
      await owner.waitForLine((l) => l.startsWith(":bob!") && l.includes("identity-control"));
      expect((await f.request(route("#staff", "/messages"), alice)).status).toBe(403);
      await unchanged(x);
      await f.stop();
      const all = (await f.snapshot("channel_members")).flat() as any[];
      const staff = all.filter((r) => r.user_id !== alice.account.id);
      expect(
        staff.some(
          (r) => r.user_id === bob.account.id && r.account_name === "bob" && !r.modes.includes("q"),
        ),
      ).toBe(true);
      expect(JSON.stringify(await f.snapshot("messages"))).toContain(bob.account.id);
      await f.restart();
      const a2 = await f.connect(alice);
      expect((await command(f, a2, "@account=bob :bob!owner@server JOIN #staff")).join()).toContain(
        " 473 ",
      );
      expect((await f.request(route("#staff", "/messages"), alice)).status).toBe(403);
    } finally {
      await f.dispose();
    }
  });

  it("CHAN-006: reconnect reconciles an ordinary membership and retains explicit founder authority", async () => {
    const x = await fixture();
    const { f, founder, bob, owner, b } = x;
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      await join(f, owner, "#secret");
      await join(f, b, "#secret");
      await mode(f, owner, "#secret", "+si");
      const member = await events(f, bob),
        authorized = await events(f, founder);
      streams.push(member, authorized);
      await post(f, bob, "#secret", "before-reconnect");
      await vi.waitFor(() =>
        expect(member.received.some((e) => e.data?.content === "before-reconnect")).toBe(true),
      );
      b.close();
      await drain(f, [owner]);
      expect((await f.request(route("#secret", "/messages"), bob)).status).toBe(403);
      await post(f, founder, "#secret", "during-disconnect-private");
      await vi.waitFor(() =>
        expect(
          authorized.received.some((e) => e.data?.content === "during-disconnect-private"),
        ).toBe(true),
      );
      await drain(f, [owner]);
      expect(member.received.some((e) => e.data?.content === "during-disconnect-private")).toBe(
        false,
      );
      const reconnected = await f.connect(bob, "bobnew");
      expect((await command(f, reconnected, "JOIN #secret")).join()).toContain(" 473 ");
      await command(f, owner, "INVITE bobnew #secret");
      await join(f, reconnected, "#secret");
      expect(JSON.stringify(await history(f, bob, "#secret"))).toContain("before-reconnect");
      await unchanged(x);
      for (const s of streams) s.ws.close();
      await f.restart();
      expect(JSON.stringify(await history(f, founder, "#secret"))).toContain("before-reconnect");
      expect((await f.request(route("#secret", "/messages"), bob)).status).toBe(403);
    } finally {
      for (const s of streams) s.ws.close();
      await f.dispose();
    }
  });

  for (const [channel, value] of [
    ["#secret", "+s"],
    ["#private", "+p"],
    ["#invite", "+i"],
    ["#locked", "+k channel-secret-key"],
  ]) {
    it(`CHAN-007 CHAN-008 CHAN-009 CHAN-010 CHAN-013: ${channel} discovery, members, history and metadata require current access`, async () => {
      const x = await fixture();
      const { f, founder, alice, bob, charlie, owner, a, b, c } = x;
      const streams: Awaited<ReturnType<typeof events>>[] = [];
      try {
        await join(f, owner, channel);
        await join(f, b, channel);
        await mode(f, owner, channel, value);
        const member = await events(f, bob),
          outsiderAlice = await events(f, alice),
          outsiderCharlie = await events(f, charlie);
        streams.push(member, outsiderAlice, outsiderCharlie);
        await join(f, owner, "#event-control");
        await post(f, founder, "#event-control", "query-observer-positive");
        for (const observer of [outsiderAlice, outsiderCharlie])
          await vi.waitFor(() =>
            expect(
              observer.received.some((e) => e.data?.content === "query-observer-positive"),
            ).toBe(true),
          );
        const message = await post(f, founder, channel, `private-needle-${channel.slice(1)}`);
        await vi.waitFor(() =>
          expect(member.received.some((e) => e.data?.content === message.content)).toBe(true),
        );
        const before = JSON.stringify(await history(f, founder, channel));
        for (const [actor, client] of [
          [alice, a],
          [charlie, c],
        ] as const) {
          for (const suffix of [
            "/info",
            "/messages",
            "/messages/search?q=private",
            "/roles",
            "/unread",
          ]) {
            const denied = await f.request(route(channel, suffix), actor);
            expect(denied.status, `${actor.username} ${suffix}`).toBe(403);
            expect(await denied.text()).not.toContain(message.content);
            expect((await f.request(route(channel, suffix), bob)).status).toBe(200);
          }
          for (const alias of ["/api/channels", "/api/v1/channels"]) {
            if (alias === "/api/channels") {
              expect(
                (await f.request(`${alias}/${encodeURIComponent(channel)}/info`, actor)).status,
              ).toBe(403);
              expect(
                (await f.request(`${alias}/${encodeURIComponent(channel)}/info`, bob)).status,
              ).toBe(200);
            }
          }
          const listing = await command(f, client, "LIST");
          expect(listing.filter((l) => l.includes(" 322 ")).join()).not.toContain(channel);
          expect(await (await f.request("/api/v1/channels", actor)).text()).not.toContain(channel);
          const names = await command(f, client, `NAMES ${channel}`);
          expect(names.filter((l) => l.includes(" 353 ")).join()).toBe("");
          expect((await command(f, client, `CHATHISTORY LATEST ${channel} * 20`)).join()).toContain(
            "FAIL CHATHISTORY",
          );
          expect((await command(f, client, `TOPIC ${channel}`)).join()).toContain(" 442 ");
        }
        const memberNames = await command(f, b, `NAMES ${channel}`);
        expect(memberNames.filter((l) => l.includes(" 353 ")).join()).toContain("founder");
        const cap = await command(
          f,
          b,
          "CAP REQ :batch server-time message-tags draft/chathistory",
        );
        expect(cap.join()).toContain(" ACK ");
        const playback = await command(f, b, `CHATHISTORY LATEST ${channel} * 20`);
        expect(playback.join()).toContain(message.content);
        expect(JSON.stringify(await history(f, founder, channel))).toBe(before);
        await drain(f, [owner, a, b, c]);
        expect(outsiderAlice.received.filter((e) => e.channelId === channel)).toEqual([]);
        expect(outsiderCharlie.received.filter((e) => e.channelId === channel)).toEqual([]);
        await unchanged(x);
        for (const s of streams) s.ws.close();
        await f.stop();
        const stored = JSON.stringify(await f.snapshot("messages"));
        expect(stored).toContain(message.content);
        const members = (await f.snapshot("channel_members")).flat() as any[];
        expect(members.some((m) => m.user_id === charlie.account.id)).toBe(false);
        await f.restart();
        expect(JSON.stringify(await history(f, founder, channel))).toContain(message.content);
        for (const actor of [alice, charlie]) {
          expect((await f.request(route(channel, "/messages"), actor)).status).toBe(403);
          expect((await f.request(route(channel, "/info"), actor)).status).toBe(403);
          expect(await (await f.request("/api/v1/channels", actor)).text()).not.toContain(channel);
        }
        const c2 = await f.connect(charlie);
        expect(
          (await command(f, c2, `NAMES ${channel}`)).filter((l) => l.includes(" 353 ")),
        ).toEqual([]);
        expect(
          (await command(f, c2, "LIST")).filter((l) => l.includes(" 322 ")).join(),
        ).not.toContain(channel);
      } finally {
        for (const s of streams) s.ws.close();
        await f.dispose();
      }
    });

    it(`CHAN-011 CHAN-014 CHAN-015: ${channel} event visibility and retained history revoke on PART`, async () => {
      const x = await fixture();
      const { f, founder, bob, charlie, owner, b, c } = x;
      const streams: Awaited<ReturnType<typeof events>>[] = [];
      try {
        await join(f, owner, channel);
        await mode(f, owner, channel, value);
        await post(f, founder, channel, "retained-before-membership");
        expect((await f.request(route(channel, "/messages"), bob)).status).toBe(403);
        if (value === "+i") await command(f, owner, `INVITE bob ${channel}`);
        await join(f, b, channel, channel === "#locked" ? "channel-secret-key" : "");
        expect(JSON.stringify(await history(f, bob, channel))).toContain(
          "retained-before-membership",
        );
        const member = await events(f, bob),
          outsider = await events(f, charlie),
          authorized = await events(f, founder);
        streams.push(member, outsider, authorized);
        await join(f, owner, "#event-control");
        await post(f, founder, "#event-control", "outsider-stream-positive");
        await vi.waitFor(() =>
          expect(
            outsider.received.some((e) => e.data?.content === "outsider-stream-positive"),
          ).toBe(true),
        );
        await post(f, founder, channel, "event-member-positive");
        await vi.waitFor(() =>
          expect(member.received.some((e) => e.data?.content === "event-member-positive")).toBe(
            true,
          ),
        );
        await vi.waitFor(() =>
          expect(authorized.received.some((e) => e.data?.content === "event-member-positive")).toBe(
            true,
          ),
        );
        const cut = member.received.length;
        await command(f, b, `PART ${channel}`);
        await vi.waitFor(() =>
          expect(member.received.slice(cut)).toContainEqual(
            expect.objectContaining({
              type: "channel.member_left",
              channelId: channel,
              ownerId: bob.account.id,
              data: expect.objectContaining({ accountId: bob.account.id, joined: false }),
            }),
          ),
        );
        await post(f, founder, channel, "event-after-part-denied");
        await vi.waitFor(() =>
          expect(
            authorized.received.some((e) => e.data?.content === "event-after-part-denied"),
          ).toBe(true),
        );
        await drain(f, [owner, b, c]);
        expect(outsider.received.filter((e) => e.channelId === channel)).toEqual([]);
        expect(member.received.slice(cut).filter((e) => e.channelId === channel)).toEqual([
          expect.objectContaining({
            type: "channel.member_left",
            ownerId: bob.account.id,
            data: expect.objectContaining({ accountId: bob.account.id, joined: false }),
          }),
        ]);
        expect(b.lines.some((l) => l.includes("event-after-part-denied"))).toBe(false);
        expect((await f.request(route(channel, "/messages"), bob)).status).toBe(403);
        expect((await command(f, b, `CHATHISTORY LATEST ${channel} * 10`)).join()).toContain(
          "FAIL CHATHISTORY",
        );
        await unchanged(x);
        for (const s of streams) s.ws.close();
        await f.stop();
        expect(JSON.stringify(await f.snapshot("messages"))).toContain("event-after-part-denied");
        expect(JSON.stringify(await f.snapshot("channel_members"))).not.toContain(bob.account.id);
        await f.restart();
        expect((await f.request(route(channel, "/messages"), bob)).status).toBe(403);
        expect(JSON.stringify(await history(f, founder, channel))).toContain(
          "event-after-part-denied",
        );
      } finally {
        for (const s of streams) s.ws.close();
        await f.dispose();
      }
    });
  }

  it("CHAN-016 CHAN-017 CHAN-018 CHAN-019 CHAN-024: invitation identity, forgery, revocation and one-use capabilities", async () => {
    const x = await fixture();
    const { f, founder, alice, bob, charlie, owner, a, b, c } = x;
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      await join(f, owner, "#invite");
      await join(f, a, "#invite");
      await mode(f, owner, "#invite", "+i");
      const member = await events(f, bob),
        outsider = await events(f, charlie),
        authorized = await events(f, founder);
      streams.push(member, outsider, authorized);
      expect((await command(f, a, "INVITE bob #invite")).join()).toContain(" 482 ");
      await drain(f, [a, b]);
      expect(b.lines.some((l) => l.includes(" INVITE bob #invite"))).toBe(false);
      expect((await command(f, b, "JOIN #invite")).join()).toContain(" 473 ");
      await command(f, owner, "INVITE bob #invite");
      expect((await command(f, c, "@account=bob JOIN #invite")).join()).toContain(" 473 ");
      await command(f, owner, "UNINVITE bob #invite");
      expect((await command(f, b, "JOIN #invite")).join()).toContain(" 473 ");
      await command(f, owner, "INVITE bob #invite");
      await join(f, b, "#invite");
      await post(f, bob, "#invite", "invited-control");
      expect(b.lines.some((l) => l.includes(" INVITE bob #invite"))).toBe(true);
      await vi.waitFor(() =>
        expect(member.received.some((e) => e.data?.content === "invited-control")).toBe(true),
      );
      await vi.waitFor(() =>
        expect(authorized.received.some((e) => e.data?.content === "invited-control")).toBe(true),
      );
      await command(f, b, "PART #invite");
      expect((await command(f, b, "JOIN #invite")).join()).toContain(" 473 ");
      expect((await f.request(route("#invite", "/messages"), charlie)).status).toBe(403);
      expect(JSON.stringify(await history(f, founder, "#invite"))).toContain("invited-control");
      await post(f, founder, "#invite", "consumed-invite-future-denied");
      await vi.waitFor(() =>
        expect(
          authorized.received.some((e) => e.data?.content === "consumed-invite-future-denied"),
        ).toBe(true),
      );
      await drain(f, [owner, b, c]);
      expect(member.received.some((e) => e.data?.content === "consumed-invite-future-denied")).toBe(
        false,
      );
      expect(outsider.received.filter((e) => e.channelId === "#invite")).toEqual([]);
      await unchanged(x);
      for (const s of streams) s.ws.close();
      await f.stop();
      expect((await f.snapshot("channel_invites")).flat()).toHaveLength(0);
      expect(JSON.stringify(await f.snapshot("channel_members"))).not.toContain(bob.account.id);
      expect(JSON.stringify(await f.snapshot("channel_permissions"))).not.toContain(bob.account.id);
      expect(JSON.stringify(await f.snapshot("messages"))).toContain("invited-control");
      expect(alice.account.id).not.toBe(bob.account.id);
      await f.restart();
      const o2 = await f.connect(founder),
        c2 = await f.connect(charlie);
      await join(f, o2, "#invite");
      expect((await command(f, c2, "JOIN #invite")).join()).toContain(" 473 ");
      await command(f, o2, "INVITE charlie #invite");
      await join(f, c2, "#invite");
      await post(f, charlie, "#invite", "restart-invitation-control");
    } finally {
      for (const s of streams) s.ws.close();
      await f.dispose();
    }
  });

  it("CHAN-019: UNINVITE after recipient nickname change revokes the account-bound invitation", async () => {
    const x = await fixture();
    const { f, founder, bob, charlie, owner, b, c } = x;
    try {
      await join(f, owner, "#invite");
      await mode(f, owner, "#invite", "+i");
      await command(f, owner, "INVITE bob #invite");
      await command(f, owner, "INVITE charlie #invite");
      await command(f, b, "NICK bobnew");
      await command(f, owner, "UNINVITE bobnew #invite");
      const cut = owner.lines.length;
      const attempt = await command(f, b, "JOIN #invite");
      expect
        .soft(attempt.join(), "a revoked account-bound invitation must not follow an old nickname")
        .toContain(" 473 ");
      expect.soft((await f.request(route("#invite", "/messages"), bob)).status).toBe(403);
      await drain(f, [owner, b]);
      expect
        .soft(
          owner.lines.slice(cut).some((l) => l.includes(":bobnew!") && l.includes(" JOIN #invite")),
        )
        .toBe(false);
      expect.soft((await command(f, b, "INVITE")).join()).not.toContain("#invite");
      expect((await command(f, c, "INVITE")).join()).toContain("#invite");
      // An unrelated invitation issued before revocation remains usable.
      await join(f, c, "#invite");
      await post(f, charlie, "#invite", "revocation-unrelated-positive");
      await unchanged(x);
      await f.stop();
      expect
        .soft(JSON.stringify(await f.snapshot("channel_members")))
        .not.toContain(bob.account.id);
      expect(JSON.stringify(await f.snapshot("messages"))).toContain(
        "revocation-unrelated-positive",
      );
      expect(JSON.stringify(await f.snapshot("channel_permissions"))).toContain(founder.account.id);
      expect.soft((await f.snapshot("session_invites")).flat()).toHaveLength(0);
      await f.restart();
      const b2 = await f.connect(bob);
      expect.soft((await command(f, b2, "JOIN #invite")).join()).toContain(" 473 ");
      expect.soft((await command(f, b2, "INVITE")).join()).not.toContain("#invite");
    } finally {
      await f.dispose();
    }
  });

  it("CHAN-019: nickname reuse cannot revoke a different account's valid invitation", async () => {
    const x = await fixture();
    const { f, founder, bob, charlie, owner, b, c } = x;
    try {
      await join(f, owner, "#invite");
      await mode(f, owner, "#invite", "+i");
      expect((await command(f, b, "NICK reusedalias")).join()).toContain(" NICK reusedalias");
      await command(f, owner, "INVITE reusedalias #invite");
      await command(f, b, "NICK bobnew");
      expect((await command(f, c, "NICK reusedalias")).join()).toContain(" NICK reusedalias");
      await command(f, owner, "UNINVITE reusedalias #invite");
      expect((await command(f, b, "INVITE")).join()).toContain("#invite");
      expect((await command(f, c, "INVITE")).join()).not.toContain("#invite");
      expect((await command(f, c, "JOIN #invite")).join()).toContain(" 473 ");
      await join(f, b, "#invite");
      await post(f, bob, "#invite", "reuse-account-positive");
      expect((await f.request(route("#invite", "/messages"), charlie)).status).toBe(403);
      await unchanged(x);
      await f.stop();
      expect((await f.snapshot("channel_invites")).flat()).toHaveLength(0);
      expect(JSON.stringify(await f.snapshot("channel_members"))).not.toContain(charlie.account.id);
      await f.restart();
      expect(JSON.stringify(await history(f, founder, "#invite"))).toContain(
        "reuse-account-positive",
      );
      expect((await f.request(route("#invite", "/messages"), charlie)).status).toBe(403);
    } finally {
      await f.dispose();
    }
  });

  it("CHAN-018 CHAN-019: member cannot revoke account invitations by spoofing founder tags", async () => {
    const x = await fixture();
    const { f, alice, bob, owner, a, b } = x;
    try {
      await join(f, owner, "#invite");
      await join(f, a, "#invite");
      await mode(f, owner, "#invite", "+i");
      await command(f, owner, "INVITE bob #invite");
      await command(f, b, "NICK bobnew");
      expect(
        (
          await command(f, a, "@account=founder :founder!services@server UNINVITE bobnew #invite")
        ).join(),
      ).toContain(" 482 ");
      expect((await command(f, b, "INVITE")).join()).toContain("#invite");
      await join(f, b, "#invite");
      await post(f, bob, "#invite", "issuer-rank-positive");
      await unchanged(x);
      await f.stop();
      expect(JSON.stringify(await f.snapshot("channel_members"))).toContain(bob.account.id);
      expect(
        (await f.snapshot("channel_permissions"))
          .flat()
          .filter((row: any) => row.user_id === alice.account.id),
      ).toHaveLength(1);
    } finally {
      await f.dispose();
    }
  });

  for (const nick of ["bob", "historicalalias"]) {
    it(`CHAN-019: offline invitation ${nick} revokes through trusted ownership across restart`, async () => {
      const x = await fixture();
      const { f, founder, bob, charlie, owner, b } = x;
      try {
        await join(f, owner, "#invite");
        await mode(f, owner, "#invite", "+i");
        if (nick !== "bob") await command(f, b, `NICK ${nick}`);
        await command(f, owner, `INVITE ${nick} #invite`);
        await command(f, owner, "INVITE charlie #invite");
        await unchanged(x);
        await f.stop();
        expect((await f.snapshot("channel_invites")).flat()).toHaveLength(2);
        await f.restart();
        const o2 = await f.connect(founder);
        await join(f, o2, "#invite");
        await command(f, o2, `UNINVITE ${nick} #INVITE`);
        const b2 = await f.connect(bob),
          c2 = await f.connect(charlie);
        expect((await command(f, b2, "INVITE")).join()).not.toContain("#invite");
        expect((await command(f, b2, "JOIN #invite")).join()).toContain(" 473 ");
        expect((await command(f, c2, "INVITE")).join()).toContain("#invite");
        await join(f, c2, "#invite");
        await post(f, charlie, "#invite", "offline-unrelated-positive");
        await f.stop();
        expect((await f.snapshot("channel_invites")).flat()).toHaveLength(0);
        expect((await f.snapshot("session_invites")).flat()).toHaveLength(0);
        expect(JSON.stringify(await f.snapshot("channel_members"))).not.toContain(bob.account.id);
        await f.restart();
        const b3 = await f.connect(bob);
        expect((await command(f, b3, "JOIN #invite")).join()).toContain(" 473 ");
      } finally {
        await f.dispose();
      }
    });
  }

  it("CHAN-017 CHAN-020: an invitation cannot cross channels or bypass an independent channel key", async () => {
    const x = await fixture();
    const { f, bob, owner, b } = x;
    try {
      for (const channel of ["#invite", "#staff", "#locked"]) {
        await join(f, owner, channel);
        await mode(f, owner, channel, "+i");
      }
      await mode(f, owner, "#locked", "+k channel-secret-key");
      await command(f, owner, "INVITE bob #invite");
      expect((await command(f, b, "JOIN #staff")).join()).toContain(" 473 ");
      await command(f, owner, "INVITE bob #locked");
      expect((await command(f, b, "JOIN #locked wrong-key")).join()).toContain(" 475 ");
      expect((await f.request(route("#staff", "/messages"), bob)).status).toBe(403);
      expect((await f.request(route("#locked", "/messages"), bob)).status).toBe(403);
      await join(f, b, "#locked", "channel-secret-key");
      await post(f, bob, "#locked", "invited-key-positive");
      await join(f, b, "#invite");
      await post(f, bob, "#invite", "channel-bound-positive");
      await unchanged(x);
      await f.stop();
      expect((await f.snapshot("channel_invites")).flat()).toHaveLength(0);
      expect(JSON.stringify(await f.snapshot("messages"))).toContain("invited-key-positive");
    } finally {
      await f.dispose();
    }
  });

  it("CHAN-017: invite exceptions match the intended account only", async () => {
    const x = await fixture();
    const { f, bob, charlie, owner, b, c } = x;
    try {
      await join(f, owner, "#invite");
      await mode(f, owner, "#invite", "+i");
      await mode(f, owner, "#invite", "+I $a:bob");
      expect((await command(f, c, "JOIN #invite")).join()).toContain(" 473 ");
      await join(f, b, "#invite");
      await post(f, bob, "#invite", "invite-exception-positive");
      expect((await f.request(route("#invite", "/messages"), charlie)).status).toBe(403);
      await unchanged(x);
      await f.stop();
      expect(JSON.stringify(await f.snapshot("channel_list_modes"))).toContain("$a:bob");
      expect(JSON.stringify(await f.snapshot("channel_members"))).not.toContain(charlie.account.id);
    } finally {
      await f.dispose();
    }
  });

  it("CHAN-017 CHAN-024: expired public invitation cannot authorize JOIN after independent runtime restart", async () => {
    const x = await fixture();
    const { f, founder, bob, owner } = x;
    try {
      await join(f, owner, "#invite");
      await mode(f, owner, "#invite", "+i");
      await command(f, owner, "INVITE bob #invite");
      await unchanged(x);
      await f.stop();
      expect((await f.snapshot("channel_invites")).flat()).toHaveLength(1);
      await expireInvites(f);
      await f.restart();
      const o2 = await f.connect(founder),
        b2 = await f.connect(bob);
      await join(f, o2, "#invite");
      expect((await command(f, b2, "JOIN #invite")).join()).toContain(" 473 ");
      await command(f, o2, "INVITE bob #invite");
      await join(f, b2, "#invite");
      await post(f, bob, "#invite", "fresh-invite-control");
      await f.stop();
      expect((await f.snapshot("channel_invites")).flat()).toHaveLength(0);
      expect(JSON.stringify(await f.snapshot("messages"))).toContain("fresh-invite-control");
    } finally {
      await f.dispose();
    }
  });

  for (const badKey of ["", "wrong-key", "CHANNEL-SECRET-KEY"]) {
    it(`CHAN-020 CHAN-021: key ${JSON.stringify(badKey)} is denied without disclosure or membership`, async () => {
      const x = await fixture();
      const { f, founder, bob, charlie, owner, b, c } = x;
      const stream = await events(f, charlie);
      try {
        await join(f, owner, "#event-control");
        await post(f, founder, "#event-control", "outsider-stream-positive");
        await vi.waitFor(() =>
          expect(stream.received.some((e) => e.data?.content === "outsider-stream-positive")).toBe(
            true,
          ),
        );
        await join(f, owner, "#locked");
        await mode(f, owner, "#locked", "+k channel-secret-key");
        const before = JSON.stringify(await info(f, founder, "#locked"));
        const lines = await command(f, b, `JOIN #locked${badKey ? ` ${badKey}` : ""}`);
        expect(lines.join()).toContain(" 475 ");
        expect(lines.join()).not.toContain("channel-secret-key");
        expect((await command(f, c, "MODE #locked")).join()).not.toContain("channel-secret-key");
        for (const alias of ["/api/v1/channels/%23locked/info", "/api/channels/%23locked/info"]) {
          const denied = await f.request(alias, charlie);
          expect(denied.status).toBe(403);
          expect(await denied.text()).not.toContain("channel-secret-key");
        }
        expect(JSON.stringify(await info(f, founder, "#locked"))).toBe(before);
        await join(f, b, "#locked", "channel-secret-key");
        await post(f, bob, "#locked", "key-correct-control");
        await drain(f, [owner, b, c]);
        expect(JSON.stringify(stream.received)).not.toContain("channel-secret-key");
        expect(JSON.stringify(stream.received)).not.toContain("key-correct-control");
        await unchanged(x);
        stream.ws.close();
        await f.stop();
        expect(JSON.stringify(await f.snapshot("channel_metadata"))).toContain(
          "channel-secret-key",
        );
        expect(JSON.stringify(await f.snapshot("messages"))).toContain("key-correct-control");
        expect(JSON.stringify(await f.snapshot("channel_members"))).not.toContain(
          charlie.account.id,
        );
        await f.restart();
        expect((await f.request(route("#locked", "/messages"), charlie)).status).toBe(403);
        expect(JSON.stringify(await history(f, founder, "#locked"))).toContain(
          "key-correct-control",
        );
        const b2 = await f.connect(bob);
        expect((await command(f, b2, "JOIN #locked wrong-key")).join()).toContain(" 475 ");
        await join(f, b2, "#locked", "channel-secret-key");
      } finally {
        stream.ws.close();
        await f.dispose();
      }
    });
  }

  for (const [channel, restriction, numeric] of [
    ["#invite", "+i", "473"],
    ["#locked", "+k channel-secret-key", "475"],
    ["#staff", "+b $a:bob", "474"],
  ]) {
    it(`administrative bypass control: ${channel} REST mutation cannot bypass JOIN policy`, async () => {
      const x = await fixture();
      const { f, founder, bob, owner, b } = x;
      try {
        const root = await f.createActor("rootadmin", true);
        await join(f, owner, channel);
        await mode(f, owner, channel, restriction);
        expect((await command(f, b, `JOIN ${channel}`)).join()).toContain(` ${numeric} `);
        const before = JSON.stringify(await info(f, founder, channel));
        for (const alias of ["/api/v1/admin", "/admin"]) {
          const denied = await f.request(
            `${alias}/channels/${encodeURIComponent(channel)}/modes`,
            bob,
            "POST",
            { modeString: "-ikb", modeArgs: ["$a:bob"] },
          );
          expect(denied.status).toBe(403);
        }
        expect(JSON.stringify(await info(f, founder, channel))).toBe(before);
        const control = await f.request(
          `/api/v1/admin/channels/${encodeURIComponent(channel)}/modes`,
          root,
          "POST",
          {
            modeString: channel === "#invite" ? "-i" : channel === "#locked" ? "-k" : "-b",
            modeArgs: channel === "#staff" ? ["$a:bob"] : [],
          },
        );
        expect(control.status).toBe(200);
        await join(f, b, channel);
        await post(f, bob, channel, "admin-control-entry");
        await unchanged(x);
        await f.stop();
        expect(JSON.stringify(await f.snapshot("messages"))).toContain("admin-control-entry");
      } finally {
        await f.dispose();
      }
    });
  }

  it("CHAN-025 CHAN-026 CHAN-027 CHAN-028 CHAN-030 CHAN-031 CHAN-032: account ban, passive events, nickname changes, reconnect and KICK", async () => {
    const x = await fixture();
    const { f, founder, bob, charlie, owner, b, c } = x;
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      await join(f, owner, "#staff");
      await join(f, b, "#staff");
      await join(f, c, "#staff");
      await mode(f, owner, "#staff", "+si");
      await post(f, bob, "#staff", "before-ban-authorized");
      const blocked = await events(f, bob),
        allowed = await events(f, charlie);
      streams.push(blocked, allowed);
      await mode(f, owner, "#staff", "+b $a:bob");
      const snapshot = JSON.stringify(await history(f, founder, "#staff"));
      expect((await command(f, b, "PRIVMSG #staff :banned-irc-forgery")).join()).toContain(" 404 ");
      expect(
        (
          await f.request(route("#staff", "/messages"), bob, "POST", {
            content: "banned-rest-forgery",
          })
        ).status,
      ).toBe(403);
      expect((await f.request(route("#staff", "/messages"), bob)).status).toBe(403);
      expect(JSON.stringify(await history(f, founder, "#staff"))).toBe(snapshot);
      await post(f, founder, "#staff", "after-ban-recipient-control");
      await vi.waitFor(() =>
        expect(
          allowed.received.some((e) => e.data?.content === "after-ban-recipient-control"),
        ).toBe(true),
      );
      await drain(f, [owner, b, c]);
      expect(JSON.stringify(blocked.received)).not.toContain("after-ban-recipient-control");
      expect(b.lines.join()).not.toContain("after-ban-recipient-control");
      await command(f, owner, "KICK #staff bob :ban-control");
      await command(f, b, "NICK bobchanged");
      expect((await command(f, b, "JOIN #staff")).join()).toMatch(/ (473|474) /);
      // Remove +i so the account ban, rather than another restriction, is decisive.
      await mode(f, owner, "#staff", "-i");
      expect((await command(f, b, "JOIN #staff")).join()).toContain(" 474 ");
      b.close();
      await drain(f, [owner]);
      const b2 = await f.connect(bob, "bobafter");
      expect((await command(f, b2, "JOIN #staff")).join()).toContain(" 474 ");
      await unchanged(x);
      for (const s of streams) s.ws.close();
      await f.stop();
      expect(JSON.stringify(await f.snapshot("channel_members"))).not.toContain(bob.account.id);
      expect(JSON.stringify(await f.snapshot("messages"))).not.toContain("forgery");
      expect(JSON.stringify(await f.snapshot("channel_bans"))).toContain("$a:bob");
      await f.restart();
      const o2 = await f.connect(founder),
        b3 = await f.connect(bob);
      await join(f, o2, "#staff");
      expect((await command(f, b3, "JOIN #staff")).join()).toContain(" 474 ");
      await mode(f, o2, "#staff", "-b $a:bob");
      await join(f, b3, "#staff");
      await post(f, bob, "#staff", "unban-positive-control");
    } finally {
      for (const s of streams) s.ws.close();
      await f.dispose();
    }
  });

  for (const exception of ["$a:bob", "$a:charlie"]) {
    it(`CHAN-029: ban exception ${exception} grants only the matching account`, async () => {
      const x = await fixture();
      const { f, bob, charlie, owner, b, c } = x;
      const streams: Awaited<ReturnType<typeof events>>[] = [];
      try {
        await join(f, owner, "#staff");
        await mode(f, owner, "#staff", "+b *!*@*");
        await mode(f, owner, "#staff", `+e ${exception}`);
        const matchedActor = exception === "$a:bob" ? bob : charlie,
          matched = exception === "$a:bob" ? b : c;
        const deniedActor = exception === "$a:bob" ? charlie : bob,
          denied = exception === "$a:bob" ? c : b;
        expect((await command(f, denied, "JOIN #staff")).join()).toContain(" 474 ");
        await join(f, matched, "#staff");
        const allowedStream = await events(f, matchedActor),
          deniedStream = await events(f, deniedActor);
        streams.push(allowedStream, deniedStream);
        await post(f, matchedActor, "#staff", "exception-positive-control");
        await vi.waitFor(() =>
          expect(
            allowedStream.received.some((e) => e.data?.content === "exception-positive-control"),
          ).toBe(true),
        );
        expect((await f.request(route("#staff", "/messages"), deniedActor)).status).toBe(403);
        await drain(f, [matched, denied]);
        expect(denied.lines.join()).not.toContain("exception-positive-control");
        expect(deniedStream.received.filter((e) => e.channelId === "#staff")).toEqual([]);
        await unchanged(x);
        for (const s of streams) s.ws.close();
        await f.stop();
        expect(JSON.stringify(await f.snapshot("channel_list_modes"))).toContain(exception);
        const members = JSON.stringify(await f.snapshot("channel_members"));
        expect(members).toContain(matchedActor.account.id);
        expect(members).not.toContain(deniedActor.account.id);
        await f.restart();
        const matchedAgain = await f.connect(matchedActor),
          deniedAgain = await f.connect(deniedActor);
        expect((await command(f, deniedAgain, "JOIN #staff")).join()).toContain(" 474 ");
        await join(f, matchedAgain, "#staff");
        await post(f, matchedActor, "#staff", "exception-restart-control");
        expect((await f.request(route("#staff", "/messages"), deniedActor)).status).toBe(403);
      } finally {
        for (const s of streams) s.ws.close();
        await f.dispose();
      }
    });
  }

  it("CHAN-032: KICK revokes secret membership without a ban and an explicit invitation restores access", async () => {
    const x = await fixture();
    const { f, founder, bob, charlie, owner, b, c } = x;
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      await join(f, owner, "#staff");
      await join(f, b, "#staff");
      await join(f, c, "#staff");
      await mode(f, owner, "#staff", "+si");
      const kicked = await events(f, bob),
        authorized = await events(f, charlie);
      streams.push(kicked, authorized);
      await post(f, founder, "#staff", "pre-kick-control");
      await vi.waitFor(() =>
        expect(kicked.received.some((e) => e.data?.content === "pre-kick-control")).toBe(true),
      );
      await command(f, owner, "KICK #staff bob :kick-control");
      const cut = kicked.received.length;
      await post(f, founder, "#staff", "after-kick-private");
      await vi.waitFor(() =>
        expect(authorized.received.some((e) => e.data?.content === "after-kick-private")).toBe(
          true,
        ),
      );
      await drain(f, [owner, b, c]);
      expect(kicked.received.slice(cut).filter((e) => e.channelId === "#staff")).toEqual([]);
      expect(b.lines.join()).not.toContain("after-kick-private");
      expect((await f.request(route("#staff", "/messages"), bob)).status).toBe(403);
      expect(
        (await f.request(route("#staff", "/messages"), bob, "POST", { content: "kick-forgery" }))
          .status,
      ).toBe(403);
      expect((await command(f, b, "JOIN #staff")).join()).toContain(" 473 ");
      await command(f, owner, "INVITE bob #staff");
      await join(f, b, "#staff");
      await post(f, bob, "#staff", "kick-reinvite-control");
      await unchanged(x);
      for (const s of streams) s.ws.close();
      await f.stop();
      expect(JSON.stringify(await f.snapshot("messages"))).not.toContain("kick-forgery");
      expect(JSON.stringify(await f.snapshot("messages"))).toContain("kick-reinvite-control");
    } finally {
      for (const s of streams) s.ws.close();
      await f.dispose();
    }
  });

  it("CHAN-033: destructive removal reserves the archived name and clears old authority", async () => {
    const x = await fixture();
    const { f, founder, alice, bob, charlie, owner, a, b, c } = x;
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      const root = await f.createActor("rootadmin", true);
      await join(f, owner, "#roles");
      await join(f, b, "#roles");
      await mode(f, owner, "#roles", "+si");
      await command(f, owner, "CS AMODE #roles +o bob");
      const role = await f.request(route("#roles", "/roles"), founder, "POST", {
        name: "old-authority",
        ircMode: "o",
        permissions: ["manage_channel"],
      });
      expect(role.status).toBe(201);
      const roleId = ((await role.json()) as any).role.id;
      expect(
        (
          await f.request(route("#roles", "/roles/assign"), founder, "POST", {
            userId: bob.account.id,
            roleGroupId: roleId,
          })
        ).status,
      ).toBe(200);
      const member = await events(f, bob),
        outsider = await events(f, charlie);
      streams.push(member, outsider);
      await join(f, c, "#event-control");
      await post(f, charlie, "#event-control", "archive-observer-positive");
      await vi.waitFor(() =>
        expect(outsider.received.some((e) => e.data?.content === "archive-observer-positive")).toBe(
          true,
        ),
      );
      await post(f, founder, "#roles", "old-generation-secret");
      await vi.waitFor(() =>
        expect(member.received.some((e) => e.data?.content === "old-generation-secret")).toBe(true),
      );
      const cut = member.received.length;
      const destroyed = await f.request("/api/v1/admin/channels/%23roles", root, "DELETE", {
        purgeMessages: true,
      });
      expect(destroyed.status).toBe(200);
      for (const client of [a, owner, b])
        expect((await command(f, client, "JOIN #roles")).join()).toContain(" 403 ");
      const register = await f.request("/api/v1/admin/channels/%23roles/register", root, "POST", {
        founder: "alice",
      });
      expect(register.status).toBe(200);
      expect(await register.json()).toMatchObject({
        ok: false,
        message: "Archived channel names are reserved to protect retained data",
      });
      for (const actor of [alice, founder, bob]) {
        expect(
          (
            await f.request(route("#roles", "/info"), actor, "PATCH", {
              description: "stale-authority-forgery",
            })
          ).status,
        ).toBe(403);
        expect((await f.request(route("#roles", "/messages"), actor)).status).toBe(403);
        expect(
          (
            await f.request(route("#roles", "/messages"), actor, "POST", {
              content: "archived-event-forgery",
            })
          ).status,
        ).toBe(403);
      }
      await drain(f, [owner, a, b, c]);
      expect(member.received.slice(cut).filter((e) => e.channelId === "#roles")).toEqual([]);
      expect(outsider.received.filter((e) => e.channelId === "#roles")).toEqual([]);
      await unchanged(x);
      for (const s of streams) s.ws.close();
      await f.stop();
      expect(JSON.stringify(await f.snapshot("channel_permissions"))).not.toContain(
        founder.account.id,
      );
      expect(JSON.stringify(await f.snapshot("channel_user_roles"))).not.toContain(roleId);
      expect(JSON.stringify(await f.snapshot("channel_role_groups"))).not.toContain(roleId);
      expect(JSON.stringify(await f.snapshot("messages"))).not.toMatch(
        /forgery|old-generation-secret/,
      );
      await f.restart();
      expect((await f.request(route("#roles", "/messages"), founder)).status).toBe(403);
    } finally {
      for (const s of streams) s.ws.close();
      await f.dispose();
    }
  });

  it("CHAN-012: secret attachment bytes and response metadata require current membership", async () => {
    const x = await fixture();
    const { f, founder, bob, charlie, owner, b } = x;
    try {
      await join(f, owner, "#secret");
      await join(f, b, "#secret");
      await mode(f, owner, "#secret", "+s");
      const form = new FormData();
      form.append(
        "file",
        new Blob(["secret-attachment-control"], { type: "text/plain" }),
        "secret-original-name.txt",
      );
      const uploaded = await fetch(
        new URL("/api/v1/media/upload?channel=%23secret", f.server.url),
        { method: "POST", headers: { Authorization: `Bearer ${founder.token}` }, body: form },
      );
      expect(uploaded.status).toBe(201);
      const media = (await uploaded.json()) as any;
      for (const actor of [founder, bob]) {
        const read = await f.request(media.url, actor);
        expect(read.status).toBe(200);
        expect(await read.text()).toBe("secret-attachment-control");
        expect(read.headers.get("content-disposition")).toContain("secret-original-name.txt");
      }
      const denied = await f.request(media.url, charlie);
      expect(denied.status).toBe(404);
      expect(await denied.text()).not.toMatch(/secret-attachment-control|secret-original-name/);
      expect(denied.headers.get("content-disposition")).toBeNull();
      await command(f, b, "PART #secret");
      expect((await f.request(media.url, bob)).status).toBe(404);
      expect(await (await f.request(media.url, founder)).text()).toBe("secret-attachment-control");
      await unchanged(x);
      await f.stop();
      expect(JSON.stringify(await f.snapshot("media_uploads"))).toContain(
        "secret-original-name.txt",
      );
      await f.restart();
      expect((await f.request(media.url, charlie)).status).toBe(404);
      expect((await f.request(media.url, bob)).status).toBe(404);
      expect(await (await f.request(media.url, founder)).text()).toBe("secret-attachment-control");
    } finally {
      await f.dispose();
    }
  });

  it("requested channel configurations: registered-only, moderated, read-only, history and empty channels are real", async () => {
    const x = await fixture();
    const { f, founder, bob, owner, b } = x;
    try {
      for (const name of ["#restricted", "#moderated", "#readonly", "#empty", "#history"])
        await join(f, owner, name);
      await mode(f, owner, "#restricted", "+R");
      await join(f, b, "#restricted");
      await join(f, b, "#moderated");
      await mode(f, owner, "#moderated", "+m");
      expect((await command(f, b, "PRIVMSG #moderated :moderated-forgery")).join()).toContain(
        " 404 ",
      );
      await mode(f, owner, "#moderated", "+v bob");
      await post(f, bob, "#moderated", "moderated-voice-control");
      expect(
        (await f.request(route("#readonly", "/info"), founder, "PATCH", { readOnly: true })).status,
      ).toBe(200);
      await join(f, b, "#readonly");
      expect((await command(f, b, "PRIVMSG #readonly :readonly-forgery")).join()).toContain(
        " 404 ",
      );
      expect(
        (
          await f.request(route("#readonly", "/messages"), bob, "POST", {
            content: "readonly-rest-forgery",
          })
        ).status,
      ).toBe(400);
      await post(f, founder, "#readonly", "announcement-control");
      const first = await post(f, founder, "#history", "earlier-history-control"),
        last = await post(f, founder, "#history", "later-history-control");
      expect(last.createdAt).toBeGreaterThan(first.createdAt);
      await command(f, owner, "F UNREQUESTBOT #empty");
      await command(f, owner, "PART #empty");
      const empty = await info(f, founder, "#empty");
      expect(JSON.stringify(empty)).toContain('"registered":true');
      const names = await command(f, b, "NAMES #empty");
      expect(names.filter((l) => l.includes(" 353 "))).toEqual([]);
      await unchanged(x);
      await f.stop();
      expect(JSON.stringify(await f.snapshot("messages"))).not.toContain("forgery");
      expect(JSON.stringify(await f.snapshot("messages"))).toContain("earlier-history-control");
      expect(JSON.stringify(await f.snapshot("messages"))).toContain("later-history-control");
      await f.restart();
      expect(JSON.stringify(await info(f, founder, "#empty"))).toContain('"registered":true');
    } finally {
      await f.dispose();
    }
  });
});
