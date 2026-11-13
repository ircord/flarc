import { expect, it } from "vitest";
import {
  accountDisk,
  channelDisk,
  ircCommand,
  join,
  observers,
} from "../helpers/admin-gap-fixture";
import { createMatrixFixture } from "../helpers/matrix-fixture";

it("[ADMIN-004 ADMIN-007 ADMIN-008 ADMIN-022 ADMIN-025 ADMIN-026] admin account changes and role revocation enforce independent actor authority", async () => {
  const f = await createMatrixFixture();
  let streams: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true),
      ircop = await f.createActor("ircop"),
      founder = await f.createActor("founder"),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie"),
      target = await f.createActor("target");
    expect(
      (
        await f.request("/admin/accounts/ircop/roles", root, "POST", {
          role: "oper",
          action: "grant",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request("/admin/accounts/charlie/roles", root, "POST", {
          role: "bot",
          action: "grant",
        })
      ).status,
    ).toBe(200);
    const irc = await f.connect(ircop),
      owner = await f.connect(founder),
      a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie),
      r = await f.connect(root);
    await join(owner, "#founder");
    for (const client of [irc, owner, a, b, c, r]) await join(client, "#identitybarrier");
    await ircCommand(irc, `OPER ircop ${ircop.password}`, / 381 /);
    expect((await f.request("/admin/accounts/target/disable", root, "POST")).status).toBe(200);
    const revoked = await f.login("alice", alice.password);
    expect((await f.request("/api/v1/auth/logout", revoked, "POST")).status).toBe(200);
    streams = await observers(f, [root, founder, charlie, bob], [r, owner, c, b]);
    await streams.barrier();
    const ircStarts = [r.lines.length, owner.lines.length, c.lines.length, b.lines.length],
      eventStarts = streams.received.map((x) => x.length);
    const beforeAccounts = await accountDisk(f.directory),
      beforeFounder = await channelDisk(f.directory, "#founder");
    for (const prefix of ["/admin", "/api/v1/admin"])
      for (const actor of [alice, founder, ircop, revoked, null]) {
        for (const action of ["grant", "revoke"]) {
          const response = await f.request(`${prefix}/accounts/bob/roles`, actor, "POST", {
            role: "admin",
            action,
          });
          expect(response.status).toBe(actor === null || actor === revoked ? 401 : 403);
        }
        expect((await f.request(`${prefix}/accounts/target/enable`, actor, "POST")).status).toBe(
          actor === null || actor === revoked ? 401 : 403,
        );
      }
    const marker = await streams.barrier();
    for (const [i, values] of streams.received.entries())
      expect(values.slice(eventStarts[i]).every((x) => x.includes(marker))).toBe(true);
    for (const [i, client] of [r, owner, c, b].entries())
      expect(client.lines.slice(ircStarts[i]).every((x) => x.includes(marker))).toBe(true);
    expect(await accountDisk(f.directory)).toEqual(beforeAccounts);
    expect(await channelDisk(f.directory, "#founder")).toEqual(beforeFounder);
    expect(
      ((await (await f.request("/admin/accounts/bob/roles", root)).json()) as any).roles,
    ).toEqual([]);
    for (const [grantPrefix, revokePrefix] of [
      ["/admin", "/api/v1/admin"],
      ["/api/v1/admin", "/admin"],
    ]) {
      expect(
        (
          await f.request(`${grantPrefix}/accounts/bob/roles`, root, "POST", {
            role: "oper",
            action: "grant",
          })
        ).status,
      ).toBe(200);
      expect(
        ((await (await f.request(`${grantPrefix}/accounts/bob/roles`, root)).json()) as any).roles,
      ).toContain("oper");
      await ircCommand(b, `OPER bob ${bob.password}`, / 381 /);
      const deoper = b.waitForNewLine((l) => l.includes(" MODE bob -o"));
      expect(
        (
          await f.request(`${revokePrefix}/accounts/bob/roles`, root, "POST", {
            role: "oper",
            action: "revoke",
          })
        ).status,
      ).toBe(200);
      await deoper;
      await ircCommand(b, `OPER bob ${bob.password}`, / 464 /);
      await ircCommand(b, "SAJOIN bob #forbidden", / 481 /);
      expect(
        ((await (await f.request(`${revokePrefix}/accounts/bob/roles`, root)).json()) as any).roles,
      ).not.toContain("oper");
    }
    expect(
      (
        await f.request("/api/v1/auth/login", null, "POST", {
          username: "target",
          password: target.password,
        })
      ).status,
    ).toBe(401);
    for (const [disablePrefix, enablePrefix] of [
      ["/admin", "/api/v1/admin"],
      ["/api/v1/admin", "/admin"],
    ]) {
      expect(
        (await f.request(`${disablePrefix}/accounts/target/disable`, root, "POST")).status,
      ).toBe(200);
      expect((await f.request("/api/v1/profiles/target", target)).status).toBe(401);
      expect((await f.request(`${enablePrefix}/accounts/target/enable`, root, "POST")).status).toBe(
        200,
      );
      expect((await f.request("/api/v1/profiles/target", target)).status).toBe(401);
    }
    const targetFresh = await f.login("target", target.password);
    expect(targetFresh.account.id).toBe(target.account.id);
    const bobFresh = await f.login("bob", bob.password);
    expect(bobFresh.account.id).toBe(bob.account.id);
    streams.close();
    streams = undefined;
    await f.stop();
    const roles = (await f.snapshot("account_roles")).flat() as any[];
    expect(roles.filter((x) => x.user_id === bob.account.id)).toEqual([]);
    expect(roles.some((x) => x.user_id === ircop.account.id && x.role === "oper")).toBe(true);
    expect(roles.some((x) => x.user_id === charlie.account.id && x.role === "bot")).toBe(true);
    const users = (await f.snapshot("users")).flat() as any[];
    expect(users.find((x) => x.id === target.account.id)?.disabled_at).toBeNull();
    await f.restart();
    const newRoot = await f.login("rootadmin", root.password),
      newFounder = await f.login("founder", founder.password),
      newOper = await f.login("ircop", ircop.password),
      newBob = await f.login("bob", bob.password);
    expect(newBob.account.id).toBe(bob.account.id);
    const newCharlie = await f.login("charlie", charlie.password);
    const postR = await f.connect(newRoot),
      postFounder = await f.connect(newFounder),
      postBob = await f.connect(newBob),
      postCharlie = await f.connect(newCharlie);
    for (const client of [postR, postFounder, postBob, postCharlie])
      await join(client, "#identitybarrier");
    expect((await f.request("/admin/accounts/target/disable", newRoot, "POST")).status).toBe(200);
    streams = await observers(
      f,
      [newRoot, newFounder, newBob, newCharlie],
      [postR, postFounder, postBob, postCharlie],
    );
    await streams.barrier();
    const postClients = [postR, postFounder, postBob, postCharlie],
      postIrcStarts = postClients.map((client) => client.lines.length),
      postEventStarts = streams.received.map((values) => values.length);
    const postAccounts = await accountDisk(f.directory),
      postFounderState = await channelDisk(f.directory, "#founder");
    expect(
      (postAccounts.users as any[]).find((x) => x.id === target.account.id)?.disabled_at,
    ).not.toBeNull();
    expect((postAccounts.roles as any[]).filter((x) => x.user_id === bob.account.id)).toEqual([]);
    expect(
      (postAccounts.roles as any[]).some(
        (x) => x.user_id === charlie.account.id && x.role === "bot",
      ),
    ).toBe(true);
    for (const prefix of ["/admin", "/api/v1/admin"]) {
      expect(
        (
          await f.request(`${prefix}/accounts/bob/roles`, newFounder, "POST", {
            role: "admin",
            action: "grant",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await f.request(`${prefix}/accounts/bob/roles`, newOper, "POST", {
            role: "admin",
            action: "grant",
          })
        ).status,
      ).toBe(403);
      expect((await f.request(`${prefix}/accounts/bob/roles`, newRoot)).status).toBe(200);
      for (const actor of [newFounder, newOper])
        expect((await f.request(`${prefix}/accounts/target/enable`, actor, "POST")).status).toBe(
          403,
        );
    }
    const postMarker = await streams.barrier();
    for (const [idx, values] of streams.received.entries())
      expect(values.slice(postEventStarts[idx]).every((value) => value.includes(postMarker))).toBe(
        true,
      );
    for (const [idx, client] of postClients.entries())
      expect(
        client.lines.slice(postIrcStarts[idx]).every((value) => value.includes(postMarker)),
      ).toBe(true);
    expect(await accountDisk(f.directory)).toEqual(postAccounts);
    expect(await channelDisk(f.directory, "#founder")).toEqual(postFounderState);
    streams.close();
    streams = undefined;
    expect(
      (
        await f.request("/admin/accounts/bob/roles", newRoot, "POST", {
          role: "oper",
          action: "grant",
        })
      ).status,
    ).toBe(200);
    expect(
      ((await (await f.request("/api/v1/admin/accounts/bob/roles", newRoot)).json()) as any).roles,
    ).toContain("oper");
    expect(
      (
        await f.request("/api/v1/admin/accounts/bob/roles", newRoot, "POST", {
          role: "oper",
          action: "revoke",
        })
      ).status,
    ).toBe(200);
    expect(
      ((await (await f.request("/admin/accounts/bob/roles", newRoot)).json()) as any).roles,
    ).not.toContain("oper");
    expect((await f.request("/api/v1/admin/accounts/target/enable", newRoot, "POST")).status).toBe(
      200,
    );
    expect((await f.login("target", target.password)).account.id).toBe(target.account.id);
    expect(
      ((await (await f.request("/admin/accounts/charlie/roles", newRoot)).json()) as any).roles,
    ).toContain("bot");
  } finally {
    streams?.close();
    await f.dispose();
  }
});

it("[ADMIN-009 ADMIN-010 ADMIN-011 ADMIN-017 ADMIN-025 ADMIN-026] admin aliases configure distinct channels while ordinary founders and IRC operators are denied", async () => {
  const f = await createMatrixFixture();
  let streams: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true),
      founder = await f.createActor("founder"),
      ircop = await f.createActor("ircop"),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    expect(
      (
        await f.request("/admin/accounts/ircop/roles", root, "POST", {
          role: "oper",
          action: "grant",
        })
      ).status,
    ).toBe(200);
    const r = await f.connect(root),
      o = await f.connect(founder),
      i = await f.connect(ircop),
      a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    await join(c, "#sentinel");
    await ircCommand(i, `OPER ircop ${ircop.password}`, / 381 /);
    for (const client of [r, o, i, a, b, c]) await join(client, "#identitybarrier");
    const sentinel = await (await f.request("/admin/channels/%23sentinel/info", root)).json();
    const revoked = await f.login("alice", alice.password);
    expect((await f.request("/api/v1/auth/logout", revoked, "POST")).status).toBe(200);
    for (const [prefix, name, owner] of [
      ["/admin", "#managedone", "founder"],
      ["/api/v1/admin", "#managedtwo", "alice"],
    ]) {
      const res = await f.request(
        `${prefix}/channels/${encodeURIComponent(name)}/register`,
        root,
        "POST",
        { founder: owner },
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).ok).toBe(true);
    }
    await join(o, "#managedone");
    await join(b, "#managedone");
    const roleIds: Record<string, string> = {};
    for (const [actor, channel, targetId] of [
      [founder, "#managedone", bob.account.id],
      [charlie, "#sentinel", alice.account.id],
    ] as const) {
      const roleResponse = await f.request(
        `/api/v1/channels/${encodeURIComponent(channel)}/roles`,
        actor,
        "POST",
        { name: "independent-control", permissions: [] },
      );
      expect(roleResponse.status).toBe(201);
      const role = ((await roleResponse.json()) as any).role;
      roleIds[channel] = role.id;
      expect(
        (
          await f.request(
            `/api/v1/channels/${encodeURIComponent(channel)}/roles/assign`,
            actor,
            "POST",
            { userId: targetId, roleGroupId: role.id },
          )
        ).status,
      ).toBe(200);
    }
    for (const [index, prefix] of ["/admin", "/api/v1/admin"].entries()) {
      const path = `${prefix}/channels/%23managedone`;
      const info = await f.request(`${path}/info`, root, "PATCH", {
        description: `admin-description-${index}`,
      });
      expect(info.status).toBe(200);
      const bot = await f.request(`${path}/bot`, root, "POST", {
        enabled: true,
        welcomeMessage: `admin-welcome-${index}`,
      });
      expect(bot.status).toBe(200);
      const read = await f.request(path, root);
      expect(read.status).toBe(200);
      expect(((await read.json()) as any).channel.name).toBe("#managedone");
      expect(JSON.stringify(await (await f.request(`${path}/info`, root)).json())).toContain(
        `admin-description-${index}`,
      );
      expect(JSON.stringify(await (await f.request(`${path}/bot`, root)).json())).toContain(
        `admin-welcome-${index}`,
      );
    }
    const topicDelivery = b.waitForNewLine((l) =>
      l.includes(" TOPIC #managedone :admin-topic-control"),
    );
    expect(
      (
        await f.request("/api/v1/admin/channels/%23managedone/topic", root, "POST", {
          topic: "admin-topic-control",
        })
      ).status,
    ).toBe(200);
    await topicDelivery;
    const beforeInfo = await (await f.request("/admin/channels/%23managedone/info", root)).json(),
      beforeBot = await (await f.request("/admin/channels/%23managedone/bot", root)).json();
    streams = await observers(f, [root, founder, charlie, bob], [r, o, c, b]);
    await streams.barrier();
    const ircStarts = [r.lines.length, o.lines.length, b.lines.length, c.lines.length],
      eventStarts = streams.received.map((x) => x.length);
    const domainBefore = {
      accounts: await accountDisk(f.directory),
      one: await channelDisk(f.directory, "#managedone"),
      two: await channelDisk(f.directory, "#managedtwo"),
      other: await channelDisk(f.directory, "#sentinel"),
    };
    for (const prefix of ["/admin", "/api/v1/admin"])
      for (const actor of [alice, founder, ircop, revoked, null]) {
        const status = actor === null || actor === revoked ? 401 : 403;
        for (const [path, method, body] of [
          ["/register", "POST", { founder: "alice" }],
          ["/info", "PATCH", { description: "forbidden-description" }],
          ["/bot", "POST", { enabled: false, welcomeMessage: "forbidden-welcome" }],
          ["/info", "GET", undefined],
          ["/bot", "GET", undefined],
          ["", "GET", undefined],
        ] as const)
          expect(
            (await f.request(`${prefix}/channels/%23managedone${path}`, actor, method, body))
              .status,
          ).toBe(status);
      }
    const marker = await streams.barrier();
    for (const [idx, events] of streams.received.entries())
      expect(events.slice(eventStarts[idx]).every((x) => x.includes(marker))).toBe(true);
    for (const [idx, client] of [r, o, b, c].entries())
      expect(client.lines.slice(ircStarts[idx]).every((x) => x.includes(marker))).toBe(true);
    expect({
      accounts: await accountDisk(f.directory),
      one: await channelDisk(f.directory, "#managedone"),
      two: await channelDisk(f.directory, "#managedtwo"),
      other: await channelDisk(f.directory, "#sentinel"),
    }).toEqual(domainBefore);
    expect(await (await f.request("/admin/channels/%23managedone/info", root)).json()).toEqual(
      beforeInfo,
    );
    expect(await (await f.request("/admin/channels/%23managedone/bot", root)).json()).toEqual(
      beforeBot,
    );
    expect(await (await f.request("/admin/channels/%23sentinel/info", root)).json()).toEqual(
      sentinel,
    );
    streams.close();
    streams = undefined;
    await f.stop();
    const one = await channelDisk(f.directory, "#managedone"),
      two = await channelDisk(f.directory, "#managedtwo"),
      other = await channelDisk(f.directory, "#sentinel");
    expect(one.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "founder", value: "founder" }),
        expect.objectContaining({ key: "topic", value: "admin-topic-control" }),
        expect.objectContaining({ key: "f_bot_welcome", value: "admin-welcome-1" }),
      ]),
    );
    expect(one.kv).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "description", value: "admin-description-1" }),
      ]),
    );
    expect(two.metadata).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "founder", value: "alice" })]),
    );
    expect(other.metadata).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "founder", value: "charlie" })]),
    );
    await f.restart();
    const rr = await f.login("rootadmin", root.password),
      ff = await f.login("founder", founder.password),
      ii = await f.login("ircop", ircop.password),
      bb = await f.login("bob", bob.password),
      cc = await f.login("charlie", charlie.password);
    expect(await (await f.request("/admin/channels/%23managedone/info", rr)).json()).toEqual(
      beforeInfo,
    );
    expect(await (await f.request("/api/v1/admin/channels/%23managedone/bot", rr)).json()).toEqual(
      beforeBot,
    );
    expect(await (await f.request("/admin/channels/%23sentinel/info", rr)).json()).toEqual(
      sentinel,
    );
    const postR = await f.connect(rr),
      postF = await f.connect(ff),
      postB = await f.connect(bb),
      postC = await f.connect(cc);
    for (const client of [postR, postF, postB, postC]) await join(client, "#identitybarrier");
    await join(postF, "#managedone");
    await join(postB, "#managedone");
    streams = await observers(f, [rr, ff, bb, cc], [postR, postF, postB, postC]);
    await streams.barrier();
    const postClients = [postR, postF, postB, postC],
      postIrcStarts = postClients.map((client) => client.lines.length),
      postEventStarts = streams.received.map((values) => values.length);
    const postDomain = {
      accounts: await accountDisk(f.directory),
      one: await channelDisk(f.directory, "#managedone"),
      two: await channelDisk(f.directory, "#managedtwo"),
      other: await channelDisk(f.directory, "#sentinel"),
    };
    expect(postDomain.one.assignments).toEqual([
      expect.objectContaining({ user_id: bob.account.id, group_id: roleIds["#managedone"] }),
    ]);
    expect(postDomain.other.assignments).toEqual([
      expect.objectContaining({ user_id: alice.account.id, group_id: roleIds["#sentinel"] }),
    ]);
    expect(postDomain.one.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: roleIds["#managedone"], name: "independent-control" }),
      ]),
    );
    expect(postDomain.other.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: roleIds["#sentinel"], name: "independent-control" }),
      ]),
    );
    for (const prefix of ["/admin", "/api/v1/admin"])
      for (const actor of [ff, ii]) {
        expect(
          (
            await f.request(`${prefix}/channels/%23managedtwo/register`, actor, "POST", {
              founder: "alice",
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await f.request(`${prefix}/channels/%23managedone/bot`, actor, "POST", {
              enabled: false,
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await f.request(`${prefix}/channels/%23managedone/info`, actor, "PATCH", {
              description: "post-restart-forbidden",
            })
          ).status,
        ).toBe(403);
      }
    const postMarker = await streams.barrier();
    for (const [idx, values] of streams.received.entries())
      expect(values.slice(postEventStarts[idx]).every((value) => value.includes(postMarker))).toBe(
        true,
      );
    for (const [idx, client] of postClients.entries())
      expect(
        client.lines.slice(postIrcStarts[idx]).every((value) => value.includes(postMarker)),
      ).toBe(true);
    expect({
      accounts: await accountDisk(f.directory),
      one: await channelDisk(f.directory, "#managedone"),
      two: await channelDisk(f.directory, "#managedtwo"),
      other: await channelDisk(f.directory, "#sentinel"),
    }).toEqual(postDomain);
    streams.close();
    streams = undefined;
    const freshRegister = await f.request("/admin/channels/%23afterrestart/register", rr, "POST", {
      founder: "alice",
    });
    expect(freshRegister.status).toBe(200);
    expect(((await freshRegister.json()) as any).ok).toBe(true);
    expect(
      ((await (await f.request("/admin/channels/%23afterrestart/info", rr)).json()) as any).channel
        .founder,
    ).toBe("alice");
    expect(
      (
        await f.request("/api/v1/admin/channels/%23managedone/bot", rr, "POST", {
          enabled: true,
          welcomeMessage: "post-restart-control",
        })
      ).status,
    ).toBe(200);
    const finalBot = (await (
      await f.request("/admin/channels/%23managedone/bot", rr)
    ).json()) as any;
    expect(finalBot.bot).toMatchObject({ enabled: true, welcomeMessage: "post-restart-control" });
  } finally {
    streams?.close();
    await f.dispose();
  }
});
