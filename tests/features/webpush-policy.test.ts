import { expect, it } from "vitest";
import { pushFixture, waitFor } from "../helpers/webpush-policy-fixture";

it.each([404, 410])(
  "removes only a provider %i subscription and still delivers encrypted content to an independent endpoint",
  async (status) => {
    const f = await pushFixture();
    try {
      const alice = await f.actor("alice"),
        bob = await f.actor("bob"),
        charlie = await f.actor("charlie");
      const stale = await f.subscription(bob, "stale"),
        live = await f.subscription(bob, "live"),
        unrelated = await f.subscription(charlie, "unrelated");
      f.responses.set(stale.endpoint, status);
      const conversation = await f.conversation(alice, bob);
      await f.send(alice, conversation, `provider-${status}-secret`);
      await waitFor(() =>
        f.deliveries.some(
          (d) =>
            d.url === live.endpoint && live.decrypt(d.body).type === "conversation.message_created",
        ),
      );
      await waitFor(
        async () =>
          !(
            await f.db((db) =>
              db
                .prepare("SELECT endpoint FROM push_deliveries WHERE endpoint=?")
                .all(stale.endpoint),
            )
          ).length,
      );
      const subscriptions = (await (
        await f.request("/api/v1/notifications/subscriptions?username=bob", bob)
      ).json()) as { endpoints: string[] };
      expect(subscriptions.endpoints).toEqual([live.endpoint]);
      expect(
        (
          (await (
            await f.request("/api/v1/notifications/subscriptions?username=charlie", charlie)
          ).json()) as { endpoints: string[] }
        ).endpoints,
      ).toEqual([unrelated.endpoint]);
      const received = f.deliveries.find(
        (d) =>
          d.url === live.endpoint && live.decrypt(d.body).type === "conversation.message_created",
      )!;
      expect(live.decrypt(received.body)).toMatchObject({
        type: "conversation.message_created",
        conversationId: conversation,
      });
      expect(received.authorization).toMatch(/^vapid t=/);
      expect(received.body.includes(Buffer.from(`provider-${status}-secret`))).toBe(false);
      expect(f.deliveries.some((d) => d.url === unrelated.endpoint)).toBe(false);
    } finally {
      await f.close();
    }
  },
  45000,
);

