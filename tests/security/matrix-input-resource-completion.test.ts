import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { parseIRCMessage } from "../../server/protocol/irc/parser";
import { closed, eventually } from "../helpers/abuse-gap-fixture";
import { wire } from "../helpers/auth-gap-fixture";
import { inputResourceCompletionFixture } from "../helpers/input-resource-completion-fixture";

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

it("ABUSE-001 ABUSE-002: UTF-8 line/tag byte limits and exact frame bounds preserve private state across recreation", async () => {
  const f = await inputResourceCompletionFixture();
  const { r } = f;
  try {
    const dave = await r.f.create("dave");
    for (let phase = 0; phase < 2; phase++) {
      if (phase) await f.resume();
      const client = await f.connect(dave);
      const before = await f.state();
      await r.silence(async () => {
        const line = `PING :${"é".repeat(252)}`;
        expect(bytes(line)).toBe(510);
        await wire(client, line, / PONG /);
        await wire(client, `${line}é`, / 417 /);
        const overhead = bytes("@+pad= "),
          room = 4096 - overhead;
        const padding = "é".repeat(Math.floor(room / 2)) + "x".repeat(room % 2);
        const tag = `@+pad=${padding} `;
        expect(bytes(tag)).toBe(4096);
        await wire(client, `${tag}PING :tag-byte-positive`, / PONG .*tag-byte-positive/);
        await wire(client, `@+pad=${padding}é PING :tag-byte-denied`, / 417 /);
        expect(
          client.lines.some((line) => line.includes(" PONG ") && line.includes("tag-byte-denied")),
        ).toBe(false);
        const frames = Array.from({ length: 128 }, (_, i) => {
          const marker = `frame-exact-${i}-`;
          return `PING :${marker}${"x".repeat(504 - marker.length)}\r\n`;
        }).join("");
        expect(bytes(frames)).toBe(65536);
        const start = client.lines.length;
        await wire(client, frames, / PONG .*frame-exact-127-/);
        expect(client.lines.slice(start).filter((line) => line.includes(" PONG "))).toHaveLength(
          128,
        );
        const gone = closed(client.ws);
        client.ws.send(Buffer.alloc(65537, 65));
        expect((await gone).reason).toBe("Input frame too large");
        const another = await f.connect(dave);
        const overlong = closed(another.ws);
        another.send(`PING :${"x".repeat(8193)}`);
        expect((await overlong).reason).toBe("Input line too long");
      });
      expect(await f.state()).toEqual(before);
      expect((await r.f.request("/api/v1/profiles/dave", dave)).status).toBe(200);
    }
  } finally {
    await f.dispose();
  }
}, 60000);

it("ABUSE-009 ABUSE-010: malformed binary input is silent and forged prefix/server tags cannot change canonical sender after recreation", async () => {
  const f = await inputResourceCompletionFixture();
  const { r } = f;
  try {
    let previousId: string | undefined;
    for (let phase = 0; phase < 2; phase++) {
      if (phase) await f.resume();
      for (const client of [r.a, r.b])
        await wire(
          client,
          "CAP REQ :message-tags account-tag server-time msgid labeled-response",
          / CAP .* ACK /,
        );
      const marker = `canonical-input-${phase}-${randomUUID()}`,
        forged = `forged-${randomUUID()}`;
      const received = r.b.waitForNewLine((line) => line.includes(marker));
      r.a.send(
        `@account=bob;msgid=${forged};time=1900-01-01T00:00:00Z;+clientnote=alpha\\sbeta :mallory!bad@evil PRIVMSG #protected :${marker}`,
      );
      const actual = parseIRCMessage(await received);
      expect(actual.prefix).toMatch(/^alice!alice@/);
      expect(actual.tags.account).toBe("alice");
      expect(actual.tags.msgid).not.toBe(forged);
      expect(actual.tags.time).not.toBe("1900-01-01T00:00:00Z");
      await r.good.until(marker);
      await r.flush();
      expect(r.outside.received.join("\n")).not.toContain(marker);
      expect(r.c.lines.join("\n")).not.toContain(marker);
      const read = await r.f.request("/api/v1/channels/%23protected/messages", r.bob);
      expect(read.status).toBe(200);
      const message = ((await read.json()) as any).messages.find(
        (row: any) => row.content === marker,
      );
      expect(message).toMatchObject({
        senderId: r.alice.account.id,
        senderAccount: "alice",
        senderNick: "alice",
      });
      expect(message.id).toBe(actual.tags.msgid);
      expect(message.id).not.toBe(forged);
      const before = await f.state();
      if (previousId)
        expect(
          before.messages.some(
            (row) => row.id === previousId && row.sender_id === r.alice.account.id,
          ),
        ).toBe(true);
      await r.silence(async () => {
        const failed = r.a.waitForNewLine(
          (line) =>
            line.includes("FAIL PRIVMSG INVALID_UTF8") && line.includes("label=invalidbinary"),
        );
        r.a.ws.send(
          Buffer.concat([
            Buffer.from("@label=invalidbinary PRIVMSG #protected :"),
            Buffer.from([0xff, 0xfe]),
            Buffer.from("\r\n"),
          ]),
        );
        await failed;
        // Malformed tag-only input is ignored by the normal parser; PONG proves progress.
        r.a.send("@+invalid=unterminated");
        await r.f.barrier(r.a);
        const nul = await r.f.request("/api/v1/channels/%23protected/messages", r.alice, "POST", {
          content: "invalid\u0000private-input",
        });
        expect(nul.status).toBe(400);
      });
      expect(await f.state()).toEqual(before);
      previousId = message.id;
    }
  } finally {
    await f.dispose();
  }
}, 60000);

