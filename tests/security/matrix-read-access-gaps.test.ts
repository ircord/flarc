import { expect, it } from "vitest";
import { observedAuthFixture, sameProtected, wire } from "../helpers/auth-gap-fixture";

it("USER-001 CHAN-012: own profile and secret attachment reads are silent and survive recreation", async () => {
  const r = await observedAuthFixture();
  try {
    const dave = await r.f.create("dave");
    const d = await r.f.connect(dave);
    await wire(d, "JOIN #protected", / 366 .*#protected/);
    const fields = {
      displayName: "Alice Read Control",
      avatar: "alice-read-avatar",
      bio: "alice-read-bio",
    };
    expect((await r.f.request("/api/v1/profiles/alice", r.alice, "PATCH", fields)).status).toBe(
      200,
    );
    async function upload(token: string, target: string, filename: string, data: string) {
      return fetch(new URL(`/api/v1/media/upload?channel=${encodeURIComponent(target)}`, r.f.url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "text/plain",
          "x-filename": filename,
        },
        body: data,
      });
    }
    const secretBytes = "protected-attachment-bytes",
      filename = "private-attachment-sentinel.txt";
    const uploaded = await upload(r.bob.token, "#protected", filename, secretBytes);
    expect(uploaded.status).toBe(201);
    const media = (await uploaded.json()) as any;
    expect(media).toMatchObject({
      filename,
      size: secretBytes.length,
      mimeType: "text/plain",
      uploader: "bob",
    });
    const independentUpload = await upload(
      r.charlie.token,
      "#unrelated",
      "independent.txt",
      "independent-attachment-bytes",
    );
    expect(independentUpload.status).toBe(201);
    const independent = (await independentUpload.json()) as any;
    async function allowed(actor: typeof r.bob) {
      const response = await r.f.request(media.url, actor);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/plain");
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename*=UTF-8''${filename}`,
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const bytes = await response.text();
      expect(bytes).toBe(secretBytes);
      const length = response.headers.get("content-length");
      if (length !== null) expect(Number(length)).toBe(secretBytes.length);
    }
    await allowed(dave);
    await wire(d, "PART #protected :revoked", / PART #protected/);
    await r.flush();
    async function snapshot() {
      const protectedState = await r.f.snapshot();
      const extra: Record<string, any[]> = {};
      for (const table of ["user_metadata", "media_uploads", "media_upload_chunks"])
        extra[table] = (await r.f.rows(table))
          .flat()
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return { protectedState, extra };
    }
    const before = await snapshot();
    expect(before.extra.media_uploads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: media.id,
          filename,
          scope_kind: "channel",
          scope_target: "#protected",
          size: secretBytes.length,
        }),
        expect.objectContaining({
          id: independent.id,
          filename: "independent.txt",
          scope_kind: "channel",
          scope_target: "#unrelated",
        }),
      ]),
    );
    async function checks() {
      await r.silence(async () => {
        const profile = await r.f.request("/api/v1/profiles/alice", r.alice);
        expect(profile.status).toBe(200);
        expect(((await profile.json()) as any).profile).toMatchObject({
          username: "alice",
          ...fields,
        });
        const anonymous = await r.f.request("/api/v1/profiles/alice");
        expect(anonymous.status).toBe(401);
        expect(await anonymous.text()).not.toContain(fields.bio);
        await allowed(r.alice);
        await allowed(r.bob);
        for (const actor of [r.charlie, dave])
          for (const suffix of ["", "?download=1"]) {
            const denied = await r.f.request(`${media.url}${suffix}`, actor);
            expect(denied.status).toBe(404);
            expect(denied.headers.get("content-disposition")).toBeNull();
            expect(denied.headers.get("content-length")).not.toBe(String(secretBytes.length));
            const contents = JSON.stringify([...denied.headers]) + (await denied.text());
            for (const secret of [filename, secretBytes, media.id, "text/plain"])
              expect(contents).not.toContain(secret);
          }
        const other = await r.f.request(independent.url, r.charlie);
        expect(other.status).toBe(200);
        expect(other.headers.get("content-disposition")).toContain("independent.txt");
        expect(await other.text()).toBe("independent-attachment-bytes");
      });
    }
    for (let i = 0; i < 2; i++) {
      await r.resume();
      await checks();
      const after = await snapshot();
      sameProtected(before.protectedState, after.protectedState);
      expect(after.extra).toEqual(before.extra);
    }
  } finally {
    await r.dispose();
  }
}, 60000);
