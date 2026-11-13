import { expect, it } from "vitest";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import { channelEventStream, insertLegacyChannelMetadata } from "./channel-event-helper";
import { channelOutboxFixture } from "./channel-outbox-fixture";
import { stream, wire } from "./helpers/session-features";

it("role inheritance is channel scoped, bounded, persistent, and revokes inherited modes", async () => {
  const f = await createMatrixFixture();
  const eventStreams: Array<{ close: () => void }> = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const [client, channel] of [
      [a, "#lineage"],
      [b, "#lineage"],
      [c, "#other"],
    ] as const) {
      const joined = client.waitForNewLine(
        (line) => line.includes(" 366 ") && line.includes(channel),
      );
      client.send(`JOIN ${channel}`);
      await joined;
    }
    for (const [client, channel] of [
      [a, "#lineage"],
      [c, "#other"],
    ] as const) {
      const registered = client.waitForNewLine(
        (line) =>
          line.includes(channel) && /successfully registered|already registered/i.test(line),
      );
      client.send(`CS REGISTER ${channel}`);
      await registered;
    }
    const roleEvents = await channelEventStream(f, alice);
    eventStreams.push(roleEvents);
    const route = "/api/v1/channels/%23lineage/roles";
    const create = async (body: object) => {
      const response = await f.request(route, alice, "POST", body);
      expect(response.status).toBe(201);
      return ((await response.json()) as any).role;
    };
    const parent = await create({
      name: "parent",
      ircMode: "o",
      priority: 7,
      permissions: ["change_topic"],
    });
    const createdEvent = await roleEvents.until("channel.role_created");
    expect(JSON.stringify(createdEvent)).toContain(parent.id);
    expect(createdEvent.channelGeneration).toBeTruthy();
    const child = await create({ name: "child", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    const granted = b.waitForNewLine((line) => line.includes(" MODE #lineage +o bob"));
    expect(
      (
        await f.request(`${route}/assign`, alice, "POST", {
          userId: bob.account.id,
          roleGroupId: child.id,
        })
      ).status,
    ).toBe(200);
    await granted;
    const mode = b.waitForNewLine((line) => line.includes(" MODE #lineage +m"));
    b.send("MODE #lineage +m");
    await mode;
    const eventBarrier = async () => {
      const marker = `role-denial-${crypto.randomUUID()}`;
      expect(
        (
          await f.request("/api/v1/channels/%23lineage/messages", alice, "POST", {
            content: marker,
          })
        ).status,
      ).toBe(201);
      await roleEvents.until(marker);
    };
    await eventBarrier();
    let denialOffset = roleEvents.events.length;
    const cycle = await f.request(`${route}/${parent.id}`, alice, "PATCH", { parentId: child.id });
    expect(cycle.status).toBe(400);
    await eventBarrier();
    expect(
      roleEvents.events.slice(denialOffset).filter((event) => /"type":"channel\.role_/.test(event)),
    ).toEqual([]);
    const renamed = await f.request(`${route}/${parent.id}`, alice, "PATCH", { name: "renamed" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as any).role).toMatchObject({
      priority: 7,
      permissions: ["change_topic"],
    });
    const outsideRole = await f.request("/api/v1/channels/%23other/roles", charlie, "POST", {
      name: "foreign",
    });
    expect(outsideRole.status).toBe(201);
    const foreign = ((await outsideRole.json()) as any).role;
    const foreignBefore = await (
      await f.request("/api/v1/channels/%23other/roles", charlie)
    ).json();
    await eventBarrier();
    denialOffset = roleEvents.events.length;
    expect(
      (await f.request(`${route}/${child.id}`, alice, "PATCH", { parentId: foreign.id })).status,
    ).toBe(400);
    expect(
      (await f.request(`${route}/${parent.id}`, bob, "PATCH", { parentId: child.id })).status,
    ).toBe(403);
    await eventBarrier();
    expect(
      roleEvents.events.slice(denialOffset).filter((event) => /"type":"channel\.role_/.test(event)),
    ).toEqual([]);
    expect(await (await f.request("/api/v1/channels/%23other/roles", charlie)).json()).toEqual(
      foreignBefore,
    );
    let ancestor = child.id;
    for (let i = 0; i < 6; i++)
      ancestor = (await create({ name: `depth-${i}`, parentId: ancestor })).id;
    expect(
      (await f.request(route, alice, "POST", { name: "too-deep", parentId: ancestor })).status,
    ).toBe(400);
    const roles = (await (await f.request(route, alice)).json()) as any;
    expect(roles.roles.find((role: any) => role.id === parent.id).parentId).toBeNull();
    await f.restart();
    const a2 = await f.connect(alice),
      b2 = await f.connect(bob);
    for (const client of [a2, b2]) {
      const joined = client.waitForNewLine(
        (line) => line.includes(" 366 ") && line.includes("#lineage"),
      );
      client.send("JOIN #lineage");
      await joined;
    }
    const c2 = await f.connect(charlie);
    await wire(c2, "JOIN #other", / 366 .*#other/);
    expect(await (await f.request("/api/v1/channels/%23other/roles", charlie)).json()).toEqual(
      foreignBefore,
    );
    const persisted = (await (await f.request(route, alice)).json()) as any;
    expect(persisted.roles.find((role: any) => role.id === child.id).parentId).toBe(parent.id);
    const removed = b2.waitForNewLine((line) => line.includes(" MODE #lineage -o bob"));
    expect((await f.request(`${route}/${parent.id}`, alice, "DELETE")).status).toBe(200);
    await removed;
    const after = (await (await f.request(route, alice)).json()) as any;
    expect(after.roles.find((role: any) => role.id === child.id).parentId).toBeNull();
  } finally {
    for (const stream of eventStreams) stream.close();
    await f.dispose();
  }
}, 60000);

it.each([false, true])(
  "channel outbox publishes edits in commit order with equal clock fields: %s",
  async (sameClock) => {
    const wrapped = await channelOutboxFixture();
    const f = wrapped.fixture;
    let events: Awaited<ReturnType<typeof channelEventStream>> | undefined;
    try {
      const alice = await f.createActor("alice");
      const created = await f.request("/api/v1/channels", alice, "POST", {
        name: "#outbox-order",
        privacy: "secret",
      });
      expect(created.status).toBe(201);
      const { generation } = (await created.json()) as { generation: string };
      const base = "/api/v1/channels/%23outbox-order/messages";
      const sent = await f.request(base, alice, "POST", { content: "original" });
      expect(sent.status).toBe(201);
      const id = ((await sent.json()) as any).message.id as string;
      events = await channelEventStream(f, alice);
      const subscription = await events.subscribe("#outbox-order", generation);
      expect(subscription.type).toBe("result");
      const cursor = subscription.result.cursor as string;
      const session = await wrapped.session(),
        channel = await wrapped.channel("#outbox-order");
      await session.setJournalBlocked(true);
      const first = await f.request(`${base}/${id}`, alice, "PATCH", {
        content: "first-committed-edit",
      });
      const second = await f.request(`${base}/${id}`, alice, "PATCH", {
        content: "second-committed-edit",
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const before = (await channel.queuedEventRows()) as Array<{
        payload: string;
        created_at: number;
      }>;
      expect(before).toHaveLength(2);
      expect(before.map((row) => JSON.parse(row.payload).event.data.newContent)).toEqual([
        "first-committed-edit",
        "second-committed-edit",
      ]);
      await channel.setAdversarialTimes(sameClock);
      const reversed = (await channel.queuedEventRows()) as Array<{ created_at: number }>;
      expect(reversed.map((row) => row.created_at)).toEqual(sameClock ? [100, 100] : [200, 100]);
      await session.setJournalBlocked(false);
      await channel.flushPendingEvents();
      await Promise.all([
        events.until("first-committed-edit"),
        events.until("second-committed-edit"),
      ]);
      const live = events.events
        .map((line) => JSON.parse(line))
        .filter((event) => event.type === "message.updated")
        .map((event) => event.data.newContent);
      expect(live).toEqual(["first-committed-edit", "second-committed-edit"]);
      const replay = await events.replay(cursor);
      expect(replay.type).toBe("result");
      const replayed = replay.result.events
        .filter((event: any) => event.type === "message.updated")
        .map((event: any) => event.data.newContent);
      expect(replayed).toEqual(["first-committed-edit", "second-committed-edit"]);
      const history = await f.request(base, alice);
      expect(history.status).toBe(200);
      expect(JSON.stringify(await history.json())).toContain("second-committed-edit");
    } finally {
      events?.close();
      await wrapped.dispose();
    }
  },
  60000,
);

it("an archived legacy channel with residual active metadata fails closed without mutation", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    expect(
      (
        await f.request("/api/v1/channels", alice, "POST", {
          name: "#legacy-state",
          privacy: "secret",
        })
      ).status,
    ).toBe(201);
    expect((await f.request("/api/v1/channels/%23legacy-state", alice, "DELETE", {})).status).toBe(
      200,
    );
    expect(
      (await f.request("/api/v1/channels", bob, "POST", { name: "#healthy", privacy: "public" }))
        .status,
    ).toBe(201);
    await f.stop();
    await insertLegacyChannelMetadata(f.directory, "#legacy-state");
    const before = {
      metadata: await f.snapshot("channel_metadata"),
      kv: await f.snapshot("channel_kv_metadata"),
      members: await f.snapshot("channel_members"),
      roles: await f.snapshot("channel_role_groups"),
    };
    await f.restart();
    const denied = await f.request("/api/v1/channels", bob, "POST", {
      name: "#legacy-state",
      privacy: "public",
    });
    expect(denied.status).toBe(409);
    expect((await f.request("/api/v1/channels/%23healthy/members", bob)).status).toBe(200);
    await f.stop();
    expect({
      metadata: await f.snapshot("channel_metadata"),
      kv: await f.snapshot("channel_kv_metadata"),
      members: await f.snapshot("channel_members"),
      roles: await f.snapshot("channel_role_groups"),
    }).toEqual(before);
  } finally {
    await f.dispose();
  }
}, 60000);

it("PART and KICK deliver the committed reason once to original removed users while later private events remain denied", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie"),
      outsider = await f.createActor("outsider");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie),
      o = await f.connect(outsider);
    for (const client of [a, b, c]) {
      const joined = client.waitForNewLine(
        (line) => line.includes(" 366 ") && line.includes("#controls"),
      );
      client.send("JOIN #controls");
      await joined;
    }
    const secret = a.waitForNewLine((line) => line.includes(" MODE #controls +s"));
    a.send("MODE #controls +s");
    await secret;
    const bobStart = b.lines.length,
      aliceStart = a.lines.length,
      charlieStart = c.lines.length,
      outsiderStart = o.lines.length;
    const kicked = b.waitForNewLine((line) => line.includes(" KICK #controls bob"));
    const kickObserved = a.waitForNewLine((line) => line.includes(" KICK #controls bob"));
    a.send("KICK #controls bob :sensitive-kick-reason");
    expect(await kicked).toMatch(/ KICK #controls bob :sensitive-kick-reason(?:\r?\n)?$/);
    expect(await kickObserved).toContain("sensitive-kick-reason");
    const parted = c.waitForNewLine((line) => line.includes(" PART #controls"));
    const partObserved = a.waitForNewLine((line) => line.includes(" PART #controls"));
    c.send("PART #controls :sensitive-part-reason");
    expect(await parted).toMatch(/ PART #controls :sensitive-part-reason(?:\r?\n)?$/);
    expect(await partObserved).toContain("sensitive-part-reason");
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c), f.barrier(o)]);
    expect(
      b.lines.slice(bobStart).filter((line) => line.includes(" KICK #controls bob")),
    ).toHaveLength(1);
    expect(
      c.lines.slice(charlieStart).filter((line) => line.includes(" PART #controls")),
    ).toHaveLength(1);
    expect(
      a.lines.slice(aliceStart).filter((line) => line.includes(" KICK #controls bob")),
    ).toHaveLength(1);
    a.send("PRIVMSG #controls :private-after-committed-removals");
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c), f.barrier(o)]);
    for (const client of [b, c, o])
      expect(client.lines.join("\n")).not.toContain("private-after-committed-removals");
    expect(o.lines.slice(outsiderStart).join("\n")).not.toContain("#controls");
  } finally {
    await f.dispose();
  }
}, 60000);

