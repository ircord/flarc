import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createMediaRecoveryFixture } from "../helpers/media-recovery-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

async function barrier(client: TestIRCClient) {
  const nonce = randomUUID();
  const received = client.waitForNewLine((line) => line.includes(" PONG ") && line.includes(nonce));
  client.send(`PING :${nonce}`);
  await received;
}

it("lists only published media in each authenticated scope and preserves isolation after recreation", async () => {
  const f = await createMediaRecoveryFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    const aliceJoin = a.waitForNewLine(
      (line) => line.includes(" JOIN ") && line.includes("#media"),
    );
    a.send("JOIN #media");
    await aliceJoin;
    const bobJoin = b.waitForNewLine((line) => line.includes(" JOIN ") && line.includes("#media"));
    b.send("JOIN #media");
    await bobJoin;
    const secret = a.waitForNewLine((line) => line.includes(" MODE #media +s"));
    a.send("MODE #media +s");
    await secret;
    const upload = async (token: string, query: string, content: string) => {
      const response = await fetch(new URL(`/api/v1/media/upload${query}`, f.runtime.url), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
          "X-Filename": `${content}.txt`,
        },
        body: content,
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };
    const privateId = await upload(alice.token, "", "alice-private");
    const unrelatedId = await upload(bob.token, "", "bob-unrelated");
    const channelId = await upload(alice.token, "?channel=media", "channel-secret");
    const dmId = await upload(alice.token, "?dm=bob", "conversation-secret");
    const limitedResponse = await f.request("/api/v1/auth/credentials", alice.token, "POST", {
      label: "media-route-only",
      expiresAt: Date.now() + 60000,
      scopes: [
        { operation: "rest.post", resource: "/api/v1/media/upload" },
        { operation: "rest.get", resource: `/media/${privateId}` },
      ],
    });
    expect(limitedResponse.status).toBe(200);
    const limited = ((await limitedResponse.json()) as { credential: { token: string } }).credential
      .token;
    const beforeDenied = await f.runtime.accounts.recoveryRows();
    expect((await f.upload(limited, "scope-denied", "scope-denied.txt")).status).toBe(403);
    expect((await f.request(`/media/${privateId}`, limited)).status).toBe(404);
    expect(await f.runtime.accounts.recoveryRows()).toEqual(beforeDenied);
    const ids = async (token: string, query = "") => {
      const response = await f.request(`/api/v1/media${query}`, token);
      expect(response.status).toBe(200);
      return ((await response.json()) as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      );
    };
    expect(await ids(alice.token)).toEqual([privateId]);
    expect(await ids(bob.token)).toEqual([unrelatedId]);
    expect(await ids(bob.token, "?channel=media")).toEqual([channelId]);
    expect(await ids(bob.token, "?dm=alice")).toEqual([dmId]);
    await Promise.all([barrier(a), barrier(b), barrier(c)]);
    const offsets = [a.lines.length, b.lines.length, c.lines.length];
    expect((await f.request("/api/v1/media?channel=media", charlie.token)).status).toBe(403);
    expect(await ids(charlie.token, "?dm=alice")).toEqual([]);
    expect((await f.request("/api/v1/media")).status).toBe(401);
    await Promise.all([barrier(a), barrier(b), barrier(c)]);
    for (const [i, client] of [a, b, c].entries())
      expect(client.lines.slice(offsets[i]).join("\n")).not.toMatch(
        /alice-private|channel-secret|conversation-secret/,
      );
    await f.restart();
    expect(await ids(alice.token)).toEqual([privateId]);
    expect(await ids(bob.token)).toEqual([unrelatedId]);
    expect(await ids(bob.token, "?dm=alice")).toEqual([dmId]);
    expect((await f.request(`/media/${privateId}`, bob.token)).status).toBe(404);
  } finally {
    await f.dispose();
  }
});