it("ABUSE-004: real authentication and API request quotas deny without protected effects and survive recreation", async () => {
  const f = await inputResourceCompletionFixture();
  const { r } = f;
  try {
    const limited = await r.f.create("limited");
    await r.flush();
    const before = await f.state(),
      start = Date.now();
    await r.silence(async () => {
      for (let n = 0; n < 300; n++) {
        const response = await r.f.request("/api/v1/profiles/limited", limited);
        expect(response.status, `allowed API request ${n + 1}`).toBe(200);
        expect(((await response.json()) as any).profile.username).toBe("limited");
      }
      const denied = await r.f.request("/api/v1/profiles/limited", limited);
      expect(denied.status).toBe(429);
      expect(await denied.text()).toContain("API request limit reached");
    });
    expect(Date.now() - start).toBeLessThan(60000);
    expect(await f.state()).toEqual(before);
    await f.resume();
    expect(Date.now() - start).toBeLessThan(60000);
    await r.silence(async () => {
      const denied = await r.f.request("/api/v1/profiles/limited", limited);
      expect(denied.status).toBe(429);
      expect(await denied.text()).not.toContain(limited.token);
      expect((await r.f.request("/api/v1/profiles/bob", r.bob)).status).toBe(200);
    });
    expect(await f.state()).toEqual(before);
    const target = await r.f.create("ratetarget");
    const baseline = await f.state(),
      authStart = Date.now();
    await r.silence(async () => {
      for (let n = 0; n < 9; n++) {
        const denied = await r.f.request("/api/v1/auth/login", null, "POST", {
          username: target.username,
          password: `Wrong-${n}`,
        });
        expect(denied.status).toBe(401);
        expect(await denied.text()).toContain("Invalid credentials");
      }
      const denied = await r.f.request("/api/v1/auth/login", null, "POST", {
        username: target.username,
        password: target.password,
      });
      expect(denied.status).toBe(401);
      expect(await denied.text()).toContain("Too many authentication attempts");
    });
    expect(Date.now() - authStart).toBeLessThan(10000);
    expect(await f.state()).toEqual(baseline);
    await f.resume();
    expect(Date.now() - authStart).toBeLessThan(10000);
    await r.silence(async () => {
      const denied = await r.f.request("/api/v1/auth/login", null, "POST", {
        username: target.username,
        password: target.password,
      });
      expect(denied.status).toBe(401);
      expect(await denied.text()).toContain("Too many authentication attempts");
      expect((await r.f.request("/api/v1/profiles/bob", r.bob)).status).toBe(200);
    });
    expect(Date.now() - authStart).toBeLessThan(10000);
    expect(await f.state()).toEqual(baseline);
  } finally {
    await f.dispose();
  }
}, 120000);