it("rechecks a removed pending subscription while another recipient remains live", async () => {
  const f = await pushFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      outsider = await f.actor("charlie");
    const blocker = await f.subscription(bob, "blocker"),
      removed = await f.subscription(bob, "removed"),
      unrelated = await f.subscription(outsider, "outside");
    const conversation = await f.conversation(alice, bob);
    f.responses.set(blocker.endpoint, 503);
    f.hold(blocker.endpoint);
    await f.send(alice, conversation, "pending-unsubscribe-secret");
    await waitFor(() => f.deliveries.some((d) => d.url === blocker.endpoint));
    const removedPending = await f.db(
      (db) =>
        db
          .prepare("SELECT event_id,attempts FROM push_deliveries WHERE endpoint=?")
          .get(removed.endpoint) as { event_id: string; attempts: number } | undefined,
    );
    expect(removedPending).toMatchObject({ attempts: 0 });
    const target = `/api/v1/notifications/subscribe?username=bob&endpoint=${encodeURIComponent(removed.endpoint)}`;
    expect((await f.request(target, outsider, "DELETE")).status).toBe(403);
    expect((await f.request(target, bob, "DELETE")).status).toBe(200);
    expect(
      await f.db((db) =>
        db.prepare("SELECT event_id FROM push_deliveries WHERE endpoint=?").all(removed.endpoint),
      ),
    ).toEqual([]);
    f.release();
    await waitFor(
      async () =>
        (
          await f.db(
            (db) =>
              db
                .prepare("SELECT attempts FROM push_deliveries WHERE endpoint=?")
                .get(blocker.endpoint) as { attempts: number } | undefined,
          )
        )?.attempts === 1,
    );
    const pendingControl = await f.db(
      (db) =>
        db
          .prepare(
            "SELECT event_id,account_id,attempts,next_attempt FROM push_deliveries WHERE endpoint=?",
          )
          .get(blocker.endpoint) as
          | { event_id: string; account_id: string; attempts: number; next_attempt: number }
          | undefined,
    );
    expect(pendingControl).toMatchObject({ attempts: 1 });
    expect(pendingControl!.next_attempt).toBeGreaterThan(Date.now());
    f.responses.set(blocker.endpoint, 201);
    const completedBeforeRestart = f.completed.filter(
      (endpoint) => endpoint === blocker.endpoint,
    ).length;
    const providerCallsBeforeRestart = f.deliveries.length;
    await f.restart();
    expect(
      await f.db((db) =>
        db
          .prepare(
            "SELECT event_id,account_id,attempts,next_attempt FROM push_deliveries WHERE endpoint=?",
          )
          .get(blocker.endpoint),
      ),
    ).toEqual(pendingControl);
    await f.alarm(blocker.endpoint);
    await waitFor(
      async () =>
        !(
          await f.db((db) =>
            db
              .prepare("SELECT endpoint FROM push_deliveries WHERE endpoint=?")
              .all(blocker.endpoint),
          )
        ).length,
    );
    expect(f.completed.filter((endpoint) => endpoint === blocker.endpoint).length).toBeGreaterThan(
      completedBeforeRestart,
    );
    const blockerControlDeliveries = f.deliveries.filter(
      (delivery) =>
        delivery.url === blocker.endpoint &&
        JSON.stringify(blocker.decrypt(delivery.body)).includes("pending-unsubscribe-secret"),
    );
    expect(blockerControlDeliveries.length).toBeGreaterThanOrEqual(2);
    const postRestartControl = f.deliveries
      .slice(providerCallsBeforeRestart)
      .filter(
        (delivery) =>
          delivery.url === blocker.endpoint &&
          JSON.stringify(blocker.decrypt(delivery.body)).includes("pending-unsubscribe-secret"),
      );
    expect(postRestartControl.length).toBeGreaterThan(0);
    expect(blocker.decrypt(postRestartControl.at(-1)!.body)).toMatchObject({
      type: "conversation.message_created",
      conversationId: conversation,
    });
    expect(
      f.deliveries.some((d) => d.url === removed.endpoint || d.url === unrelated.endpoint),
    ).toBe(false);
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=bob", bob)
        ).json()) as { endpoints: string[] }
      ).endpoints,
    ).toEqual([blocker.endpoint]);
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=charlie", outsider)
        ).json()) as { endpoints: string[] }
      ).endpoints,
    ).toEqual([unrelated.endpoint]);
  } finally {
    await f.close();
  }
}, 45000);

