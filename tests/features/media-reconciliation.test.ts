import { expect, it } from "vitest";
import { createMediaRecoveryFixture } from "../helpers/media-recovery-fixture";

it("fences an expired upload and reaps a late provider write after runtime recreation", async () => {
  const f = await createMediaRecoveryFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob");
    const bucket = await f.runtime.mf.getR2Bucket("MEDIA_BUCKET");
    await bucket.put("unrelated-application/sentinel", "must-remain");
    const held = f.upload(alice.token, "late-provider-secret", "late.txt", "hold-before-write");
    await f.runtime.gate.waitReached();
    const row = (await f.runtime.accounts.recoveryRows()).find(
      (r: any) => r.filename === "late.txt",
    );
    expect(row).toMatchObject({ owner_id: alice.id, upload_state: "pending", size: 20 });
    expect(row.object_key).toBeTruthy();
    const ownerListing = await f.request("/api/v1/media?pending=1", alice.token);
    expect(ownerListing.status).toBe(200);
    expect(await ownerListing.text()).toContain(row.id);
    expect(await (await f.request("/api/v1/media?pending=1", bob.token)).text()).not.toContain(
      row.id,
    );
    await f.runtime.accounts.recoveryExpire(row.id);
    await f.runtime.accounts.recoveryRun();
    expect(await f.runtime.accounts.recoveryQuota(alice.id)).toBe(0);
    expect((await f.request(`/media/${row.id}`, alice.token)).status).toBe(404);
    expect(await bucket.get(row.object_key)).toBeNull();
    await f.runtime.gate.releaseGate();
    expect((await held).status).toBe(403);
    expect(await (await bucket.get(row.object_key))!.text()).toBe("late-provider-secret");
    await f.restart();
    await f.runtime.accounts.recoveryRun();
    const restored = await f.runtime.mf.getR2Bucket("MEDIA_BUCKET");
    expect(await restored.get(row.object_key)).toBeNull();
    expect(await (await restored.get("unrelated-application/sentinel"))!.text()).toBe(
      "must-remain",
    );
    expect(await f.runtime.accounts.recoveryQuota(alice.id)).toBe(0);
    expect((await f.request(`/media/${row.id}`, bob.token)).status).toBe(404);
  } finally {
    await f.dispose();
  }
}, 45000);

it("retries provider deletion failure without exposing expired bytes or harming another upload", async () => {
  const f = await createMediaRecoveryFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob");
    const ready = await f.upload(bob.token, "healthy-independent", "healthy.txt");
    expect(ready.status).toBe(201);
    const good = (await ready.json()) as { url: string };
    const held = f.upload(alice.token, "failed-delete-secret", "failed.txt", "write-hold");
    await f.runtime.gate.waitReached();
    const row = (await f.runtime.accounts.recoveryRows()).find(
      (r: any) => r.filename === "failed.txt",
    );
    await f.runtime.gate.setDeleteFailure(true);
    await f.runtime.accounts.recoveryExpire(row.id);
    await f.runtime.accounts.recoveryRun();
    expect(await f.runtime.accounts.recoveryQuota(alice.id)).toBe(0);
    expect((await f.request(`/media/${row.id}`, alice.token)).status).toBe(404);
    expect(await (await f.request(good.url, bob.token)).text()).toBe("healthy-independent");
    const bucket = await f.runtime.mf.getR2Bucket("MEDIA_BUCKET");
    expect(await (await bucket.get(row.object_key))!.text()).toBe("failed-delete-secret");
    await f.runtime.gate.releaseGate();
    expect((await held).status).toBe(403);
    await f.runtime.gate.setDeleteFailure(false);
    await f.restart();
    await f.runtime.accounts.recoveryRun();
    expect(await (await f.runtime.mf.getR2Bucket("MEDIA_BUCKET")).get(row.object_key)).toBeNull();
    expect(await (await f.request(good.url, bob.token)).text()).toBe("healthy-independent");
  } finally {
    await f.dispose();
  }
}, 45000);
