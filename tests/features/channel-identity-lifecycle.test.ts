import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import type { ChannelDO } from "../../server/durable-objects/channel";
import { createMatrixFixture, json, stream } from "./helpers/session-features";
import { liveRows } from "./helpers/shards-backpressure";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
async function channelStub(f: Fixture, channel: string) {
  const namespace = await f.server.mf.getDurableObjectNamespace("CHANNELS");
  const stub = namespace.get(namespace.idFromName(`FlaRC:${channel}`)) as unknown as Pick<
    ChannelDO,
    | "clientRequest"
    | "clientRequestWithHash"
    | "getExistingChannelGeneration"
    | "getChannelGeneration"
    | "adminRequest"
  >;
  return { stub };
}

/** Preserve real authorization and mutations; only serialize thrown RPC errors
 * before Miniflare's Node proxy can replace them with a transport assertion. */
async function channelProbeFixture() {
  const original = process.env.FLARC_TEST_BUNDLE;
  if (!original) throw new Error("A frozen production bundle is required");
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-channel-identity-probe-"));
  await cp(path.dirname(original), path.join(directory, "production"), { recursive: true });
  const wrapper = path.join(directory, "wrapper.mjs");
  await writeFile(
    wrapper,
    `
export {default,SessionDO,AccountsDO} from './production/index.mjs';
import {ChannelDO as Channel} from './production/index.mjs';
export class ChannelDO extends Channel {
  async testChannelRequest(kind,...args) {
    try {
      const value=kind==='generation'?super.getChannelGeneration(...args):
        kind==='hash'?await super.clientRequestWithHash(...args):await super.clientRequest(...args);
      return {ok:true,value};
    } catch(error) {return {ok:false,error:String(error?.message??error)}}
  }
}
`,
  );
  process.env.FLARC_TEST_BUNDLE = wrapper;
  try {
    const fixture = await createMatrixFixture();
    return {
      fixture,
      async probe(channel: string, kind: string, ...args: unknown[]) {
        const { stub } = await channelStub(fixture, channel);
        const value = await (
          stub as unknown as {
            testChannelRequest(kind: string, ...args: unknown[]): Promise<unknown>;
          }
        ).testChannelRequest(kind, ...args);
        return JSON.parse(JSON.stringify(value));
      },
      async dispose() {
        try {
          await fixture.dispose();
        } finally {
          process.env.FLARC_TEST_BUNDLE = original;
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    process.env.FLARC_TEST_BUNDLE = original;
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
async function channelState(f: Fixture) {
  const tables = [
    "channel_metadata",
    "channel_kv_metadata",
    "channel_role_groups",
    "channel_members",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (await liveRows(f, table))
          .flat()
          .map((row) => JSON.stringify(row))
          .sort(),
      ]),
    ),
  );
}

it("authorized role creation before JOIN binds the actual channel namespace and publishes the committed event", async () => {
  const f = await createMatrixFixture();
  let events: Awaited<ReturnType<typeof stream>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true);
    events = await stream(f, root);
    const created = await json(
      f,
      "/api/v1/channels/%23gaming/roles",
      root,
      "POST",
      {
        name: "BeforeJoin",
        permissions: ["send_messages"],
      },
      201,
    );
    const metadata = (await liveRows(f, "channel_metadata")).map((rows) =>
      Object.fromEntries(rows.map((row: any) => [row.key, row.value])),
    );
    expect(metadata).toContainEqual(
      expect.objectContaining({ name: "#gaming", canonical_name: "#gaming" }),
    );
    expect(metadata.some((row) => row.name === "#unknown")).toBe(false);
    expect((await liveRows(f, "channel_members")).flat()).toEqual([]);
    const event = await events.until(
      (item) => item.type === "channel.role_created" && item.data.roleGroupId === created.role.id,
    );
    expect(event.data).toMatchObject({ channel: "#gaming", name: "BeforeJoin" });
    events.close();
    await f.stop();
    expect((await f.snapshot("channel_role_groups")).flat()).toContainEqual(
      expect.objectContaining({ id: created.role.id, name: "BeforeJoin" }),
    );
    const persisted = (await f.snapshot("channel_metadata")).flat() as any[];
    expect(persisted.filter((row) => row.key === "canonical_name").map((row) => row.value)).toEqual(
      ["#gaming"],
    );
  } finally {
    events?.close();
    await f.dispose();
  }
}, 20000);

