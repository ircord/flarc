import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMediaRaceFixture } from "../helpers/media-race-fixture";

async function deadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function join(
  client: Awaited<ReturnType<Awaited<ReturnType<typeof createMediaRaceFixture>>["connect"]>>,
  channel: string,
) {
  const done = client.waitForNewLine((l) => l.includes(" 366 ") && l.includes(channel));
  client.send(`JOIN ${channel}`);
  await done;
}

async function observe(
  f: Awaited<ReturnType<typeof createMediaRaceFixture>>,
  users: { token: string }[],
  clients: Awaited<ReturnType<Awaited<ReturnType<typeof createMediaRaceFixture>>["connect"]>>[],
) {
  const sockets: WebSocket[] = [],
    received: string[][] = users.map(() => []);
  try {
    for (const [i, user] of users.entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", user.token, "POST");
      expect(ticket.status).toBe(200);
      const ws = new WebSocket(
        `ws://${f.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
      );
      sockets.push(ws);
      ws.on("message", (data) => received[i].push(data.toString()));
      await deadline(
        new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        }),
        "event socket open",
      );
    }
  } catch (error) {
    for (const socket of sockets) socket.terminate();
    throw error;
  }
  const barrier = async (marker: string) => {
    const promises = sockets.map(
      (socket) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Missing event barrier ${marker}`)),
            4000,
          );
          socket.on("message", function listener(data) {
            if (data.toString().includes(marker)) {
              clearTimeout(timer);
              socket.off("message", listener);
              resolve();
            }
          });
        }),
    );
    const result = await f.request("/api/v1/channels/%23watch/messages", users[0].token, "POST", {
      content: marker,
    });
    expect(result.status).toBe(201);
    await deadline(
      Promise.all([...promises, ...clients.map((c) => c.waitForLine((l) => l.includes(marker)))]),
      "event and IRC live barrier",
    );
  };
  return {
    received,
    barrier,
    close() {
      for (const socket of sockets) socket.terminate();
    },
  };
}

for (const action of ["logout", "disable"] as const) {
  it(`[MEDIA-001 AUTH-011 AUTH-024 DB-025] ${action} prevents upload commit after authenticated channel scope was paused`, async () => {
    const f = await createMediaRaceFixture(false);
    let watcher: Awaited<ReturnType<typeof observe>> | undefined;
    try {
      const root = action === "disable" ? await f.actor("rootadmin", true) : undefined;
      const alice = await f.actor("alice"),
        bob = await f.actor("bob"),
        charlie = await f.actor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      for (const client of [a, b, c]) await join(client, "#race");
      for (const client of [b, c]) await join(client, "#watch");
      watcher = await observe(f, [bob, charlie], [b, c]);
      await watcher.barrier("sqlite-before-race");
      const eventStart = watcher.received.map((x) => x.length),
        ircStart = [b.lines.length, c.lines.length];
      const aliceControl = await f.upload(
        alice.token,
        "alice-control",
        "alice-control.txt",
        "?channel=%23race",
      );
      expect(aliceControl.status).toBe(201);
      const bobControl = await f.upload(bob.token, "bob-unrelated-data", "bob-sentinel.txt");
      expect(bobControl.status).toBe(201);
      const bobFile = (await bobControl.json()) as any;
      const beforeRows = await f.accounts.matrixRows(),
        beforeChunks = await f.accounts.matrixChunks();
      const ns = await f.mf.getDurableObjectNamespace("CHANNELS");
      const channel = ns.get(ns.idFromName("FlaRC:#race")) as any;
      await channel.matrixArm();
      const pending = f.upload(
        alice.token,
        "revoked-pending-bytes",
        "revoked-race.txt",
        "?channel=%23race",
      );
      await deadline(channel.matrixReached(), "scope gate reached after actual authorization");
      expect(await f.accounts.matrixRows()).toEqual(beforeRows);
      const revoked =
        action === "logout"
          ? await f.request("/api/v1/auth/logout", alice.token, "POST")
          : await f.request("/admin/accounts/alice/disable", root!.token, "POST");
      expect(revoked.status).toBe(200);
      expect((await f.request("/api/v1/profiles/alice", alice.token)).status).toBe(401);
      await channel.matrixRelease();
      const result = await deadline(pending, "upload response after release");
      const body = await result.text();
      const afterRows = await f.accounts.matrixRows(),
        afterChunks = await f.accounts.matrixChunks();
      expect(await (await f.request(bobFile.url, bob.token)).text()).toBe("bob-unrelated-data");
      await watcher.barrier("sqlite-after-race");
      const resultId = result.status === 201 ? (JSON.parse(body) as any).id : "missing-id";
      for (const [i, events] of watcher.received.entries())
        expect(events.slice(eventStart[i]).join("\n")).not.toMatch(
          new RegExp(`revoked-race|revoked-pending|${resultId}`),
        );
      for (const [i, client] of [b, c].entries())
        expect(client.lines.slice(ircStart[i]).join("\n")).not.toMatch(
          new RegExp(`revoked-race|revoked-pending|${resultId}`),
        );
      watcher.close();
      console.log(
        "MEDIA_RACE_SQLITE",
        JSON.stringify({
          action,
          status: result.status,
          body,
          beforeRows,
          afterRows,
          beforeChunks,
          afterChunks,
        }),
      );
      expect.soft([401, 403]).toContain(result.status);
      expect.soft(afterRows).toEqual(beforeRows);
      expect.soft(afterChunks).toEqual(beforeChunks);
    } finally {
      watcher?.close();
      await f.dispose();
    }
  }, 15000);
}