it("websocket role and message mutations reject cross-account authority and replay once", async () => {
  const f = await createMatrixFixture();
  const streams: Array<{ close: () => void }> = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const created = await f.request("/api/v1/channels", alice, "POST", {
      name: "#ws-feature",
      privacy: "secret",
    });
    expect(created.status).toBe(201);
    const { generation } = (await created.json()) as { generation: string };
    const a = await channelEventStream(f, alice),
      b = await channelEventStream(f, bob);
    streams.push(a, b);
    const input = {
      channel: "#ws-feature",
      generation,
      clientOperationId: `${Date.now()}.${crypto.randomUUID()}`,
      group: { name: "ws-role", ircMode: "v" },
    };
    const forbidden = await b.command("channel.role.create", input);
    expect(forbidden.type).toBe("error");
    expect(forbidden.status).toBe(403);
    const first = await a.command("channel.role.create", input);
    expect(first.type).toBe("result");
    const retry = await a.command("channel.role.create", input);
    expect(retry.result).toEqual(first.result);
    const conflict = await a.command("channel.role.create", {
      ...input,
      group: { name: "different", ircMode: "v" },
    });
    expect(conflict.type).toBe("error");
    expect(conflict.status).toBe(409);
    const send = {
      channel: "#ws-feature",
      generation,
      clientOperationId: `${Date.now()}.${crypto.randomUUID()}`,
      content: "one-websocket-message",
    };
    const message = await a.command("channel.send", send);
    expect(message.type).toBe("result");
    const repeated = await a.command("channel.send", send);
    expect(repeated.result.message.id).toBe(message.result.message.id);
    const history = await f.request("/api/v1/channels/%23ws-feature/messages", alice);
    expect(history.status).toBe(200);
    expect(
      ((await history.json()) as any).messages.filter((row: any) => row.content === send.content),
    ).toHaveLength(1);
    const irc = await f.connect(alice);
    const joined = irc.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#ws-feature"),
    );
    irc.send("JOIN #ws-feature");
    await joined;
    const start = irc.lines.length;
    const redaction = {
      channel: "#ws-feature",
      generation,
      id: message.result.message.id,
      clientOperationId: `${Date.now()}.${crypto.randomUUID()}`,
    };
    const received = irc.waitForNewLine((line) =>
      line.includes(` REDACT #ws-feature ${redaction.id}`),
    );
    const deleted = await a.command("channel.redact", redaction);
    expect(deleted.type).toBe("result");
    await received;
    const redactionReplay = await a.command("channel.redact", redaction);
    expect(redactionReplay.type).toBe("result");
    expect(redactionReplay.result.replayed).toBe(true);
    await f.barrier(irc);
    expect(
      irc.lines.slice(start).filter((line) => line.includes(` REDACT #ws-feature ${redaction.id}`)),
    ).toHaveLength(1);
    a.close();
    b.close();
    await f.restart();
    const after = await channelEventStream(f, alice);
    streams.push(after);
    const replay = await after.command("channel.role.create", input);
    expect(replay.result).toEqual(first.result);
  } finally {
    for (const stream of streams) stream.close();
    await f.dispose();
  }
}, 60000);