it("denied channel role requests leave identity, roles and metadata unchanged across token and hash facades", async () => {
  const probed = await channelProbeFixture(),
    f = probed.fixture;
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice");
    const { stub } = await channelStub(f, "#denied");
    expect(await stub.getExistingChannelGeneration()).toBeNull();
    // Constructor schema bookkeeping exists before the request; no domain
    // identity, custom metadata or role may be added by any denied caller.
    const before = await channelState(f);
    expect(
      (await liveRows(f, "channel_metadata"))
        .flat()
        .filter((row: any) => row.key !== "fts_integrity_version"),
    ).toEqual([]);
    expect(
      (await f.request("/api/v1/channels/%23denied/roles", alice, "POST", { name: "DeniedHTTP" }))
        .status,
    ).toBe(403);
    expect(
      await probed.probe("#denied", "token", alice.token, "role.create", {
        channelName: "#denied",
        group: { name: "DeniedRPC" },
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/management denied|founder/i) });
    const hash = createHash("sha256").update(alice.token).digest("hex");
    expect(
      await probed.probe("#denied", "hash", hash, "role.create", {
        channelName: "#denied",
        group: { name: "DeniedHash" },
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/management denied|founder/i) });
    expect(
      await probed.probe("#denied", "token", "invalid-session", "role.create", {
        channelName: "#denied",
        group: { name: "Anonymous" },
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Authentication required/) });
    const credential = (
      await json(f, "/api/v1/auth/credentials", root, "POST", {
        label: "no-channel-management",
        expiresAt: Date.now() + 60000,
        scopes: [{ operation: "profile.get", resource: "rootadmin" }],
      })
    ).credential;
    expect(
      await probed.probe("#denied", "token", credential.token, "role.create", {
        channelName: "#denied",
        group: { name: "DeniedScope" },
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/access denied/i) });
    expect(await channelState(f)).toEqual(before);
  } finally {
    await probed.dispose();
  }
}, 20000);

it("channel names cannot rebind initialized or uninitialized objects and stale generations do not mutate roles", async () => {
  const probed = await channelProbeFixture(),
    f = probed.fixture;
  try {
    const root = await f.createActor("rootadmin", true);
    await json(f, "/api/v1/channels/%23bound/roles", root, "POST", { name: "Original" }, 201);
    const { stub: empty } = await channelStub(f, "#empty");
    await empty.getExistingChannelGeneration();
    const before = await channelState(f),
      group = { name: "MustNotExist" };
    expect(
      await probed.probe("#bound", "token", root.token, "role.create", {
        channelName: "#other",
        group,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/access denied/i) });
    expect(await probed.probe("#bound", "generation", "#other")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/access denied/i),
    });
    expect(
      await probed.probe("#empty", "token", root.token, "role.create", {
        channelName: "#other",
        group,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/access denied/i) });
    expect(
      await probed.probe("#empty", "token", root.token, "role.create", { group }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/identity required/i) });
    expect(
      await probed.probe("#bound", "token", root.token, "role.create", {
        channelName: "#bound",
        expectedGeneration: crypto.randomUUID(),
        group,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/generation changed/i) });
    expect(await channelState(f)).toEqual(before);
  } finally {
    await probed.dispose();
  }
}, 20000);

async function expireArchivedMessage(
  directory: string,
  channel: string,
  id: string,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await expireArchivedMessage(file, channel, id);
    } else if (entry.name.endsWith(".sqlite")) {
      const db = new DatabaseSync(file);
      try {
        if (
          !db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='channel_archived_messages'",
            )
            .get()
        )
          continue;
        const name = db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as
          | { value: string }
          | undefined;
        if (name?.value === channel) {
          expect(
            db
              .prepare(
                "UPDATE channel_archived_messages SET expires_at=0,payload=json_set(payload,'$.expires_at',0) WHERE id=?",
              )
              .run(id).changes,
          ).toBe(1);
        }
      } finally {
        db.close();
      }
    }
  }
}

