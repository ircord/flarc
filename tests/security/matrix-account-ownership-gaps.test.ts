import { expect, it } from "vitest";
import { ircCommand, join, observers, subscribe } from "../helpers/account-ownership-gap-fixture";
import { createMatrixFixture } from "../helpers/matrix-fixture";

function metadataDelivered(
  client: { waitForNewLine: (predicate: (line: string) => boolean) => Promise<string> },
  recipient: string,
  target: string,
  key: string,
  value: string,
) {
  return client.waitForNewLine(
    (line) => line.includes(` 761 ${recipient} ${target} ${key} * `) && line.endsWith(value),
  );
}

it("[USER-001 USER-002 USER-003 USER-004 USER-005 USER-006 USER-012 USER-013 USER-014] independent profile fields bind paths queries and bodies to the authenticated actor", async () => {
  const f = await createMatrixFixture();
  let streams: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      a2 = await f.connect(alice, "alicealt"),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const client of [a, a2, b, c]) await subscribe(client);
    for (const client of [a, b]) await join(client, "#profile");
    for (const client of [a, a2, b]) await join(client, "#identitybarrier");
    for (const [actor, values] of [
      [bob, { displayName: "Bob Original", avatar: "bob-original", customStatus: "bob-status" }],
      [
        charlie,
        {
          displayName: "Charlie Original",
          avatar: "charlie-original",
          customStatus: "charlie-status",
        },
      ],
    ] as const)
      expect(
        (await f.request(`/api/v1/profiles/${actor.username}`, actor, "PATCH", values)).status,
      ).toBe(200);
    const beforeBob = await (await f.request("/api/v1/profiles/bob", bob)).json(),
      beforeCharlie = await (await f.request("/api/v1/profiles/charlie", charlie)).json();
    const fields = [
      { field: "displayName", key: "display-name", value: "Alice Display" },
      { field: "avatar", key: "avatar", value: "alice-avatar" },
      { field: "customStatus", key: "custom-status", value: "alice-status" },
    ] as const;
    const actorOnly = async (
      clients: (typeof a)[],
      starts: number[],
      key: string,
      value: string,
    ) => {
      await Promise.all(clients.map((client) => f.barrier(client)));
      for (const [i, client] of clients.entries()) {
        const relevant = client.lines
          .slice(starts[i])
          .filter(
            (line) => line.includes(" 761 ") && line.includes(` ${key} * `) && line.endsWith(value),
          );
        expect(relevant.length).toBeGreaterThan(0);
        for (const line of relevant) {
          const match = line.match(/ 761 \S+ (\S+) (\S+) \* /);
          expect(match?.[2]).toBe(key);
          expect(["alice", "alicealt"]).toContain(match?.[1]);
        }
      }
    };
    for (const [i, { field, key, value }] of fields.entries()) {
      const starts = [a2.lines.length, b.lines.length];
      const delivery = [
        metadataDelivered(a2, "alicealt", "alice", key, value),
        metadataDelivered(a2, "alicealt", "alicealt", key, value),
        metadataDelivered(b, "bob", "alice", key, value),
        metadataDelivered(b, "bob", "alicealt", key, value),
      ];
      const outside = c.lines.length;
      const prefix = i % 2 === 0 ? "/api/v1/profiles" : "/api/profile";
      expect(
        (await f.request(`${prefix}/alice`, alice, "PATCH", { [field]: `  ${value}  ` })).status,
      ).toBe(200);
      await Promise.all(delivery);
      await actorOnly([a2, b], starts, key, value);
      await f.barrier(c);
      expect(c.lines.slice(outside).join("\n")).not.toContain(value);
      expect(
        ((await (await f.request("/api/v1/profiles/alice", alice)).json()) as any).profile[field],
      ).toBe(value);
    }
    await join(c, "#identitybarrier");
    streams = await observers(f, [alice, bob, charlie], [a, a2, b, c]);
    await streams.barrier();
    const eventOffsets = streams.received.map((x) => x.length),
      ircOffsets = [a2.lines.length, b.lines.length, c.lines.length];
    for (const prefix of ["/api/v1/profiles", "/api/profile"])
      for (const { field } of fields) {
        const marker = `foreign-${field}-${prefix.includes("v1") ? "current" : "legacy"}`;
        expect((await f.request(`${prefix}/bob`, alice, "PATCH", { [field]: marker })).status).toBe(
          403,
        );
      }
    for (const { field, key } of fields)
      await ircCommand(
        a,
        `METADATA bob SET ${key} :foreign-irc-${field}`,
        /FAIL METADATA KEY_NO_PERMISSION/,
      );
    const deniedBarrier = await streams.barrier();
    for (const [i, events] of streams.received.entries())
      expect(events.slice(eventOffsets[i]).every((line) => line.includes(deniedBarrier))).toBe(
        true,
      );
    for (const [i, client] of [a2, b, c].entries())
      expect(client.lines.slice(ircOffsets[i]).every((line) => line.includes(deniedBarrier))).toBe(
        true,
      );
    for (const { field, key } of fields) {
      const queryValue = `query-${field}`,
        bodyValue = `body-${field}`;
      const queryStarts = [a2.lines.length, b.lines.length, c.lines.length];
      const queryDelivery = [
        metadataDelivered(a2, "alicealt", "alice", key, queryValue),
        metadataDelivered(a2, "alicealt", "alicealt", key, queryValue),
        metadataDelivered(b, "bob", "alice", key, queryValue),
        metadataDelivered(b, "bob", "alicealt", key, queryValue),
        metadataDelivered(c, "charlie", "alice", key, queryValue),
        metadataDelivered(c, "charlie", "alicealt", key, queryValue),
      ];
      expect(
        (
          await f.request(`/api/v1/profiles/alice?username=bob`, alice, "PATCH", {
            [field]: queryValue,
          })
        ).status,
      ).toBe(200);
      await Promise.all(queryDelivery);
      await actorOnly([a2, b, c], queryStarts, key, queryValue);
      expect(
        ((await (await f.request("/api/v1/profiles/alice", alice)).json()) as any).profile[field],
      ).toBe(queryValue);
      const bodyStarts = [a2.lines.length, b.lines.length, c.lines.length];
      const bodyDelivery = [
        metadataDelivered(a2, "alicealt", "alice", key, bodyValue),
        metadataDelivered(a2, "alicealt", "alicealt", key, bodyValue),
        metadataDelivered(b, "bob", "alice", key, bodyValue),
        metadataDelivered(b, "bob", "alicealt", key, bodyValue),
        metadataDelivered(c, "charlie", "alice", key, bodyValue),
        metadataDelivered(c, "charlie", "alicealt", key, bodyValue),
      ];
      expect(
        (
          await f.request("/api/profile/alice", alice, "PATCH", {
            [field]: bodyValue,
            username: "bob",
            userId: bob.account.id,
          })
        ).status,
      ).toBe(400);
      expect(
        (await f.request("/api/profile/alice", alice, "PATCH", { [field]: bodyValue })).status,
      ).toBe(200);
      await Promise.all(bodyDelivery);
      await actorOnly([a2, b, c], bodyStarts, key, bodyValue);
      expect(
        ((await (await f.request("/api/v1/profiles/alice", alice)).json()) as any).profile[field],
      ).toBe(bodyValue);
      expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(beforeBob);
    }
    const ignored = {
      username: "bob",
      userId: bob.account.id,
      id: bob.account.id,
      isAdmin: true,
      isOper: true,
      roles: ["admin"],
      displayName: "Alice Scoped",
    };
    expect(
      (await f.request(`/api/profile/alice?username=bob&user=bob`, alice, "PATCH", ignored)).status,
    ).toBe(400);
    expect(
      (
        await f.request(`/api/profile/alice?username=bob&user=bob`, alice, "PATCH", {
          displayName: "Alice Scoped",
        })
      ).status,
    ).toBe(200);
    const marker = await streams.barrier();
    for (const [i, events] of streams.received.entries())
      expect(events.slice(eventOffsets[i]).join("\n")).not.toMatch(
        /foreign-displayName|foreign-avatar|foreign-customStatus|"roles":\["admin"\]/,
      );
    for (const [i, client] of [a2, b, c].entries())
      expect(client.lines.slice(ircOffsets[i]).join("\n")).not.toMatch(
        /foreign-displayName|foreign-avatar|foreign-customStatus/,
      );
    expect(marker).toContain("identity-barrier");
    expect(await (await f.request("/api/v1/profiles/bob", bob)).json()).toEqual(beforeBob);
    expect(await (await f.request("/api/v1/profiles/charlie", charlie)).json()).toEqual(
      beforeCharlie,
    );
    const own = (await (await f.request("/api/profile/alice", alice)).json()) as any;
    expect(own.profile.displayName).toBe("Alice Scoped");
    expect(own.profile.roles).not.toContain("admin");
    expect((await f.request("/admin/accounts", alice)).status).toBe(403);
    streams.close();
    streams = undefined;
    await f.stop();
    const roles = (await f.snapshot("account_roles")).flat() as any[];
    expect(roles.filter((r) => r.user_id === alice.account.id)).toEqual([]);
    const meta = (await f.snapshot("user_metadata")).flat() as any[];
    expect(
      meta.some(
        (r) => r.target_key === "alice" && r.key === "display-name" && r.value === "Alice Scoped",
      ),
    ).toBe(true);
    expect(meta.some((r) => String(r.value).includes("foreign-"))).toBe(false);
    await f.restart();
    const freshAlice = await f.login("alice", alice.password),
      freshBob = await f.login("bob", bob.password),
      freshCharlie = await f.login("charlie", charlie.password);
    expect(freshAlice.account.id).toBe(alice.account.id);
    expect((await f.request("/admin/accounts", freshAlice)).status).toBe(403);
    expect(await (await f.request("/api/v1/profiles/bob", freshBob)).json()).toEqual(beforeBob);
    expect(await (await f.request("/api/v1/profiles/charlie", freshCharlie)).json()).toEqual(
      beforeCharlie,
    );
    expect(
      ((await (await f.request("/api/v1/profiles/alice", freshAlice)).json()) as any).profile,
    ).toMatchObject({
      displayName: "Alice Scoped",
      avatar: "body-avatar",
      customStatus: "body-customStatus",
    });
    for (const prefix of ["/api/v1/profiles", "/api/profile"])
      for (const { field } of fields)
        expect(
          (
            await f.request(`${prefix}/bob`, freshAlice, "PATCH", {
              [field]: `after-restart-${field}`,
            })
          ).status,
        ).toBe(403);
    expect(await (await f.request("/api/v1/profiles/bob", freshBob)).json()).toEqual(beforeBob);
    expect(await (await f.request("/api/v1/profiles/charlie", freshCharlie)).json()).toEqual(
      beforeCharlie,
    );
    expect((await f.request("/admin/accounts", root)).status).toBe(200);
  } finally {
    streams?.close();
    await f.dispose();
  }
});

