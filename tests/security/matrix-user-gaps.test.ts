import { describe, expect, it } from "vitest";
import { createMatrixFixture } from "../helpers/matrix-fixture";

describe("matrix user gaps", () => {
  it("rejects profile writes from disabled existing sessions and preserves other accounts across restart", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const second = await f.login("alice", alice.password);
      const bob = await f.createActor("bob");
      expect(
        (
          await f.request("/api/v1/profiles/alice", alice, "PATCH", {
            displayName: "Alice Before",
            avatar: "alice-avatar",
            customStatus: "alice-status",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request("/api/v1/profiles/bob", bob, "PATCH", {
            displayName: "Bob Safe",
            avatar: "bob-avatar",
            customStatus: "bob-status",
          })
        ).status,
      ).toBe(200);
      const a = await f.connect(alice);
      const observer = await f.connect(bob);
      observer.send("CAP REQ :draft/metadata-3");
      await observer.waitForLine(
        (line) =>
          line.includes(" CAP ") && line.includes(" ACK ") && line.includes("draft/metadata-3"),
      );
      observer.send("METADATA * SUB *");
      await observer.waitForLine((line) => line.includes(" 770 "));
      a.send("JOIN #disabledprofile");
      await a.waitForLine((line) => line.includes(" 366 ") && line.includes("#disabledprofile"));
      observer.send("JOIN #disabledprofile");
      await observer.waitForLine(
        (line) => line.includes(" 366 ") && line.includes("#disabledprofile"),
      );
      const aliceBefore = await (await f.request("/api/v1/profiles/alice", root)).json();
      const bobBefore = await (await f.request("/api/v1/profiles/bob", bob)).json();
      expect((await f.request("/admin/accounts/alice/disable", root, "POST")).status).toBe(200);
      await f.barrier(observer);
      const eventStart = observer.lines.length;
      for (const actor of [alice, second]) {
        expect(
          (
            await f.request("/api/v1/profiles/alice", actor, "PATCH", {
              displayName: "disabled-attack",
              avatar: "disabled-avatar",
              customStatus: "disabled-status",
            })
          ).status,
        ).toBe(401);
      }
      await f.barrier(observer);
      expect(observer.lines.slice(eventStart).join("\n")).not.toContain("disabled-");
      expect(await (await f.request("/api/v1/profiles/alice", root)).json()).toEqual(aliceBefore);
      expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(bobBefore);
      await f.stop();
      const rows = JSON.stringify(await f.snapshot("user_metadata"));
      expect(rows).toContain("Alice Before");
      expect(rows).toContain("Bob Safe");
      expect(rows).not.toContain("disabled-attack");
      expect(rows).not.toContain("disabled-avatar");
      expect(rows).not.toContain("disabled-status");
      await f.restart();
      const freshRoot = await f.login("rootadmin", root.password);
      const freshBob = await f.login("bob", bob.password);
      expect(await (await f.request("/api/v1/profiles/alice", freshRoot)).json()).toEqual(
        aliceBefore,
      );
      expect(await (await f.request("/api/v1/profiles/bob", freshBob)).json()).toEqual(bobBefore);
    } finally {
      await f.dispose();
    }
  });

  it("filters non-profile account metadata and credentials from cross-user profile readback after restart", async () => {
    const f = await createMatrixFixture();
    try {
      const root = await f.createActor("rootadmin", true);
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const secret = "private-profile-sentinel";
      expect(
        (
          await f.request("/admin/metadata/users/bob", root, "PUT", {
            key: "private-note",
            value: secret,
          })
        ).status,
      ).toBe(200);
      expect(
        (await f.request("/api/v1/profiles/bob", bob, "PATCH", { displayName: "Bob Public" }))
          .status,
      ).toBe(200);
      const read = async (actor: typeof alice) => {
        const response = await f.request("/api/v1/profiles/bob", actor);
        expect(response.status).toBe(200);
        const data = (await response.json()) as any;
        expect(data.profile.displayName).toBe("Bob Public");
        const text = JSON.stringify(data);
        expect(text).not.toContain(secret);
        expect(text).not.toContain("private-note");
        expect(text).not.toContain(bob.password);
        expect(text).not.toMatch(/password|stored.?key|server.?key|scram/i);
      };
      await read(alice);
      await f.stop();
      expect(JSON.stringify(await f.snapshot("user_metadata"))).toContain(secret);
      await f.restart();
      await read(await f.login("alice", alice.password));
      expect((await f.login("bob", bob.password)).account.id).toBe(bob.account.id);
    } finally {
      await f.dispose();
    }
  });

  it("delivers REST profile updates to subscribed shared-channel IRC peers", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice");
      const bob = await f.createActor("bob");
      const charlie = await f.createActor("charlie");
      const dave = await f.createActor("dave");
      const a = await f.connect(alice);
      const b = await f.connect(bob);
      const otherDevice = await f.connect(alice, "alicealt");
      const outsider = await f.connect(charlie);
      const unsubscribed = await f.connect(dave);
      for (const client of [otherDevice, outsider]) {
        client.send("CAP REQ :draft/metadata-3");
        await client.waitForLine(
          (line) =>
            line.includes(" CAP ") && line.includes(" ACK ") && line.includes("draft/metadata-3"),
        );
        client.send("METADATA * SUB display-name avatar custom-status");
        await client.waitForLine((line) => line.includes(" 770 ") && line.includes("display-name"));
      }
      unsubscribed.send("CAP REQ :draft/metadata-3");
      await unsubscribed.waitForLine(
        (line) =>
          line.includes(" CAP ") && line.includes(" ACK ") && line.includes("draft/metadata-3"),
      );
      b.send("CAP REQ :draft/metadata-3");
      await b.waitForLine(
        (line) =>
          line.includes(" CAP ") && line.includes(" ACK ") && line.includes("draft/metadata-3"),
      );
      b.send("METADATA * SUB display-name avatar custom-status");
      await b.waitForLine((line) => line.includes(" 770 ") && line.includes("display-name"));
      a.send("JOIN #profilegaps");
      await a.waitForLine((line) => line.includes(" 366 ") && line.includes("#profilegaps"));
      b.send("JOIN #profilegaps");
      await b.waitForLine((line) => line.includes(" 366 ") && line.includes("#profilegaps"));
      unsubscribed.send("JOIN #profilegaps");
      await unsubscribed.waitForLine(
        (line) => line.includes(" 366 ") && line.includes("#profilegaps"),
      );
      const control = b.waitForNewLine(
        (line) => line.includes(" 761 ") && line.includes("irc-control"),
      );
      a.send("METADATA alice SET avatar :irc-control");
      await control;
      await f.barrier(b);
      await Promise.all([f.barrier(otherDevice), f.barrier(outsider), f.barrier(unsubscribed)]);
      const start = b.lines.length;
      const ownStart = otherDevice.lines.length;
      const outsideStart = outsider.lines.length;
      const unsubStart = unsubscribed.lines.length;
      expect(
        (
          await f.request("/api/v1/profiles/alice", alice, "PATCH", {
            displayName: "rest-display",
            avatar: "rest-avatar",
            customStatus: "rest-status",
          })
        ).status,
      ).toBe(200);
      const profile = (await (await f.request("/api/v1/profiles/alice", bob)).json()) as any;
      expect(profile.profile).toMatchObject({
        displayName: "rest-display",
        avatar: "rest-avatar",
        customStatus: "rest-status",
      });
      await f.barrier(b);
      const received = b.lines.slice(start).join("\n");
      expect(received).toContain("rest-display");
      expect(received).toContain("rest-avatar");
      expect(received).toContain("rest-status");
      await Promise.all([f.barrier(otherDevice), f.barrier(outsider), f.barrier(unsubscribed)]);
      expect(otherDevice.lines.slice(ownStart).join("\n")).toContain("rest-display");
      expect(outsider.lines.slice(outsideStart).join("\n")).not.toContain("rest-display");
      expect(unsubscribed.lines.slice(unsubStart).join("\n")).not.toContain("rest-display");
      const denyStart = b.lines.length;
      expect(
        (await f.request("/api/v1/profiles/alice", bob, "PATCH", { avatar: "denied-avatar" }))
          .status,
      ).toBe(403);
      await f.barrier(b);
      expect(b.lines.slice(denyStart).join("\n")).not.toContain("denied-avatar");
      expect(
        ((await (await f.request("/api/v1/profiles/alice", bob)).json()) as any).profile.avatar,
      ).toBe("rest-avatar");
      const cleared = b.waitForNewLine(
        (line) => line.includes(" 766 ") && line.includes("alice avatar"),
      );
      expect(
        (await f.request("/api/v1/profiles/alice", alice, "PATCH", { avatar: null })).status,
      ).toBe(200);
      await cleared;
      await f.stop();
      const metadata = JSON.stringify(await f.snapshot("user_metadata"));
      expect(metadata).toContain("rest-display");
      expect(metadata).not.toContain("rest-avatar");
      expect(metadata).not.toContain("denied-avatar");
      await f.restart();
      const freshBob = await f.login("bob", bob.password);
      const afterRestart = (await (
        await f.request("/api/v1/profiles/alice", freshBob)
      ).json()) as any;
      expect(afterRestart.profile).toMatchObject({
        displayName: "rest-display",
        avatar: null,
        customStatus: "rest-status",
      });
    } finally {
      await f.dispose();
    }
  });
});

