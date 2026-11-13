import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
const channelPath = (name: string) => `/api/v1/channels/${encodeURIComponent(name)}`;

async function join(client: TestIRCClient, name: string) {
  client.send(`JOIN ${name}`);
  await client.waitForLine((line) => line.includes(" 366 ") && line.includes(name));
}

async function events(f: Fixture, actor: MatrixActor) {
  const response = await f.request("/api/v1/auth/events-ticket", actor, "POST");
  expect(response.status).toBe(200);
  const { ticket } = (await response.json()) as any;
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`);
  const received: string[] = [];
  ws.on("message", (data) => received.push(data.toString()));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  async function until(needle: string) {
    if (received.some((value) => value.includes(needle))) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off("message", listener);
        reject(new Error(`No event ${needle}: ${received.join("\n")}`));
      }, 4000);
      function listener(data: WebSocket.RawData) {
        if (data.toString().includes(needle)) {
          clearTimeout(timer);
          ws.off("message", listener);
          resolve();
        }
      }
      ws.on("message", listener);
    });
  }
  return { ws, received, until };
}

async function send(f: Fixture, actor: MatrixActor, name: string, content: string) {
  const response = await f.request(`${channelPath(name)}/messages`, actor, "POST", { content });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as any).message;
}

// The receiver sends no PING or other input between revocation and the marker.
// A later public message/event is the output barrier, proving a live pipeline.
for (const action of ["kick", "ban"] as const) {
  it(`[WS-012 WS-024 CHAN-014 ${action === "kick" ? "CHAN-032" : "CHAN-028"}] idle ${action} revokes private IRC and event delivery while unrelated delivery stays live`, async () => {
    const f = await createMatrixFixture();
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const owner = await f.connect(alice),
        receiver = await f.connect(bob),
        outsider = await f.connect(charlie);
      await join(owner, "#vault");
      owner.send("MODE #vault +s");
      await owner.waitForLine((l) => l.includes(" MODE #vault +s"));
      await join(receiver, "#vault");
      for (const client of [owner, receiver, outsider]) await join(client, "#barrier");
      const authorized = await events(f, alice),
        revoked = await events(f, bob),
        unrelated = await events(f, charlie);
      streams.push(authorized, revoked, unrelated);
      const original = await send(f, alice, "#vault", `before-${action}`);
      await receiver.waitForLine((l) => l.includes(`:before-${action}`));
      await revoked.until(`before-${action}`);
      const baseline = await (await f.request(`${channelPath("#vault")}/messages`, alice)).json();
      // An unrelated ordinary member cannot invoke the same moderation operation.
      expect(
        (
          await f.request(
            `/admin/channels/%23vault/${action === "kick" ? "kick" : "modes"}`,
            charlie,
            "POST",
            action === "kick" ? { nick: "bob" } : { modes: "+b", params: ["bob!*@*"] },
          )
        ).status,
      ).toBe(403);
      expect(await (await f.request(`${channelPath("#vault")}/messages`, alice)).json()).toEqual(
        baseline,
      );
      owner.send(action === "kick" ? "KICK #vault bob :revoked" : "MODE #vault +b bob!*@*");
      await owner.waitForLine((l) =>
        l.includes(action === "kick" ? " KICK #vault bob" : " MODE #vault +b bob!*@*"),
      );
      const secret = `secret-after-${action}-${randomUUID()}`;
      await send(f, alice, "#vault", secret);
      await authorized.until(secret);
      const marker = `barrier-${randomUUID()}`;
      await send(f, alice, "#barrier", marker);
      await Promise.all([
        receiver.waitForLine((l) => l.includes(marker)),
        outsider.waitForLine((l) => l.includes(marker)),
        revoked.until(marker),
        unrelated.until(marker),
      ]);
      expect(receiver.lines.join("\n")).not.toContain(secret);
      expect(outsider.lines.join("\n")).not.toContain(secret);
      expect(revoked.received.join("\n")).not.toContain(secret);
      expect(unrelated.received.join("\n")).not.toContain(secret);
      expect((await f.request(`${channelPath("#vault")}/messages`, bob)).status).toBe(403);
      expect(
        (
          await f.request(`${channelPath("#vault")}/messages`, bob, "POST", {
            content: "forbidden-write",
          })
        ).status,
      ).toBe(403);
      const history = (await (
        await f.request(`${channelPath("#vault")}/messages`, alice)
      ).json()) as any;
      expect(history.messages.find((m: any) => m.id === original.id).content).toBe(
        `before-${action}`,
      );
      expect(JSON.stringify(history)).not.toContain("forbidden-write");
      for (const stream of streams) stream.ws.terminate();
      await f.stop();
      const messageTables = (await f.snapshot("messages")) as any[][];
      const rows = messageTables.flat();
      expect(rows.filter((r) => r.content === secret)).toHaveLength(1);
      expect(rows.some((r) => r.content === "forbidden-write")).toBe(false);
      // Both tables exist in every ChannelDO, enumerated in the same file order.
      const vaultIndex = messageTables.findIndex((table) =>
        table.some((row) => row.content === secret),
      );
      const members = (await f.snapshot("channel_members"))[vaultIndex] as any[];
      if (action === "kick")
        expect(members.filter((r) => r.user_id === bob.account.id)).toHaveLength(0);
      else
        expect((await f.snapshot("channel_bans")).flat()).toEqual(
          expect.arrayContaining([expect.objectContaining({ mask: "bob!*@*" })]),
        );
    } finally {
      for (const stream of streams) stream.ws.terminate();
      await f.dispose();
    }
  });
}

for (const action of ["logout", "disable", "reset"] as const) {
  it(`[${action === "logout" ? "AUTH-022 DM-015" : action === "disable" ? "AUTH-024 AUTH-025 WS-013" : "AUTH-023"} WS-024] ${action} invalidates an idle receiving event credential and preserves independent authorization`, async () => {
    const f = await createMatrixFixture();
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const owner = await f.connect(alice),
        receiver = await f.connect(bob),
        outsider = await f.connect(charlie);
      await join(owner, "#vault");
      owner.send("MODE #vault +s");
      await owner.waitForLine((l) => l.includes(" MODE #vault +s"));
      await join(receiver, "#vault");
      for (const client of [owner, receiver, outsider]) await join(client, "#barrier");
      const good = await events(f, alice),
        stale = await events(f, bob),
        unrelated = await events(f, charlie);
      streams.push(good, stale, unrelated);
      await send(f, alice, "#vault", "before-credential-revocation");
      await stale.until("before-credential-revocation");
      await receiver.waitForLine((l) => l.includes(":before-credential-revocation"));
      owner.send("PRIVMSG bob :private-dm-before-revocation");
      await receiver.waitForLine((l) => l.includes("private-dm-before-revocation"));
      expect((await f.request("/api/v1/dms/alice/messages", bob)).status).toBe(200);
      const protectedHistory = await (
        await f.request(`${channelPath("#vault")}/messages`, alice)
      ).json();
      if (action !== "logout") {
        expect(
          (
            await f.request(
              `/admin/accounts/bob/${action === "reset" ? "password" : "disable"}`,
              charlie,
              "POST",
              action === "reset" ? { password: "denied-replacement-password!" } : undefined,
            )
          ).status,
        ).toBe(403);
        expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
      }
      const closed = new Promise<void>((resolve) => stale.ws.once("close", () => resolve()));
      const ircClosed =
        action === "logout"
          ? undefined
          : new Promise<void>((resolve) => receiver.ws.once("close", () => resolve()));
      const replacement = `Replacement-${randomUUID()}!`;
      const response =
        action === "logout"
          ? await f.request("/api/v1/auth/logout", bob, "POST")
          : await f.request(
              `/admin/accounts/bob/${action === "reset" ? "password" : "disable"}`,
              root,
              "POST",
              action === "reset" ? { password: replacement } : undefined,
            );
      expect(response.status).toBe(200);
      expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(401);
      expect((await f.request("/api/v1/dms/alice/messages", bob)).status).toBe(401);
      expect(await (await f.request(`${channelPath("#vault")}/messages`, alice)).json()).toEqual(
        protectedHistory,
      );
      const secret = `after-credential-${randomUUID()}`;
      await send(f, alice, "#vault", secret);
      await good.until(secret);
      await closed;
      if (ircClosed) await ircClosed;
      else await receiver.waitForLine((l) => l.includes(secret)); // IRC PASS is an independent credential.
      const marker = `public-marker-${randomUUID()}`;
      await send(f, alice, "#barrier", marker);
      await unrelated.until(marker);
      await outsider.waitForLine((l) => l.includes(marker));
      expect(stale.received.join("\n")).not.toContain(secret);
      expect(unrelated.received.join("\n")).not.toContain(secret);
      if (action !== "logout") expect(receiver.lines.join("\n")).not.toContain(secret);
      if (action === "disable") {
        expect((await f.request("/admin/accounts/bob/enable", root, "POST")).status).toBe(200);
        expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(401);
      }
      const fresh = await f.login("bob", action === "reset" ? replacement : bob.password);
      expect((await f.request("/api/v1/dms/alice/messages", fresh)).status).toBe(200);
      expect((await f.request(`${channelPath("#vault")}/messages`, charlie)).status).toBe(403);
      for (const stream of streams) stream.ws.terminate();
      await f.stop();
      const messages = (await f.snapshot("messages")).flat() as any[];
      expect(messages.filter((m) => m.content === secret)).toHaveLength(1);
      expect(messages.find((m) => m.content === "before-credential-revocation")).toBeDefined();
      const sessions = (await f.snapshot("api_sessions")).flat() as any[];
      expect(sessions.filter((s) => s.user_id === bob.account.id)).toHaveLength(1);
    } finally {
      for (const stream of streams) stream.ws.terminate();
      await f.dispose();
    }
  });
}

for (const action of ["logout", "admin-role"] as const) {
  it(`[${action === "logout" ? "WS-014" : "WS-015"}] local workerd hibernating eviction rechecks ${action} without a receiving-client reconnect`, async () => {
    const f = await createMatrixFixture();
    const streams: Awaited<ReturnType<typeof events>>[] = [];
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob");
      const owner = await f.connect(alice);
      await join(owner, "#hibernation");
      owner.send("MODE #hibernation +s");
      await owner.waitForLine((l) => l.includes(" MODE #hibernation +s"));
      await join(owner, "#barrier");
      const member = await f.connect(bob);
      if (action === "logout") await join(member, "#hibernation");
      else
        expect(
          (
            await f.request("/admin/accounts/bob/roles", root, "POST", {
              role: "admin",
              action: "grant",
            })
          ).status,
        ).toBe(200);
      const good = await events(f, alice),
        stale = await events(f, bob);
      streams.push(good, stale);
      await send(f, alice, "#hibernation", "before-local-hibernation");
      await stale.until("before-local-hibernation");
      if (action === "logout")
        expect((await f.request("/api/v1/auth/logout", bob, "POST")).status).toBe(200);
      else
        expect(
          (
            await f.request("/admin/accounts/bob/roles", root, "POST", {
              role: "admin",
              action: "revoke",
            })
          ).status,
        ).toBe(200);
      // Installed Miniflare exposes workerd:unsafe.evict(..., {webSockets:'hibernate'}).
      // This exercises local attachment reconstruction, not deployed Cloudflare behavior.
      await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
        name: "FlaRC",
        webSockets: "hibernate",
      });
      const closed =
        action === "logout"
          ? new Promise<void>((resolve) => stale.ws.once("close", () => resolve()))
          : undefined;
      const secret = `after-local-hibernation-${randomUUID()}`;
      await send(f, alice, "#hibernation", secret);
      await good.until(secret);
      if (closed) await closed;
      else {
        const marker = `hibernation-barrier-${randomUUID()}`;
        await send(f, alice, "#barrier", marker);
        await stale.until(marker);
        expect((await f.request("/admin/accounts", bob)).status).toBe(403);
        expect((await f.request(`${channelPath("#hibernation")}/messages`, bob)).status).toBe(403);
      }
      expect(stale.received.join("\n")).not.toContain(secret);
      for (const stream of streams) stream.ws.terminate();
      await f.stop();
      expect((await f.snapshot("messages")).flat()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: secret, sender_id: alice.account.id }),
        ]),
      );
    } finally {
      for (const stream of streams) stream.ws.terminate();
      await f.dispose();
    }
  });
}