it("[USER-007 USER-009] foreign password resets fail and persisted password and SCRAM secrets stay out of responses and streams", async () => {
  const f = await createMatrixFixture();
  let streams: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie"),
      dave = await f.createActor("dave");
    await f.stop();
    const users = (await f.snapshot("users")).flat() as any[],
      scram = (await f.snapshot("scram_credentials")).flat() as any[];
    const hash = users.find((u) => u.id === bob.account.id)?.password_hash,
      credential = scram.find((u) => u.user_id === bob.account.id);
    const secrets = [
      hash,
      credential?.salt,
      credential?.stored_key,
      credential?.server_key,
      bob.password,
    ].filter((x): x is string => typeof x === "string" && x.length > 8);
    expect(secrets.length).toBe(5);
    await f.restart();
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const client of [a, b, c]) {
      await subscribe(client);
      await join(client, "#identitybarrier");
    }
    streams = await observers(f, [alice, bob, charlie], [a, b, c]);
    await streams.barrier();
    const ircStarts = [a.lines.length, b.lines.length, c.lines.length],
      eventStarts = streams.received.map((x) => x.length);
    const outputs: string[] = [];
    for (const prefix of ["/admin", "/api/v1/admin"]) {
      const denied = await f.request(`${prefix}/accounts/bob/password`, alice, "POST", {
        password: "forged-password-987!",
      });
      expect(denied.status).toBe(403);
      outputs.push(await denied.text());
    }
    const denialBarrier = await streams.barrier();
    for (const [i, events] of streams.received.entries())
      expect(events.slice(eventStarts[i]).every((line) => line.includes(denialBarrier))).toBe(true);
    for (const [i, client] of [a, b, c].entries())
      expect(client.lines.slice(ircStarts[i]).every((line) => line.includes(denialBarrier))).toBe(
        true,
      );
    const replacement = "Charlie-Replacement-987!";
    const positive = await f.request("/admin/accounts/dave/password", root, "POST", {
      password: replacement,
    });
    expect(positive.status).toBe(200);
    outputs.push(await positive.text());
    for (const [route, actor, status] of [
      ["/api/v1/profiles/bob", alice, 200],
      ["/api/profile/bob", alice, 200],
      ["/admin/accounts/bob", root, 200],
      ["/admin/accounts/bob", alice, 403],
    ] as const) {
      const response = await f.request(route, actor);
      expect(response.status).toBe(status);
      outputs.push(await response.text());
    }
    const freshBob = await f.login("bob", bob.password);
    expect(freshBob.account.id).toBe(bob.account.id);
    expect(
      (
        await f.request("/api/v1/auth/login", null, "POST", {
          username: "bob",
          password: "forged-password-987!",
        })
      ).status,
    ).toBe(401);
    expect((await f.login("dave", replacement)).account.id).toBe(dave.account.id);
    expect((await f.login("charlie", charlie.password)).account.id).toBe(charlie.account.id);
    await streams.barrier();
    for (const [i, client] of [a, b, c].entries())
      outputs.push(client.lines.slice(ircStarts[i]).join("\n"));
    for (const [i, events] of streams.received.entries())
      outputs.push(events.slice(eventStarts[i]).join("\n"));
    for (const output of outputs)
      for (const secret of secrets) expect(output.includes(secret)).toBe(false);
    for (const output of outputs) expect(output.includes("forged-password-987!")).toBe(false);
    streams.close();
    streams = undefined;
    await f.stop();
    const usersAfter = (await f.snapshot("users")).flat() as any[],
      scramAfter = (await f.snapshot("scram_credentials")).flat() as any[];
    expect(usersAfter.find((u) => u.id === bob.account.id)?.password_hash === hash).toBe(true);
    expect(
      JSON.stringify(scramAfter.find((u) => u.user_id === bob.account.id)) ===
        JSON.stringify(credential),
    ).toBe(true);
    await f.restart();
    const restartedBob = await f.login("bob", bob.password),
      restartedCharlie = await f.login("dave", replacement),
      restartedAlice = await f.login("alice", alice.password);
    expect(restartedBob.account.id).toBe(bob.account.id);
    expect(restartedCharlie.account.id).toBe(dave.account.id);
    expect(
      (
        await f.request("/admin/accounts/bob/password", restartedAlice, "POST", {
          password: "after-restart-forgery!",
        })
      ).status,
    ).toBe(403);
    expect((await f.login("bob", bob.password)).account.id).toBe(bob.account.id);
    expect((await f.login("charlie", charlie.password)).account.id).toBe(charlie.account.id);
    const result = await f.request("/api/v1/profiles/bob", restartedAlice);
    expect(result.status).toBe(200);
    const text = await result.text();
    for (const secret of secrets) expect(text.includes(secret)).toBe(false);
  } finally {
    streams?.close();
    await f.dispose();
  }
});

