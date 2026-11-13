import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMediaRecoveryFixture } from "../helpers/media-recovery-fixture";

type Fixture = Awaited<ReturnType<typeof createMediaRecoveryFixture>>;
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
async function watch(
  f: Fixture,
  users: { token: string; username: string; password: string; id: string }[],
) {
  const clients = await Promise.all(users.map((u) => f.connect(u))),
    sockets: WebSocket[] = [],
    received: string[][] = users.map(() => []);
  try {
    for (const c of clients) {
      const done = c.waitForNewLine((l) => l.includes(" 366 ") && l.includes("#recoverywatch"));
      c.send("JOIN #recoverywatch");
      await done;
    }
    for (const [i, user] of users.entries()) {
      const t = await f.request("/api/v1/auth/events-ticket", user.token, "POST");
      expect(t.status).toBe(200);
      const ws = new WebSocket(
        `ws://${f.runtime.url.host}/api/v1/events?ticket=${((await t.json()) as any).ticket}`,
      );
      sockets.push(ws);
      ws.on("message", (data) => received[i].push(data.toString()));
      await deadline(
        new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        }),
        "event connection",
      );
    }
  } catch (error) {
    for (const ws of sockets) ws.terminate();
    throw error;
  }
  return {
    received,
    clients,
    close() {
      for (const ws of sockets) ws.terminate();
    },
    async barrier(marker: string) {
      const waits = sockets.map(
        (ws) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("missing barrier")), 4000);
            ws.on("message", function listener(data) {
              if (data.toString().includes(marker)) {
                clearTimeout(timer);
                ws.off("message", listener);
                resolve();
              }
            });
          }),
      );
      expect(
        (
          await f.request("/api/v1/channels/%23recoverywatch/messages", users[0].token, "POST", {
            content: marker,
          })
        ).status,
      ).toBe(201);
      await deadline(
        Promise.all([...waits, ...clients.map((c) => c.waitForLine((l) => l.includes(marker)))]),
        "live barrier",
      );
    },
  };
}
async function pendingChecks(
  f: Fixture,
  alice: { token: string; id: string },
  bob: { token: string },
  id: string,
  body: string,
  ready: any,
  expectedQuota: number,
) {
  const rows = await f.runtime.accounts.recoveryRows();
  expect(rows.find((x: any) => x.id === id)).toMatchObject({
    owner_id: alice.id,
    upload_state: "pending",
    size: body.length,
    storage_kind: "r2",
  });
  expect(await f.runtime.accounts.recoveryQuota(alice.id)).toBe(expectedQuota);
  const bucket = await f.runtime.mf.getR2Bucket("MEDIA_BUCKET");
  const row = rows.find((x: any) => x.id === id);
  expect(await (await bucket.get(row.object_key ?? id))!.text()).toBe(body);
  expect((await f.request(`/media/${id}`, alice.token)).status).toBe(404);
  expect((await f.request(`/media/${id}`, bob.token)).status).toBe(404);
  expect(await (await f.request(ready.url, bob.token)).text()).toBe("unrelated-ready-bytes");
  return rows;
}

it("[MEDIA-009 MEDIA-012 DB-025] failed provider cleanup leaves inaccessible orphan bytes until automatic reconciliation", async () => {
  const f = await createMediaRecoveryFixture();
  let observer: Awaited<ReturnType<typeof watch>> | undefined;
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    observer = await watch(f, [bob, charlie]);
    await observer.barrier("failure-before");
    const starts = observer.received.map((x) => x.length);
    const own = await f.upload(alice.token, "alice-ready", "own.txt");
    expect(own.status).toBe(201);
    const ownFile = (await own.json()) as any;
    const readyRes = await f.upload(bob.token, "unrelated-ready-bytes", "other.txt");
    expect(readyRes.status).toBe(201);
    const ready = (await readyRes.json()) as any;
    await f.runtime.gate.setDeleteFailure(true);
    const failure = await f.upload(
      alice.token,
      "provider-failed-body",
      "provider-failed.txt",
      "write-fail",
    );
    expect(failure.status).toBe(503);
    const error = await failure.text();
    expect(error).not.toMatch(/test provider|test put|stack|sqlite/i);
    const pending = JSON.parse(JSON.stringify(await f.runtime.gate.reservation()));
    expect(pending).toBeTruthy();
    expect(error).not.toContain(pending.id);
    expect(pending).toMatchObject({
      owner_id: alice.id,
      upload_state: "pending",
      size: "provider-failed-body".length,
    });
    expect(
      (await f.runtime.accounts.recoveryRows()).some((row: any) => row.id === pending.id),
    ).toBe(false);
    expect(await f.runtime.accounts.recoveryQuota(alice.id)).toBe("alice-ready".length);
    expect(
      await (await (
        await f.runtime.mf.getR2Bucket("MEDIA_BUCKET")
      ).get(pending.object_key))!.text(),
    ).toBe("provider-failed-body");
    expect((await f.request(`/media/${pending.id}`, alice.token)).status).toBe(404);
    expect((await f.request(`/media/${pending.id}`, bob.token)).status).toBe(404);
    expect(await f.runtime.accounts.recoveryAlarm()).toBeGreaterThan(Date.now());
    await observer.barrier("failure-after");
    for (const [i, events] of observer.received.entries())
      expect(events.slice(starts[i]).join("\n")).not.toMatch(
        new RegExp(`provider-failed|${pending.id}`),
      );
    observer.close();
    observer = undefined;
    await f.restart();
    expect((await f.request(`/media/${pending.id}`, alice.token)).status).toBe(404);
    expect(
      await (await (
        await f.runtime.mf.getR2Bucket("MEDIA_BUCKET")
      ).get(pending.object_key))!.text(),
    ).toBe("provider-failed-body");
    expect(await f.runtime.accounts.recoveryAlarm()).toBeGreaterThan(Date.now());
    observer = await watch(f, [bob, charlie]);
    await observer.barrier("failure-after-restart");
    observer.close();
    observer = undefined;
    expect((await f.request(`/api/v1/media/${pending.id}`, bob.token, "DELETE")).status).toBe(404);
    await f.runtime.accounts.recoveryRun();
    expect((await f.runtime.accounts.recoveryRows()).some((x: any) => x.id === pending.id)).toBe(
      false,
    );
    expect(await f.runtime.accounts.recoveryQuota(alice.id)).toBe("alice-ready".length);
    expect(
      await (await f.runtime.mf.getR2Bucket("MEDIA_BUCKET")).get(pending.object_key),
    ).toBeNull();
    expect(await (await f.request(ownFile.url, alice.token)).text()).toBe("alice-ready");
    expect(await (await f.request(ready.url, bob.token)).text()).toBe("unrelated-ready-bytes");
  } finally {
    observer?.close();
    await f.dispose();
  }
}, 15000);