it.each([429, 503])(
  "persists %i retry attempts over recreation and stops after the bounded eighth attempt",
  async (status) => {
    const f = await pushFixture();
    try {
      const alice = await f.actor("alice"),
        bob = await f.actor("bob"),
        charlie = await f.actor("charlie");
      const retry = await f.subscription(bob, "retry"),
        control = await f.subscription(charlie, "independent-control");
      f.responses.set(retry.endpoint, status);
      const conversation = await f.conversation(alice, bob),
        controlConversation = await f.conversation(alice, charlie);
      const retrySecret = `retry-${status}-secret`;
      await f.send(alice, conversation, retrySecret);
      await waitFor(
        async () =>
          (
            await f.db(
              (db) =>
                db
                  .prepare("SELECT attempts FROM push_deliveries WHERE endpoint=?")
                  .get(retry.endpoint) as { attempts: number } | undefined,
            )
          )?.attempts === 1,
      );
      const before = await f.db(
        (db) =>
          db
            .prepare(
              "SELECT event_id,account_id,attempts,next_attempt FROM push_deliveries WHERE endpoint=?",
            )
            .get(retry.endpoint) as {
            event_id: string;
            account_id: string;
            attempts: number;
            next_attempt: number;
          },
      );
      expect(before.next_attempt).toBeGreaterThan(Date.now());
      const controlSecret = `retry-${status}-independent-control`;
      await f.send(alice, controlConversation, controlSecret);
      await waitFor(() =>
        f.deliveries.some(
          (delivery) =>
            delivery.url === control.endpoint &&
            JSON.stringify(control.decrypt(delivery.body)).includes(controlSecret),
        ),
      );
      const independentDelivery = f.deliveries.find(
        (delivery) =>
          delivery.url === control.endpoint &&
          JSON.stringify(control.decrypt(delivery.body)).includes(controlSecret),
      )!;
      expect(control.decrypt(independentDelivery.body)).toMatchObject({
        type: "conversation.message_created",
        conversationId: controlConversation,
      });
      expect(independentDelivery.authorization).toMatch(/^vapid t=/);
      expect(independentDelivery.body.includes(Buffer.from(controlSecret))).toBe(false);
      expect(
        f.deliveries
          .filter((delivery) => delivery.url === retry.endpoint)
          .every(
            (delivery) => !JSON.stringify(retry.decrypt(delivery.body)).includes(controlSecret),
          ),
      ).toBe(true);
      expect(
        await f.db((db) =>
          db.prepare("SELECT event_id FROM push_deliveries WHERE endpoint=?").all(control.endpoint),
        ),
      ).toEqual([]);
      await f.restart();
      expect(
        await f.db((db) =>
          db
            .prepare(
              "SELECT event_id,account_id,attempts,next_attempt FROM push_deliveries WHERE endpoint=?",
            )
            .get(retry.endpoint),
        ),
      ).toEqual(before);
      for (let attempt = 2; attempt <= 8; attempt++) {
        await f.alarm(retry.endpoint);
        const row = await f.db(
          (db) =>
            db
              .prepare("SELECT attempts,next_attempt FROM push_deliveries WHERE endpoint=?")
              .get(retry.endpoint) as { attempts: number; next_attempt: number } | undefined,
        );
        if (attempt < 8) {
          expect(row?.attempts).toBe(attempt);
          expect(row!.next_attempt).toBeGreaterThan(Date.now());
        } else expect(row).toBeUndefined();
      }
      const relevant = f.deliveries.filter(
        (d) =>
          d.url === retry.endpoint && retry.decrypt(d.body).type === "conversation.message_created",
      );
      expect(relevant).toHaveLength(8);
      expect(relevant.every((d) => !d.body.includes(Buffer.from(`retry-${status}-secret`)))).toBe(
        true,
      );
      expect(
        (
          (await (
            await f.request("/api/v1/notifications/subscriptions?username=bob", bob)
          ).json()) as { endpoints: string[] }
        ).endpoints,
      ).toEqual([retry.endpoint]);
      expect(
        (
          (await (
            await f.request("/api/v1/notifications/subscriptions?username=charlie", charlie)
          ).json()) as { endpoints: string[] }
        ).endpoints,
      ).toEqual([control.endpoint]);
    } finally {
      await f.close();
    }
  },
  90000,
);

