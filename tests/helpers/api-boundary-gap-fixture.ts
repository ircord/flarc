import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { authGapFixture, sameProtected, wire } from "./auth-gap-fixture";
import type { TestIRCClient } from "./miniflare-harness";

export async function apiBoundaryRig() {
  const f = await authGapFixture({ ALLOWED_ORIGINS: "https://trusted.example" });
  const root = await f.create("rootadmin", true),
    alice = await f.create("alice"),
    bob = await f.create("bob"),
    charlie = await f.create("charlie");
  let clients: TestIRCClient[] = [],
    streams: Awaited<ReturnType<typeof f.event>>[] = [];
  async function observers() {
    const b = await f.connect(bob),
      a = await f.connect(alice),
      c = await f.connect(charlie);
    await wire(b, "JOIN #boundary", / 366 .*#boundary/);
    await wire(a, "JOIN #boundary", / 366 .*#boundary/);
    await wire(c, "JOIN #unrelated", / 366 .*#unrelated/);
    for (const client of [a, b, c]) await wire(client, "JOIN #markers", / 366 .*#markers/);
    clients = [a, b, c];
    streams = await Promise.all([alice, bob, charlie].map((actor) => f.event(actor)));
  }
  await observers();
  await wire(clients[1], "MODE #boundary +s", / MODE #boundary \+s/);
  await wire(clients[2], "MODE #unrelated +s", / MODE #unrelated \+s/);
  expect(
    (
      await f.request("/api/v1/channels/%23boundary/messages", bob, "POST", {
        content: "api-boundary-secret-channel",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await f.request("/api/v1/channels/%23unrelated/messages", charlie, "POST", {
        content: "api-boundary-unrelated-channel",
      })
    ).status,
  ).toBe(201);
  const dm = clients[1].waitForNewLine((line) => line.includes("api-boundary-secret-dm"));
  clients[0].send("PRIVMSG bob :api-boundary-secret-dm");
  await dm;
  expect(
    (
      await f.request("/api/v1/profiles/charlie", charlie, "PATCH", {
        bio: "api-boundary-unrelated-profile",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request("/admin/metadata/users/bob", root, "PUT", {
        key: "private-note",
        value: "api-boundary-private-metadata",
      })
    ).status,
  ).toBe(200);
  const mediaResponse = await fetch(new URL("/api/v1/media/upload", f.url), {
    method: "POST",
    headers: { authorization: `Bearer ${bob.token}`, "content-type": "text/plain" },
    body: "api-boundary-private-media",
  });
  expect(mediaResponse.status).toBe(201);
  const media = (await mediaResponse.json()) as any;
  async function barrier() {
    const marker = `api-boundary-barrier-${randomUUID()}`;
    expect(
      (await f.request("/api/v1/channels/%23markers/messages", bob, "POST", { content: marker }))
        .status,
    ).toBe(201);
    await Promise.all([
      ...clients.map((client) => client.waitForLine((line) => line.includes(marker))),
      ...streams.map((event) => event.until(marker)),
    ]);
    expect(streams[2].received.some((line) => line.includes("api-boundary-secret-channel"))).toBe(
      false,
    );
    return marker;
  }
  async function silent(action: () => Promise<void>) {
    await barrier();
    const ircOffsets = clients.map((client) => client.lines.length),
      eventOffsets = streams.map((event) => event.received.length);
    await action();
    const marker = await barrier();
    for (const [i, client] of clients.entries())
      expect(client.lines.slice(ircOffsets[i]).filter((line) => !line.includes(marker))).toEqual(
        [],
      );
    for (const [i, event] of streams.entries())
      expect(
        event.received.slice(eventOffsets[i]).filter((line) => !line.includes(marker)),
      ).toEqual([]);
  }
  async function snapshot() {
    const protectedState = await f.snapshot();
    const extra: Record<string, any[]> = {};
    for (const table of ["user_metadata", "media_uploads", "media_upload_chunks"])
      extra[table] = (await f.rows(table))
        .flat()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { protectedState, extra };
  }
  function equal(
    before: Awaited<ReturnType<typeof snapshot>>,
    after: Awaited<ReturnType<typeof snapshot>>,
  ) {
    sameProtected(before.protectedState, after.protectedState);
    expect(after.extra).toEqual(before.extra);
  }
  async function resume() {
    await f.restart();
    await observers();
  }
  async function controls() {
    const profile = await f.request("/api/v1/profiles/charlie", alice);
    expect(profile.status).toBe(200);
    expect(((await profile.json()) as any).profile.bio).toBe("api-boundary-unrelated-profile");
    const secret = await f.request("/api/v1/channels/%23boundary/messages", alice);
    expect(secret.status).toBe(200);
    expect(await secret.text()).toContain("api-boundary-secret-channel");
    const dmRead = await f.request("/api/v1/dms/bob/messages", alice);
    expect(dmRead.status).toBe(200);
    expect(await dmRead.text()).toContain("api-boundary-secret-dm");
    const rootRead = await f.request("/admin/accounts/bob", root);
    expect(rootRead.status).toBe(200);
    expect(JSON.stringify(await rootRead.json())).toContain(bob.account.id);
    expect(await (await f.request(media.url, bob)).text()).toBe("api-boundary-private-media");
  }
  return {
    f,
    root,
    alice,
    bob,
    charlie,
    media,
    barrier,
    silent,
    snapshot,
    equal,
    resume,
    controls,
    async dispose() {
      await f.dispose();
    },
  };
}
export type ApiBoundaryRig = Awaited<ReturnType<typeof apiBoundaryRig>>;
