import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMediaRoleGapFixture } from "../helpers/media-role-gap-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

async function command(c: TestIRCClient, text: string, match: string) {
  const done = c.waitForNewLine((line) => line.includes(match));
  c.send(text);
  await done;
}
async function join(c: TestIRCClient, name: string) {
  await command(c, `JOIN ${name}`, ` ${name} :End of`);
}
const aliases = ["/api/v1/media/upload", "/api/media/upload"];
const roles = "/api/v1/channels/%23attachments/roles";

for (const provider of ["sqlite", "r2"] as const)
  describe(`${provider} attachment authorization`, () => {
    it("ROLE-026 MEDIA-001 MEDIA-004 MEDIA-012: additive scoped grants, removal and restart preserve read/write separation", async () => {
      const f = await createMediaRoleGapFixture(provider);
      try {
        const alice = await f.actor("alice"),
          bob = await f.actor("bob"),
          outsider = await f.actor("outsider");
        let clients = await Promise.all([alice, bob, outsider].map((who) => f.connect(who)));
        async function setup() {
          for (const name of ["#attachments", "#other"])
            for (const c of clients.slice(0, 2)) await join(c, name);
          for (const c of clients) await join(c, "#barrier");
        }
        await setup();
        await command(clients[0], "MODE #attachments +s", " MODE #attachments +s");
        let streams = await Promise.all([alice, bob, outsider].map((who) => f.events(who)));
        async function barrier() {
          const marker = `attachment-barrier-${randomUUID()}`;
          expect(
            (
              await f.request("/api/v1/channels/%23barrier/messages", alice, "POST", {
                content: marker,
              })
            ).status,
          ).toBe(201);
          await Promise.all([
            ...clients.map((c) => c.waitForLine((line) => line.includes(marker))),
            ...streams.map((e) => e.until(marker)),
          ]);
          return marker;
        }
        async function denied(action: () => Promise<Response>, status = 403) {
          await barrier();
          const offsets = clients.map((c) => c.lines.length),
            eventOffsets = streams.map((e) => e.lines.length),
            before = await f.state();
          const response = await action();
          expect(response.status).toBe(status);
          expect(response.headers.get("location")).toBeNull();
          expect(await response.text()).not.toContain("forbidden-attachment");
          expect(await f.state()).toEqual(before);
          const marker = await barrier();
          for (const [i, c] of clients.entries())
            expect(c.lines.slice(offsets[i]).filter((line) => !line.includes(marker))).toEqual([]);
          for (const [i, e] of streams.entries())
            expect(e.lines.slice(eventOffsets[i]).filter((line) => !line.includes(marker))).toEqual(
              [],
            );
        }
        const payload = new Uint8Array(512 * 1024 + 17).fill(71);
        async function allowed(who = bob, name = "#attachments", alias = aliases[0]) {
          const before = await f.state(),
            response = await f.upload(who, name, payload, alias);
          expect(response.status, await response.clone().text()).toBe(201);
          const file = (await response.json()) as any,
            after = await f.state();
          expect(
            after.rows.filter((row: any) => !before.rows.some((old: any) => old.id === row.id)),
          ).toEqual([
            expect.objectContaining({
              id: file.id,
              owner_id: who.account.id,
              size: payload.length,
              scope_kind: "channel",
              scope_target: name,
              storage_kind: provider,
              upload_state: "ready",
              inline_bytes: 0,
              data_layout: provider === "sqlite" ? "chunked" : "inline",
              data_sha256:
                provider === "sqlite" ? createHash("sha256").update(payload).digest("hex") : null,
            }),
          ]);
          expect(after.rows).toHaveLength(before.rows.length + 1);
          expect(after.quota.find((q: any) => q.owner_id === who.account.id)?.bytes).toBe(
            (before.quota.find((q: any) => q.owner_id === who.account.id)?.bytes ?? 0) +
              payload.length,
          );
          expect(after.chunks.filter((c: any) => c.media_id === file.id)).toEqual(
            provider === "sqlite"
              ? [
                  { media_id: file.id, chunk_index: 0, bytes: 512 * 1024 },
                  { media_id: file.id, chunk_index: 1, bytes: 17 },
                ]
              : [],
          );
          expect(after.objects).toHaveLength(before.objects.length + (provider === "r2" ? 1 : 0));
          if (provider === "r2")
            expect(after.objects).toContainEqual({
              key: after.rows.find((row: any) => row.id === file.id).object_key,
              size: payload.length,
            });
          const read = await f.request(file.url, alice);
          expect(read.status).toBe(200);
          expect(new Uint8Array(await read.arrayBuffer())).toEqual(payload);
          return file;
        }
        const ordinary = await allowed(),
          unrelated = await allowed(alice, "#other");
        await command(clients[0], "MODE #attachments +m", " MODE #attachments +m");
        await command(clients[0], "MODE #other +m", " MODE #other +m");
        for (const alias of aliases)
          await denied(() => f.upload(bob, "#attachments", "forbidden-attachment", alias));
        const created = await f.request(roles, alice, "POST", {
          name: "Attachments",
          permissions: ["attach_files"],
        });
        expect(created.status).toBe(201);
        const role = ((await created.json()) as any).role;
        const assignment = { userId: bob.account.id, roleGroupId: role.id };
        async function assign(remove = false) {
          expect(
            (await f.request(`${roles}/assign`, alice, "POST", { ...assignment, remove })).status,
          ).toBe(200);
        }
        await assign();
        for (const alias of aliases) await allowed(bob, "#attachments", alias);
        await denied(() => f.upload(bob, "#other", "forbidden-attachment"));
        await denied(
          () =>
            f.request("/api/v1/channels/%23attachments/messages", bob, "POST", {
              content: "forbidden-attachment",
            }),
          400,
        );
        await denied(() =>
          f.request(roles, bob, "POST", { name: "forbidden-attachment", ircMode: "q" }),
        );
        await denied(() => f.upload(outsider, "#attachments", "forbidden-attachment"));
        await assign(true);
        for (const alias of aliases)
          await denied(() => f.upload(bob, "#attachments", "forbidden-attachment", alias));
        expect((await f.request(ordinary.url, bob)).status).toBe(200);
        expect((await f.request(ordinary.url, outsider)).status).toBe(404);
        await assign();
        const persistent = await f.state();
        await f.restart();
        expect(await f.state()).toEqual(persistent);
        clients = await Promise.all([alice, bob, outsider].map((who) => f.connect(who)));
        await setup();
        streams = await Promise.all([alice, bob, outsider].map((who) => f.events(who)));
        await allowed(bob, "#attachments", aliases[1]);
        await assign(true);
        await f.restart();
        clients = await Promise.all([alice, bob, outsider].map((who) => f.connect(who)));
        await setup();
        streams = await Promise.all([alice, bob, outsider].map((who) => f.events(who)));
        for (const alias of aliases)
          await denied(() => f.upload(bob, "#attachments", "forbidden-attachment", alias));
        expect((await f.request(ordinary.url, bob)).status).toBe(200);
        const healthy = await f.request(unrelated.url, alice);
        expect(healthy.status).toBe(200);
        expect(new Uint8Array(await healthy.arrayBuffer())).toEqual(payload);
        // Voice and operator authority remain independently sufficient.
        await command(clients[0], "MODE #attachments +v bob", " MODE #attachments +v bob");
        await allowed();
        await command(
          clients[0],
          "MODE #attachments -v+o bob bob",
          " MODE #attachments -v+o bob bob",
        );
        await allowed();
      } finally {
        await f.dispose();
      }
    }, 60000);

    it("ROLE-026 MEDIA-001: attach_files cannot bypass membership, bans, quiet, mute or read-only", async () => {
      const f = await createMediaRoleGapFixture(provider);
      try {
        const alice = await f.actor("alice"),
          bob = await f.actor("bob"),
          outsider = await f.actor("outsider");
        const a = await f.connect(alice),
          b = await f.connect(bob),
          c = await f.connect(outsider);
        await join(a, "#attachments");
        await join(b, "#attachments");
        await join(a, "#other");
        await join(b, "#other");
        await command(a, "MODE #attachments +s", " MODE #attachments +s");
        const clients = [a, b, c];
        for (const client of clients) await join(client, "#barrier");
        const streams = await Promise.all([alice, bob, outsider].map((who) => f.events(who)));
        async function barrier() {
          const marker = `attachment-restriction-${randomUUID()}`;
          expect(
            (
              await f.request("/api/v1/channels/%23barrier/messages", alice, "POST", {
                content: marker,
              })
            ).status,
          ).toBe(201);
          await Promise.all([
            ...clients.map((client) => client.waitForLine((line) => line.includes(marker))),
            ...streams.map((stream) => stream.until(marker)),
          ]);
          return marker;
        }
        async function window() {
          await barrier();
          return {
            irc: clients.map((client) => client.lines.length),
            events: streams.map((stream) => stream.lines.length),
          };
        }
        async function silent(
          offsets: Awaited<ReturnType<typeof window>>,
          intentionalRoleRemoval?: string,
        ) {
          const marker = await barrier();
          for (const [i, client] of clients.entries())
            expect(
              client.lines.slice(offsets.irc[i]).filter((line) => !line.includes(marker)),
            ).toEqual([]);
          for (const [i, stream] of streams.entries()) {
            const observed = stream.lines
              .slice(offsets.events[i])
              .filter((line) => !line.includes(marker));
            const transitions = observed.filter((line) => {
              if (!intentionalRoleRemoval) return false;
              const event = JSON.parse(line);
              return (
                event.type === "channel.member_role_changed" &&
                event.channelId === "#attachments" &&
                event.data?.userId === bob.account.id &&
                event.data?.roleGroupId === intentionalRoleRemoval &&
                event.data?.assigned === false
              );
            });
            expect(transitions).toHaveLength(intentionalRoleRemoval && i < 2 ? 1 : 0);
            expect(observed.filter((line) => !transitions.includes(line))).toEqual([]);
          }
        }
        const created = await f.request(roles, alice, "POST", {
          name: "Attachments",
          permissions: ["attach_files"],
        });
        expect(created.status).toBe(201);
        const id = ((await created.json()) as any).role.id;
        expect(
          (
            await f.request(`${roles}/assign`, alice, "POST", {
              userId: bob.account.id,
              roleGroupId: id,
            })
          ).status,
        ).toBe(200);
        await command(a, "MODE #attachments +m", " MODE #attachments +m");
        expect((await f.upload(bob, "#attachments", "allowed")).status).toBe(201);
        async function denial() {
          const offsets = await window();
          const before = await f.state();
          for (const alias of aliases) {
            const r = await f.upload(bob, "#attachments", "forbidden-attachment", alias);
            expect(r.status).toBe(403);
            expect(r.headers.get("location")).toBeNull();
            expect(await r.text()).not.toContain("forbidden-attachment");
          }
          expect(await f.state()).toEqual(before);
          await silent(offsets);
        }
        for (const mode of ["q bob!*@*", "b $m:bob!*@*", "b $a:bob"]) {
          await command(a, `MODE #attachments +${mode}`, ` MODE #attachments +${mode}`);
          await denial();
          await command(a, `MODE #attachments -${mode}`, ` MODE #attachments -${mode}`);
          expect((await f.upload(bob, "#attachments", "restriction-removed")).status).toBe(201);
        }
        expect(
          (
            await f.request("/api/v1/channels/%23attachments/info", alice, "PATCH", {
              readOnly: true,
            })
          ).status,
        ).toBe(200);
        await denial();
        expect(
          (
            await f.request("/api/v1/channels/%23attachments/info", alice, "PATCH", {
              readOnly: false,
            })
          ).status,
        ).toBe(200);
        await command(b, "PART #attachments :membership-revoked", " PART #attachments");
        await denial();
        await join(b, "#attachments");
        expect((await f.upload(bob, "#attachments", "rejoined")).status).toBe(201);
        if (provider === "r2") {
          const independentBytes = "unrelated-survives-rollback";
          const independentUpload = await f.upload(alice, "#other", independentBytes);
          expect(independentUpload.status).toBe(201);
          const independent = (await independentUpload.json()) as any;
          const offsets = await window();
          const before = await f.state(),
            pending = f.upload(bob, "#attachments", "revoked-during-put", aliases[1], true);
          const gate = await f.gate();
          await gate.waitReached();
          const held = await f.state();
          const reservation = held.rows.filter(
            (row: any) => !before.rows.some((old: any) => old.id === row.id),
          );
          expect(reservation).toEqual([
            expect.objectContaining({
              owner_id: bob.account.id,
              upload_state: "pending",
              size: 18,
              scope_kind: "channel",
              scope_target: "#attachments",
            }),
          ]);
          expect(held.objects).toContainEqual({ key: reservation[0].object_key, size: 18 });
          for (const who of [alice, bob, outsider])
            expect((await f.request(`/media/${reservation[0].id}`, who)).status).toBe(404);
          expect(
            (
              await f.request(`${roles}/assign`, alice, "POST", {
                userId: bob.account.id,
                roleGroupId: id,
                remove: true,
              })
            ).status,
          ).toBe(200);
          await gate.resume();
          const response = await pending;
          expect(response.status).toBe(403);
          expect(response.headers.get("location")).toBeNull();
          const after = await f.state();
          expect(after.rows).toEqual(before.rows);
          expect(after.chunks).toEqual(before.chunks);
          expect(after.quota).toEqual(before.quota);
          expect(after.objects).toEqual(before.objects);
          await silent(offsets, id);
          const rollbackState = await f.state();
          const rejectedId = reservation[0].id;
          const independentRow = rollbackState.rows.find((row: any) => row.id === independent.id);
          expect(independentRow).toMatchObject({
            owner_id: alice.account.id,
            scope_kind: "channel",
            scope_target: "#other",
            size: independentBytes.length,
            upload_state: "ready",
            storage_kind: "r2",
          });
          expect(
            rollbackState.channel.channel_user_roles.some(
              (row: any) => row.user_id === bob.account.id && row.group_id === id,
            ),
          ).toBe(false);
          await f.restart();
          const restarted = await f.state();
          expect(restarted).toEqual(rollbackState);
          expect(restarted.rows.some((row: any) => row.id === rejectedId)).toBe(false);
          expect(restarted.chunks.some((row: any) => row.media_id === rejectedId)).toBe(false);
          expect(restarted.objects.some((row: any) => row.key === rejectedId)).toBe(false);
          expect(restarted.quota).toEqual(before.quota);
          expect(restarted.rows.find((row: any) => row.id === independent.id)).toEqual(
            independentRow,
          );
          expect(await (await f.request(independent.url, alice)).text()).toBe(independentBytes);
          for (const who of [alice, bob, outsider])
            expect((await f.request(`/media/${rejectedId}`, who)).status).toBe(404);
          const postClients = await Promise.all(
            [alice, bob, outsider].map((who) => f.connect(who)),
          );
          for (const client of postClients.slice(0, 2)) {
            await join(client, "#attachments");
            await join(client, "#other");
          }
          for (const client of postClients) await join(client, "#barrier");
          const postStreams = await Promise.all([alice, bob, outsider].map((who) => f.events(who)));
          async function postBarrier() {
            const marker = `rollback-restart-${randomUUID()}`;
            expect(
              (
                await f.request("/api/v1/channels/%23barrier/messages", alice, "POST", {
                  content: marker,
                })
              ).status,
            ).toBe(201);
            await Promise.all([
              ...postClients.map((client) => client.waitForLine((line) => line.includes(marker))),
              ...postStreams.map((stream) => stream.until(marker)),
            ]);
            return marker;
          }
          await postBarrier();
          const ircOffsets = postClients.map((client) => client.lines.length);
          const eventOffsets = postStreams.map((stream) => stream.lines.length);
          const beforeDenied = await f.state();
          for (const alias of aliases) {
            const denied = await f.upload(
              bob,
              "#attachments",
              "rollback-post-restart-denied",
              alias,
            );
            expect(denied.status).toBe(403);
            expect(denied.headers.get("location")).toBeNull();
          }
          expect(await f.state()).toEqual(beforeDenied);
          const deniedBarrier = await postBarrier();
          for (const [i, client] of postClients.entries())
            expect(
              client.lines.slice(ircOffsets[i]).filter((line) => !line.includes(deniedBarrier)),
            ).toEqual([]);
          for (const [i, stream] of postStreams.entries())
            expect(
              stream.lines.slice(eventOffsets[i]).filter((line) => !line.includes(deniedBarrier)),
            ).toEqual([]);
          const liveMarker = `rollback-member-positive-${randomUUID()}`;
          expect(
            (
              await f.request("/api/v1/channels/%23attachments/messages", alice, "POST", {
                content: liveMarker,
              })
            ).status,
          ).toBe(201);
          await Promise.all([
            postClients[1].waitForLine((line) => line.includes(liveMarker)),
            postStreams[1].until(liveMarker),
          ]);
          await postBarrier();
          expect(postClients[2].lines.join("\n")).not.toContain(liveMarker);
          expect(postStreams[2].lines.join("\n")).not.toContain(liveMarker);
          const healthy = await f.upload(alice, "#other", "unrelated-after-restart");
          expect(healthy.status).toBe(201);
          expect(await (await f.request(((await healthy.json()) as any).url, alice)).text()).toBe(
            "unrelated-after-restart",
          );
        }
      } finally {
        await f.dispose();
      }
    }, 60000);
  });
