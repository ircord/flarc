import { expect, it } from "vitest";
import { accountDisk, channelDisk, join, observers } from "../helpers/admin-gap-fixture";
import { createMatrixFixture } from "../helpers/matrix-fixture";

it("administrative catchalls reject unknown branches without changes and metrics require a real session", async () => {
  const f = await createMatrixFixture();
  let stream: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    async function verify() {
      const r = await f.connect(root),
        a = await f.connect(alice),
        b = await f.connect(bob);
      for (const client of [r, a, b]) await join(client, "#identitybarrier");
      await join(a, "#protected");
      await join(b, "#unrelated");
      stream = await observers(f, [root, alice, bob], [r, a, b]);
      await stream.barrier();
      const ircOffsets = [r, a, b].map((client) => client.lines.length);
      const eventOffsets = stream.received.map((items) => items.length);
      const beforeAccounts = await accountDisk(f.directory),
        beforeProtected = await channelDisk(f.directory, "#protected"),
        beforeUnrelated = await channelDisk(f.directory, "#unrelated");
      for (const prefix of ["/admin", "/api/v1/admin"]) {
        expect((await f.request(`${prefix}/unknown-inventory-branch`, null)).status).toBe(401);
        expect((await f.request(`${prefix}/unknown-inventory-branch`, alice)).status).toBe(403);
        const unknown = await f.request(`${prefix}/unknown-inventory-branch`, root);
        expect(unknown.status).toBe(404);
        expect(await unknown.text()).toContain("Admin route not found");
        const control = await f.request(`${prefix}/stats`, root);
        expect(control.status).toBe(200);
        expect(((await control.json()) as any).ok).toBe(true);
      }
      expect((await f.request("/metrics")).status).toBe(401);
      const metrics = await f.request("/metrics", alice);
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("content-type")).toContain("text/plain");
      const text = await metrics.text();
      expect(text).toContain("flarc_up 1");
      expect(text).toContain("flarc_registered_users_total");
      expect(text).not.toContain(alice.token);
      const marker = await stream.barrier();
      for (const [index, client] of [r, a, b].entries())
        expect(
          client.lines.slice(ircOffsets[index]).filter((line) => !line.includes(marker)),
        ).toEqual([]);
      for (const [index, lines] of stream.received.entries())
        expect(lines.slice(eventOffsets[index]).filter((line) => !line.includes(marker))).toEqual(
          [],
        );
      expect(await accountDisk(f.directory)).toEqual(beforeAccounts);
      expect(await channelDisk(f.directory, "#protected")).toEqual(beforeProtected);
      expect(await channelDisk(f.directory, "#unrelated")).toEqual(beforeUnrelated);
      stream.close();
      stream = undefined;
    }
    await verify();
    await f.restart();
    await verify();
  } finally {
    stream?.close();
    await f.dispose();
  }
}, 60000);