it("ABUSE-011: five real event connections preserve identity, deny a sixth, release capacity and reconstruct with healthy independent recipients", async () => {
  const f = await inputResourceCompletionFixture();
  const { r } = f;
  try {
    for (let phase = 0; phase < 2; phase++) {
      if (phase) await f.resume();
      const streams: Awaited<ReturnType<typeof f.openEvents>>[] = [];
      for (let n = 0; n < 5; n++) {
        const stream = await f.openEvents(r.alice);
        expect(stream.status).toBe(101);
        streams.push(stream);
      }
      const before = await f.state();
      await r.silence(async () => {
        expect((await f.openEvents(r.alice)).status).toBe(429);
        expect((await f.openEvents(r.bob)).status).toBe(101);
      });
      expect(await f.state()).toEqual(before);
      const marker = `quota-private-${phase}-${randomUUID()}`;
      const response = await r.f.request("/api/v1/channels/%23protected/messages", r.bob, "POST", {
        content: marker,
      });
      expect(response.status).toBe(201);
      const sent = ((await response.json()) as any).message;
      await eventually(
        () => streams.every((s) => s.lines.some((line) => line.includes(marker))),
        "all five authenticated event recipients",
      );
      for (const stream of streams)
        expect(
          stream.lines.map((line) => JSON.parse(line)).find((e) => e.data?.content === marker),
        ).toMatchObject({
          type: "message.created",
          channelId: "#protected",
          messageId: sent.id,
          data: { senderId: r.bob.account.id, content: marker },
        });
      await r.flush();
      expect(r.outside.received.join("\n")).not.toContain(marker);
      expect(r.c.lines.join("\n")).not.toContain(marker);
      const gone = closed(streams[0].ws);
      streams[0].ws.close(1000, "release-event-slot");
      expect(await gone).toEqual({ code: 1000, reason: "release-event-slot" });
      await eventually(
        () => f.eventLeases(r.alice.account.id).then((count) => count === 4),
        "closed edge lease released",
      );
      await r.flush();
      const replacement = await f.openEvents(r.alice);
      expect(replacement.status).toBe(101);
      const again = await f.state();
      await r.silence(async () => {
        expect((await f.openEvents(r.alice)).status).toBe(429);
      });
      expect(await f.state()).toEqual(again);
      expect((await f.state()).messages).toContainEqual(
        expect.objectContaining({ id: sent.id, sender_id: r.bob.account.id, content: marker }),
      );
      await f.closeExtra();
      await eventually(
        () => f.eventLeases(r.alice.account.id).then((count) => count === 0),
        "all extra edge leases released before recreation",
      );
    }
  } finally {
    await f.dispose();
  }
}, 60000);