for (const origin of ["REST", "IRC", "JOIN", "ADMIN"] as const) {
  for (const revoke of ["PART", "UNSUB"] as const) {
    it(`${origin} metadata delivery rechecks ${revoke} while outbound authorization is pending`, async () => {
      const { cp, mkdtemp, rm, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const { Miniflare } = await import("miniflare");
      const { ensureNitroBuilt, TestIRCClient } = await import("../helpers/miniflare-harness");
      const f = await createMatrixFixture();
      const dir = await mkdtemp(path.join(tmpdir(), "flarc-user-gap-gate-"));
      const clients: InstanceType<typeof TestIRCClient>[] = [];
      let mf: InstanceType<typeof Miniflare> | undefined;
      try {
        const root = await f.createActor("rootadmin", true);
        const alice = await f.createActor("alice");
        const bob = await f.createActor("bob");
        const charlie = await f.createActor("charlie");
        await f.stop();
        const bundle = await ensureNitroBuilt();
        await cp(path.dirname(bundle), path.join(dir, "production"), { recursive: true });
        await writeFile(
          path.join(dir, "wrapper.mjs"),
          `
export { default, ChannelDO } from './production/index.mjs';
import { AccountsDO as Original, SessionDO as OriginalSession } from './production/index.mjs';
export class SessionDO extends OriginalSession {
  unsubWaiters = [];
  saveAttachment(ws, attachment) {
    super.saveAttachment(ws, attachment);
    if (attachment.accountName === 'bob' && !(attachment.metadataSubs ?? []).includes('avatar')) {
      for (const resolve of this.unsubWaiters.splice(0)) resolve(true);
    }
  }
  waitUnsub() {
    const bob = [...this.sessionsById.values()].find(x => x.attachment.accountName === 'bob');
    return bob && !(bob.attachment.metadataSubs ?? []).includes('avatar') ? true : new Promise(resolve => this.unsubWaiters.push(resolve));
  }
}
export class AccountsDO extends Original {
  gate = false; reached = false; entered = []; release = null;
  arm() { this.gate = true; this.reached = false; }
  waitGate() { return this.reached ? true : new Promise(resolve => this.entered.push(resolve)); }
  releaseGate() { this.release?.(); }
  async getAccountByUsername(name) {
    if (this.gate && name.toLowerCase() === 'bob') {
      this.gate = false; this.reached = true;
      const wait = new Promise(resolve => { this.release = resolve; });
      for (const resolve of this.entered.splice(0)) resolve(true);
      await wait;
    }
    return super.getAccountByUsername(name);
  }
}
`,
        );
        mf = new Miniflare({
          modules: true,
          scriptPath: path.join(dir, "wrapper.mjs"),
          modulesRoot: dir,
          compatibilityDate: "2025-02-04",
          compatibilityFlags: ["nodejs_compat"],
          durableObjectsPersist: f.directory,
          bindings: { SIGNUP_POLICY: "open" },
          durableObjects: {
            SESSION: { className: "SessionDO", useSQLite: true },
            CHANNELS: { className: "ChannelDO", useSQLite: true },
            ACCOUNTS: { className: "AccountsDO", useSQLite: true },
          },
        });
        const url = await mf.ready;
        const namespace = await mf.getDurableObjectNamespace("ACCOUNTS");
        const gate = namespace.get(namespace.idFromName("FlaRC")) as any;
        const sessions = await mf.getDurableObjectNamespace("SESSION");
        const sessionControl = sessions.get(sessions.idFromName("FlaRC")) as any;
        const connect = async (actor: typeof alice, join = true) => {
          const client = new TestIRCClient(`ws://${url.host}/irc`);
          clients.push(client);
          await client.connect();
          client.send(`PASS ${actor.username}:${actor.password}`);
          await client.register(actor.username);
          client.send("CAP REQ :draft/metadata-3");
          await client.waitForLine((line) => line.includes(" CAP ") && line.includes(" ACK "));
          client.send("METADATA * SUB avatar");
          await client.waitForLine((line) => line.includes(" 770 ") && line.includes("avatar"));
          if (join) {
            client.send("JOIN #gateprofile");
            await client.waitForLine(
              (line) => line.includes(" 366 ") && line.includes("#gateprofile"),
            );
          }
          return client;
        };
        const a = await connect(alice, origin !== "JOIN");
        const b = await connect(bob);
        const c = await connect(charlie);
        const nonce = `held-${origin}-${revoke}`;
        if (origin === "JOIN") {
          a.send(`METADATA alice SET avatar :${nonce}`);
          await a.waitForLine((line) => line.includes(" 761 ") && line.includes(nonce));
        }
        await gate.arm();
        const start = b.lines.length;
        let pendingRest: Promise<Response> | undefined;
        if (origin === "REST") {
          pendingRest = fetch(new URL("/api/v1/profiles/alice", url), {
            method: "PATCH",
            headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ avatar: nonce }),
          });
        } else if (origin === "IRC") a.send(`METADATA alice SET avatar :${nonce}`);
        else if (origin === "JOIN") a.send("JOIN #gateprofile");
        else {
          const res = await fetch(new URL("/admin/metadata/channels/%23gateprofile", url), {
            method: "PUT",
            headers: { Authorization: `Bearer ${root.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ key: "avatar", value: nonce }),
          });
          expect(res.status).toBe(200);
        }
        await gate.waitGate();
        if (revoke === "PART") {
          const parted = a.waitForNewLine((line) => line.includes(" PART #gateprofile"));
          b.send("PART #gateprofile :leaving");
          await parted;
        } else {
          const unsubscribed = sessionControl.waitUnsub();
          b.send("METADATA * UNSUB avatar");
          await unsubscribed;
        }
        await gate.releaseGate();
        if (pendingRest) expect((await pendingRest).status).toBe(200);
        await c.waitForLine((line) => line.includes(" 761 ") && line.includes(nonce));
        const pong = b.waitForNewLine(
          (line) => line.includes(" PONG ") && line.includes("gate-barrier"),
        );
        b.send("PING :gate-barrier");
        await pong;
        expect(b.lines.slice(start).join("\n")).not.toContain(nonce);
      } finally {
        for (const client of clients) client.close();
        await mf?.dispose();
        await f.dispose();
        await rm(dir, { recursive: true, force: true });
      }
    }, 15000);
  }
}