it("[USER-010 USER-011] NickServ grouping registration and drop retain exact nickname owners after recreation", async () => {
  const f = await createMatrixFixture();
  let streams: Awaited<ReturnType<typeof observers>> | undefined;
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    let a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const client of [a, b, c]) {
      await subscribe(client);
      await join(client, "#identitybarrier");
    }
    await ircCommand(a, "NICK AliceExtra", / NICK :?AliceExtra/i);
    await ircCommand(a, "NS GROUP", /Successfully grouped nickname AliceExtra/i);
    await ircCommand(b, "NICK BobExtra", / NICK :?BobExtra/i);
    await ircCommand(b, "NS GROUP", /Successfully grouped nickname BobExtra/i);
    const assertOwners = async (aliceExtraPresent: boolean) => {
      const rows = (await f.snapshot("registered_nicks")).flat() as any[];
      for (const [nick, id] of [
        ["alice", alice.account.id],
        ["bob", bob.account.id],
        ["bobextra", bob.account.id],
        ["charlie", charlie.account.id],
      ])
        expect(rows.find((r) => r.nickname === nick)?.user_id).toBe(id);
      const extra = rows.filter((r) => r.nickname === "aliceextra");
      if (aliceExtraPresent) expect(extra.map((r) => r.user_id)).toEqual([alice.account.id]);
      else expect(extra).toEqual([]);
    };
    await f.stop();
    await assertOwners(true);
    await f.restart();
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
    await f.stop();
    await assertOwners(true);
    await f.restart();
    a = await f.connect(alice, "AliceExtra");
    await ircCommand(a, "NS DROP AliceExtra", /Successfully dropped nickname AliceExtra/i);
    await f.stop();
    await assertOwners(false);
    await f.restart();
    expect((await f.request("/api/v1/profiles/alice", alice)).status).toBe(200);
    await f.stop();
    await assertOwners(false);
    await f.restart();
    a = await f.connect(alice);
    b = await f.connect(bob, "BobExtra");
    c = await f.connect(charlie);
    for (const client of [a, b, c]) {
      await subscribe(client);
      await join(client, "#identitybarrier");
    }
    streams = await observers(f, [alice, bob, charlie], [a, b, c]);
    await streams.barrier();
    const eventOffsets = streams.received.map((x) => x.length),
      ircOffsets = [a.lines.length, c.lines.length];
    await ircCommand(b, "NICK alice", / 433 .*Nickname belongs to another account/i);
    await ircCommand(b, "NS GROUP alice", /Successfully grouped nickname BobExtra to account bob/i);
    await ircCommand(b, "NS SAREGISTER alice forged-password!", /Insufficient privileges/i);
    await ircCommand(b, "NS DROP alice", /Could not drop nickname alice/i);
    const denialBarrier = await streams.barrier();
    for (const [i, events] of streams.received.entries())
      expect(events.slice(eventOffsets[i]).every((line) => line.includes(denialBarrier))).toBe(
        true,
      );
    for (const [i, client] of [a, c].entries())
      expect(client.lines.slice(ircOffsets[i]).every((line) => line.includes(denialBarrier))).toBe(
        true,
      );
    streams.close();
    streams = undefined;
    await f.stop();
    const nicks = (await f.snapshot("registered_nicks")).flat() as any[];
    for (const [nick, id] of [
      ["alice", alice.account.id],
      ["bob", bob.account.id],
      ["bobextra", bob.account.id],
      ["charlie", charlie.account.id],
    ])
      expect(nicks.find((n) => n.nickname === nick)?.user_id).toBe(id);
    await f.restart();
    const aa = await f.login("alice", alice.password),
      bb = await f.login("bob", bob.password),
      cc = await f.login("charlie", charlie.password);
    expect([aa.account.id, bb.account.id, cc.account.id]).toEqual([
      alice.account.id,
      bob.account.id,
      charlie.account.id,
    ]);
    a = await f.connect(aa);
    b = await f.connect(bb);
    c = await f.connect(cc);
    await ircCommand(b, "NICK alice", / 433 .*Nickname belongs to another account/i);
    await ircCommand(b, "NICK BobExtra", / NICK :?BobExtra/i);
    await ircCommand(b, "NS GROUP alice", /Successfully grouped nickname BobExtra to account bob/i);
    await ircCommand(b, "NS SAREGISTER alice forged-password!", /Insufficient privileges/i);
    await ircCommand(b, "NS DROP alice", /Could not drop nickname alice/i);
    await f.stop();
    const after = (await f.snapshot("registered_nicks")).flat() as any[];
    for (const [nick, id] of [
      ["alice", alice.account.id],
      ["bob", bob.account.id],
      ["bobextra", bob.account.id],
      ["charlie", charlie.account.id],
    ])
      expect(after.find((n) => n.nickname === nick)?.user_id).toBe(id);
  } finally {
    streams?.close();
    await f.dispose();
  }
});
