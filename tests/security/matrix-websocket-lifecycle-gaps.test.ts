import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "../helpers/event-reader";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
async function wire(client: TestIRCClient, command: string, pattern: RegExp) {
  const reply = client.waitForNewLine((line) => pattern.test(line));
  client.send(command);
  return reply;
}
async function join(client: TestIRCClient, channel: string) {
  await wire(client, `JOIN ${channel}`, new RegExp(` 366 .*${channel}`));
}
async function stream(f: Fixture, actor: MatrixActor) {
  const res = await f.request("/api/v1/auth/events-ticket", actor, "POST");
  expect(res.status).toBe(200);
  const ticket = ((await res.json()) as any).ticket;
  const shard = createHash("sha256").update(ticket).digest().readUInt32BE(0) % 4;
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`, [
      "flarc.events.v2",
    ]),
    lines: string[] = [];
  ws.on("message", (data) => {
    if (!isReaderControl(ws, data)) lines.push(data.toString());
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  async function until(marker: string) {
    for (let i = 0; i < 500; i++) {
      if (lines.some((line) => line.includes(marker))) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Missing event marker ${marker}`);
  }
  return { ws, lines, until, shard };
}
async function post(f: Fixture, who: MatrixActor, channel: string, content: string) {
  const res = await f.request(
    `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
    who,
    "POST",
    { content },
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as any).message;
}
async function hibernate(f: Fixture, streams: Array<{ shard: number }>) {
  await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
    name: "FlaRC",
    webSockets: "hibernate",
  });
  for (const shard of new Set(streams.map((stream) => stream.shard)))
    await f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
      name: `FlaRC:events:${shard}`,
      webSockets: "hibernate",
    });
}
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

for (const action of ["kick", "ban", "role", "logout", "disable", "reset"] as const) {
  it(`idle ${action} takes effect on reconstructed recipients with scoped delivery and persistent state`, async () => {
    const f = await createMatrixFixture();
    const streams: Awaited<ReturnType<typeof stream>>[] = [];
    try {
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      await join(a, "#vault");
      await wire(a, "MODE #vault +s", / MODE #vault \+s/);
      await join(b, "#vault");
      await join(c, "#unrelated");
      await wire(c, "MODE #unrelated +s", / MODE #unrelated \+s/);
      for (const client of [a, b, c]) await join(client, "#barrier");
      const unrelated = await post(f, charlie, "#unrelated", `unrelated-${action}`);
      const dmMarker = `unrelated-dm-${action}-${randomUUID()}`;
      const dm = c.waitForNewLine((line) => line.includes(dmMarker));
      a.send(`PRIVMSG charlie :${dmMarker}`);
      await dm;
      const good = await stream(f, alice),
        target = await stream(f, bob),
        outside = await stream(f, charlie);
      streams.push(good, target, outside);
      let roleId = "";
      if (action === "role") {
        const made = await f.request("/api/v1/channels/%23vault/roles", alice, "POST", {
          name: "TemporaryOperator",
          ircMode: "o",
          permissions: [],
        });
        expect(made.status).toBe(201);
        roleId = ((await made.json()) as any).role.id;
        expect(
          (
            await f.request("/api/v1/channels/%23vault/roles/assign", alice, "POST", {
              userId: bob.account.id,
              roleGroupId: roleId,
            })
          ).status,
        ).toBe(200);
        await wire(b, "MODE #vault +i", / MODE #vault \+i/);
        await wire(b, "MODE #vault -i", / MODE #vault -i/);
      }
      const initial = `initial-${action}-${randomUUID()}`;
      await post(f, alice, "#vault", initial);
      await Promise.all([target.until(initial), b.waitForLine((line) => line.includes(initial))]);
      const beforeBarrier = `before-${action}-${randomUUID()}`;
      await post(f, alice, "#barrier", beforeBarrier);
      await Promise.all([
        target.until(beforeBarrier),
        outside.until(beforeBarrier),
        b.waitForLine((line) => line.includes(beforeBarrier)),
        c.waitForLine((line) => line.includes(beforeBarrier)),
      ]);
      await hibernate(f, streams);
      // Bob sends no input from this point until the transition and delivery checks finish.
      const awake = `awake-${action}-${randomUUID()}`;
      await post(f, alice, "#barrier", awake);
      await Promise.all([
        good.until(awake),
        target.until(awake),
        outside.until(awake),
        a.waitForLine((line) => line.includes(awake)),
        b.waitForLine((line) => line.includes(awake)),
        c.waitForLine((line) => line.includes(awake)),
      ]);
      const infoBefore = await (await f.request("/api/v1/channels/%23vault/info", alice)).json();
      const ircOffsets = [a, b, c].map((client) => client.lines.length),
        eventOffsets = [good, target, outside].map((event) => event.lines.length);
      const bad = await f.request("/api/v1/channels/%23vault/info", charlie, "PATCH", {
        description: `forged-${action}`,
      });
      expect(bad.status).toBe(403);
      expect(await (await f.request("/api/v1/channels/%23vault/info", alice)).json()).toEqual(
        infoBefore,
      );
      const denialBarrier = `denial-${action}-${randomUUID()}`;
      await post(f, alice, "#barrier", denialBarrier);
      await Promise.all([
        ...[a, b, c].map((client) => client.waitForLine((line) => line.includes(denialBarrier))),
        ...[good, target, outside].map((event) => event.until(denialBarrier)),
      ]);
      for (const [i, client] of [a, b, c].entries())
        expect(
          client.lines.slice(ircOffsets[i]).filter((line) => !line.includes(denialBarrier)),
        ).toEqual([]);
      for (const [i, event] of [good, target, outside].entries())
        expect(
          event.lines.slice(eventOffsets[i]).filter((line) => !line.includes(denialBarrier)),
        ).toEqual([]);
      const replacement = `Replacement-${randomUUID()}!`;
      const targetClosed = new Promise<void>((resolve) => target.ws.once("close", () => resolve()));
      const ircClosed = new Promise<void>((resolve) => b.ws.once("close", () => resolve()));
      if (action === "kick") await wire(a, "KICK #vault bob :revoked", / KICK #vault bob/);
      if (action === "ban") await wire(a, "MODE #vault +b bob!*@*", / MODE #vault \+b bob!\*@\*/);
      if (action === "role")
        expect(
          (
            await f.request("/api/v1/channels/%23vault/roles/assign", alice, "POST", {
              userId: bob.account.id,
              roleGroupId: roleId,
              remove: true,
            })
          ).status,
        ).toBe(200);
      if (action === "logout")
        expect((await f.request("/api/v1/auth/logout", bob, "POST")).status).toBe(200);
      if (action === "disable")
        expect((await f.request("/admin/accounts/bob/disable", root, "POST")).status).toBe(200);
      if (action === "reset")
        expect(
          (await f.request("/admin/accounts/bob/password", root, "POST", { password: replacement }))
            .status,
        ).toBe(200);
      await hibernate(f, streams);
      const secret = `after-${action}-${randomUUID()}`;
      await post(f, alice, "#vault", secret);
      await good.until(secret);
      const barrier = `after-barrier-${action}-${randomUUID()}`;
      await post(f, alice, "#barrier", barrier);
      await Promise.all([
        good.until(barrier),
        outside.until(barrier),
        a.waitForLine((line) => line.includes(barrier)),
        c.waitForLine((line) => line.includes(barrier)),
      ]);
      if (["kick", "ban", "role"].includes(action))
        await Promise.all([target.until(barrier), b.waitForLine((line) => line.includes(barrier))]);
      if (["logout", "disable", "reset"].includes(action)) await targetClosed;
      if (["disable", "reset"].includes(action)) await ircClosed;
      if (["kick", "ban", "disable", "reset"].includes(action)) {
        expect(target.lines.join("\n")).not.toContain(secret);
        expect(b.lines.join("\n")).not.toContain(secret);
      } else if (action === "logout") {
        expect(target.lines.join("\n")).not.toContain(secret);
        await b.waitForLine((line) => line.includes(secret)); // The independent IRC PASS remains valid.
        await b.waitForLine((line) => line.includes(barrier));
      } else {
        await Promise.all([target.until(secret), b.waitForLine((line) => line.includes(secret))]);
      }
      expect(outside.lines.join("\n")).not.toContain(secret);
      expect(c.lines.join("\n")).not.toContain(secret);
      const activeIrc = [a, c, ...(["kick", "ban", "role", "logout"].includes(action) ? [b] : [])];
      const activeEvents = [
        good,
        outside,
        ...(["kick", "ban", "role"].includes(action) ? [target] : []),
      ];
      const deniedIrcOffsets = activeIrc.map((client) => client.lines.length),
        deniedEventOffsets = activeEvents.map((event) => event.lines.length);
      if (action === "kick" || action === "ban") {
        expect((await f.request("/api/v1/channels/%23vault/messages", bob)).status).toBe(403);
        expect(
          (
            await f.request("/api/v1/channels/%23vault/messages", bob, "POST", {
              content: `denied-${action}`,
            })
          ).status,
        ).toBe(403);
      }
      if (["logout", "disable", "reset"].includes(action))
        expect((await f.request("/api/v1/dms/alice/messages", bob)).status).toBe(401);
      if (action === "role") await wire(b, "MODE #vault +i", / 482 /);
      const deniedBarrier = `post-denial-${action}-${randomUUID()}`;
      await post(f, alice, "#barrier", deniedBarrier);
      await Promise.all([
        ...activeIrc.map((client) => client.waitForLine((line) => line.includes(deniedBarrier))),
        ...activeEvents.map((event) => event.until(deniedBarrier)),
      ]);
      for (const [i, client] of activeIrc.entries())
        expect(
          client.lines
            .slice(deniedIrcOffsets[i])
            .filter(
              (line) =>
                !line.includes(deniedBarrier) &&
                !(action === "role" && client === b && / 482 /.test(line)),
            ),
        ).toEqual([]);
      for (const [i, event] of activeEvents.entries())
        expect(
          event.lines.slice(deniedEventOffsets[i]).filter((line) => !line.includes(deniedBarrier)),
        ).toEqual([]);
      for (const s of streams) s.ws.terminate();
      await f.stop();
      const messageTables = await f.snapshot("messages");
      const messages = messageTables.flat() as any[],
        dms = (await f.snapshot("direct_messages")).flat() as any[];
      expect(messages).toContainEqual(
        expect.objectContaining({ id: unrelated.id, content: `unrelated-${action}` }),
      );
      expect(messages).toContainEqual(
        expect.objectContaining({ content: secret, sender_id: alice.account.id }),
      );
      expect(messages.some((row) => row.content === `denied-${action}`)).toBe(false);
      expect(dms).toContainEqual(
        expect.objectContaining({
          content: dmMarker,
          sender_id: alice.account.id,
          target_id: charlie.account.id,
        }),
      );
      if (action === "kick") {
        const vaultIndex = messageTables.findIndex((table) =>
          (table as any[]).some((row) => row.content === secret),
        );
        expect(vaultIndex).toBeGreaterThanOrEqual(0);
        expect(
          ((await f.snapshot("channel_members"))[vaultIndex] as any[]).some(
            (row) => row.user_id === bob.account.id,
          ),
        ).toBe(false);
      }
      if (action === "ban")
        expect((await f.snapshot("channel_bans")).flat()).toContainEqual(
          expect.objectContaining({ mask: "bob!*@*" }),
        );
      if (action === "role")
        expect(
          (await f.snapshot("channel_user_roles"))
            .flat()
            .some((row: any) => row.user_id === bob.account.id && row.group_id === roleId),
        ).toBe(false);
      if (["logout", "disable", "reset"].includes(action))
        expect(
          (await f.snapshot("api_sessions"))
            .flat()
            .some((row: any) => row.token_hash === tokenHash(bob.token)),
        ).toBe(false);
      if (action === "disable" || action === "reset") {
        const users = (await f.snapshot("users")).flat() as any[];
        const affected = users.find((row) => row.id === bob.account.id);
        expect(affected.credential_version).toBeGreaterThan(0);
        expect(affected.disabled_at === null).toBe(action === "reset");
        expect(users).toContainEqual(
          expect.objectContaining({
            id: charlie.account.id,
            disabled_at: null,
            credential_version: 0,
          }),
        );
      }
      await f.restart();
      expect((await f.request("/api/v1/channels/%23unrelated/messages", alice)).status).toBe(403);
      if (action === "disable") {
        expect(
          (
            await f.request("/api/v1/auth/login", undefined, "POST", {
              username: "bob",
              password: bob.password,
            })
          ).status,
        ).toBe(401);
        expect((await f.request("/admin/accounts/bob/enable", root, "POST")).status).toBe(200);
        expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(401);
      }
      if (action === "reset")
        expect(
          (
            await f.request("/api/v1/auth/login", undefined, "POST", {
              username: "bob",
              password: bob.password,
            })
          ).status,
        ).toBe(401);
      const fresh = await f.login("bob", action === "reset" ? replacement : bob.password);
      const aa = await f.connect(alice),
        bb = await f.connect(fresh),
        cc = await f.connect(charlie);
      await join(aa, "#vault");
      await join(cc, "#unrelated");
      expect(
        await (await f.request("/api/v1/channels/%23unrelated/messages", charlie)).text(),
      ).toContain(`unrelated-${action}`);
      expect(await (await f.request("/api/v1/dms/charlie/messages", alice)).text()).toContain(
        dmMarker,
      );
      if (action === "ban") {
        await wire(bb, "JOIN #vault", / 474 /);
        await wire(aa, "MODE #vault -b bob!*@*", / MODE #vault -b/);
      }
      await join(bb, "#vault");
      expect((await f.request("/api/v1/channels/%23vault/messages", fresh)).status).toBe(200);
      if (action === "role") {
        await wire(bb, "MODE #vault +i", / 482 /);
        expect(
          (
            await f.request("/api/v1/channels/%23vault/roles/assign", alice, "POST", {
              userId: bob.account.id,
              roleGroupId: roleId,
            })
          ).status,
        ).toBe(200);
        await wire(bb, "MODE #vault +i", / MODE #vault \+i/);
      }
      const restoredEvents = await stream(f, fresh);
      streams.push(restoredEvents);
      const restored = `restored-${action}-${randomUUID()}`,
        delivery = bb.waitForNewLine((line) => line.includes(restored));
      await post(f, alice, "#vault", restored);
      await Promise.all([delivery, restoredEvents.until(restored)]);
    } finally {
      for (const s of streams) s.ws.terminate();
      await f.dispose();
    }
  }, 60000);
}