it("[MEDIA-009 MEDIA-012 AUTH-011 DB-025] failed R2 put releases reservation even after originating session revocation", async () => {
  const f = await createMediaRaceFixture(true);
  let watcher: Awaited<ReturnType<typeof observe>> | undefined;
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    const b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const client of [b, c]) await join(client, "#watch");
    watcher = await observe(f, [bob, charlie], [b, c]);
    await watcher.barrier("r2-before-race");
    const eventStart = watcher.received.map((x) => x.length),
      ircStart = [b.lines.length, c.lines.length];
    const healthy = await f.upload(bob.token, "r2-healthy-sentinel", "healthy.txt");
    expect(healthy.status).toBe(201);
    const good = (await healthy.json()) as any;
    const ok = await f.upload(alice.token, "r2-positive-control", "positive.txt");
    expect(ok.status).toBe(201);
    const normalFail = await f.upload(
      alice.token,
      "ordinary-failed-put",
      "ordinary-fail.txt",
      "",
      "fail",
    );
    expect(normalFail.status).toBe(503);
    expect(await normalFail.text()).not.toMatch(/matrix injected|stack|sqlite/i);
    const before = await f.accounts.matrixRows();
    expect(before.some((r: any) => r.filename === "ordinary-fail.txt")).toBe(false);
    const bucket = await f.mf.getR2Bucket("MEDIA_BUCKET");
    const beforeObjects = (await bucket.list()).objects.map((x) => x.key).sort();
    const reached = f.putGate.waitReached();
    const pending = f.upload(
      alice.token,
      "revoked-failed-put",
      "revoked-fail.txt",
      "",
      "hold-fail",
    );
    expect(await deadline(reached, "R2 put gate reached after reservation")).toBe(true);
    const reserved = await f.accounts.matrixRows();
    const row = reserved.find((r: any) => r.filename === "revoked-fail.txt");
    expect(row).toMatchObject({ owner_id: alice.id, size: 18, storage_kind: "r2" });
    expect(await bucket.get(row.object_key ?? row.id)).toBeNull();
    expect((await f.request("/api/v1/auth/logout", alice.token, "POST")).status).toBe(200);
    expect((await f.request("/api/v1/profiles/alice", alice.token)).status).toBe(401);
    await f.putGate.releaseGate();
    const result = await deadline(pending, "failed put response");
    const body = await result.text();
    const after = await f.accounts.matrixRows(),
      afterObjects = (await bucket.list()).objects.map((x) => x.key).sort();
    expect(await (await f.request(good.url, bob.token)).text()).toBe("r2-healthy-sentinel");
    expect((await f.upload(bob.token, "healthy-followup", "followup.txt")).status).toBe(201);
    await watcher.barrier("r2-after-race");
    for (const [i, events] of watcher.received.entries())
      expect(events.slice(eventStart[i]).join("\n")).not.toMatch(
        new RegExp(`revoked-fail|revoked-failed-put|${row.id}`),
      );
    for (const [i, client] of [b, c].entries())
      expect(client.lines.slice(ircStart[i]).join("\n")).not.toMatch(
        new RegExp(`revoked-fail|revoked-failed-put|${row.id}`),
      );
    watcher.close();
    console.log(
      "MEDIA_RACE_R2",
      JSON.stringify({
        status: result.status,
        body,
        before,
        reserved,
        after,
        beforeObjects,
        afterObjects,
      }),
    );
    expect.soft(result.status).toBe(503);
    expect.soft(body).not.toMatch(/matrix injected|stack|sqlite/i);
    expect.soft(after).toEqual(before);
    expect.soft(afterObjects).toEqual(beforeObjects);
  } finally {
    watcher?.close();
    await f.dispose();
  }
}, 15000);