it("[MEDIA-009 MEDIA-012 DB-025] stopping workerd during a completed R2 put preserves inaccessible pending reservation until known-id deletion", async () => {
  const f = await createMediaRecoveryFixture();
  let observer: Awaited<ReturnType<typeof watch>> | undefined;
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    observer = await watch(f, [bob, charlie]);
    await observer.barrier("crash-before");
    const starts = observer.received.map((x) => x.length);
    const own = await f.upload(alice.token, "alice-ready", "own.txt");
    expect(own.status).toBe(201);
    const ownFile = (await own.json()) as any;
    const readyRes = await f.upload(bob.token, "unrelated-ready-bytes", "other.txt");
    expect(readyRes.status).toBe(201);
    const ready = (await readyRes.json()) as any;
    const reached = f.runtime.gate.waitReached();
    const pendingRequest = f
      .upload(alice.token, "completed-before-exit", "crash-pending.txt", "write-hold")
      .catch(() => null);
    expect(await deadline(reached, "completed put gate")).toBe(true);
    const pending = (await f.runtime.accounts.recoveryRows()).find(
      (x: any) => x.filename === "crash-pending.txt",
    );
    expect(pending).toBeTruthy();
    await pendingChecks(
      f,
      alice,
      bob,
      pending.id,
      "completed-before-exit",
      ready,
      "alice-ready".length + "completed-before-exit".length,
    );
    await observer.barrier("crash-held");
    for (const [i, events] of observer.received.entries())
      expect(events.slice(starts[i]).join("\n")).not.toMatch(
        new RegExp(`crash-pending|${pending.id}`),
      );
    observer.close();
    observer = undefined;
    await f.restart();
    const interrupted = await pendingRequest;
    expect(interrupted?.status).not.toBe(201);
    await pendingChecks(
      f,
      alice,
      bob,
      pending.id,
      "completed-before-exit",
      ready,
      "alice-ready".length + "completed-before-exit".length,
    );
    expect(await f.runtime.accounts.recoveryAlarm()).toBeGreaterThan(Date.now());
    observer = await watch(f, [bob, charlie]);
    await observer.barrier("crash-after-restart");
    observer.close();
    observer = undefined;
    const healthy = await f.upload(bob.token, "healthy-followup", "followup.txt");
    expect(healthy.status).toBe(201);
    await f.restart();
    await pendingChecks(
      f,
      alice,
      bob,
      pending.id,
      "completed-before-exit",
      ready,
      "alice-ready".length + "completed-before-exit".length,
    );
    expect((await f.request(`/api/v1/media/${pending.id}`, bob.token, "DELETE")).status).toBe(404);
    // This public deletion succeeds only because the test inspected the otherwise undisclosed opaque ID.
    expect((await f.request(`/api/v1/media/${pending.id}`, alice.token, "DELETE")).status).toBe(
      200,
    );
    expect((await f.runtime.accounts.recoveryRows()).some((x: any) => x.id === pending.id)).toBe(
      false,
    );
    expect(await f.runtime.accounts.recoveryQuota(alice.id)).toBe("alice-ready".length);
    expect(
      await (await f.runtime.mf.getR2Bucket("MEDIA_BUCKET")).get(pending.object_key),
    ).toBeNull();
    expect(await (await f.request(ownFile.url, alice.token)).text()).toBe("alice-ready");
    expect(await (await f.request(ready.url, bob.token)).text()).toBe("unrelated-ready-bytes");
  } finally {
    observer?.close();
    await f.dispose();
  }
}, 15000);
