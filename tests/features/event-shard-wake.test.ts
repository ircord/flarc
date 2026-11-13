import { expect, it, vi } from "vitest";
import { createMatrixFixture, json, operation, stream, wire } from "./helpers/session-features";

it("occupied event shards wake for public live observers while private and replay authority stay isolated", async () => {
  const f = await createMatrixFixture();
  const sockets: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const alice = await f.createActor("alice"),
      observer = await f.createActor("observer");
    const a = await f.connect(alice);
    await wire(a, "JOIN #wakepublic", / 366 .*#wakepublic/);
    await wire(a, "JOIN #wakesecret", / 366 .*#wakesecret/);
    await wire(a, "MODE #wakesecret +s", / MODE #wakesecret \+s/);
    const outsider = await stream(f, observer),
      owner = await stream(f, alice);
    sockets.push(outsider, owner);
    const cursor = (await json(f, "/api/v1/events/bootstrap", observer)).cursor;
    const created = await f.request("/api/v1/channels/%23wakesecret/messages", alice, "POST", {
      content: "private-wake-secret",
    });
    expect(created.status).toBe(201);
    const sent = await f.request("/api/v1/channels/%23wakepublic/messages", alice, "POST", {
      content: "public-wake-marker",
    });
    expect(sent.status).toBe(201);
    const id = ((await sent.json()) as any).message.id;
    await vi.waitFor(
      () => {
        expect(outsider.frames).toContainEqual(
          expect.objectContaining({ messageId: id, transient: true }),
        );
        expect(owner.frames.some((item) => item.data?.content === "private-wake-secret")).toBe(
          true,
        );
      },
      { timeout: 1000, interval: 10 },
    );
    expect(JSON.stringify(outsider.frames)).not.toContain("private-wake-secret");
    const replay = await json(f, `/api/v1/events/replay?cursor=${cursor}`, observer);
    expect(JSON.stringify(replay.events)).not.toContain("public-wake-marker");
    expect(JSON.stringify(replay.events)).not.toContain("private-wake-secret");
    expect((await f.request("/api/v1/channels/%23wakesecret/messages", observer)).status).toBe(403);
    // A retained stream remains functional after unrelated private events.
    const next = await f.request("/api/v1/channels/%23wakepublic/messages", alice, "POST", {
      content: `later-${operation()}`,
    });
    expect(next.status).toBe(201);
  } finally {
    for (const socket of sockets) socket.close();
    await f.dispose();
  }
}, 60000);