it("[MEDIA-001 MEDIA-003 MEDIA-006 AUTH-011 DB-025] completed R2 put stays private and rolls back after logout before publication", async () => {
  const f = await createMediaRaceFixture(true);
  let watcher: Awaited<ReturnType<typeof observe>> | undefined;
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    const b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const client of [b, c]) await join(client, "#watch");
    watcher = await observe(f, [bob, charlie], [b, c]);
    await watcher.barrier("publication-before");
    const eventsStart = watcher.received.map((x) => x.length),
      ircStart = [b.lines.length, c.lines.length];
    const own = await f.upload(alice.token, "alice-ready-data", "alice-ready.txt");
    expect(own.status).toBe(201);
    const ownFile = (await own.json()) as any;
    const other = await f.upload(bob.token, "bob-ready-data", "bob-ready.txt");
    expect(other.status).toBe(201);
    const otherFile = (await other.json()) as any;
    const before = await f.accounts.matrixRows(),
      bucket = await f.mf.getR2Bucket("MEDIA_BUCKET");
    const reached = f.putGate.waitReached();
    const pending = f.upload(
      alice.token,
      "held-completed-bytes",
      "pending.txt",
      "",
      "hold-success",
    );
    expect(
      await deadline(reached, "successful R2 put completed and held before finalization"),
    ).toBe(true);
    const rows = await f.accounts.matrixRows(),
      row = rows.find((r: any) => r.filename === "pending.txt");
    expect(row).toMatchObject({ owner_id: alice.id, size: 20, storage_kind: "r2" });
    expect((await f.accounts.matrixStates()).find((x: any) => x.id === row.id)).toMatchObject({
      upload_state: "pending",
    });
    expect(await (await bucket.get(row.object_key ?? row.id))!.text()).toBe("held-completed-bytes");
    expect((await f.request(`/media/${row.id}`, alice.token)).status).toBe(404);
    expect((await f.request(`/media/${row.id}`, bob.token)).status).toBe(404);
    // This calls the actual DO RPC directly from the fixture, never exposing it through HTTP.
    await f.accounts.rollbackMediaReservation(row.id, bob.id);
    await f.accounts.rollbackMediaReservation(ownFile.id, alice.id);
    await f.accounts.rollbackMediaReservation(otherFile.id, bob.id);
    expect(await f.accounts.matrixRows()).toEqual(rows);
    expect(await (await bucket.get(row.object_key ?? row.id))!.text()).toBe("held-completed-bytes");
    expect(await (await f.request(ownFile.url, alice.token)).text()).toBe("alice-ready-data");
    expect(await (await f.request(otherFile.url, bob.token)).text()).toBe("bob-ready-data");
    expect((await f.request("/api/v1/auth/logout", alice.token, "POST")).status).toBe(200);
    expect((await f.request("/api/v1/profiles/alice", alice.token)).status).toBe(401);
    await f.putGate.releaseGate();
    const result = await deadline(pending, "upload finalization after logout");
    expect(result.status).toBe(403);
    expect(await f.accounts.matrixRows()).toEqual(before);
    expect(await bucket.get(row.object_key ?? row.id)).toBeNull();
    expect(await (await f.request(otherFile.url, bob.token)).text()).toBe("bob-ready-data");
    await watcher.barrier("publication-after");
    for (const [i, events] of watcher.received.entries())
      expect(events.slice(eventsStart[i]).join("\n")).not.toMatch(
        new RegExp(`pending.txt|held-completed-bytes|${row.id}`),
      );
    for (const [i, client] of [b, c].entries())
      expect(client.lines.slice(ircStart[i]).join("\n")).not.toMatch(
        new RegExp(`pending.txt|held-completed-bytes|${row.id}`),
      );
  } finally {
    watcher?.close();
    await f.dispose();
  }
}, 15000);