it("enforces channel all, mentions and nothing preferences and rejects other-account or malformed updates", async () => {
  const f = await pushFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      outsider = await f.actor("charlie");
    expect(
      (
        await f.request("/api/v1/channels", alice, "POST", {
          name: "#push-policy",
          privacy: "public",
        })
      ).status,
    ).toBe(201);
    expect((await f.request("/api/v1/channels/%23push-policy/join", bob, "POST", {})).status).toBe(
      200,
    );
    expect(
      (await f.request("/api/v1/channels/%23push-policy/join", outsider, "POST", {})).status,
    ).toBe(200);
    expect(
      (
        await f.request("/api/v1/users/charlie/notifications/%23push-policy", outsider, "PUT", {
          level: "all",
        })
      ).status,
    ).toBe(200);
    const control = await f.subscription(outsider, "positive-control");
    const subscription = await f.subscription(bob, "channel");
    const irc = await f.connect(bob);
    const nickChange = irc.waitForNewLine((line) => / NICK :?Bob\[/.test(line));
    irc.send("NICK Bob[");
    await nickChange;
    const grouped = irc.waitForNewLine((line) =>
      line.includes("Successfully grouped nickname Bob["),
    );
    irc.send("NS GROUP");
    await grouped;
    const pref = "/api/v1/users/bob/notifications/%23push-policy";
    const before = await (await f.request("/api/v1/users/bob/notifications", bob)).json();
    expect((await f.request(pref, outsider, "PUT", { level: "all" })).status).toBe(403);
    expect((await f.request(pref, bob, "PUT", { level: "invalid" })).status).toBe(400);
    expect(await (await f.request("/api/v1/users/bob/notifications", bob)).json()).toEqual(before);
    const send = async (content: string) => {
      expect(
        (await f.request("/api/v1/channels/%23push-policy/messages", alice, "POST", { content }))
          .status,
      ).toBe(201);
      await waitFor(() =>
        f.deliveries.some(
          (d) =>
            d.url === control.endpoint && JSON.stringify(control.decrypt(d.body)).includes(content),
        ),
      );
      await waitFor(
        async () =>
          !(
            await f.db((db) =>
              db
                .prepare("SELECT event_id FROM push_deliveries WHERE endpoint=?")
                .all(subscription.endpoint),
            )
          ).length,
      );
    };
    const messages = () =>
      f.deliveries
        .filter((d) => d.url === subscription.endpoint)
        .map((d) => subscription.decrypt(d.body))
        .filter((event) => event.type === "message.created");
    await send("default-unmentioned");
    expect(messages().length).toBe(0); // documented default is mentions
    expect((await f.request(pref, bob, "PUT", { level: "all" })).status).toBe(200);
    await send("all-unmentioned");
    expect(messages().length).toBe(1);
    expect((await f.request(pref, bob, "PUT", { level: "mentions" })).status).toBe(200);
    const mentionsState = await (await f.request("/api/v1/users/bob/notifications", bob)).json();
    expect(mentionsState).not.toEqual(before);
    expect(JSON.stringify(mentionsState)).toContain("mentions");
    await f.restart();
    expect(await (await f.request("/api/v1/users/bob/notifications", bob)).json()).toEqual(
      mentionsState,
    );
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=bob", bob)
        ).json()) as {
          endpoints: string[];
        }
      ).endpoints,
    ).toEqual([subscription.endpoint]);
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=charlie", outsider)
        ).json()) as { endpoints: string[] }
      ).endpoints,
    ).toEqual([control.endpoint]);
    await send("mentions-unmentioned");
    expect(messages().length).toBe(1);
    await send("hello bob");
    expect(messages().length).toBe(2);
    await send("hello BOB!");
    expect(messages().length).toBe(3);
    await send("hello bOB{");
    expect(messages().length).toBe(4);
    await send("hello bobby");
    expect(messages().length).toBe(4);
    expect(
      (await f.request(pref, bob, "PUT", { level: "all", muted_until: Date.now() + 60_000 }))
        .status,
    ).toBe(200);
    await send("bob temporarily muted");
    expect(messages().length).toBe(4);
    expect((await f.request(pref, bob, "PUT", { level: "nothing" })).status).toBe(200);
    await send("hello bob muted");
    expect(messages().length).toBe(4);
    expect(f.deliveries.every((d) => !d.body.includes(Buffer.from("hello bob")))).toBe(true);
  } finally {
    await f.close();
  }
}, 60000);

it("does not retry a queued channel event after its recipient leaves, while the founder remains authorized", async () => {
  const f = await pushFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob");
    expect(
      (await f.request("/api/v1/channels", alice, "POST", { name: "#revoked", privacy: "secret" }))
        .status,
    ).toBe(201);
    expect((await f.request("/api/v1/channels/%23revoked/join", bob, "POST", {})).status).toBe(200);
    expect(
      (await f.request("/api/v1/users/bob/notifications/%23revoked", bob, "PUT", { level: "all" }))
        .status,
    ).toBe(200);
    const subscription = await f.subscription(bob, "revoked");
    f.responses.set(subscription.endpoint, 503);
    expect(
      (
        await f.request("/api/v1/channels/%23revoked/messages", alice, "POST", {
          content: "revoked-channel-secret",
        })
      ).status,
    ).toBe(201);
    await waitFor(
      async () =>
        (
          await f.db(
            (db) =>
              db
                .prepare("SELECT attempts FROM push_deliveries WHERE endpoint=?")
                .get(subscription.endpoint) as { attempts: number } | undefined,
          )
        )?.attempts === 1,
    );
    expect((await f.request("/api/v1/channels/%23revoked/leave", bob, "POST")).status).toBe(200);
    expect((await f.request("/api/v1/channels/%23revoked/members", bob)).status).toBe(403);
    expect((await f.request("/api/v1/channels/%23revoked/members", alice)).status).toBe(200);
    const before = f.deliveries.length;
    await f.alarm(subscription.endpoint);
    expect(f.deliveries).toHaveLength(before);
    expect(
      await f.db((db) =>
        db.prepare("SELECT * FROM push_deliveries WHERE endpoint=?").all(subscription.endpoint),
      ),
    ).toEqual([]);
    await f.restart();
    expect((await f.request("/api/v1/channels/%23revoked/members", bob)).status).toBe(403);
    expect((await f.request("/api/v1/channels/%23revoked/members", alice)).status).toBe(200);
  } finally {
    await f.close();
  }
}, 45000);