it("uninitialized admin channel reads preserve the requested namespace and denied routes establish no identity", async () => {
  const f = await createMatrixFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      bob = await f.createActor("bob");
    expect((await f.request("/admin/channels/%23unseen", bob)).status).toBe(403);
    expect((await liveRows(f, "channel_metadata")).flat()).toEqual([]);
    const full = await json(f, "/admin/channels/%23unseen", root);
    expect(full.channel).toMatchObject({ name: "#unseen", canonicalName: "#unseen" });
    const info = await json(f, "/api/v1/admin/channels/%23unseen/info", root);
    expect(info.channel).toMatchObject({ channel: "#unseen", canonicalName: "#unseen" });
    expect((await json(f, "/admin/channels/%23unseen/messages", root)).messages).toEqual([]);
    expect(
      (await liveRows(f, "channel_metadata"))
        .flat()
        .filter((row: any) => row.key === "canonical_name")
        .map((row: any) => row.value),
    ).toEqual(["#unseen"]);
  } finally {
    await f.dispose();
  }
}, 20000);

it("scoped administrators read only the current retained channel archive with bounded pagination, redaction and expiry", async () => {
  const f = await createMatrixFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const firstGeneration = (
      await json(
        f,
        "/api/v1/channels",
        alice,
        "POST",
        { name: "#retained", privacy: "secret" },
        201,
      )
    ).generation;
    const route = "/api/v1/channels/%23retained/messages",
      adminRoute = "/admin/channels/%23retained/messages";
    const first = (await json(f, route, alice, "POST", { content: "retained-one" }, 201)).message;
    const second = (await json(f, route, alice, "POST", { content: "retained-two" }, 201)).message;
    const redacted = (await json(f, route, alice, "POST", { content: "must-stay-scrubbed" }, 201))
      .message;
    await json(f, `${route}/${redacted.id}`, alice, "DELETE");
    await json(f, "/admin/channels/%23retained", root, "DELETE", { purgeMessages: false });
    const credential = (
      await json(f, "/api/v1/auth/credentials", root, "POST", {
        label: "retained-channel-reader",
        expiresAt: Date.now() + 60000,
        scopes: [
          { operation: "rest.get", resource: "*" },
          { operation: "admin.route.channels.get", resource: "#retained" },
          { operation: "admin.rpc.getmessagesforadmin", resource: "#retained" },
        ],
      })
    ).credential;
    const scoped = { ...root, token: credential.token };
    const retained = (await json(f, adminRoute, scoped)).messages;
    expect(retained.map((item: any) => item.id)).toEqual([redacted.id, second.id, first.id]);
    expect(retained.find((item: any) => item.id === redacted.id)).toMatchObject({
      redacted: true,
      content: "",
    });
    expect(JSON.stringify(retained)).not.toContain("must-stay-scrubbed");
    expect(
      (await json(f, `${adminRoute}?before=${second.id}`, scoped)).messages.map(
        (item: any) => item.id,
      ),
    ).toEqual([first.id]);
    expect(
      (await json(f, `${adminRoute}?after=${first.id}&limit=1`, scoped)).messages,
    ).toHaveLength(1);
    const { stub } = await channelStub(f, "#retained");
    const around = await stub.adminRequest(root.token, "getMessagesForAdmin", [
      1,
      undefined,
      undefined,
      second.id,
    ]);
    expect(around).toEqual([expect.objectContaining({ id: second.id })]);
    for (const ordinary of [alice, bob]) {
      expect((await f.request(adminRoute, ordinary)).status).toBe(403);
      expect((await f.request(route, ordinary)).status).toBe(403);
    }
    expect((await f.request("/admin/channels/%23other/messages", scoped)).status).toBe(403);
    await f.stop();
    await expireArchivedMessage(f.directory, "#retained", first.id);
    await f.restart();
    expect((await json(f, adminRoute, scoped)).messages.map((item: any) => item.id)).not.toContain(
      first.id,
    );
    const recreated = await json(
      f,
      "/api/v1/channels",
      bob,
      "POST",
      { name: "#retained", privacy: "secret" },
      201,
    );
    expect(recreated.generation).not.toBe(firstGeneration);
    expect((await json(f, route, bob)).messages).toEqual([]);
    expect((await json(f, adminRoute, scoped)).messages).toEqual([]);
    expect((await liveRows(f, "channel_archived_messages")).flat()).toContainEqual(
      expect.objectContaining({ generation: firstGeneration, id: second.id }),
    );
  } finally {
    await f.dispose();
  }
}, 30000);