it("public observers receive authorized events and lose access when the channel becomes secret", async () => {
  const f = await createMatrixFixture();
  const streams: Array<{ close: () => void }> = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const create = async (actor: typeof alice, name: string, privacy: "public" | "secret") => {
      const response = await f.request("/api/v1/channels", actor, "POST", { name, privacy });
      expect(response.status).toBe(201);
      return ((await response.json()) as { generation: string }).generation;
    };
    const generation = await create(alice, "#observed", "public");
    const independentGeneration = await create(bob, "#observer-home", "public");
    const stream = await channelEventStream(f, bob);
    streams.push(stream);
    const subscribed = await stream.subscribe("#observed", generation);
    expect(subscribed.type).toBe("result");
    expect(subscribed.result.boundaries[0]).toMatchObject({ generation });
    const send = async (actor: typeof alice, channel: string, content: string) => {
      const response = await f.request(
        `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
        actor,
        "POST",
        { content },
      );
      expect(response.status).toBe(201);
    };
    await send(alice, "#observed", "public-observer-control");
    const visible = await stream.until("public-observer-control");
    expect(visible.channelGeneration).toBe(generation);
    const irc = await f.connect(alice);
    const joined = irc.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#observed"),
    );
    irc.send("JOIN #observed");
    await joined;
    const secret = irc.waitForNewLine((line) => line.includes(" MODE #observed +s"));
    irc.send("MODE #observed +s");
    await secret;
    await send(alice, "#observed", "private-after-revocation");
    expect((await stream.subscribe("#observer-home", independentGeneration)).type).toBe("result");
    await send(bob, "#observer-home", "observer-independent-barrier");
    await stream.until("observer-independent-barrier");
    expect(stream.events.join("\n")).not.toContain("private-after-revocation");
    stream.close();
    await f.restart();
    const after = await channelEventStream(f, bob);
    streams.push(after);
    const denied = await after.subscribe("#observed", generation);
    expect(denied.type).toBe("error");
    expect((await f.request("/api/v1/channels/%23observed/info", alice)).status).toBe(200);
  } finally {
    for (const stream of streams) stream.close();
    await f.dispose();
  }
}, 60000);

it("status-targeted messages never become public observer or lower-rank events", async () => {
  const f = await createMatrixFixture();
  const streams: Array<{ close: () => void }> = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie"),
      dave = await f.createActor("dave");
    const created = await f.request("/api/v1/channels", alice, "POST", {
      name: "#status",
      privacy: "public",
    });
    expect(created.status).toBe(201);
    const { generation } = (await created.json()) as { generation: string };
    expect((await f.request("/api/v1/channels/%23status/join", bob, "POST", {})).status).toBe(200);
    const irc = await f.connect(alice);
    const joined = irc.waitForNewLine((line) => line.includes(" 366 ") && line.includes("#status"));
    irc.send("JOIN #status");
    await joined;
    const daveIrc = await f.connect(dave);
    const daveJoined = daveIrc.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#status"),
    );
    daveIrc.send("JOIN #status");
    await daveJoined;
    const granted = daveIrc.waitForNewLine((line) => line.includes(" MODE #status +o dave"));
    irc.send("MODE #status +o dave");
    await granted;
    const a = await channelEventStream(f, alice),
      b = await channelEventStream(f, bob),
      c = await channelEventStream(f, charlie),
      d = await channelEventStream(f, dave);
    streams.push(a, b, c, d);
    const subscription = await d.subscribe("#status", generation);
    expect(subscription.type).toBe("result");
    const cursor = subscription.result.cursor as string;
    irc.send("PRIVMSG @#status :op-only-event-sentinel");
    const [restricted] = await Promise.all([
      a.until("op-only-event-sentinel"),
      d.until("op-only-event-sentinel"),
    ]);
    const namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const channel = namespace.get(namespace.idFromName("FlaRC:#status")) as any;
    const predicate = (actor: typeof alice) =>
      channel.validateJournalMessage({
        accountId: actor.account.id,
        credentialVersion: actor.account.credentialVersion ?? 0,
        generation: restricted.channelGeneration,
        messageId: restricted.messageId,
      });
    expect(await predicate(dave)).toBe(true);
    expect(JSON.stringify(await d.replay(cursor))).toContain("op-only-event-sentinel");
    expect(await predicate(bob)).toBe(false);
    const removed = daveIrc.waitForNewLine((line) => line.includes(" MODE #status -o dave"));
    irc.send("MODE #status -o dave");
    await removed;
    expect(await predicate(dave)).toBe(false);
    expect(JSON.stringify(await d.replay(cursor))).not.toContain("op-only-event-sentinel");
    expect(await predicate(alice)).toBe(true);
    const barrier = await f.request("/api/v1/channels/%23status/messages", alice, "POST", {
      content: "public-status-barrier",
    });
    expect(barrier.status).toBe(201);
    await Promise.all([b.until("public-status-barrier"), c.until("public-status-barrier")]);
    expect(b.events.join("\n")).not.toContain("op-only-event-sentinel");
    expect(c.events.join("\n")).not.toContain("op-only-event-sentinel");
    const history = await f.request("/api/v1/channels/%23status/messages", bob);
    expect(history.status).toBe(200);
    expect(await history.text()).not.toContain("op-only-event-sentinel");
  } finally {
    for (const stream of streams) stream.close();
    await f.dispose();
  }
}, 60000);

it("retired channel history and authority stay isolated after recreation", async () => {
  const f = await createMatrixFixture();
  const streams: Array<{ close: () => void }> = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const base = "/api/v1/channels/%23generation";
    const created = await f.request("/api/v1/channels", alice, "POST", {
      name: "#generation",
      privacy: "secret",
    });
    expect(created.status).toBe(201);
    const old = (await created.json()) as { generation: string };
    const initialNamespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const initialChannel = initialNamespace.get(
      initialNamespace.idFromName("FlaRC:#generation"),
    ) as any;
    await expect(
      initialChannel.accountMembers(alice.token, "#elsewhere", old.generation),
    ).rejects.toThrow();
    const sent = await f.request(`${base}/messages`, alice, "POST", { content: "old-secret" });
    expect(sent.status).toBe(201);
    const message = ((await sent.json()) as any).message;
    const uploaded = await fetch(
      new URL("/api/v1/media/upload?channel=%23generation", f.server.url),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${alice.token}`,
          "content-type": "text/plain",
          "x-filename": "retired-secret.txt",
        },
        body: "retired-media-secret",
      },
    );
    expect(uploaded.status).toBe(201);
    const media = (await uploaded.json()) as { url: string };
    expect(await (await f.request(media.url, alice)).text()).toBe("retired-media-secret");
    const roleResponse = await f.request(`${base}/roles`, alice, "POST", {
      name: "retired-role",
      ircMode: "o",
    });
    expect(roleResponse.status).toBe(201);
    const oldRole = ((await roleResponse.json()) as any).role;
    expect(
      (
        await f.request("/api/v1/channels", bob, "POST", {
          name: "#independent",
          privacy: "public",
        })
      ).status,
    ).toBe(201);
    const aliceEvents = await channelEventStream(f, alice),
      bobEvents = await channelEventStream(f, bob);
    streams.push(aliceEvents, bobEvents);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const suffix of ["/info", "/messages", "/roles", "/members"]) {
        const response = await f.request(`${base}${suffix}`, alice);
        expect(response.status).toBe(200);
        result[suffix] = await response.json();
      }
      const attachment = await f.request(media.url, alice);
      expect(attachment.status).toBe(200);
      result.attachment = { headers: [...attachment.headers], body: await attachment.text() };
      return result;
    };
    const beforeDenied = await snapshot();
    expect((await f.request(base, bob, "DELETE", {})).status).toBe(403);
    expect(await snapshot()).toEqual(beforeDenied);
    const independent = await f.request("/api/v1/channels/%23independent/messages", bob, "POST", {
      content: "independent-deletion-barrier",
    });
    expect(independent.status).toBe(201);
    await bobEvents.until("independent-deletion-barrier");
    const ownBarrier = await f.request(`${base}/messages`, alice, "POST", {
      content: "owner-deletion-barrier",
    });
    expect(ownBarrier.status).toBe(201);
    await aliceEvents.until("owner-deletion-barrier");
    expect(aliceEvents.events.join("\n")).not.toContain("channel.deleted");
    expect(bobEvents.events.join("\n")).not.toContain("channel.deleted");
    aliceEvents.close();
    bobEvents.close();
    expect((await f.request(base, alice, "DELETE", {})).status).toBe(200);
    expect((await f.request(`${base}/messages`, bob)).status).not.toBe(200);
    await f.stop();
    const archives = (await f.snapshot("channel_archived_messages")).flat() as any[];
    expect(archives).toContainEqual(
      expect.objectContaining({ generation: old.generation, id: message.id }),
    );
    await f.restart();
    const recreated = await f.request("/api/v1/channels", bob, "POST", {
      name: "#generation",
      privacy: "secret",
    });
    expect(recreated.status).toBe(201);
    const fresh = (await recreated.json()) as { generation: string };
    expect(fresh.generation).not.toBe(old.generation);
    const freshSnapshot = async () => {
      const state: Record<string, unknown> = {};
      for (const suffix of ["/info", "/messages", "/roles", "/members"]) {
        const response = await f.request(`${base}${suffix}`, bob);
        expect(response.status).toBe(200);
        state[suffix] = await response.json();
      }
      return state;
    };
    const freshBefore = await freshSnapshot();
    const staleStream = await channelEventStream(f, alice),
      freshStream = await channelEventStream(f, bob);
    streams.push(staleStream, freshStream);
    const staleMutation = await staleStream.command("channel.send", {
      channel: "#generation",
      generation: old.generation,
      clientOperationId: `${Date.now()}.${crypto.randomUUID()}`,
      content: "stale-public-attempt",
    });
    expect(staleMutation.type).toBe("error");
    expect(staleMutation.status).toBe(409);
    expect(await freshSnapshot()).toEqual(freshBefore);
    const freshBarrier = await f.request(`${base}/messages`, bob, "POST", {
      content: "fresh-generation-barrier",
    });
    expect(freshBarrier.status).toBe(201);
    await freshStream.until("fresh-generation-barrier");
    expect(freshStream.events.join("\n")).not.toContain("stale-public-attempt");
    expect(staleStream.events.join("\n")).not.toContain("fresh-generation-barrier");
    const afterBarrier = await freshSnapshot();
    const staleTopic = await staleStream.command("channel.topic", {
      channel: "#generation",
      generation: old.generation,
      clientOperationId: `${Date.now()}.${crypto.randomUUID()}`,
      topic: "stale-topic",
    });
    expect(staleTopic).toMatchObject({ type: "error", status: 409 });
    const staleRole = await staleStream.command("channel.role.create", {
      channel: "#generation",
      generation: old.generation,
      clientOperationId: `${Date.now()}.${crypto.randomUUID()}`,
      group: { name: "stale-role" },
    });
    expect(staleRole).toMatchObject({ type: "error", status: 409 });
    const namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const channel = namespace.get(namespace.idFromName("FlaRC:#generation")) as any;
    await expect(
      channel.setTopic({
        channelName: "#generation",
        sessionId: `api:${alice.account.id}`,
        nickname: "alice",
        topic: "stale-write",
        expectedGeneration: old.generation,
      }),
    ).rejects.toThrow();
    await expect(
      channel.assignUserRole(alice.account.id, oldRole.id, old.generation),
    ).rejects.toThrow();
    await expect(
      channel.appendMessage({
        channelName: "#generation",
        sessionId: `api:${alice.account.id}`,
        userId: alice.account.id,
        accountName: "alice",
        nickname: "alice",
        username: "alice",
        hostname: "gateway.api",
        command: "PRIVMSG",
        content: "stale-message",
        isOper: true,
        expectedGeneration: old.generation,
      }),
    ).rejects.toThrow();
    expect(await freshSnapshot()).toEqual(afterBarrier);
    const probeBarrier = await f.request(`${base}/messages`, bob, "POST", {
      content: "after-stale-probes-barrier",
    });
    expect(probeBarrier.status).toBe(201);
    await freshStream.until("after-stale-probes-barrier");
    expect(freshStream.events.join("\n")).not.toContain("stale-topic");
    expect(freshStream.events.join("\n")).not.toContain("stale-role");
    const history = await f.request(`${base}/messages`, bob);
    expect(history.status).toBe(200);
    expect(await history.text()).not.toContain("old-secret");
    const roles = await f.request(`${base}/roles`, bob);
    expect(roles.status).toBe(200);
    expect(await roles.text()).not.toContain(oldRole.id);
    expect((await f.request(`${base}/members`, alice)).status).toBe(403);
    const deniedMedia = await f.request(media.url, bob);
    expect(deniedMedia.status).toBe(404);
    expect(await deniedMedia.text()).not.toContain("retired-media-secret");
    await f.restart();
    expect((await f.request(`${base}/members`, bob)).status).toBe(200);
    expect(await (await f.request(`${base}/messages`, bob)).text()).not.toContain("old-secret");
  } finally {
    for (const stream of streams) stream.close();
    await f.dispose();
  }
}, 60000);

