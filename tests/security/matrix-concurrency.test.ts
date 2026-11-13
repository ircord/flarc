import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import { TestIRCClient } from "../helpers/miniflare-harness";

it("[WS-001 WS-006 WS-016 WS-023] event tickets cannot authenticate IRC and cross-origin or credential-query event handshakes are denied", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  let wrongEndpoint: TestIRCClient | undefined;
  try {
    const alice = await f.createActor("alice");
    const response = await f.request("/api/v1/auth/events-ticket", alice, "POST");
    expect(response.status).toBe(200);
    const { ticket } = (await response.json()) as any;
    wrongEndpoint = new TestIRCClient(`${f.server.wsUrl}?ticket=${ticket}`);
    await wrongEndpoint.connect();
    wrongEndpoint.send(
      "NICK TicketPretender\r\nUSER pretender 0 * :Unproven identity\r\nJOIN #wrong-endpoint",
    );
    await wrongEndpoint.waitForNumeric(451);
    await f.barrier(wrongEndpoint);
    expect(wrongEndpoint.lines.some((l) => l.includes(" 001 ") || l.includes(" JOIN #"))).toBe(
      false,
    );
    for (const suffix of ["", `?token=${alice.token}`, "?ticket=invalid"]) {
      const denied = await f.server.mf.dispatchFetch(
        `${f.server.url.origin}/api/v1/events${suffix}`,
        { headers: { Upgrade: "websocket" } },
      );
      expect(denied.status).toBe(401);
    }
    const foreignOrigin = await f.server.mf.dispatchFetch(
      `${f.server.url.origin}/api/v1/events?ticket=${ticket}`,
      { headers: { Upgrade: "websocket", Origin: "https://untrusted.invalid" } },
    );
    expect(foreignOrigin.status).toBe(403);
    // Wrong endpoint / Origin rejection did not consume the legitimately scoped ticket.
    const good = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`, {
      origin: f.server.url.origin,
    });
    sockets.push(good);
    await new Promise<void>((resolve, reject) => {
      good.once("open", resolve);
      good.once("error", reject);
    });
    const owner = await f.connect(alice);
    owner.send("JOIN #origin-control");
    await owner.waitForNumeric(366);
    const marker = `origin-control-${randomUUID()}`;
    const delivered = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Valid origin ticket did not receive authorized event")),
        4000,
      );
      good.on("message", (data) => {
        if (data.toString().includes(marker)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(
      (
        await f.request("/api/v1/channels/%23origin-control/messages", alice, "POST", {
          content: marker,
        })
      ).status,
    ).toBe(201);
    await delivered;
    good.terminate();
    wrongEndpoint.close();
    wrongEndpoint = new TestIRCClient(f.server.wsUrl);
    await wrongEndpoint.connect();
    wrongEndpoint.send(
      "NICK ReconnectedPretender\r\nUSER pretender 0 * :Reconnected without credentials\r\nJOIN #origin-control",
    );
    await wrongEndpoint.waitForNumeric(451);
    await f.barrier(wrongEndpoint);
    expect(
      wrongEndpoint.lines.some((line) => line.includes(" 001 ") || line.includes(" JOIN #")),
    ).toBe(false);
    wrongEndpoint.close();
    await f.stop();
    expect((await f.snapshot("messages")).flat()).toEqual([
      expect.objectContaining({ content: marker, sender_id: alice.account.id }),
    ]);
  } finally {
    wrongEndpoint?.close();
    for (const ws of sockets) ws.terminate();
    await f.dispose();
  }
});

it("[WS-002 WS-004 WS-005 WS-007 ABUSE-016] eight simultaneous real WebSocket ticket redemptions have exactly one authenticated winner", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const owner = await f.connect(alice);
    owner.send("JOIN #alice-only");
    await owner.waitForNumeric(366);
    owner.send("MODE #alice-only +s");
    await owner.waitForLine((l) => l.includes(" MODE #alice-only +s"));
    const response = await f.request("/api/v1/auth/events-ticket", alice, "POST");
    expect(response.status).toBe(200);
    const { ticket } = (await response.json()) as any;
    const forged = await f.server.mf.dispatchFetch(
      `${f.server.url.origin}/api/v1/events?ticket=${ticket}&username=bob&accountId=${bob.account.id}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(forged.status).toBe(400);
    const outcomes = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<number>((resolve, reject) => {
            const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`);
            sockets.push(ws);
            ws.once("open", () => resolve(101));
            ws.once("unexpected-response", (_request, reply) => {
              reply.resume();
              resolve(reply.statusCode!);
            });
            ws.once("error", reject);
          }),
      ),
    );
    expect(outcomes.filter((code) => code === 101)).toHaveLength(1);
    expect(outcomes.filter((code) => code === 401)).toHaveLength(7);
    const replay = await f.server.mf.dispatchFetch(
      `${f.server.url.origin}/api/v1/events?ticket=${ticket}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(replay.status).toBe(401);
    const winner = sockets.find((ws) => ws.readyState === WebSocket.OPEN)!;
    const marker = `alice-principal-${randomUUID()}`;
    const event = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Winning ticket did not receive Alice's authorized event")),
        4000,
      );
      winner.on("message", (data) => {
        if (data.toString().includes(marker)) {
          clearTimeout(timer);
          resolve(data.toString());
        }
      });
    });
    expect(
      (
        await f.request("/api/v1/channels/%23alice-only/messages", alice, "POST", {
          content: marker,
        })
      ).status,
    ).toBe(201);
    expect(await event).toContain(marker);
    expect((await f.request("/api/v1/channels/%23alice-only/messages", bob)).status).toBe(403);
    await f.stop();
    expect((await f.snapshot("event_tickets")).flat()).toHaveLength(0);
    expect((await f.snapshot("messages")).flat()).toEqual([
      expect.objectContaining({ content: marker, sender_id: alice.account.id }),
    ]);
  } finally {
    for (const ws of sockets) ws.terminate();
    await f.dispose();
  }
});

