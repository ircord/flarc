import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { MatrixActor } from "../helpers/matrix-fixture";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

describe("matrix role boundaries", () => {
  it("ROLE-001 ROLE-002 ROLE-003 ROLE-004 ROLE-022 ROLE-036: founder role mutation and cross-channel role IDs", async () => {
    const f = await createMatrixFixture();
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      a.send("JOIN #roles");
      await a.waitForNumeric(366);
      b.send("JOIN #roles");
      await b.waitForNumeric(366);
      c.send("JOIN #staff");
      await c.waitForNumeric(366);
      a.send("JOIN #staff");
      await a.waitForNewLine((l) => l.includes(" 366 ") && l.includes("#staff"));
      const roles = "/api/v1/channels/%23roles/roles",
        staff = "/api/v1/channels/%23staff/roles";
      expect(
        (
          await f.request("/api/v1/channels/%23roles/info", alice, "PATCH", {
            description: "founder-control",
          })
        ).status,
      ).toBe(200);
      const create = await f.request(roles, alice, "POST", {
        name: "Trusted",
        ircMode: "o",
        permissions: [],
      });
      expect(create.status).toBe(201);
      const id = ((await create.json()) as any).role.id;
      const assignment = { userId: bob.account.id, roleGroupId: id };
      expect((await f.request(roles, bob, "POST", { name: "forged", ircMode: "q" })).status).toBe(
        403,
      );
      expect((await f.request(`${roles}/assign`, bob, "POST", assignment)).status).toBe(403);
      const staffBefore = await (await f.request(staff, charlie)).text();
      const cross = await f.request(`${staff}/assign`, charlie, "POST", assignment);
      expect(cross.status).toBe(404);
      expect(await (await f.request(staff, charlie)).text()).toBe(staffBefore);
      expect((await f.request(`${roles}/assign`, alice, "POST", assignment)).status).toBe(200);
      b.send("MODE #roles +i");
      await b.waitForLine((l) => l.includes(" MODE #roles +i"));
      expect(
        (
          await f.request(`${roles}/assign`, alice, "POST", {
            ...assignment,
            remove: true,
          })
        ).status,
      ).toBe(200);
      b.send("MODE #roles -i");
      await b.waitForNumeric(482);
      expect((await f.request(`${roles}/${id}`, alice, "DELETE")).status).toBe(200);
      expect(await (await f.request(roles, alice)).text()).not.toContain('"name":"Trusted"');
      await f.stop();
      const rows = JSON.stringify(await f.snapshot("channel_role_groups"));
      expect(rows).not.toContain('"name":"forged"');
    } finally {
      await f.dispose();
    }
  });
  it("ROLE-014 ROLE-017 ROLE-018 ROLE-019 ROLE-020 ROLE-021 ROLE-023: rank and channel scope", async () => {
    const f = await createMatrixFixture();
    try {
      const founder = await f.createActor("founder"),
        operator = await f.createActor("operator"),
        voiced = await f.createActor("voiced"),
        member = await f.createActor("member"),
        alice = await f.createActor("alice");
      const owner = await f.connect(founder),
        op = await f.connect(operator),
        voice = await f.connect(voiced),
        m = await f.connect(member),
        a = await f.connect(alice);
      for (const x of [owner, op, voice, m]) {
        x.send("JOIN #moderated");
        await x.waitForNumeric(366);
      }
      a.send("JOIN #staff");
      await a.waitForNumeric(366);
      op.send("JOIN #staff");
      await op.waitForNewLine((l) => l.includes(" 366 ") && l.includes("#staff"));
      owner.send("MODE #moderated +mov operator voiced");
      await m.waitForLine((l) => l.includes(" MODE #moderated +mov"));
      const received = m.waitForNewLine((l) => l.includes("voice-control"));
      voice.send("PRIVMSG #moderated :voice-control");
      await received;
      m.send("PRIVMSG #moderated :member-forbidden");
      await m.waitForNumeric(404);
      voice.send("KICK #moderated member :forbidden");
      await voice.waitForNumeric(482);
      m.send("MODE #moderated -m");
      await m.waitForNumeric(482);
      op.send("MODE #moderated +q operator");
      await op.waitForNumeric(482);
      op.send("MODE #staff +i");
      await op.waitForNumeric(482);
      expect(
        (
          await f.request("/api/v1/channels/%23moderated/info", member, "PATCH", {
            description: "forbidden",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await f.request("/api/v1/channels/%23moderated/roles", operator, "POST", {
            name: "takeover",
            ircMode: "q",
          })
        ).status,
      ).toBe(403);
      await Promise.all([f.barrier(owner), f.barrier(m)]);
      expect(owner.lines.some((l) => l.includes("member-forbidden"))).toBe(false);
      expect(
        await (await f.request("/api/v1/channels/%23moderated/info", founder)).text(),
      ).not.toContain("forbidden");
    } finally {
      await f.dispose();
    }
  });
  it("ROLE-011 ROLE-012 ROLE-013 ROLE-015 ROLE-016: operator and halfop rank boundaries", async () => {
    const f = await createMatrixFixture();
    try {
      const founder = await f.createActor("founder"),
        admin = await f.createActor("chanadmin"),
        operator = await f.createActor("operator"),
        halfop = await f.createActor("halfop"),
        voiced = await f.createActor("voiced"),
        member = await f.createActor("member");
      const o = await f.connect(founder),
        a = await f.connect(admin),
        op = await f.connect(operator),
        h = await f.connect(halfop),
        v = await f.connect(voiced),
        m = await f.connect(member);
      for (const client of [o, a, op, h, v, m]) {
        client.send("JOIN #ranks");
        await client.waitForNumeric(366);
      }
      o.send("MODE #ranks +aohv chanadmin operator halfop voiced");
      await m.waitForLine((l) => l.includes(" MODE #ranks +aohv"));
      h.send("MODE #ranks +o halfop");
      await h.waitForNumeric(482);
      h.send("MODE #ranks -o operator");
      await h.waitForNumeric(482);
      op.send("MODE #ranks +m");
      await m.waitForLine((l) => l.includes(" MODE #ranks +m"));
      op.send("MODE #ranks +b $a:member");
      await m.waitForLine((l) => l.includes(" MODE #ranks +b"));
      op.send("KICK #ranks member :rank-control");
      await m.waitForLine((l) => l.includes(" KICK #ranks member"));
      m.send("JOIN #ranks");
      await m.waitForNumeric(474);
      await f.barrier(o);
      expect(
        o.lines.some(
          (l) => l.includes(" MODE #ranks +o halfop") || l.includes(" MODE #ranks -o operator"),
        ),
      ).toBe(false);
      expect((await f.request("/api/v1/channels/%23ranks/messages", member)).status).toBe(403);
      expect((await f.request("/api/v1/channels/%23ranks/info", admin)).status).toBe(200);
    } finally {
      await f.dispose();
    }
  });
});

// Local helpers intentionally live in this slice: no privileged fixture RPC or fake flags.
const rolePath = "/api/v1/channels/%23roles";
const staffPath = "/api/v1/channels/%23staff";
const rankNames = [
  "founder",
  "chanadmin",
  "operator",
  "halfop",
  "voiced",
  "member",
  "alice",
  "bob",
  "outsider",
] as const;
type Name = (typeof rankNames)[number];
type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
const behaviorTrace: Record<string, { routes: any[]; commands: any[] }> = {};
function trace() {
  return (behaviorTrace[expect.getState().currentTestName!] ??= { routes: [], commands: [] });
}
afterAll(() => {
  if (process.env.FLARC_ROLE_TRACE)
    writeFileSync(process.env.FLARC_ROLE_TRACE, JSON.stringify(behaviorTrace, null, 2));
});
async function irc(client: TestIRCClient, command: string, pattern: RegExp) {
  const reply = client.waitForNewLine((line) => pattern.test(line));
  client.send(command);
  const line = await reply;
  trace().commands.push({ command, response: line });
  return line;
}
async function join(client: TestIRCClient, channel: string) {
  await irc(client, `JOIN ${channel}`, new RegExp(` 366 .*${channel}`));
}
async function stream(f: Fixture, actor: MatrixActor) {
  const res = await f.request("/api/v1/auth/events-ticket", actor, "POST");
  expect(res.status).toBe(200);
  const { ticket } = (await res.json()) as any;
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`);
  const received: string[] = [];
  ws.on("message", (data) => received.push(data.toString()));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return {
    ws,
    received,
    until: (text: string) =>
      new Promise<void>((resolve, reject) => {
        if (received.some((v) => v.includes(text))) return resolve();
        const timer = setTimeout(() => {
          ws.off("message", listener);
          reject(new Error(`Missing event ${text}`));
        }, 3000);
        function listener(data: WebSocket.RawData) {
          if (data.toString().includes(text)) {
            clearTimeout(timer);
            ws.off("message", listener);
            resolve();
          }
        }
        ws.on("message", listener);
      }),
  };
}
async function roleRig() {
  const f = await createMatrixFixture();
  const request = f.request;
  f.request = async (...args: Parameters<typeof request>) => {
    const response = await request(...args);
    trace().routes.push({
      path: args[0],
      method: args[2] ?? "GET",
      actor: args[1]?.username ?? "anonymous",
      status: response.status,
    });
    return response;
  };
  const actors = {} as Record<Name, MatrixActor>;
  let clients = {} as Record<Name, TestIRCClient>;
  let streams: Awaited<ReturnType<typeof stream>>[] = [];
  async function connect() {
    clients = {} as Record<Name, TestIRCClient>;
    for (const name of rankNames) clients[name] = await f.connect(actors[name]);
    await join(clients.founder, "#roles");
    for (const name of rankNames.filter((n) => n !== "founder" && n !== "outsider"))
      await join(clients[name], "#roles");
    await join(clients.outsider, "#staff");
    await join(clients.alice, "#staff");
    for (const name of ["founder", "member", "outsider"] as const)
      await join(clients[name], "#markers");
    streams = [await stream(f, actors.member), await stream(f, actors.outsider)];
  }
  async function closeStreams() {
    for (const s of streams) s.ws.terminate();
    streams = [];
  }
  async function disk() {
    await closeStreams();
    await f.stop();
    const tables = [
      "channel_metadata",
      "channel_kv_metadata",
      "channel_permissions",
      "channel_role_groups",
      "channel_user_roles",
      "channel_bans",
      "channel_members",
      "messages",
    ];
    const metadata = (await f.snapshot("channel_metadata")) as any[][];
    const kvTables = (await f.snapshot("channel_kv_metadata")) as any[][];
    const roleTables = (await f.snapshot("channel_role_groups")) as any[][];
    const protectedIndices = metadata.flatMap((rows, index) =>
      rows.some((row) => row.key === "name" && ["#roles", "#staff", "#public"].includes(row.value))
        ? [index]
        : [],
    );
    const normalize = (table: string, rows: any[][]) =>
      protectedIndices
        .flatMap((index) => rows[index])
        .map((row) =>
          table === "channel_members"
            ? {
                user_id: row.user_id,
                account_name: row.account_name,
                nickname: row.nickname,
                modes: [...row.modes].sort().join(""),
                is_persistent: row.is_persistent,
              }
            : row,
        )
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const result: Record<string, any[]> = {};
    for (const table of tables)
      result[table] = normalize(table, (await f.snapshot(table)) as any[][]);
    // Reopen the same SQLite directory, independently read each registered channel,
    // then stop it again before comparing storage. No live sockets survive this boundary.
    await f.restart();
    for (const [index, rows] of metadata.entries()) {
      const meta = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      const kv = Object.fromEntries(kvTables[index].map((row) => [row.key, row.value]));
      const owner = actors[meta.founder as Name];
      if (!owner || meta.registered !== "1") continue;
      const path = `/api/v1/channels/${encodeURIComponent(meta.name)}`;
      const info = await f.request(`${path}/info`, owner);
      expect(info.status).toBe(200);
      expect(((await info.json()) as any).channel).toMatchObject({
        founder: meta.founder,
        modes: meta.modes,
        description: kv.description ?? null,
      });
      const roles = await f.request(`${path}/roles`, owner);
      expect(roles.status).toBe(200);
      expect(((await roles.json()) as any).roles.map((role: any) => role.id).sort()).toEqual(
        roleTables[index].map((role: any) => role.id).sort(),
      );
    }
    await f.stop();
    for (const table of tables)
      expect(normalize(table, (await f.snapshot(table)) as any[][]), `restart ${table}`).toEqual(
        result[table],
      );
    return result;
  }
  async function resume() {
    await f.restart();
    await connect();
  }
  async function flush() {
    const marker = `roles-barrier-${randomUUID()}`;
    expect(
      (
        await f.request("/api/v1/channels/%23markers/messages", actors.founder, "POST", {
          content: marker,
        })
      ).status,
    ).toBe(201);
    await Promise.all([
      streams[0].until(marker),
      streams[1].until(marker),
      f.barrier(clients.founder),
      f.barrier(clients.member),
      f.barrier(clients.outsider),
    ]);
    // The unrelated observer is connected and receiving markers, but sees no #roles payload.
    expect(streams[1].received.filter((line) => line.includes('"channelId":"#roles"'))).toEqual([]);
    expect(
      clients.outsider.lines.filter((line) => / (MODE|KICK|TOPIC|PRIVMSG) #roles /.test(line)),
    ).toEqual([]);
    expect
      .soft(
        clients.member.lines.filter((line) =>
          / (KICK|TOPIC|PRIVMSG) #roles .*forbidden/.test(line),
        ),
      )
      .toEqual([]);
    expect
      .soft(
        streams[0].received.filter(
          (line) => line.includes('"channelId":"#roles"') && line.includes("forbidden"),
        ),
      )
      .toEqual([]);
    expect(
      (await (await f.request(`${staffPath}/info`, actors.outsider)).json()) as any,
    ).toMatchObject({ channel: { description: "unrelated-staff-sentinel", founder: "outsider" } });
  }
  try {
    for (const name of rankNames) actors[name] = await f.createActor(name);
    await connect();
    await irc(clients.founder, "CS REGISTER #roles", /successfully registered|already registered/);
    await irc(clients.outsider, "CS REGISTER #staff", /successfully registered|already registered/);
    await irc(clients.founder, "MODE #roles +s", / MODE #roles \+s/);
    for (const [name, mode] of [
      ["chanadmin", "a"],
      ["operator", "o"],
      ["halfop", "h"],
      ["voiced", "v"],
      ["alice", "o"],
    ] as const)
      await irc(
        clients.founder,
        `CS AMODE #roles +${mode} ${name}`,
        new RegExp(` MODE #roles \\+${mode} ${name}`),
      );
    expect(
      (
        await f.request(`${staffPath}/info`, actors.outsider, "PATCH", {
          description: "unrelated-staff-sentinel",
        })
      ).status,
    ).toBe(200);
    return {
      f,
      actors,
      get c() {
        return clients;
      },
      get events() {
        return streams;
      },
      disk,
      resume,
      flush,
      async dispose() {
        await closeStreams();
        await f.dispose();
      },
    };
  } catch (error) {
    await closeStreams();
    await f.dispose();
    throw error;
  }
}
type Rig = Awaited<ReturnType<typeof roleRig>>;
async function createRole(
  r: Rig,
  name: string,
  ircMode: string | null = null,
  permissions: string[] = [],
) {
  const response = await r.f.request(`${rolePath}/roles`, r.actors.founder, "POST", {
    name,
    ircMode,
    permissions,
  });
  expect(response.status).toBe(201);
  const role = ((await response.json()) as any).role;
  await r.events[0].until(role.id);
  return role;
}
async function assign(r: Rig, id: string, name: Name = "bob", remove = false) {
  const response = await r.f.request(`${rolePath}/roles/assign`, r.actors.founder, "POST", {
    userId: r.actors[name].account.id,
    roleGroupId: id,
    remove,
  });
  expect(response.status).toBe(200);
}
async function deniedRest(
  r: Rig,
  path: string,
  name: Name,
  method: string,
  body?: unknown,
  status = 403,
) {
  await r.flush();
  const observerStart = r.c.member.lines.length;
  const eventStart = r.events[0].received.length;
  const response = await r.f.request(path, r.actors[name], method, body);
  expect(response.status).toBe(status);
  const data = (await response.json()) as any;
  expect(data.ok).not.toBe(true);
  expect(JSON.stringify(data)).not.toMatch(
    /unrelated-staff-sentinel|permissions_json|password_hash|scram|assignedAt/,
  );
  await r.flush();
  expect(
    r.c.member.lines
      .slice(observerStart)
      .filter((line) => / (MODE|KICK|TOPIC|PRIVMSG) #roles /.test(line)),
  ).toEqual([]);
  expect(
    r.events[0].received.slice(eventStart).filter((line) => line.includes('"channelId":"#roles"')),
  ).toEqual([]);
}
async function roleList(r: Rig) {
  return ((await (await r.f.request(`${rolePath}/roles`, r.actors.founder)).json()) as any).roles;
}
function assertSameProtected(before: Record<string, any[]>, after: Record<string, any[]>) {
  for (const table of [
    "channel_permissions",
    "channel_role_groups",
    "channel_user_roles",
    "channel_bans",
    "channel_metadata",
    "channel_kv_metadata",
    "channel_members",
    "messages",
  ])
    expect(after[table], table).toEqual(before[table]);
}

describe("matrix role hierarchy expanded", () => {
  it("ROLE-001 ROLE-002 ROLE-003 ROLE-004: founder settings and complete role CRUD persist with denied member controls", async () => {
    const r = await roleRig();
    try {
      const baseline = await r.disk();
      await r.resume();
      expect(
        (
          await r.f.request(`${rolePath}/info`, r.actors.founder, "PATCH", {
            description: "role-settings-control",
          })
        ).status,
      ).toBe(200);
      const role = await createRole(r, "Trusted", "o");
      expect(
        (
          await r.f.request(`${rolePath}/roles/${role.id}`, r.actors.founder, "PATCH", {
            name: "TrustedRenamed",
            color: "#abcdef",
          })
        ).status,
      ).toBe(200);
      await assign(r, role.id);
      await irc(r.c.bob, "MODE #roles +m", / MODE #roles \+m/);
      await deniedRest(r, `${rolePath}/roles`, "member", "POST", { name: "forbidden-role" });
      await deniedRest(r, `${rolePath}/roles/${role.id}`, "member", "PATCH", {
        name: "forbidden-rename",
      });
      await deniedRest(r, `${rolePath}/roles/assign`, "member", "POST", {
        userId: r.actors.member.account.id,
        roleGroupId: role.id,
      });
      await deniedRest(r, `${rolePath}/roles/${role.id}`, "member", "DELETE");
      await deniedRest(r, `${rolePath}/info`, "member", "PATCH", {
        description: "forbidden-settings",
      });
      await r.flush();
      const assigned = await r.disk();
      expect(assigned.channel_role_groups).toContainEqual(
        expect.objectContaining({
          id: role.id,
          name: "TrustedRenamed",
          color: "#abcdef",
          irc_mode: "o",
        }),
      );
      expect(assigned.channel_user_roles).toContainEqual(
        expect.objectContaining({ user_id: r.actors.bob.account.id, group_id: role.id }),
      );
      expect(assigned.channel_kv_metadata).toContainEqual(
        expect.objectContaining({ key: "description", value: "role-settings-control" }),
      );
      expect(assigned.channel_role_groups.some((x) => /forbidden/.test(x.name))).toBe(false);
      await r.resume();
      expect(await roleList(r)).toContainEqual(
        expect.objectContaining({ id: role.id, name: "TrustedRenamed" }),
      );
      await assign(r, role.id, "bob", true);
      await irc(r.c.bob, "MODE #roles -m", / 482 /);
      expect(
        (await r.f.request(`${rolePath}/roles/${role.id}`, r.actors.founder, "DELETE")).status,
      ).toBe(200);
      await r.flush();
      const deleted = await r.disk();
      expect(deleted.channel_role_groups).toEqual(baseline.channel_role_groups);
      expect(deleted.channel_user_roles).toEqual(baseline.channel_user_roles);
      await r.resume();
      expect(await roleList(r)).toEqual([]);
    } finally {
      await r.dispose();
    }
  });

  it("ROLE-005: founder configures F through authenticated service commands and an ordinary member cannot", async () => {
    const r = await roleRig();
    try {
      await irc(r.c.founder, "PRIVMSG F :UNREQUESTBOT #roles", /F has left #roles/);
      const before = await r.disk();
      await r.resume();
      await irc(
        r.c.member,
        "PRIVMSG F :REQUESTBOT #roles",
        /must be a channel operator or channel owner/,
      );
      await r.flush();
      const denied = await r.disk();
      assertSameProtected(before, denied);
      await r.resume();
      const delivered = r.c.member.waitForNewLine((line) => /:F!.* JOIN #roles/.test(line));
      await irc(r.c.founder, "PRIVMSG F :REQUESTBOT #roles", /F has joined #roles/);
      await delivered;
      await r.flush();
      const after = await r.disk();
      expect(after.channel_metadata).toContainEqual(
        expect.objectContaining({ key: "f_bot_enabled", value: "1" }),
      );
      await r.resume();
      await irc(r.c.member, "NAMES #roles", / 353 .*~F/);
    } finally {
      await r.dispose();
    }
  });

  it("ROLE-006 ROLE-007 ROLE-010: ownership rejects impersonation and administrator takeover and transfers only through ChanServ", async () => {
    const r = await roleRig();
    try {
      const before = await r.disk();
      await r.resume();
      for (const name of ["member", "chanadmin", "operator"] as const) {
        await irc(r.c[name], `CS TRANSFER #roles ${name}`, /Insufficient privileges/);
        await irc(r.c[name], "CS TRANSFER accept #roles", /Invalid channel transfer/);
        await irc(r.c[name], `MODE #roles +q ${name}`, / 482 /);
        await deniedRest(r, `${rolePath}/roles`, name, "POST", { name: "Founder", ircMode: "q" });
      }
      await r.flush();
      const rejected = await r.disk();
      assertSameProtected(before, rejected);
      await r.resume();
      const confirmation = await irc(
        r.c.founder,
        "CS TRANSFER #roles bob",
        /To confirm, run this command/,
      );
      const code = confirmation.match(/bob ([a-f0-9]{8})/)?.[1];
      expect(code).toBeTruthy();
      await irc(r.c.founder, "CS TRANSFER #roles bob wrong-code", /Invalid confirmation code/);
      expect(
        ((await (await r.f.request(`${rolePath}/info`, r.actors.founder)).json()) as any).channel
          .founder,
      ).toBe("founder");
      await irc(
        r.c.founder,
        `CS TRANSFER #roles bob ${code}`,
        /Successfully transferred channel #roles to account bob/,
      );
      await deniedRest(r, `${rolePath}/roles`, "founder", "POST", {
        name: "old-founder-forbidden",
      });
      expect(
        (
          await r.f.request(`${rolePath}/roles`, r.actors.bob, "POST", {
            name: "new-founder-control",
          })
        ).status,
      ).toBe(201);
      await r.flush();
      const after = await r.disk();
      expect(
        after.channel_permissions
          .filter((p) => p.permission === "q")
          .map((p) => p.user_id)
          .sort(),
      ).toEqual([r.actors.bob.account.id, r.actors.outsider.account.id].sort());
      expect(after.channel_metadata).toContainEqual(
        expect.objectContaining({ key: "founder", value: "bob" }),
      );
      await r.resume();
      expect(
        ((await (await r.f.request(`${rolePath}/info`, r.actors.bob)).json()) as any).channel
          .founder,
      ).toBe("bob");
      await deniedRest(r, `${rolePath}/roles`, "founder", "POST", {
        name: "restart-old-founder-forbidden",
      });
    } finally {
      await r.dispose();
    }
  });

  it("ROLE-006: only the designated account can accept a pending ChanServ ownership transfer", async () => {
    const r = await roleRig();
    try {
      await irc(r.c.founder, "CS TRANSFER #roles bob", /To confirm, run this command/);
      const before = await r.disk();
      await r.resume();
      await irc(r.c.member, "CS TRANSFER accept #roles", /Invalid channel transfer/);
      await r.flush();
      const rejected = await r.disk();
      assertSameProtected(before, rejected);
      await r.resume();
      await irc(
        r.c.bob,
        "CS TRANSFER accept #roles",
        /Successfully transferred channel #roles to account bob/,
      );
      await irc(r.c.member, "NAMES #roles", / 353 .*~bob/);
      await deniedRest(r, `${rolePath}/roles`, "founder", "POST", {
        name: "old-founder-forbidden",
      });
      expect(
        (
          await r.f.request(`${rolePath}/roles`, r.actors.bob, "POST", {
            name: "new-founder-control",
          })
        ).status,
      ).toBe(201);
      await r.flush();
      const after = await r.disk();
      expect(after.channel_metadata).toContainEqual(
        expect.objectContaining({ key: "founder", value: "bob" }),
      );
      expect(
        after.channel_permissions
          .filter((p) => p.permission === "q")
          .map((p) => p.user_id)
          .sort(),
      ).toEqual([r.actors.bob.account.id, r.actors.outsider.account.id].sort());
    } finally {
      await r.dispose();
    }
  });

  for (const [id, actor, operation] of [
    ["ROLE-008", "chanadmin", "kick"],
    ["ROLE-008", "chanadmin", "ban"],
    ["ROLE-008", "chanadmin", "mode"],
    ["ROLE-011", "operator", "kick"],
    ["ROLE-012", "operator", "ban"],
    ["ROLE-013", "operator", "mode"],
  ] as const)
    it(`${id}: ${actor} authorized ${operation} pairs with ordinary denial and durable channel isolation`, async () => {
      const r = await roleRig();
      try {
        const before = await r.disk();
        await r.resume();
        const command =
          operation === "kick"
            ? "KICK #roles bob :rank-control"
            : operation === "ban"
              ? "MODE #roles +b $a:bob"
              : "MODE #roles +m";
        await irc(r.c.member, command, / 482 /);
        await r.flush();
        const rejected = await r.disk();
        assertSameProtected(before, rejected);
        await r.resume();
        const pattern =
          operation === "kick"
            ? / KICK #roles bob/
            : operation === "ban"
              ? / MODE #roles \+b \$a:bob/
              : / MODE #roles \+m/;
        const recipient = r.c.member.waitForNewLine((line) => pattern.test(line));
        await irc(r.c[actor], command, pattern);
        await recipient;
        if (operation === "kick")
          await deniedRest(r, `${rolePath}/messages`, "bob", "POST", { content: "kicked-write" });
        if (operation === "ban") {
          await irc(r.c.bob, "PART #roles", / PART #roles/);
          await irc(r.c.bob, "JOIN #roles", / 474 /);
        }
        await r.flush();
        const after = await r.disk();
        expect(after.channel_role_groups).toEqual(before.channel_role_groups);
        expect(after.channel_user_roles).toEqual(before.channel_user_roles);
        expect(after.channel_permissions).toEqual(before.channel_permissions);
        if (operation === "ban")
          expect(after.channel_bans).toContainEqual(expect.objectContaining({ mask: "$a:bob" }));
        if (operation === "mode")
          expect(
            after.channel_metadata
              .filter((m) => m.key === "modes")
              .some((m) => m.value.includes("m")),
          ).toBe(true);
        await r.f.restart();
        const reader = await r.f.connect(r.actors.founder);
        await join(reader, "#roles");
        if (operation === "mode")
          expect(
            ((await (await r.f.request(`${rolePath}/info`, r.actors.founder)).json()) as any)
              .channel.modes,
          ).toContain("m");
        if (operation === "ban") {
          const bob = await r.f.connect(r.actors.bob);
          await irc(bob, "JOIN #roles", / 474 /);
        }
        if (operation === "kick")
          expect(
            (
              await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
                content: "restart-kicked-write",
              })
            ).status,
          ).toBe(403);
      } finally {
        await r.dispose();
      }
    });

  it("ROLE-009 ROLE-014 ROLE-016 ROLE-028: administrator operator halfop authority ceilings hold in REST MODE and ChanServ", async () => {
    const r = await roleRig();
    try {
      const role = await createRole(r, "Owner", "q", ["manage_channel"]);
      const before = await r.disk();
      await r.resume();
      for (const name of ["chanadmin", "operator", "halfop"] as const) {
        await irc(r.c[name], `MODE #roles +q ${name}`, / 482 /);
        await irc(r.c[name], `CS AMODE #roles +q ${name}`, /Only the founder/);
        await deniedRest(r, `${rolePath}/roles`, name, "POST", {
          name: "Owner",
          ircMode: "q",
          permissions: ["manage_channel"],
        });
        await deniedRest(r, `${rolePath}/roles/${role.id}`, name, "PATCH", { ircMode: "q" });
        await deniedRest(r, `${rolePath}/roles/assign`, name, "POST", {
          userId: r.actors[name].account.id,
          roleGroupId: role.id,
        });
      }
      await irc(r.c.halfop, "MODE #roles +o halfop", / 482 /);
      await irc(r.c.halfop, "CS AMODE #roles +o halfop", /Cannot change higher channel privileges/);
      await r.flush();
      const after = await r.disk();
      assertSameProtected(before, after);
      await r.resume();
      // Founder is the only channel actor allowed to grant +q role capabilities.
      await assign(r, role.id, "bob");
      await irc(r.c.bob, "MODE #roles +m", / MODE #roles \+m/);
      await r.flush();
      await r.disk();
    } finally {
      await r.dispose();
    }
  });

  for (const target of ["operator", "chanadmin", "founder"] as const)
    it(`ROLE-015: halfop cannot alter or kick ${target} but can kick an ordinary member`, async () => {
      const r = await roleRig();
      try {
        const before = await r.disk();
        await r.resume();
        await irc(r.c.halfop, `MODE #roles -o ${target}`, / 482 /);
        await irc(
          r.c.halfop,
          `CS AMODE #roles -o ${target}`,
          /Cannot change higher channel privileges/,
        );
        const start = r.c.member.lines.length,
          actorStart = r.c.halfop.lines.length;
        r.c.halfop.send(`KICK #roles ${target} :forbidden-higher-rank`);
        await r.f.barrier(r.c.halfop);
        await r.f.barrier(r.c.member);
        expect
          .soft(
            r.c.halfop.lines
              .slice(actorStart)
              .some((line) => / 482 /.test(line) && line.includes("#roles")),
          )
          .toBe(true);
        expect
          .soft(
            r.c.member.lines.slice(start).filter((line) => line.includes(` KICK #roles ${target}`)),
          )
          .toEqual([]);
        await r.flush();
        const rejected = await r.disk();
        assertSameProtected(before, rejected);
        await r.resume();
        const delivered = r.c.member.waitForNewLine((line) => line.includes(" KICK #roles bob"));
        await irc(r.c.halfop, "KICK #roles bob :permitted-lower-rank", / KICK #roles bob/);
        await delivered;
        await r.flush();
        const after = await r.disk();
        expect(after.channel_members.filter((m) => m.user_id === r.actors.bob.account.id)).toEqual(
          [],
        );
        expect(after.channel_permissions).toEqual(before.channel_permissions);
      } finally {
        await r.dispose();
      }
    });

  it("ROLE-026 ROLE-028: custom kick permission cannot modify higher-ranked members", async () => {
    const r = await roleRig();
    try {
      const role = await createRole(r, "Limited moderator", null, ["kick_members"]);
      await assign(r, role.id);
      const before = await r.disk();
      await r.resume();
      for (const target of ["voiced", "halfop", "operator", "chanadmin", "founder"] as const)
        await irc(r.c.bob, `KICK #roles ${target} :forbidden-custom-ceiling`, / 482 /);
      await r.flush();
      const rejected = await r.disk();
      assertSameProtected(before, rejected);
      await r.resume();
      const delivered = r.c.founder.waitForNewLine((line) => line.includes(" KICK #roles member"));
      await irc(r.c.bob, "KICK #roles member :permitted-equal-rank", / KICK #roles member/);
      await delivered;
      await r.flush();
      const after = await r.disk();
      expect(after.channel_members.filter((m) => m.user_id === r.actors.member.account.id)).toEqual(
        [],
      );
      expect(after.channel_user_roles).toEqual(before.channel_user_roles);
    } finally {
      await r.dispose();
    }
  });

  it("ROLE-017: Alice privileged in roles remains ordinary in staff through REST IRC and services", async () => {
    const r = await roleRig();
    try {
      await join(r.c.founder, "#public");
      await join(r.c.alice, "#public");
      await irc(r.c.founder, "MODE #public +o alice", / MODE #public \+o alice/);
      await irc(r.c.alice, "MODE #public +m", / MODE #public \+m/);
      await irc(r.c.alice, "MODE #roles +m", / MODE #roles \+m/);
      expect(
        (
          await r.f.request(`${rolePath}/info`, r.actors.alice, "PATCH", {
            description: "alice-local-control",
          })
        ).status,
      ).toBe(200);
      const before = await r.disk();
      await r.resume();
      await irc(r.c.alice, "MODE #staff +m", / 482 /);
      await irc(r.c.alice, "KICK #staff outsider :forbidden", / 482 /);
      await irc(r.c.alice, "CS AMODE #staff +o alice", /sufficient privileges/);
      await deniedRest(r, `${staffPath}/info`, "alice", "PATCH", {
        description: "cross-channel-forbidden",
      });
      await deniedRest(r, `${staffPath}/roles`, "alice", "POST", { name: "Owner", ircMode: "q" });
      await r.flush();
      const after = await r.disk();
      assertSameProtected(before, after);
      await r.resume();
      await irc(r.c.alice, "MODE #staff +m", / 482 /);
    } finally {
      await r.dispose();
    }
  });

  it("ROLE-018 ROLE-019 ROLE-020 ROLE-021 ROLE-022 ROLE-023 ROLE-024: voice permits speech only and member mutations remain denied", async () => {
    const r = await roleRig();
    try {
      await irc(r.c.founder, "MODE #roles +m", / MODE #roles \+m/);
      const role = await createRole(r, "Speaker", "v");
      const before = await r.disk();
      await r.resume();
      for (const name of ["voiced", "member"] as const) {
        await irc(r.c[name], "KICK #roles bob :forbidden-voice-kick", / 482 /);
        await irc(r.c[name], "MODE #roles +b $a:bob", / 482 /);
        await irc(r.c[name], "MODE #roles -m", / 482 /);
        await deniedRest(r, `${rolePath}/roles/assign`, name, "POST", {
          userId: r.actors[name].account.id,
          roleGroupId: role.id,
        });
        await deniedRest(r, `${rolePath}/roles`, name, "POST", { name: "SelfVoice", ircMode: "v" });
        await deniedRest(r, `${rolePath}/info`, name, "PATCH", {
          description: "forbidden-member-metadata",
        });
      }
      await irc(r.c.member, "PRIVMSG #roles :forbidden-member-irc", / 404 /);
      const denied = await r.f.request(`${rolePath}/messages`, r.actors.member, "POST", {
        content: "forbidden-member-rest",
      });
      expect(denied.status).toBe(400);
      expect(await denied.text()).toMatch(/moderated|Cannot send/i);
      await r.flush();
      const rejected = await r.disk();
      assertSameProtected(before, rejected);
      await r.resume();
      const event = r.events[0].until("voiced-rest-control");
      expect(
        (
          await r.f.request(`${rolePath}/messages`, r.actors.voiced, "POST", {
            content: "voiced-rest-control",
          })
        ).status,
      ).toBe(201);
      await event;
      r.c.voiced.send("PRIVMSG #roles :voiced-irc-control");
      await r.c.member.waitForLine((line) => line.includes("voiced-irc-control"));
      await r.flush();
      const after = await r.disk();
      expect(
        after.messages.filter(
          (m) => m.content === "voiced-rest-control" || m.content === "voiced-irc-control",
        ),
      ).toHaveLength(2);
      expect(after.messages.some((m) => m.content.startsWith("forbidden-member"))).toBe(false);
      await r.resume();
      const history = await (await r.f.request(`${rolePath}/messages`, r.actors.member)).text();
      expect(history).toContain("voiced-irc-control");
      expect(history).not.toContain("forbidden-member");
    } finally {
      await r.dispose();
    }
  });

  it("ROLE-025 ROLE-035: founder-created privileged names confer no grants and members cannot create lookalike roles", async () => {
    const r = await roleRig();
    try {
      const role = await createRole(r, "Founder", null, []);
      await assign(r, role.id);
      const before = await r.disk();
      await r.resume();
      for (const name of ["Founder", "Administrator", "~founder", "Operator"])
        await deniedRest(r, `${rolePath}/roles`, "bob", "POST", { name, ircMode: "q" });
      await irc(r.c.bob, "MODE #roles +m", / 482 /);
      await irc(r.c.bob, "KICK #roles member :lookalike-forbidden", / 482 /);
      await deniedRest(r, `${rolePath}/info`, "bob", "PATCH", {
        description: "lookalike-forbidden",
      });
      await r.flush();
      const after = await r.disk();
      assertSameProtected(before, after);
      await r.resume();
      await irc(r.c.bob, "MODE #roles +m", / 482 /);
    } finally {
      await r.dispose();
    }
  });

  for (const [permission, operation] of [
    ["send_messages", "speech"],
    ["change_topic", "topic"],
    ["kick_members", "kick"],
    ["ban_members", "ban"],
    ["manage_channel", "metadata"],
  ] as const)
    it(`ROLE-026: custom ${permission} grants only ${operation} through supported transports and survives restart`, async () => {
      const r = await roleRig();
      try {
        await irc(r.c.founder, "MODE #roles +m", / MODE #roles \+m/);
        const role = await createRole(r, `Custom ${permission}`, null, [permission]);
        const beforeDenial = await r.disk();
        await r.resume();
        const command =
          operation === "speech"
            ? "PRIVMSG #roles :custom-speech-control"
            : operation === "topic"
              ? "TOPIC #roles :custom-topic-control"
              : operation === "kick"
                ? "KICK #roles member :custom-kick-control"
                : "MODE #roles +b $a:member";
        if (operation === "metadata")
          await deniedRest(r, `${rolePath}/info`, "bob", "PATCH", {
            description: "custom-management-control",
          });
        else await irc(r.c.bob, command, operation === "speech" ? / 404 / : / 482 /);
        if (operation === "speech")
          expect(
            (
              await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
                content: "forbidden-custom-rest",
              })
            ).status,
          ).toBe(400);
        if (operation === "topic")
          await deniedRest(r, `${rolePath}/info`, "bob", "PATCH", {
            topic: "custom-topic-control",
          });
        await r.flush();
        const afterDenial = await r.disk();
        assertSameProtected(beforeDenial, afterDenial);
        await r.resume();
        await assign(r, role.id);
        const granted = await r.disk();
        expect(granted.channel_user_roles).toContainEqual(
          expect.objectContaining({ user_id: r.actors.bob.account.id, group_id: role.id }),
        );
        await r.resume();
        if (operation === "metadata")
          expect(
            (
              await r.f.request(`${rolePath}/info`, r.actors.bob, "PATCH", {
                description: "custom-management-control",
              })
            ).status,
          ).toBe(200);
        else {
          const pattern =
            operation === "speech"
              ? / PRIVMSG #roles :custom-speech-control/
              : operation === "topic"
                ? / TOPIC #roles :custom-topic-control/
                : operation === "kick"
                  ? / KICK #roles member/
                  : / MODE #roles \+b/;
          const delivered = r.c.founder.waitForNewLine((line) => pattern.test(line));
          r.c.bob.send(command);
          await delivered;
        }
        if (operation === "speech") {
          const event = r.events[0].until("custom-rest-speech-control");
          expect(
            (
              await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
                content: "custom-rest-speech-control",
              })
            ).status,
          ).toBe(201);
          await event;
        }
        if (operation === "topic")
          expect
            .soft(
              (
                await r.f.request(`${rolePath}/info`, r.actors.bob, "PATCH", {
                  topic: "custom-topic-control",
                })
              ).status,
            )
            .toBe(200);
        // Every custom grant still denies founder-only role management.
        await deniedRest(r, `${rolePath}/roles`, "bob", "POST", {
          name: "authority-escalation",
          ircMode: "q",
        });
        await r.flush();
        const after = await r.disk();
        expect(after.channel_user_roles).toEqual(granted.channel_user_roles);
        if (operation === "speech")
          expect(after.messages).toContainEqual(
            expect.objectContaining({
              content: "custom-speech-control",
              sender_id: r.actors.bob.account.id,
            }),
          );
        if (operation === "topic")
          expect(after.channel_metadata).toContainEqual(
            expect.objectContaining({ key: "topic", value: "custom-topic-control" }),
          );
        if (operation === "ban")
          expect(after.channel_bans).toContainEqual(expect.objectContaining({ mask: "$a:member" }));
        if (operation === "metadata")
          expect(after.channel_kv_metadata).toContainEqual(
            expect.objectContaining({ key: "description", value: "custom-management-control" }),
          );
      } finally {
        await r.dispose();
      }
    });

  for (const action of ["remove", "delete"] as const)
    it(`ROLE-027 ${action === "delete" ? "ROLE-029 " : ""}ROLE-030 ROLE-033: ${action} revokes custom voice immediately on two devices and persists without changing unrelated roles`, async () => {
      const r = await roleRig();
      let second: TestIRCClient | undefined;
      try {
        await irc(r.c.founder, "MODE #roles +m", / MODE #roles \+m/);
        const role = await createRole(r, "Speaker", "v", ["send_messages"]);
        const retained = await createRole(r, "Retained", null, ["attach_files"]);
        await assign(r, retained.id, "member");
        await assign(r, role.id);
        const before = await r.disk();
        await r.resume();
        expect(before.channel_user_roles).toHaveLength(2);
        second = await r.f.connect(r.actors.bob, "bob-device2");
        await join(second, "#roles");
        const heard = r.c.member.waitForNewLine((line) => line.includes("before-revoke-device2"));
        second.send("PRIVMSG #roles :before-revoke-device2");
        await heard;
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "before-revoke-rest",
            })
          ).status,
        ).toBe(201);
        if (action === "remove") await assign(r, role.id, "bob", true);
        else
          expect(
            (await r.f.request(`${rolePath}/roles/${role.id}`, r.actors.founder, "DELETE")).status,
          ).toBe(200);
        for (const client of [r.c.bob, second])
          await irc(client, "PRIVMSG #roles :forbidden-after-revoke-irc", / 404 /);
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "forbidden-after-revoke-rest",
            })
          ).status,
        ).toBe(400);
        await r.flush();
        expect(r.c.member.lines.some((line) => line.includes("forbidden-after-revoke"))).toBe(
          false,
        );
        expect(r.events[0].received.some((line) => line.includes("forbidden-after-revoke"))).toBe(
          false,
        );
        const after = await r.disk();
        expect(after.channel_user_roles).toEqual([
          expect.objectContaining({ group_id: retained.id, user_id: r.actors.member.account.id }),
        ]);
        expect(after.channel_role_groups.some((x) => x.id === retained.id)).toBe(true);
        expect(after.messages.some((x) => x.content.startsWith("forbidden-after-revoke"))).toBe(
          false,
        );
        await r.resume();
        await irc(r.c.bob, "PRIVMSG #roles :forbidden-restart-revoke", / 404 /);
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "forbidden-restart-rest",
            })
          ).status,
        ).toBe(400);
      } finally {
        second?.close();
        await r.dispose();
      }
    });

  it("ROLE-031: assigning and removing a custom role updates queried IRC prefix modes", async () => {
    const r = await roleRig();
    try {
      const role = await createRole(r, "Prefix", "o");
      await assign(r, role.id);
      await irc(r.c.member, "NAMES #roles", / 353 .*@bob/);
      await assign(r, role.id, "bob", true);
      const names = await irc(r.c.member, "NAMES #roles", / 353 /);
      expect(names).not.toMatch(/[@~&%+]bob\b/);
      await r.flush();
      const after = await r.disk();
      expect(after.channel_user_roles).toEqual([]);
      await r.resume();
      const restarted = await irc(r.c.member, "NAMES #roles", / 353 /);
      expect(restarted).not.toMatch(/[@~&%+]bob\b/);
    } finally {
      await r.dispose();
    }
  });

  for (const overlapping of [false, true])
    it(`ROLE-032: role-derived MODE removal is truthfully rejected with ${overlapping ? "overlapping persistent voice" : "derived voice only"} and API removal reconciles authority`, async () => {
      const r = await roleRig();
      try {
        await irc(r.c.founder, "MODE #roles +m", / MODE #roles \+m/);
        if (overlapping) await irc(r.c.founder, "CS AMODE #roles +v bob", / MODE #roles \+v bob/);
        const role = await createRole(r, "Speaker", "v");
        await assign(r, role.id);
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "before-derived-mode-control",
            })
          ).status,
        ).toBe(201);
        await r.flush();
        const before = await r.disk();
        await r.resume();
        const start = r.c.member.lines.length,
          actorStart = r.c.founder.lines.length;
        // Live MODE and persistent role assignment are separate by documented policy.
        // MODE must refuse a derived-mode removal instead of falsely advertising success.
        r.c.founder.send("MODE #roles -v bob");
        await r.f.barrier(r.c.founder);
        await r.f.barrier(r.c.member);
        expect
          .soft(
            r.c.founder.lines
              .slice(actorStart)
              .some((line) => / 482 /.test(line) && /role assignment/i.test(line)),
          )
          .toBe(true);
        expect
          .soft(
            r.c.member.lines.slice(start).filter((line) => line.includes(" MODE #roles -v bob")),
          )
          .toEqual([]);
        await irc(r.c.founder, "MODE #roles +b-v $a:member bob", / 482 .*role assignment/i);
        await r.flush();
        const rejected = await r.disk();
        assertSameProtected(before, rejected);
        await r.resume();
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "derived-authority-preserved",
            })
          ).status,
        ).toBe(201);
        await assign(r, role.id, "bob", true);
        const names = await irc(r.c.member, "NAMES #roles", / 353 /);
        if (overlapping) {
          // Removing the custom assignment does not revoke the independent ChanServ grant.
          expect(names).toMatch(/\+bob\b/);
          expect(
            (
              await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
                content: "independent-voice-control",
              })
            ).status,
          ).toBe(201);
          await irc(r.c.founder, "MODE #roles -v bob", / MODE #roles -v bob/);
        } else expect(names).not.toMatch(/[+%&@~]bob\b/);
        await irc(r.c.bob, "PRIVMSG #roles :forbidden-after-assignment-remove", / 404 /);
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "forbidden-after-assignment-remove-rest",
            })
          ).status,
        ).toBe(400);
        await r.flush();
        const removed = await r.disk();
        expect(removed.channel_user_roles.filter((x) => x.group_id === role.id)).toEqual([]);
        await r.resume();
        if (overlapping) {
          // A reconnect legitimately restores independent persistent ChanServ voice.
          expect(
            (
              await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
                content: "persistent-voice-restored",
              })
            ).status,
          ).toBe(201);
          await irc(r.c.founder, "CS AMODE #roles -v bob", / MODE #roles -v bob/);
        }
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "forbidden-final-role-mode-write",
            })
          ).status,
        ).toBe(400);
        await r.flush();
        await r.disk();
      } finally {
        await r.dispose();
      }
    });

  for (const mode of ["o", "v"] as const)
    it(`ROLE-031 ROLE-032 ROLE-033: F preserves role-derived ${mode} without false removal or sticky duplicate grants`, async () => {
      const r = await roleRig();
      try {
        await irc(r.c.founder, "MODE #roles +m", / MODE #roles \+m/);
        const role = await createRole(r, "Service derived", mode);
        await assign(r, role.id);
        const before = await r.disk();
        await r.resume();
        const start = r.c.member.lines.length;
        const reply = await irc(
          r.c.founder,
          `F ${mode === "o" ? "OP" : "VOICE"} #roles bob`,
          / NOTICE founder /,
        );
        expect.soft(reply).toMatch(/role assignment/i);
        await r.flush();
        expect
          .soft(
            r.c.member.lines
              .slice(start)
              .filter((line) => line.includes(` MODE #roles +${mode} bob`)),
          )
          .toEqual([]);
        const duplicate = await r.disk();
        assertSameProtected(before, duplicate);
        await r.resume();
        const removedStart = r.c.member.lines.length;
        const removal = await irc(
          r.c.founder,
          `F ${mode === "o" ? "DEOP" : "DEVOICE"} #roles bob`,
          / NOTICE founder /,
        );
        expect(removal).toMatch(/role assignment/i);
        await r.flush();
        expect(
          r.c.member.lines
            .slice(removedStart)
            .filter((line) => line.includes(` MODE #roles -${mode} bob`)),
        ).toEqual([]);
        const rejected = await r.disk();
        assertSameProtected(before, rejected);
        await r.resume();
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "service-derived-control",
            })
          ).status,
        ).toBe(201);
        await assign(r, role.id, "bob", true);
        const names = await irc(r.c.member, "NAMES #roles", / 353 /);
        expect(names).not.toMatch(/[+@%&~]bob\b/);
        await irc(r.c.bob, "PRIVMSG #roles :forbidden-service-derived-write", / 404 /);
        expect(
          (
            await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
              content: "forbidden-service-derived-rest",
            })
          ).status,
        ).toBe(400);
        await r.flush();
        const after = await r.disk();
        expect(after.channel_user_roles).toEqual([]);
      } finally {
        await r.dispose();
      }
    });

  it("ROLE-009 ROLE-014 ROLE-015 ROLE-016: F role commands obey actor and target rank ceilings", async () => {
    const r = await roleRig();
    try {
      const before = await r.disk();
      await r.resume();
      for (const [actor, command] of [
        ["operator", "DEOP #roles founder"],
        ["operator", "OP #roles chanadmin"],
        ["halfop", "OP #roles halfop"],
        ["halfop", "DEOP #roles operator"],
        ["chanadmin", "DEVOICE #roles founder"],
      ] as const) {
        const reply = await irc(r.c[actor], `F ${command}`, new RegExp(` NOTICE ${actor} `));
        expect(reply).toMatch(/higher channel privileges/);
      }
      await r.flush();
      const rejected = await r.disk();
      assertSameProtected(before, rejected);
      await r.resume();
      const delivered = r.c.member.waitForNewLine((line) => line.includes(" MODE #roles +o bob"));
      await irc(r.c.operator, "F OP #roles bob", /OP applied for bob/);
      await delivered;
      await irc(r.c.bob, "MODE #roles +m", / MODE #roles \+m/);
      await irc(r.c.founder, "F DEOP #roles bob", /DEOP applied for bob/);
      await irc(r.c.bob, "MODE #roles -m", / 482 /);
      await r.flush();
      const after = await r.disk();
      expect(after.channel_permissions).toEqual(before.channel_permissions);
    } finally {
      await r.dispose();
    }
  });

  it("ROLE-026 ROLE-027 ROLE-033: topic-only permission has REST IRC clear-topic and atomic mixed-body parity", async () => {
    const r = await roleRig();
    try {
      const role = await createRole(r, "Topic editor", null, ["change_topic"]);
      await assign(r, role.id);
      const before = await r.disk();
      await r.resume();
      await deniedRest(r, `${rolePath}/info`, "member", "PATCH", {
        topic: "forbidden-member-topic",
      });
      await irc(r.c.member, "TOPIC #roles :forbidden-member-topic", / 482 /);
      for (const restricted of [
        { description: "forbidden-metadata" },
        { category: "forbidden-category" },
        { avatar: null },
        { color: "#aabbcc" },
        { nsfw: true },
        { readOnly: true },
        { tags: ["forbidden-tag"] },
      ])
        await deniedRest(r, `${rolePath}/info`, "bob", "PATCH", {
          topic: "forbidden-mixed-topic",
          ...restricted,
        });
      await deniedRest(r, `${staffPath}/info`, "bob", "PATCH", {
        topic: "forbidden-cross-channel-topic",
      });
      await r.flush();
      const rejected = await r.disk();
      assertSameProtected(before, rejected);
      await r.resume();
      const ircDelivered = r.c.member.waitForNewLine((line) =>
        line.includes(" TOPIC #roles :topic-irc-control"),
      );
      r.c.bob.send("TOPIC #roles :topic-irc-control");
      await ircDelivered;
      const delivered = r.c.member.waitForNewLine((line) =>
        line.includes(" TOPIC #roles :topic-rest-control"),
      );
      const event = r.events[0].until("topic-rest-control");
      expect(
        (
          await r.f.request(`${rolePath}/info`, r.actors.bob, "PATCH", {
            topic: "topic-rest-control",
          })
        ).status,
      ).toBe(200);
      await delivered;
      await event;
      await r.flush();
      const persisted = await r.disk();
      expect(persisted.channel_metadata).toContainEqual(
        expect.objectContaining({ key: "topic", value: "topic-rest-control" }),
      );
      expect(persisted.channel_kv_metadata).toEqual(before.channel_kv_metadata);
      await r.resume();
      const clear = r.c.member.waitForNewLine((line) => / TOPIC #roles :$/.test(line));
      expect(
        (await r.f.request(`${rolePath}/info`, r.actors.bob, "PATCH", { topic: null })).status,
      ).toBe(200);
      await clear;
      expect(
        ((await (await r.f.request(`${rolePath}/info`, r.actors.member)).json()) as any).channel
          .topic ?? "",
      ).toBe("");
      await assign(r, role.id, "bob", true);
      await deniedRest(r, `${rolePath}/info`, "bob", "PATCH", {
        topic: "forbidden-immediate-revoked-topic",
      });
      await irc(r.c.bob, "TOPIC #roles :forbidden-immediate-revoked-topic", / 482 /);
      const revoked = await r.disk();
      await r.resume();
      await deniedRest(r, `${rolePath}/info`, "bob", "PATCH", { topic: "forbidden-revoked-topic" });
      await irc(r.c.bob, "TOPIC #roles :forbidden-revoked-topic", / 482 /);
      await r.flush();
      const after = await r.disk();
      assertSameProtected(revoked, after);
    } finally {
      await r.dispose();
    }
  });

  it("authenticated network operator retains the explicit kick hierarchy override", async () => {
    const r = await roleRig();
    try {
      const root = await r.f.createActor("rootadmin", true);
      expect(
        (
          await r.f.request("/admin/accounts/operator/roles", root, "POST", {
            role: "oper",
            action: "grant",
          })
        ).status,
      ).toBe(200);
      // Credentials intentionally bypass the diagnostic command trace.
      const oper = r.c.operator.waitForNewLine((line) => line.includes(" 381 "));
      r.c.operator.send(`OPER operator ${r.actors.operator.password}`);
      await oper;
      const delivered = r.c.member.waitForNewLine((line) => line.includes(" KICK #roles founder"));
      await irc(
        r.c.operator,
        "KICK #roles founder :explicit-network-override",
        / KICK #roles founder/,
      );
      await delivered;
      await r.flush();
      const after = await r.disk();
      expect(
        after.channel_members.filter((m) => m.user_id === r.actors.founder.account.id),
      ).toEqual([]);
      expect(after.channel_permissions).toContainEqual(
        expect.objectContaining({ user_id: r.actors.founder.account.id, permission: "q" }),
      );
    } finally {
      await r.dispose();
    }
  });

  for (const action of ["assign", "remove", "delete", "update"] as const)
    for (const overlapping of [false, true])
      it(`ROLE-031 ROLE-033: passive live prefix ${action} notifies two devices with ${overlapping ? "overlapping" : "derived-only"} grants`, async () => {
        const r = await roleRig();
        let second: TestIRCClient | undefined;
        let personal: Awaited<ReturnType<typeof stream>> | undefined;
        try {
          await irc(r.c.founder, "MODE #roles +m", / MODE #roles \+m/);
          second = await r.f.connect(r.actors.bob, "bob-device2");
          await join(second, "#roles");
          const secondLogin = await r.f.login("bob", r.actors.bob.password);
          personal = await stream(r.f, secondLogin);
          const personalBarrier = async () => {
            const marker = `personal-prefix-barrier-${randomUUID()}`;
            expect(
              (
                await r.f.request(
                  "/api/v1/channels/%23markers/messages",
                  r.actors.founder,
                  "POST",
                  { content: marker },
                )
              ).status,
            ).toBe(201);
            await personal!.until(marker);
          };
          const role = await createRole(r, "Live prefix", "v");
          if (overlapping) await irc(r.c.founder, "CS AMODE #roles +v bob", / MODE #roles \+v bob/);
          if (action !== "assign") await assign(r, role.id);
          await r.flush();
          await personalBarrier();
          const clients = [r.c.member, r.c.bob, second];
          const starts = clients.map((c) => c.lines.length);
          const eventStart = r.events[0].received.length,
            personalStart = personal.received.length;
          if (action === "assign") await assign(r, role.id);
          else if (action === "remove") await assign(r, role.id, "bob", true);
          else
            expect(
              (
                await r.f.request(
                  `${rolePath}/roles/${role.id}`,
                  r.actors.founder,
                  action === "delete" ? "DELETE" : "PATCH",
                  action === "update" ? { ircMode: "o" } : undefined,
                )
              ).status,
            ).toBe(200);
          // No NAMES, reconnect, polling or explicit refresh is issued before these observations.
          await r.flush();
          await personalBarrier();
          await r.f.barrier(second);
          const expected =
            action === "assign"
              ? overlapping
                ? []
                : ["+v"]
              : action === "update"
                ? overlapping
                  ? ["+o"]
                  : ["-v", "+o"]
                : overlapping
                  ? []
                  : ["-v"];
          for (const [index, client] of clients.entries()) {
            const received = client.lines
              .slice(starts[index])
              .filter((line) => / MODE #roles [+-][vo] bob(?: |$|-device2)/.test(line))
              .map((line) => line.slice(line.indexOf(" MODE #roles ") + 1));
            const wanted = ["bob", "bob-device2"].flatMap((nick) =>
              expected.map((mode) => `MODE #roles ${mode} ${nick}`),
            );
            expect.soft(received.slice().sort()).toEqual(wanted.sort());
          }
          const memberEvents = r.events[0].received
            .slice(eventStart)
            .map((line) => JSON.parse(line));
          const personalEvents = personal.received
            .slice(personalStart)
            .map((line) => JSON.parse(line));
          const type =
            action === "delete"
              ? "channel.role_deleted"
              : action === "update"
                ? "channel.role_updated"
                : "channel.member_role_changed";
          for (const events of [memberEvents, personalEvents])
            expect
              .soft(
                events.filter(
                  (event) =>
                    event.type === type &&
                    event.channelId === "#roles" &&
                    event.data.roleGroupId === role.id,
                ),
              )
              .toHaveLength(1);
          // Idempotent assignment/removal and no-op PATCH must not generate duplicate prefix deltas/events.
          const duplicateStart = r.c.member.lines.length,
            duplicateEvents = r.events[0].received.length;
          if (action === "assign") await assign(r, role.id);
          else if (action === "remove") await assign(r, role.id, "bob", true);
          else if (action === "update")
            expect(
              (
                await r.f.request(`${rolePath}/roles/${role.id}`, r.actors.founder, "PATCH", {
                  ircMode: "o",
                })
              ).status,
            ).toBe(200);
          if (action !== "delete") {
            await r.flush();
            expect(
              r.c.member.lines
                .slice(duplicateStart)
                .filter((line) => / MODE #roles [+-][vo] bob/.test(line)),
            ).toEqual([]);
            expect(
              r.events[0].received.slice(duplicateEvents).filter((line) => line.includes(role.id)),
            ).toEqual([]);
          }
          const allowed = action === "assign" || action === "update" || overlapping;
          expect(
            (
              await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
                content: allowed
                  ? "passive-prefix-authorized-control"
                  : "forbidden-passive-prefix-write",
              })
            ).status,
          ).toBe(allowed ? 201 : 400);
          await r.flush();
          personal.ws.terminate();
          personal = undefined;
          const disk = await r.disk();
          expect(disk.channel_user_roles.some((row) => row.group_id === role.id)).toBe(
            action === "assign" || action === "update",
          );
          await r.resume();
          expect(
            (
              await r.f.request(`${rolePath}/messages`, r.actors.bob, "POST", {
                content: allowed
                  ? "passive-prefix-restart-control"
                  : "forbidden-passive-prefix-restart",
              })
            ).status,
          ).toBe(allowed ? 201 : 400);
        } finally {
          personal?.ws.terminate();
          second?.close();
          await r.dispose();
        }
      });

  it("ROLE-036: foreign role IDs cannot assign patch delete or remove unrelated channel grants", async () => {
    const r = await roleRig();
    try {
      const role = await createRole(r, "Local", "o");
      await assign(r, role.id);
      const staffRoleResponse = await r.f.request(`${staffPath}/roles`, r.actors.outsider, "POST", {
        name: "Unrelated",
        ircMode: "v",
      });
      expect(staffRoleResponse.status).toBe(201);
      const staffRole = ((await staffRoleResponse.json()) as any).role;
      const before = await r.disk();
      await r.resume();
      await deniedRest(
        r,
        `${staffPath}/roles/assign`,
        "outsider",
        "POST",
        { userId: r.actors.alice.account.id, roleGroupId: role.id },
        404,
      );
      await deniedRest(
        r,
        `${staffPath}/roles/${role.id}`,
        "outsider",
        "PATCH",
        { name: "foreign-overwrite" },
        404,
      );
      const foreignDelete = await r.f.request(
        `${staffPath}/roles/${role.id}`,
        r.actors.outsider,
        "DELETE",
      );
      expect(foreignDelete.status).toBe(200);
      expect(await foreignDelete.json()).toMatchObject({ ok: false });
      const foreignRemove = await r.f.request(
        `${staffPath}/roles/assign`,
        r.actors.outsider,
        "POST",
        { userId: r.actors.bob.account.id, roleGroupId: role.id, remove: true },
      );
      expect(foreignRemove.status).toBe(200);
      await deniedRest(
        r,
        `${rolePath}/roles/assign`,
        "founder",
        "POST",
        { userId: r.actors.bob.account.id, roleGroupId: staffRole.id },
        404,
      );
      await r.flush();
      const after = await r.disk();
      assertSameProtected(before, after);
      await r.resume();
      await irc(r.c.bob, "MODE #roles +m", / MODE #roles \+m/);
    } finally {
      await r.dispose();
    }
  });
});