it("same-channel bulk redaction is atomic, scoped, and idempotent across restart", async () => {
  const f = await createMatrixFixture();
  const eventStreams: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const [client, channel] of [
      [a, "#bulk"],
      [b, "#bulk"],
      [c, "#other"],
    ] as const) {
      const joined = client.waitForNewLine(
        (line) => line.includes(" 366 ") && line.includes(channel),
      );
      client.send(`JOIN ${channel}`);
      await joined;
    }
    await wire(a, "MODE #bulk +s", / MODE #bulk \+s/);
    for (const client of [a, b])
      await wire(client, "CAP REQ :draft/message-redaction", / CAP .* ACK /);
    const post = async (who: typeof alice, channel: string, content: string) => {
      const response = await f.request(
        `/api/v1/channels/${encodeURIComponent(channel)}/messages`,
        who,
        "POST",
        { content },
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as any).message.id as string;
    };
    const own1 = await post(bob, "#bulk", "bob-first"),
      own2 = await post(bob, "#bulk", "bob-second"),
      foreign = await post(alice, "#bulk", "alice-private"),
      unrelated = await post(charlie, "#other", "other-private");
    const base = "/api/v1/channels/%23bulk/messages",
      operationId = `${Date.now()}.${crypto.randomUUID()}`;
    eventStreams.push(
      ...(await Promise.all([alice, bob, charlie].map((actor) => stream(f, actor)))),
    );
    const barrier = async () => {
      const id = await post(charlie, "#other", `bulk-event-barrier-${crypto.randomUUID()}`);
      await Promise.all(
        eventStreams.map((observer) => observer.until((event) => event.messageId === id)),
      );
      await Promise.all([a, b, c].map((client) => f.barrier(client)));
    };
    expect(
      (await f.request(`${base}/bulk-redact`, bob, "POST", { ids: [own1, foreign], operationId }))
        .status,
    ).toBe(403);
    expect(
      (await f.request(`${base}/bulk-redact`, bob, "POST", { ids: [own1, unrelated], operationId }))
        .status,
    ).toBe(403);
    const before = (await (await f.request(base, bob)).json()) as any;
    expect(before.messages.map((m: any) => m.id)).toEqual(
      expect.arrayContaining([own1, own2, foreign]),
    );
    await barrier();
    for (const observer of eventStreams)
      expect(observer.frames.filter((event) => event.type === "message.deleted")).toEqual([]);
    for (const client of [a, b, c])
      expect(client.lines.some((line) => line.includes(" REDACT #bulk "))).toBe(false);
    const result = await f.request(`${base}/bulk-redact`, bob, "POST", {
      ids: [own1, own2],
      operationId,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, replayed: false });
    const replay = await f.request(`${base}/bulk-redact`, bob, "POST", {
      ids: [own2, own1],
      operationId,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, replayed: true });
    expect(
      (await f.request(`${base}/bulk-redact`, bob, "POST", { ids: [foreign], operationId })).status,
    ).toBe(409);
    await barrier();
    for (const observer of eventStreams.slice(0, 2)) {
      const deletions = observer.frames.filter((event) => event.type === "message.deleted");
      expect(deletions.map((event) => event.messageId).sort()).toEqual([own1, own2].sort());
      expect(
        deletions.every(
          (event) => event.channelId === "#bulk" && event.operationId === operationId,
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(eventStreams[2].frames)).not.toContain("#bulk");
    for (const client of [a, b]) {
      const redactions = client.lines.filter((line) => line.includes(" REDACT #bulk "));
      expect(redactions).toHaveLength(2);
      for (const id of [own1, own2])
        expect(redactions.filter((line) => line.includes(id))).toHaveLength(1);
    }
    expect(c.lines.some((line) => line.includes(" REDACT #bulk "))).toBe(false);
    for (const observer of eventStreams.splice(0)) observer.close();
    await f.restart();
    const history = (await (await f.request(base, alice)).json()) as any;
    expect(history.messages.map((m: any) => m.id)).toContain(foreign);
    expect(history.messages.map((m: any) => m.id)).not.toContain(own1);
    expect(history.messages.map((m: any) => m.id)).not.toContain(own2);
    const other = await f.request("/api/v1/channels/%23other/messages", charlie);
    expect(await other.text()).toContain(unrelated);
    const restoredBob = await f.connect(bob);
    const restoredJoin = restoredBob.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#bulk"),
    );
    restoredBob.send("JOIN #bulk");
    await restoredJoin;
    const after = await f.request(`${base}/bulk-redact`, bob, "POST", {
      ids: [own1, own2],
      operationId,
    });
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({ replayed: true });
  } finally {
    for (const observer of eventStreams) observer.close();
    await f.dispose();
  }
}, 60000);