it("does not resurrect a queued delivery after unsubscribe and identical re-registration", async () => {
  const f = await pushFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob");
    const conversation = await f.conversation(alice, bob);
    const recipient = await f.subscription(bob, "same-endpoint");
    f.responses.set(recipient.endpoint, 503);
    await f.send(alice, conversation, "old-subscription-secret");
    await waitFor(
      async () =>
        (
          await f.db(
            (db) =>
              db
                .prepare("SELECT attempts FROM push_deliveries WHERE endpoint=?")
                .get(recipient.endpoint) as { attempts: number } | undefined,
          )
        )?.attempts === 1,
    );
    const old = f.deliveries.length;
    expect(
      (
        await f.request(
          `/api/v1/notifications/subscribe?username=bob&endpoint=${encodeURIComponent(recipient.endpoint)}`,
          bob,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect((await recipient.resubscribe()).status).toBe(200);
    f.responses.set(recipient.endpoint, 201);
    await f.alarm(recipient.endpoint);
    expect(f.deliveries).toHaveLength(old);
    expect(
      await f.db((db) =>
        db.prepare("SELECT * FROM push_deliveries WHERE endpoint=?").all(recipient.endpoint),
      ),
    ).toEqual([]);
    await f.send(alice, conversation, "new-subscription-control");
    await waitFor(() =>
      f.deliveries.some(
        (d) =>
          d.url === recipient.endpoint &&
          JSON.stringify(recipient.decrypt(d.body)).includes("new-subscription-control"),
      ),
    );
  } finally {
    await f.close();
  }
}, 45000);

it("does not revive queued messages across disable and re-enable but permits new deliveries under the retained-subscription policy", async () => {
  const f = await pushFixture();
  try {
    const root = await f.actor("rootadmin", true),
      alice = await f.actor("alice"),
      bob = await f.actor("bob");
    const conversation = await f.conversation(alice, bob),
      recipient = await f.subscription(bob, "disabled");
    f.responses.set(recipient.endpoint, 503);
    await f.send(alice, conversation, "before-disable-secret");
    await waitFor(
      async () =>
        (
          await f.db(
            (db) =>
              db
                .prepare("SELECT attempts FROM push_deliveries WHERE endpoint=?")
                .get(recipient.endpoint) as { attempts: number } | undefined,
          )
        )?.attempts === 1,
    );
    expect((await f.request("/admin/accounts/bob/disable", alice, "POST")).status).toBe(403);
    expect((await f.request("/admin/accounts/bob/disable", root, "POST")).status).toBe(200);
    expect((await f.request("/admin/accounts/bob/enable", root, "POST")).status).toBe(200);
    const before = f.deliveries.length;
    f.responses.set(recipient.endpoint, 201);
    await f.alarm(recipient.endpoint);
    expect(f.deliveries).toHaveLength(before);
    expect(
      await f.db((db) =>
        db.prepare("SELECT * FROM push_deliveries WHERE endpoint=?").all(recipient.endpoint),
      ),
    ).toEqual([]);
    const login = await f.request("/api/v1/auth/login", undefined, "POST", {
      username: bob.username,
      password: bob.password,
    });
    expect(login.status).toBe(200);
    const renewed = { ...bob, ...((await login.json()) as { token: string }) };
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=bob", renewed)
        ).json()) as { endpoints: string[] }
      ).endpoints,
    ).toEqual([recipient.endpoint]);
    await f.send(alice, conversation, "after-enable-control");
    await waitFor(() =>
      f.deliveries.some(
        (d) =>
          d.url === recipient.endpoint &&
          JSON.stringify(recipient.decrypt(d.body)).includes("after-enable-control"),
      ),
    );
  } finally {
    await f.close();
  }
}, 45000);

