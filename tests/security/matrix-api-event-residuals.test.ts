import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { accountDisk, channelDisk, ircCommand, join } from "../helpers/admin-gap-fixture";
import { isReaderControl } from "../helpers/event-reader";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";

it("WS-010: query and incoming frames cannot grant access to automatic staff events", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    let a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await join(a, "#staff");
    await ircCommand(a, "MODE #staff +si", / MODE #staff \+si/);
    await ircCommand(a, "INVITE bob #staff", / 341 .*bob #staff/);
    await join(b, "#staff");
    await join(c, "#unrelated");
    for (const client of [a, b, c]) await join(client, "#identitybarrier");
    async function stream(actor: MatrixActor, forged = false) {
      const issued = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(issued.status).toBe(200);
      const ticket = ((await issued.json()) as any).ticket;
      const query = forged ? `&channel=%23staff&username=alice&accountId=${alice.account.id}` : "";
      if (forged) {
        const denied = await f.server.mf.dispatchFetch(
          `${f.server.url.origin}/api/v1/events?ticket=${ticket}${query}`,
          { headers: { Upgrade: "websocket" } },
        );
        expect(denied.status).toBe(400);
      }
      // Redeeming the same ticket confirms selector rejection did not consume it.
      const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`, [
        "flarc.events.v2",
      ]);
      sockets.push(ws);
      const lines: string[] = [];
      ws.on("message", (data) => {
        if (!isReaderControl(ws, data)) lines.push(data.toString());
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return {
        ws,
        lines,
        async until(marker: string) {
          for (let i = 0; i < 500; i++) {
            if (lines.some((line) => line.includes(marker))) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new Error(`Missing event barrier ${marker}`);
        },
      };
    }
    async function post(actor: MatrixActor, channel: string, content: string) {
      const res = await f.request(
        `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
        actor,
        "POST",
        { content },
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as any).message.id as string;
    }
    const unrelatedId = await post(charlie, "#unrelated", "independent-event-sentinel");
    const ids: string[] = [];
    async function phase(label: string, bobAllowed: boolean) {
      const sa = await stream(alice),
        sb = await stream(bob, true),
        sc = await stream(charlie, true);
      const attempt = await stream(charlie, true);
      const accountBefore = await accountDisk(f.directory),
        staffBefore = await channelDisk(f.directory, "#staff"),
        unrelatedBefore = await channelDisk(f.directory, "#unrelated");
      const closed = new Promise<number>((resolve) => attempt.ws.once("close", resolve));
      attempt.ws.send(
        JSON.stringify({
          type: "subscribe",
          channel: "#staff",
          username: "alice",
          accountId: alice.account.id,
        }),
      );
      expect(await closed).toBe(1008);
      const content = `staff-${label}-${randomUUID()}`;
      ids.push(await post(alice, "#staff", content));
      const marker = `event-barrier-${randomUUID()}`;
      await post(alice, "#identitybarrier", marker);
      await Promise.all([
        sa.until(content),
        sa.until(marker),
        sb.until(marker),
        sc.until(marker),
        ...[a, b, c].map((client) => client.waitForLine((line) => line.includes(marker))),
      ]);
      if (bobAllowed) {
        await sb.until(content);
        expect(b.lines.some((line) => line.includes(content))).toBe(true);
      } else {
        expect(sb.lines.join("\n")).not.toContain(content);
        expect(b.lines.join("\n")).not.toContain(content);
      }
      expect(sc.lines.join("\n")).not.toContain(content);
      expect(c.lines.join("\n")).not.toContain(content);
      expect(await accountDisk(f.directory)).toEqual(accountBefore);
      const staffAfter = await channelDisk(f.directory, "#staff");
      const beforeSequence = staffBefore.metadata.find(
        (row: any) => row.key === "next_sequence",
      ) as any;
      const afterSequence = staffAfter.metadata.find(
        (row: any) => row.key === "next_sequence",
      ) as any;
      expect(Number(afterSequence.value)).toBe(Number(beforeSequence.value) + 1);
      expect({
        ...staffAfter,
        metadata: staffAfter.metadata.filter((row: any) => row.key !== "next_sequence"),
      }).toEqual({
        ...staffBefore,
        metadata: staffBefore.metadata.filter((row: any) => row.key !== "next_sequence"),
      });
      expect(await channelDisk(f.directory, "#unrelated")).toEqual(unrelatedBefore);
      const history = await f.request("/api/v1/channels/%23staff/messages", alice);
      expect(history.status).toBe(200);
      const messages = ((await history.json()) as any).messages;
      expect(messages.map((message: any) => message.id).sort()).toEqual([...ids].sort());
      expect(JSON.stringify(messages)).not.toContain("subscribe");
      const independent = await f.request("/api/v1/channels/%23unrelated/messages", charlie);
      expect(independent.status).toBe(200);
      expect(await independent.text()).toContain(unrelatedId);
      for (const item of [sa, sb, sc]) item.ws.terminate();
    }
    await phase("member", true);
    await ircCommand(a, "KICK #staff bob :revoked", / KICK #staff bob/);
    await phase("revoked", false);
    for (const ws of sockets.splice(0)) ws.terminate();
    await f.restart();
    a = await f.connect(alice);
    b = await f.connect(bob);
    c = await f.connect(charlie);
    await join(a, "#staff");
    await join(c, "#unrelated");
    for (const client of [a, b, c]) await join(client, "#identitybarrier");
    await phase("recreated", false);
  } finally {
    for (const ws of sockets) ws.terminate();
    await f.dispose();
  }
}, 60000);