it("REST account membership enforces IRC key and invitation policy without a socket", async () => {
  const f = await createMatrixFixture();
  const eventStreams: Array<{ close: () => void }> = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie"),
      eve = await f.createActor("eve");
    const creatorStream = await channelEventStream(f, alice),
      unrelatedStream = await channelEventStream(f, charlie);
    eventStreams.push(creatorStream, unrelatedStream);
    const created = await f.request("/api/v1/channels", alice, "POST", {
      name: "#account-room",
      privacy: "secret",
      inviteOnly: true,
      key: "secret-key",
      registeredOnly: true,
      moderated: true,
      readOnly: true,
    });
    expect(created.status).toBe(201);
    const initial = (await created.json()) as any;
    expect(initial.generation).toBeTruthy();
    const creationEvent = await creatorStream.until("channel.created");
    expect(creationEvent).toMatchObject({
      channelId: "#account-room",
      channelGeneration: initial.generation,
      data: {
        channel: "#account-room",
        generation: initial.generation,
        privacy: "secret",
        revision: expect.any(Number),
      },
    });
    expect(JSON.stringify(creationEvent)).not.toContain("secret-key");
    const unrelatedCreation = await f.request("/api/v1/channels", charlie, "POST", {
      name: "#creation-observer",
      privacy: "secret",
    });
    expect(unrelatedCreation.status).toBe(201);
    await unrelatedStream.until("#creation-observer");
    expect(unrelatedStream.events.join("\n")).not.toContain("#account-room");
    const base = "/api/v1/channels/%23account-room";
    const beforeConflict = await (await f.request(`${base}/info`, alice)).json();
    expect(
      (
        await f.request("/api/v1/channels", charlie, "POST", {
          name: "#account-room",
          privacy: "public",
        })
      ).status,
    ).toBe(409);
    expect(await (await f.request(`${base}/info`, alice)).json()).toEqual(beforeConflict);
    expect(
      creatorStream.events.filter(
        (event) => event.includes('"type":"channel.created"') && event.includes("#account-room"),
      ),
    ).toHaveLength(1);
    const members = await f.request(`${base}/members`, alice);
    expect(members.status).toBe(200);
    expect(((await members.json()) as any).members).toContainEqual(
      expect.objectContaining({ userId: alice.account.id, username: "alice", origins: ["rest"] }),
    );
    expect((await f.request(`${base}/members`, charlie)).status).toBe(403);
    const outsider = await f.connect(charlie);
    const wrongKey = outsider.waitForNewLine(
      (line) => line.includes(" 475 ") && line.includes("#account-room"),
    );
    outsider.send("JOIN #account-room wrong-key");
    await wrongKey;
    const noInvite = outsider.waitForNewLine(
      (line) => line.includes(" 473 ") && line.includes("#account-room"),
    );
    outsider.send("JOIN #account-room secret-key");
    await noInvite;
    expect(
      (await f.request(`${base}/invites`, alice, "POST", { username: "charlie" })).status,
    ).toBe(200);
    expect((await f.request(`${base}/invites/charlie`, alice, "DELETE")).status).toBe(200);
    expect((await f.request(`${base}/join`, charlie, "POST", { key: "secret-key" })).status).toBe(
      403,
    );
    const info = await f.request(`${base}/info`, alice);
    expect(info.status).toBe(200);
    const infoText = await info.text();
    expect(infoText).not.toContain("secret-key");
    const details = JSON.parse(infoText).channel;
    expect(details.readOnly).toBe(true);
    for (const mode of "sikRmr") expect(details.modes).toContain(mode);
    expect((await f.request(`${base}/join`, bob, "POST", { key: "secret-key" })).status).toBe(403);
    const founder = await f.connect(alice);
    const founderJoined = founder.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#account-room"),
    );
    founder.send("JOIN #account-room");
    await founderJoined;
    const ban = founder.waitForNewLine((line) =>
      line.includes(" MODE #account-room +b charlie!*@*"),
    );
    founder.send("MODE #account-room +b charlie!*@*");
    await ban;
    const openInvites = founder.waitForNewLine((line) => line.includes(" MODE #account-room -i"));
    founder.send("MODE #account-room -i");
    await openInvites;
    const bannedJoin = outsider.waitForNewLine(
      (line) => line.includes(" 474 ") && line.includes("#account-room"),
    );
    const beforeDenied = await (await f.request(`${base}/members`, alice)).json();
    outsider.send("JOIN #account-room secret-key");
    await bannedJoin;
    expect((await f.request(`${base}/join`, charlie, "POST", { key: "secret-key" })).status).toBe(
      403,
    );
    expect(await (await f.request(`${base}/members`, alice)).json()).toEqual(beforeDenied);
    const closeInvites = founder.waitForNewLine((line) => line.includes(" MODE #account-room +i"));
    founder.send("MODE #account-room +i");
    await closeInvites;
    expect(
      (await f.request(`${base}/invites`, alice, "POST", { username: "charlie" })).status,
    ).toBe(200);
    const invitedJoin = outsider.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#account-room"),
    );
    outsider.send("JOIN #account-room secret-key");
    await invitedJoin;
    expect((await f.request(`${base}/invites`, charlie, "POST", { username: "bob" })).status).toBe(
      403,
    );
    expect(
      (
        await f.request(`${base}/invites`, charlie, "POST", {
          username: "bob",
          actorId: alice.account.id,
        })
      ).status,
    ).toBe(400);
    const charliePart = outsider.waitForNewLine((line) => line.includes(" PART #account-room"));
    outsider.send("PART #account-room");
    await charliePart;
    const eveBan = founder.waitForNewLine((line) =>
      line.includes(" MODE #account-room +b eve!*@*"),
    );
    founder.send("MODE #account-room +b eve!*@*");
    await eveBan;
    expect((await f.request(`${base}/invites`, alice, "POST", { username: "eve" })).status).toBe(
      200,
    );
    const invitedRest = await f.request(`${base}/join`, eve, "POST", { key: "secret-key" });
    expect(invitedRest.status).toBe(200);
    const ownerAfterInvite = await f.request(`${base}/members`, alice);
    expect(ownerAfterInvite.status).toBe(200);
    expect(((await ownerAfterInvite.json()) as any).members).toContainEqual(
      expect.objectContaining({ userId: eve.account.id }),
    );
    expect((await f.request(`${base}/members`, eve)).status).toBe(403);
    expect((await f.request(`${base}/leave`, eve, "POST")).status).toBe(200);
    const bobLive = await f.connect(bob);
    const bobSecondDevice = await f.connect(bob, "bob-device");
    const founderEvents = await channelEventStream(f, alice);
    const bobEvents = await channelEventStream(f, bob);
    eventStreams.push(founderEvents, bobEvents);
    await f.barrier(outsider);
    const outsiderLineCount = outsider.lines.length;
    const inviteLine = bobLive.waitForNewLine((line) => line.includes(" INVITE bob #account-room"));
    const invited = await f.request(`${base}/invites`, alice, "POST", { username: "bob" });
    expect(invited.status).toBe(200);
    await inviteLine;
    const invitation = await bobEvents.until("channel.invited");
    expect(invitation.channelGeneration).toBe(initial.generation);
    expect((await f.request(`${base}/join`, bob, "POST", { key: "wrong-key" })).status).toBe(403);
    const liveJoin = founder.waitForNewLine(
      (line) => /:(?:bob|bob-device)!/.test(line) && line.includes(" JOIN #account-room"),
    );
    const firstDeviceJoin = bobLive.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#account-room"),
    );
    const secondDeviceJoin = bobSecondDevice.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#account-room"),
    );
    const accepted = await f.request(`${base}/join`, bob, "POST", { key: "secret-key" });
    expect(accepted.status).toBe(200);
    await liveJoin;
    await firstDeviceJoin;
    await secondDeviceJoin;
    const joinedEvent = await founderEvents.until("channel.member_joined");
    expect(joinedEvent.channelGeneration).toBe(initial.generation);
    expect(JSON.stringify(joinedEvent)).toContain(bob.account.id);
    await f.barrier(outsider);
    expect(outsider.lines.slice(outsiderLineCount).join("\n")).not.toContain("bob!");
    expect(await accepted.json()).toMatchObject({
      channel: "#account-room",
      generation: initial.generation,
    });
    const read = await f.request(`${base}/members`, bob);
    expect(read.status).toBe(200);
    expect(((await read.json()) as any).members).toContainEqual(
      expect.objectContaining({
        userId: bob.account.id,
        origins: expect.arrayContaining(["rest", "irc"]),
      }),
    );
    await f.restart();
    expect((await f.request(`${base}/members`, bob)).status).toBe(200);
    const b = await f.connect(bob);
    const bJoined = b.waitForNewLine(
      (line) => line.includes(" 366 ") && line.includes("#account-room"),
    );
    b.send("JOIN #account-room");
    await bJoined;
    expect((await f.request(`${base}/leave`, bob, "POST")).status).toBe(200);
    expect((await f.request(`${base}/members`, bob)).status).toBe(403);
    expect((await f.request(`${base}/members`, alice)).status).toBe(200);
  } finally {
    for (const stream of eventStreams) stream.close();
    await f.dispose();
  }
}, 60000);