it("rechecks a changed preference on queued messages, retaining an independent recipient", async () => {
  const f = await pushFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    expect(
      (
        await f.request("/api/v1/channels", alice, "POST", {
          name: "#queued-pref",
          privacy: "secret",
        })
      ).status,
    ).toBe(201);
    for (const user of [bob, charlie]) {
      expect(
        (await f.request("/api/v1/channels/%23queued-pref/join", user, "POST", {})).status,
      ).toBe(200);
      expect(
        (
          await f.request(
            `/api/v1/users/${user.username}/notifications/%23queued-pref`,
            user,
            "PUT",
            { level: "all" },
          )
        ).status,
      ).toBe(200);
    }
    const recipient = await f.subscription(bob, "queued-pref"),
      control = await f.subscription(charlie, "queued-control");
    f.responses.set(recipient.endpoint, 503);
    expect(
      (
        await f.request("/api/v1/channels/%23queued-pref/messages", alice, "POST", {
          content: "queued-preference-secret",
        })
      ).status,
    ).toBe(201);
    await waitFor(() =>
      f.deliveries.some(
        (d) =>
          d.url === control.endpoint &&
          JSON.stringify(control.decrypt(d.body)).includes("queued-preference-secret"),
      ),
    );
    await waitFor(
      async () =>
        (
          await f.db(
            (db) =>
              db
                .prepare("SELECT attempts FROM push_deliveries WHERE endpoint=?")
                .get(recipient.endpoint) as { attempts: number } | undefined,
          )
        )?.attempts === 1,
    );
    expect(
      (
        await f.request("/api/v1/users/bob/notifications/%23queued-pref", bob, "PUT", {
          level: "nothing",
        })
      ).status,
    ).toBe(200);
    const count = f.deliveries.filter((d) => d.url === recipient.endpoint).length;
    f.responses.set(recipient.endpoint, 201);
    await f.alarm(recipient.endpoint);
    expect(f.deliveries.filter((d) => d.url === recipient.endpoint)).toHaveLength(count);
    expect(
      await f.db((db) =>
        db.prepare("SELECT * FROM push_deliveries WHERE endpoint=?").all(recipient.endpoint),
      ),
    ).toEqual([]);
  } finally {
    await f.close();
  }
}, 45000);

it("does not give a late channel member earlier private events and delivers later events", async () => {
  const f = await pushFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob"),
      charlie = await f.actor("charlie");
    expect(
      (await f.request("/api/v1/channels", alice, "POST", { name: "#audience", privacy: "secret" }))
        .status,
    ).toBe(201);
    expect((await f.request("/api/v1/channels/%23audience/join", bob, "POST", {})).status).toBe(
      200,
    );
    for (const user of [bob, charlie])
      expect(
        (
          await f.request(`/api/v1/users/${user.username}/notifications/%23audience`, user, "PUT", {
            level: "all",
          })
        ).status,
      ).toBe(200);
    const original = await f.subscription(bob, "original"),
      late = await f.subscription(charlie, "late");
    expect(
      (
        await f.request("/api/v1/channels/%23audience/messages", alice, "POST", {
          content: "before-join-private",
        })
      ).status,
    ).toBe(201);
    await waitFor(() =>
      f.deliveries.some(
        (d) =>
          d.url === original.endpoint &&
          JSON.stringify(original.decrypt(d.body)).includes("before-join-private"),
      ),
    );
    expect(f.deliveries.filter((d) => d.url === late.endpoint)).toEqual([]);
    await f.restart();
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=bob", bob)
        ).json()) as {
          endpoints: string[];
        }
      ).endpoints,
    ).toEqual([original.endpoint]);
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=charlie", charlie)
        ).json()) as {
          endpoints: string[];
        }
      ).endpoints,
    ).toEqual([late.endpoint]);
    expect(f.deliveries.filter((d) => d.url === late.endpoint)).toEqual([]);
    expect((await f.request("/api/v1/channels/%23audience/join", charlie, "POST", {})).status).toBe(
      200,
    );
    expect(
      (
        await f.request("/api/v1/channels/%23audience/messages", alice, "POST", {
          content: "after-join-control",
        })
      ).status,
    ).toBe(201);
    await waitFor(() =>
      f.deliveries.some(
        (d) =>
          d.url === late.endpoint &&
          JSON.stringify(late.decrypt(d.body)).includes("after-join-control"),
      ),
    );
    expect(
      f.deliveries.some(
        (d) =>
          d.url === original.endpoint &&
          JSON.stringify(original.decrypt(d.body)).includes("after-join-control"),
      ),
    ).toBe(true);
    expect(
      f.deliveries
        .filter((d) => d.url === late.endpoint)
        .every((d) => !JSON.stringify(late.decrypt(d.body)).includes("before-join-private")),
    ).toBe(true);
  } finally {
    await f.close();
  }
}, 45000);