it("PUSH-005 PUSH-010 PUSH-012 ABUSE-018: subscription management input/revocation and genuine runtime logs protect private material across recreation", async () => {
  const f = await inputResourceCompletionFixture();
  const { r } = f;
  try {
    const keys = { auth: `private-auth-${randomUUID()}`, p256dh: `private-key-${randomUUID()}` };
    const otherKeys = { auth: `other-auth-${randomUUID()}`, p256dh: `other-key-${randomUUID()}` };
    const endpoint = `https://push.invalid/alice/${randomUUID()}`,
      other = `https://push.invalid/bob/${randomUUID()}`;
    for (const [actor, address, material] of [
      [r.alice, endpoint, keys],
      [r.bob, other, otherKeys],
    ] as const)
      expect(
        (
          await r.f.request("/api/v1/notifications/subscribe", actor, "POST", {
            username: actor.username,
            endpoint: address,
            keys: material,
          })
        ).status,
      ).toBe(200);
    const initial = await f.state();
    expect(initial.webpush_subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_key: "alice", endpoint }),
        expect.objectContaining({ user_key: "bob", endpoint: other }),
      ]),
    );
    expect(
      JSON.parse(initial.webpush_subscriptions.find((row) => row.user_key === "alice")!.keys_json),
    ).toEqual(keys);
    expect(
      JSON.parse(initial.webpush_subscriptions.find((row) => row.user_key === "bob")!.keys_json),
    ).toEqual(otherKeys);
    const credentialSecrets = [
      ...initial.users.map((row) => row.password_hash),
      ...initial.scram_credentials.flatMap((row) => [row.salt, row.stored_key, row.server_key]),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    for (let phase = 0; phase < 2; phase++) {
      if (phase) await f.resume();
      const before = await f.state();
      await r.silence(async () => {
        for (const prefix of ["/api/v1/notifications", "/api/webpush"]) {
          const own = await r.f.request(`${prefix}/subscriptions?username=alice`, r.alice);
          expect(own.status).toBe(200);
          const text = await own.text();
          expect(JSON.parse(text).endpoints).toEqual([endpoint]);
          for (const key of Object.values(keys)) expect(text).not.toContain(key);
          const foreign = await r.f.request(`${prefix}/subscriptions?username=alice`, r.bob);
          expect(foreign.status).toBe(403);
          expect(await foreign.text()).not.toContain(endpoint);
          for (const body of [
            null,
            [],
            { username: "alice", endpoint: "http://127.0.0.1/" },
            { username: "alice", endpoint: 123 },
            { username: "alice", endpoint, keys: [] },
            { username: "alice", endpoint, keys: { auth: "x".repeat(257) } },
          ]) {
            const denied = await r.f.request(`${prefix}/subscribe`, r.alice, "POST", body);
            expect(denied.status).toBe(400);
            const text = await denied.text();
            for (const secret of [
              ...Object.values(keys),
              ...r.f.secretValues,
              ...credentialSecrets,
            ])
              expect(text).not.toContain(secret);
            expect(text).not.toMatch(/SQLITE|password_hash|\bat .*\.mjs/);
          }
        }
        await wire(
          r.a,
          "WEBPUSH REGISTER http://127.0.0.1/ invalid-key invalid-auth",
          /FAIL WEBPUSH INVALID_SUBSCRIPTION REGISTER/,
        );
        const start = r.a.lines.length;
        await wire(r.a, "WEBPUSH LIST bob", / WEBPUSH LIST$/);
        expect(r.a.lines.slice(start).join("\n")).toContain(endpoint);
        expect(r.a.lines.slice(start).join("\n")).not.toContain(other);
        for (const key of Object.values(keys))
          expect(r.a.lines.slice(start).join("\n")).not.toContain(key);
      });
      expect(await f.state()).toEqual(before);
    }
    // Regression: a client-supplied close reason must not be copied into server logs.
    const logActor = await r.f.create("logprobe");
    const logStart = r.f.logs.length;
    await r.silence(async () => {
      for (let n = 0; n < 12; n++) await wire(r.a, `UNKNOWNLOG${n} :${keys.auth}`, / 421 /);
      const probe = await f.connect(logActor);
      const done = closed(probe.ws);
      // The original worker also omitted the reciprocal close handshake. Keep
      // its timeout handled while checking the actual log before awaiting close,
      // so an old-build log regression reaches its own assertion independently.
      void done.catch(() => {});
      const reason = `${keys.auth}\nlog-splice`;
      expect(bytes(reason)).toBeLessThanOrEqual(123);
      probe.ws.close(1000, reason);
      await eventually(
        () => r.f.logs.slice(logStart).join("").includes("Client disconnected: logprobe"),
        "genuine runtime close log captured",
      );
      const closeLog = r.f.logs.slice(logStart).join("");
      expect(closeLog).not.toContain(keys.auth);
      expect(closeLog).not.toContain("log-splice");
      expect(await done).toEqual({ code: 1000, reason });
    });
    const actualLog = r.f.logs.join("");
    for (const secret of [
      ...r.f.secretValues,
      ...credentialSecrets,
      ...Object.values(keys),
      ...Object.values(otherKeys),
      endpoint,
      other,
    ])
      expect(actualLog).not.toContain(secret);
    const delta = r.f.logs.slice(logStart).join("");
    expect(bytes(delta)).toBeLessThanOrEqual(4096);
    expect(delta).not.toContain("log-splice");
    const gone = closed(r.a.ws);
    expect((await r.f.request("/admin/accounts/alice/disable", r.root, "POST", {})).status).toBe(
      200,
    );
    await gone;
    r.setAliceEnabled(false);
    await r.flush();
    const disabled = await f.state();
    expect(disabled.api_sessions.filter((row) => row.user_id === r.alice.account.id)).toEqual([]);
    for (let phase = 0; phase < 2; phase++) {
      if (phase) await f.resume();
      await r.silence(async () => {
        for (const prefix of ["/api/v1/notifications", "/api/webpush"]) {
          for (const [url, method, body] of [
            [`${prefix}/subscriptions?username=alice`, "GET", undefined],
            [
              `${prefix}/subscribe`,
              "POST",
              { username: "alice", endpoint: `${endpoint}/denied`, keys },
            ],
            [
              `${prefix}/subscribe?username=alice&endpoint=${encodeURIComponent(endpoint)}`,
              "DELETE",
              undefined,
            ],
          ] as const) {
            const denied = await r.f.request(url, r.alice, method, body);
            expect(denied.status).toBe(401);
            const text = await denied.text();
            for (const secret of [...Object.values(keys), endpoint])
              expect(text).not.toContain(secret);
          }
          const healthy = await r.f.request(`${prefix}/subscriptions?username=bob`, r.bob);
          expect(healthy.status).toBe(200);
          expect(((await healthy.json()) as any).endpoints).toEqual([other]);
        }
      });
      expect(await f.state()).toEqual(disabled);
    }
    for (const secret of [
      ...r.f.secretValues,
      ...credentialSecrets,
      ...Object.values(keys),
      ...Object.values(otherKeys),
      endpoint,
      other,
    ])
      expect(r.f.logs.join("")).not.toContain(secret);
  } finally {
    await f.dispose();
  }
}, 120000);