it("[MSG-023 DB-017 DB-024] concurrent idempotent retries commit once and duplicate client keys stay scoped to account and channel", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const owner = await f.connect(alice),
      member = await f.connect(bob),
      outsider = await f.connect(charlie);
    for (const name of ["#one", "#two"]) {
      owner.send(`JOIN ${name}`);
      await owner.waitForLine((l) => l.includes(" 366 ") && l.includes(name));
      owner.send(`MODE ${name} +s`);
      await owner.waitForLine((l) => l.includes(` MODE ${name} +s`));
      member.send(`JOIN ${name}`);
      await member.waitForLine((l) => l.includes(" 366 ") && l.includes(name));
    }
    for (const client of [owner, member, outsider]) {
      client.send("JOIN #markers");
      await client.waitForLine((l) => l.includes(" 366 ") && l.includes("#markers"));
    }
    const key = `same-client-key-${randomUUID()}`;
    const post = (channel: string, actor: typeof alice, content: string) =>
      f.request(
        `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
        actor,
        "POST",
        { content },
        { "idempotency-key": key },
      );
    const retries = await Promise.all(
      Array.from({ length: 12 }, () => post("#one", alice, "one-committed-body")),
    );
    expect(retries.map((r) => r.status)).toEqual(Array(12).fill(201));
    const results = (await Promise.all(retries.map((r) => r.json()))) as any[];
    expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
    const [otherAccount, otherChannel, fourth] = await Promise.all([
      post("#one", bob, "bob-distinct-body"),
      post("#two", alice, "alice-other-channel"),
      post("#two", bob, "bob-other-channel"),
    ]);
    const distinct = await Promise.all(
      [otherAccount, otherChannel, fourth].map(async (r) => {
        expect(r.status).toBe(201);
        return ((await r.json()) as any).message;
      }),
    );
    expect(new Set([results[0].message.id, ...distinct.map((m) => m.id)]).size).toBe(4);
    const conflict = await post("#one", alice, "must-not-overwrite");
    expect(conflict.status).toBe(400);
    expect((await post("#one", charlie, "outsider-injection")).status).toBe(403);
    const marker = `delivery-barrier-${randomUUID()}`;
    expect(
      (await f.request("/api/v1/channels/%23markers/messages", alice, "POST", { content: marker }))
        .status,
    ).toBe(201);
    await Promise.all([
      member.waitForLine((l) => l.includes(marker)),
      outsider.waitForLine((l) => l.includes(marker)),
    ]);
    expect(
      member.lines.filter((l) => l.includes(" PRIVMSG #one :one-committed-body")),
    ).toHaveLength(1);
    expect(outsider.lines.join("\n")).not.toMatch(
      /one-committed-body|bob-distinct-body|alice-other-channel|bob-other-channel/,
    );
    await f.stop();
    const databases = (await f.snapshot("messages")) as any[][];
    expect(databases.flat().filter((m) => m.content === "one-committed-body")).toHaveLength(1);
    expect(
      databases.flat().some((m) => /must-not-overwrite|outsider-injection/.test(m.content)),
    ).toBe(false);
    for (const rows of databases)
      expect(new Set(rows.map((m) => m.sequence)).size).toBe(rows.length);
    expect(databases.flat().filter((m) => m.id === distinct[0].id)[0].sender_id).toBe(
      bob.account.id,
    );
  } finally {
    await f.dispose();
  }
});

it("[MSG-024 MSG-028] concurrent distinct writes produce one canonical sequence and matching ordered IRC delivery", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const owner = await f.connect(alice),
      receiver = await f.connect(bob),
      outsider = await f.connect(charlie);
    receiver.send("CAP REQ :message-tags server-time");
    await receiver.waitForLine((l) => l.includes(" ACK "));
    owner.send("JOIN #ordered");
    await owner.waitForNumeric(366);
    owner.send("MODE #ordered +s");
    await owner.waitForLine((l) => l.includes(" MODE #ordered +s"));
    receiver.send("JOIN #ordered");
    await receiver.waitForNumeric(366);
    for (const client of [owner, receiver, outsider]) {
      client.send("JOIN #markers");
      await client.waitForLine((l) => l.includes(" 366 ") && l.includes("#markers"));
    }
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        f.request("/api/v1/channels/%23ordered/messages", alice, "POST", {
          content: `ordered-body-${i}`,
        }),
      ),
    );
    const messages = await Promise.all(
      responses.map(async (r) => {
        expect(r.status).toBe(201);
        return ((await r.json()) as any).message;
      }),
    );
    const marker = `order-barrier-${randomUUID()}`;
    expect(
      (await f.request("/api/v1/channels/%23markers/messages", alice, "POST", { content: marker }))
        .status,
    ).toBe(201);
    await Promise.all([
      receiver.waitForLine((l) => l.includes(marker)),
      outsider.waitForLine((l) => l.includes(marker)),
    ]);
    const sorted = messages.sort((a, b) => a.sequence - b.sequence);
    expect(sorted.map((m) => m.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const delivered = receiver.lines.filter((l) => l.includes(" PRIVMSG #ordered :ordered-body-"));
    expect(delivered).toHaveLength(20);
    expect(delivered.map((l) => l.match(/msgid=([^; ]+)/)?.[1])).toEqual(sorted.map((m) => m.id));
    for (const message of sorted)
      expect(delivered.find((l) => l.includes(`msgid=${message.id}`))).toContain(
        new Date(message.createdAt).toISOString(),
      );
    expect(outsider.lines.join("\n")).not.toContain("ordered-body-");
    const history = (await (
      await f.request("/api/v1/channels/%23ordered/messages?limit=100", alice)
    ).json()) as any;
    expect(history.messages.map((m: any) => m.id)).toEqual(sorted.map((m) => m.id).reverse());
    await f.stop();
    const rows = (await f.snapshot("messages")).flat() as any[];
    expect(rows.filter((m) => m.content.startsWith("ordered-body-"))).toHaveLength(20);
    expect(
      rows
        .filter((m) => m.content.startsWith("ordered-body-"))
        .sort((a, b) => a.sequence - b.sequence)
        .map((m) => m.id),
    ).toEqual(sorted.map((m) => m.id));
  } finally {
    await f.dispose();
  }
});

it("[AUTH-011 API-004 DB-025] a revoked real principal cannot mutate through REST or the owning-object session recheck", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const owner = await f.connect(alice);
    owner.send("JOIN #principal");
    await owner.waitForNumeric(366);
    const route = "/api/v1/channels/%23principal/messages";
    expect(
      (await f.request(route, alice, "POST", { content: "authorized-before-logout" })).status,
    ).toBe(201);
    const namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const channel = namespace.get(namespace.idFromName("FlaRC:#principal")) as any;
    expect((await channel.clientRequest(alice.token, "history", { limit: 10 })).length).toBe(1);
    expect((await f.request("/api/v1/auth/logout", alice, "POST")).status).toBe(200);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.request(route, alice, "POST", { content: "stale-principal-write" }),
      ),
    );
    expect(attempts.map((r) => r.status)).toEqual(Array(8).fill(401));
    await expect(
      channel.clientRequest(alice.token, "send", { content: "stale-domain-write" }),
    ).rejects.toThrow();
    const history = (await (await f.request(route, bob)).json()) as any;
    expect(history.messages.map((m: any) => m.content)).toEqual(["authorized-before-logout"]);
    await f.stop();
    expect((await f.snapshot("messages")).flat()).toEqual([
      expect.objectContaining({ content: "authorized-before-logout", sequence: 1 }),
    ]);
  } finally {
    await f.dispose();
  }
});

it("[ROLE-027 ROLE-029 ROLE-033 DB-017] concurrent role deletion, assignment and sends cannot resurrect voice or bypass later authorization", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const owner = await f.connect(alice),
      speaker = await f.connect(bob),
      outsider = await f.connect(charlie);
    owner.send("JOIN #moderated");
    await owner.waitForNumeric(366);
    speaker.send("JOIN #moderated");
    await speaker.waitForNumeric(366);
    owner.send("MODE #moderated +sm");
    await owner.waitForLine((l) => l.includes(" MODE #moderated +sm"));
    const route = "/api/v1/channels/%23moderated";
    const created = await f.request(`${route}/roles`, alice, "POST", {
      name: "Speaker",
      ircMode: "v",
      permissions: ["send_messages"],
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).role.id;
    const assignment = { userId: bob.account.id, roleGroupId: id };
    expect((await f.request(`${route}/roles/assign`, alice, "POST", assignment)).status).toBe(200);
    expect(
      (await f.request(`${route}/messages`, bob, "POST", { content: "authorized-voice-control" }))
        .status,
    ).toBe(201);
    await owner.waitForLine((l) => l.includes("authorized-voice-control"));
    const operations = await Promise.all([
      f.request(`${route}/roles/${id}`, alice, "DELETE"),
      ...Array.from({ length: 8 }, (_, i) =>
        f.request(`${route}/messages`, bob, "POST", { content: `concurrent-voice-${i}` }),
      ),
      ...Array.from({ length: 4 }, () =>
        f.request(`${route}/roles/assign`, alice, "POST", assignment),
      ),
    ]);
    expect(operations[0].status).toBe(200);
    for (const response of operations.slice(1, 9)) expect([201, 400]).toContain(response.status);
    for (const response of operations.slice(9)) expect([200, 404]).toContain(response.status);
    const denied = await f.request(`${route}/messages`, bob, "POST", {
      content: "forbidden-after-role-delete-rest",
    });
    expect(denied.status).toBe(400);
    speaker.send("PRIVMSG #moderated :forbidden-after-role-delete-irc");
    await speaker.waitForNumeric(404);
    speaker.send("MODE #moderated +v bob");
    await speaker.waitForNumeric(482);
    expect((await f.request(`${route}/roles/assign`, bob, "POST", assignment)).status).toBe(403);
    for (const client of [owner, speaker, outsider]) {
      client.send("JOIN #role-barrier");
      await client.waitForLine((l) => l.includes(" 366 ") && l.includes("#role-barrier"));
    }
    const marker = `role-deletion-barrier-${randomUUID()}`;
    expect(
      (
        await f.request("/api/v1/channels/%23role-barrier/messages", alice, "POST", {
          content: marker,
        })
      ).status,
    ).toBe(201);
    await Promise.all([
      speaker.waitForLine((l) => l.includes(marker)),
      outsider.waitForLine((l) => l.includes(marker)),
    ]);
    await f.barrier(owner);
    expect(owner.lines.join("\n")).not.toContain("forbidden-after-role-delete");
    expect(outsider.lines.join("\n")).not.toMatch(/authorized-voice-control|concurrent-voice-/);
    await f.stop();
    expect((await f.snapshot("channel_user_roles")).flat()).toHaveLength(0);
    expect((await f.snapshot("channel_role_groups")).flat()).toHaveLength(0);
    const messages = (await f.snapshot("messages")).flat() as any[];
    expect(messages.some((m) => m.content.startsWith("forbidden-after-role-delete"))).toBe(false);
    expect(messages.filter((m) => m.content === "authorized-voice-control")).toHaveLength(1);
    const members = (await f.snapshot("channel_members")).flat() as any[];
    expect(
      members.filter((m) => m.user_id === bob.account.id).every((m) => !m.modes.includes("v")),
    ).toBe(true);
  } finally {
    await f.dispose();
  }
});