it("invalidates a queued event across password reset while the retained endpoint receives new events", async () => {
  const f = await pushFixture();
  try {
    const root = await f.actor("rootadmin", true),
      alice = await f.actor("alice"),
      bob = await f.actor("bob");
    const conversation = await f.conversation(alice, bob),
      recipient = await f.subscription(bob, "reset");
    f.responses.set(recipient.endpoint, 503);
    await f.send(alice, conversation, "before-reset-secret");
    await waitFor(
      async () =>
        (
          await f.db(
            (db) =>
              db
                .prepare("SELECT attempts FROM push_deliveries WHERE endpoint=?")
                .get(recipient.endpoint) as { attempts: number } | undefined,
          )
        )?.attempts === 1,
    );
    const password = "Replacement-Password-2026!";
    expect(
      (await f.request("/admin/accounts/bob/password", alice, "POST", { password })).status,
    ).toBe(403);
    expect(
      (await f.request("/admin/accounts/bob/password", root, "POST", { password })).status,
    ).toBe(200);
    const count = f.deliveries.length;
    f.responses.set(recipient.endpoint, 201);
    await f.alarm(recipient.endpoint);
    expect(f.deliveries).toHaveLength(count);
    expect(
      await f.db((db) =>
        db.prepare("SELECT * FROM push_deliveries WHERE endpoint=?").all(recipient.endpoint),
      ),
    ).toEqual([]);
    expect(
      (
        await f.request("/api/v1/auth/login", undefined, "POST", {
          username: bob.username,
          password: bob.password,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (
        await f.request("/api/v1/auth/login", undefined, "POST", {
          username: bob.username,
          password,
        })
      ).status,
    ).toBe(200);
    await f.send(alice, conversation, "after-reset-control");
    await waitFor(() =>
      f.deliveries.some(
        (d) =>
          d.url === recipient.endpoint &&
          JSON.stringify(recipient.decrypt(d.body)).includes("after-reset-control"),
      ),
    );
  } finally {
    await f.close();
  }
}, 45000);

it("does not delete an identically re-registered endpoint when an old in-flight 404 completes", async () => {
  const f = await pushFixture();
  try {
    const alice = await f.actor("alice"),
      bob = await f.actor("bob");
    const conversation = await f.conversation(alice, bob),
      recipient = await f.subscription(bob, "held404");
    f.responses.set(recipient.endpoint, 404);
    f.hold(recipient.endpoint);
    await f.send(alice, conversation, "already-in-flight");
    await waitFor(() => f.deliveries.some((d) => d.url === recipient.endpoint));
    expect(
      (
        await f.request(
          `/api/v1/notifications/subscribe?username=bob&endpoint=${encodeURIComponent(recipient.endpoint)}`,
          bob,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect((await recipient.resubscribe()).status).toBe(200);
    f.release();
    await waitFor(() => f.completed.includes(recipient.endpoint));
    await waitFor(
      async () =>
        !(
          await f.db((db) =>
            db
              .prepare("SELECT event_id FROM push_deliveries WHERE endpoint=?")
              .all(recipient.endpoint),
          )
        ).length,
    );
    expect(
      (
        (await (
          await f.request("/api/v1/notifications/subscriptions?username=bob", bob)
        ).json()) as { endpoints: string[] }
      ).endpoints,
    ).toEqual([recipient.endpoint]);
    f.responses.set(recipient.endpoint, 201);
    await f.send(alice, conversation, "fresh-endpoint-control");
    await waitFor(() =>
      f.deliveries.some(
        (d) =>
          d.url === recipient.endpoint &&
          JSON.stringify(recipient.decrypt(d.body)).includes("fresh-endpoint-control"),
      ),
    );
  } finally {
    await f.close();
  }
}, 45000);
