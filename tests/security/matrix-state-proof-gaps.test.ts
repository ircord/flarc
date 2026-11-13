import { expect, it } from "vitest";
import { accountDisk, channelDisk, join, observers } from "../helpers/admin-gap-fixture";
import { createMatrixFixture } from "../helpers/matrix-fixture";

it("DB-005: registered founder and resource metadata persist across recreation and denied registration is silent", async () => {
  const f = await createMatrixFixture();
  let streams: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true);
    const alice = await f.createActor("alice");
    const bob = await f.createActor("bob");
    const charlie = await f.createActor("charlie");
    const clients = await Promise.all([root, alice, bob, charlie].map((actor) => f.connect(actor)));
    for (const client of clients) await join(client, "#identitybarrier");
    await join(clients[3], "#independent");
    const register = await f.request("/admin/channels/%23registered/register", root, "POST", {
      founder: "alice",
    });
    expect(register.status).toBe(200);
    expect(((await register.json()) as any).ok).toBe(true);
    expect(
      (
        await f.request("/admin/channels/%23registered/info", root, "PATCH", {
          description: "registered-description",
        })
      ).status,
    ).toBe(200);
    await join(clients[1], "#registered");
    streams = await observers(f, [root, alice, bob, charlie], clients);
    await streams.barrier();
    async function domain() {
      return {
        accounts: await accountDisk(f.directory),
        registered: await channelDisk(f.directory, "#registered"),
        independent: await channelDisk(f.directory, "#independent"),
      };
    }
    async function denied(actor: typeof bob) {
      const before = await domain();
      const ircOffsets = clients.map((client) => client.lines.length);
      const eventOffsets = streams!.received.map((events) => events.length);
      expect(
        (
          await f.request("/admin/channels/%23registered/register", actor, "POST", {
            founder: "bob",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await f.request("/admin/channels/%23registered/info", actor, "PATCH", {
            description: "forbidden",
          })
        ).status,
      ).toBe(403);
      const marker = await streams!.barrier();
      for (const [i, client] of clients.entries())
        expect(client.lines.slice(ircOffsets[i]).filter((line) => !line.includes(marker))).toEqual(
          [],
        );
      for (const [i, events] of streams!.received.entries())
        expect(events.slice(eventOffsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
      expect(await domain()).toEqual(before);
      return before;
    }
    const before = await denied(bob);
    expect(before.registered.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "name", value: "#registered" }),
        expect.objectContaining({ key: "founder", value: "alice" }),
      ]),
    );
    expect(before.registered.kv).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "description", value: "registered-description" }),
      ]),
    );
    expect(before.independent.metadata).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "founder", value: "charlie" })]),
    );
    streams.close();
    streams = undefined;
    await f.restart();
    const after = await domain();
    expect(after).toEqual(before);
    const rr = await f.login("rootadmin", root.password);
    const freshBob = await f.login("bob", bob.password);
    const info = await f.request("/admin/channels/%23registered/info", rr);
    expect(info.status).toBe(200);
    expect(((await info.json()) as any).channel).toMatchObject({
      founder: "alice",
      description: "registered-description",
    });
    // Login changes session state, so establish a new exact domain baseline for denial.
    const freshActors = [
      rr,
      await f.login("alice", alice.password),
      freshBob,
      await f.login("charlie", charlie.password),
    ];
    const freshClients = await Promise.all(freshActors.map((actor) => f.connect(actor)));
    for (const client of freshClients) await join(client, "#identitybarrier");
    streams = await observers(f, freshActors, freshClients);
    await streams.barrier();
    const postBefore = await domain();
    const ircOffsets = freshClients.map((client) => client.lines.length);
    const eventOffsets = streams.received.map((events) => events.length);
    expect(
      (
        await f.request("/admin/channels/%23registered/register", freshBob, "POST", {
          founder: "bob",
        })
      ).status,
    ).toBe(403);
    const marker = await streams.barrier();
    for (const [i, client] of freshClients.entries())
      expect(client.lines.slice(ircOffsets[i]).filter((line) => !line.includes(marker))).toEqual(
        [],
      );
    for (const [i, events] of streams.received.entries())
      expect(events.slice(eventOffsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
    expect(await domain()).toEqual(postBefore);
  } finally {
    streams?.close();
    await f.dispose();
  }
}, 60000);
