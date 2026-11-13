import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";
import { afterAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "../helpers/event-reader";
import { createMatrixFixture as newMatrixFixture } from "../helpers/matrix-fixture";
import { ensureNitroBuilt, TestIRCClient } from "../helpers/miniflare-harness";

// Concrete paths are recorded during execution, rather than inventing aliases in evidence.
const observedRoutes: any[] = [];
afterAll(() => {
  if (process.env.MESSAGING_ROUTE_LOG)
    writeFileSync(process.env.MESSAGING_ROUTE_LOG, JSON.stringify(observedRoutes, null, 2));
});
async function createMatrixFixture() {
  const f = await newMatrixFixture();
  const request: typeof f.request = async (route, actor, method = "GET", body, headers) => {
    const response = await f.request(route, actor, method, body, headers);
    observedRoutes.push({
      testTitle: expect.getState().currentTestName,
      alias: route,
      method,
      status: response.status,
    });
    return response;
  };
  return {
    ...f,
    get server() {
      return f.server;
    },
    request,
  };
}

describe("matrix message ownership", () => {
  it("existing aggregate: edit and redaction authority", async () => {
    const f = await createMatrixFixture();
    const sockets: WebSocket[] = [];
    try {
      const alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      for (const x of [a, b]) {
        x.send("JOIN #history");
        await x.waitForNumeric(366);
      }
      c.send("JOIN #private");
      await c.waitForNumeric(366);
      c.send("MODE #private +s");
      await c.waitForLine((l) => l.includes(" MODE #private +s"));
      const events: any[] = [];
      const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events`, ["flarc.events.v2"], {
        headers: { Authorization: `Bearer ${alice.token}` },
      });
      sockets.push(ws);
      ws.on("message", (data) => {
        if (!isReaderControl(ws, data)) events.push(JSON.parse(data.toString()));
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      const base = "/api/v1/channels/%23history/messages",
        other = "/api/v1/channels/%23private/messages";
      const send = await f.request(base, alice, "POST", {
        content: "alice-original",
        senderNick: "bob",
        sender: "bob",
        account: "bob",
        tags: { account: "bob", "+client/test": "ok" },
      });
      expect(send.status).toBe(201);
      const message = ((await send.json()) as any).message;
      expect(message.senderNick).toBe("alice");
      expect(message.tags?.account).toBeUndefined();
      const own = await f.request(base, bob, "POST", {
        content: "bob-original",
      });
      expect(own.status).toBe(201);
      const bobId = ((await own.json()) as any).message.id;
      const secret = await f.request(other, charlie, "POST", {
        content: "private-original",
      });
      expect(secret.status).toBe(201);
      const secretId = ((await secret.json()) as any).message.id;
      await vi.waitFor(() =>
        expect(
          events.some((e) => e.type === "message.created" && e.data?.content === "alice-original"),
        ).toBe(true),
      );
      const start = events.length;
      for (const [route, actor, method, body] of [
        [`${base}/${bobId}`, alice, "PATCH", { content: "forged-edit" }],
        [`${base}/${message.id}`, bob, "DELETE", undefined],
        [`${other}/${secretId}`, alice, "PATCH", { content: "private-forgery" }],
        [`${base}/${secretId}`, alice, "PATCH", { content: "cross-id-forgery" }],
        [other, alice, "POST", { content: "private-send-forgery" }],
      ] as const) {
        const response = await f.request(route, actor, method, body);
        expect(response.status).toBe(403);
      }
      await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
      expect(JSON.stringify(events.slice(start))).not.toMatch(
        /forged-edit|private-forgery|cross-id-forgery|private-send-forgery|message\.deleted|message\.updated/,
      );
      let hist = await (await f.request(base, alice)).text();
      expect(hist).toContain("bob-original");
      expect(hist).not.toContain("forgery");
      expect(
        (
          await f.request(`${base}/${message.id}`, alice, "PATCH", {
            content: "alice-edited",
          })
        ).status,
      ).toBe(200);
      hist = await (await f.request(base, bob)).text();
      expect(hist).toContain("alice-edited");
      expect((await f.request(`${base}/${message.id}`, alice, "DELETE")).status).toBe(200);
      expect((await f.request(`${base}/${bobId}`, alice, "DELETE")).status).toBe(200); // founder moderates Bob
      hist = await (await f.request(base, bob)).text();
      expect(hist).not.toContain("alice-edited");
      expect(hist).not.toContain("bob-original");
      expect(await (await f.request(other, charlie)).text()).toContain("private-original");
      sockets.forEach((s) => {
        s.close();
      });
      await f.stop();
      const stored = JSON.stringify(await f.snapshot("messages"));
      expect(stored).not.toMatch(
        /forged-edit|private-forgery|cross-id-forgery|private-send-forgery/,
      );
    } finally {
      sockets.forEach((s) => {
        s.close();
      });
      await f.dispose();
    }
  });
});

describe("message denial boundaries", () => {
  const cases = [
    { id: "MSG-007", name: "cross-author edit", target: "bob", method: "PATCH", actor: "alice" },
    {
      id: "MSG-008",
      name: "inaccessible channel edit",
      target: "secret",
      method: "PATCH",
      actor: "alice",
    },
    {
      id: "MSG-009",
      name: "foreign channel message ID edit",
      target: "cross",
      method: "PATCH",
      actor: "alice",
    },
    {
      id: "MSG-015",
      name: "ordinary member redacting another author",
      target: "alice",
      method: "DELETE",
      actor: "bob",
    },
    {
      id: "MSG-022",
      name: "missing message edit",
      target: "missing",
      method: "PATCH",
      actor: "alice",
    },
    {
      id: "MSG-022",
      name: "missing message redaction",
      target: "missing",
      method: "DELETE",
      actor: "alice",
    },
  ] as const;
  for (const test of cases) {
    it(`${test.id}: ${test.name} is rejected without mutation or delivery`, async () => {
      const f = await createMatrixFixture();
      const sockets: WebSocket[] = [];
      try {
        const alice = await f.createActor("alice"),
          bob = await f.createActor("bob"),
          charlie = await f.createActor("charlie");
        const a = await f.connect(alice),
          b = await f.connect(bob),
          c = await f.connect(charlie);
        for (const client of [a, b]) {
          client.send("JOIN #history");
          await client.waitForNumeric(366);
        }
        c.send("JOIN #private");
        await c.waitForNumeric(366);
        c.send("MODE #private +s");
        await c.waitForLine((l) => l.includes(" MODE #private +s"));
        const base = "/api/v1/channels/%23history/messages",
          other = "/api/v1/channels/%23private/messages";
        const post = async (route: string, actor: typeof alice, content: string) => {
          const r = await f.request(route, actor, "POST", { content });
          expect(r.status).toBe(201);
          return ((await r.json()) as any).message;
        };
        const am = await post(base, alice, "alice-control"),
          bm = await post(base, bob, "bob-control"),
          cm = await post(other, charlie, "private-control");
        const allEvents: any[][] = [[], [], []];
        for (const [i, actor] of [alice, bob, charlie].entries()) {
          const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
          expect(ticket.status).toBe(200);
          const ws = new WebSocket(
            `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
            ["flarc.events.v2"],
          );
          sockets.push(ws);
          ws.on("message", (data) => {
            if (!isReaderControl(ws, data)) allEvents[i].push(JSON.parse(data.toString()));
          });
          await new Promise<void>((resolve, reject) => {
            ws.once("open", resolve);
            ws.once("error", reject);
          });
        }
        const accessPaths = [
          "/api/v1/channels/%23history/info",
          "/api/v1/channels/%23history/roles",
          "/api/v1/channels/%23private/info",
          "/api/v1/channels/%23private/roles",
        ];
        const readAccess = async () =>
          Promise.all(
            accessPaths.map(async (path, i) => {
              const r = await f.request(path, i < 2 ? alice : charlie);
              expect(r.status).toBe(200);
              return r.json();
            }),
          );
        const accessBefore = await readAccess();
        const id =
          test.target === "alice"
            ? am.id
            : test.target === "bob"
              ? bm.id
              : test.target === "missing"
                ? "missing-message-id"
                : cm.id;
        const route = `${test.target === "secret" ? other : base}/${id}`;
        const result = await f.request(
          route,
          test.actor === "bob" ? bob : alice,
          test.method,
          test.method === "PATCH" ? { content: "forbidden-mutation" } : undefined,
        );
        expect(result.status).toBe(403);
        const error = await result.text();
        expect(error).not.toMatch(/private-control|bob-control|alice-control/);
        if (test.target === "missing" && test.method === "PATCH")
          expect(error).toContain("Message not found");
        if (test.target === "bob") expect(error).toContain("You can only edit your own messages");
        if (test.target === "secret") expect(error).toContain("Channel membership is required");
        if (test.target === "cross") expect(error).toContain("Message not found");
        if (test.method === "DELETE")
          expect(error).toContain(
            test.target === "missing"
              ? "Message does not exist or has already been redacted"
              : "You are not authorized to redact this message",
          );
        const ircActor = test.actor === "bob" ? b : a;
        if (test.method === "PATCH") {
          ircActor.send(
            `@+ircord/edit=${id} PRIVMSG ${test.target === "secret" ? "#private" : "#history"} :forbidden-mutation`,
          );
          expect(await ircActor.waitForNumeric(404)).toContain(
            test.target === "secret"
              ? "Cannot send to channel (+n)"
              : "You can only edit your own existing messages",
          );
        } else {
          ircActor.send(`REDACT #history ${id}`);
          const fail = await ircActor.waitForLine((l) => l.includes(" FAIL REDACT "));
          expect(fail).toContain(test.target === "missing" ? "UNKNOWN_MSGID" : "REDACT_FORBIDDEN");
          expect(fail).toContain(
            test.target === "missing"
              ? "Message does not exist or has already been redacted"
              : "You are not authorized to redact this message",
          );
        }
        await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
        expect(JSON.stringify(allEvents)).not.toMatch(
          /message\.updated|message\.deleted|forbidden-mutation/,
        );
        expect([a, b, c].flatMap((x) => x.lines).join("\n")).not.toMatch(
          /forbidden-mutation| REDACT #history/,
        );
        expect(await readAccess()).toEqual(accessBefore);
        const hist = await (await f.request(base, alice)).text(),
          privateHist = await (await f.request(other, charlie)).text();
        expect(hist).toContain("alice-control");
        expect(hist).toContain("bob-control");
        expect(hist).not.toContain("forbidden-mutation");
        expect(privateHist).toContain("private-control");
        sockets.forEach((s) => {
          s.terminate();
        });
        await f.stop();
        const rows = (await f.snapshot("messages")).flat() as any[];
        for (const [m, content] of [
          [am, "alice-control"],
          [bm, "bob-control"],
          [cm, "private-control"],
        ] as const)
          expect(rows.find((row) => row.id === m.id)).toMatchObject({ content, redacted: 0 });
        await f.restart();
        expect(await (await f.request(base, alice)).text()).toContain("bob-control");
        expect(await (await f.request(other, charlie)).text()).toContain("private-control");
      } finally {
        sockets.forEach((s) => {
          s.terminate();
        });
        await f.dispose();
      }
    });
  }
});

it("MSG-006 MSG-010 MSG-011 MSG-012: author edit persists and reaches only authorized event recipients", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const client of [a, b]) {
      client.send("JOIN #history");
      await client.waitForNumeric(366);
    }
    a.send("MODE #history +s");
    await a.waitForLine((l) => l.includes(" MODE #history +s"));
    c.send("JOIN #unrelated");
    await c.waitForNumeric(366);
    const base = "/api/v1/channels/%23history/messages",
      other = "/api/v1/channels/%23unrelated/messages";
    const send = await f.request(base, alice, "POST", { content: "edit-before" });
    expect(send.status).toBe(201);
    const msg = ((await send.json()) as any).message;
    expect(
      (await f.request(other, charlie, "POST", { content: "unrelated-unchanged" })).status,
    ).toBe(201);
    const events: any[][] = [[], [], []];
    for (const [i, actor] of [alice, bob, charlie].entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(ticket.status).toBe(200);
      const ws = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
        ["flarc.events.v2"],
      );
      sockets.push(ws);
      ws.on("message", (data) => {
        if (!isReaderControl(ws, data)) events[i].push(JSON.parse(data.toString()));
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
    }
    const edit = await f.request(`${base}/${msg.id}`, alice, "PATCH", { content: "edit-after" });
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as any).message).toMatchObject({
      id: msg.id,
      content: "edit-after",
    });
    await vi.waitFor(() => {
      for (const e of events.slice(0, 2))
        expect(
          e.some(
            (x) =>
              x.type === "message.updated" &&
              x.messageId === msg.id &&
              x.data.newContent === "edit-after" &&
              x.data.editor === "alice",
          ),
        ).toBe(true);
    });
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
    expect(JSON.stringify(events[2])).not.toContain("edit-after");
    const hist = (await (await f.request(base, bob)).json()) as any;
    expect(hist.messages.find((x: any) => x.id === msg.id).content).toBe("edit-after");
    expect(await (await f.request(other, charlie)).text()).toContain("unrelated-unchanged");
    sockets.forEach((s) => {
      s.terminate();
    });
    await f.stop();
    expect(
      ((await f.snapshot("messages")).flat() as any[]).find((x) => x.id === msg.id),
    ).toMatchObject({ content: "edit-after", sender_id: alice.account.id, redacted: 0 });
    await f.restart();
    const after = (await (await f.request(base, alice)).json()) as any;
    expect(after.messages.find((x: any) => x.id === msg.id).content).toBe("edit-after");
    expect(await (await f.request(other, charlie)).text()).toContain("unrelated-unchanged");
  } finally {
    sockets.forEach((s) => {
      s.terminate();
    });
    await f.dispose();
  }
});

it("MSG-001 MSG-003 MSG-005: REST send derives sender and filters server-owned tags", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    b.send("CAP REQ :message-tags");
    await b.waitForLine((l) => l.includes(" ACK "));
    for (const client of [a, b]) {
      client.send("JOIN #public");
      await client.waitForNumeric(366);
    }
    c.send("JOIN #unrelated");
    await c.waitForNumeric(366);
    const other = "/api/v1/channels/%23unrelated/messages";
    expect((await f.request(other, charlie, "POST", { content: "unrelated-control" })).status).toBe(
      201,
    );
    const route = "/api/v1/channels/%23public/messages";
    const response = await f.request(route, alice, "POST", {
      content: "forgery-control",
      senderNick: "bob",
      sender: "bob",
      account: "bob",
      tags: { account: "bob", role: "admin", "+client/example": "accepted" },
    });
    expect(response.status).toBe(201);
    const message = ((await response.json()) as any).message;
    expect(message.senderNick).toBe("alice");
    expect(message.senderId).toBe(alice.account.id);
    expect(message.tags.account).toBeUndefined();
    expect(message.tags.role).toBeUndefined();
    const line = await b.waitForLine((l) => l.includes(" PRIVMSG #public :forgery-control"));
    expect(line).toContain(":alice!");
    expect(line).not.toMatch(/account=bob|role=admin|:bob!/);
    await f.barrier(c);
    expect(c.lines.join("\n")).not.toContain("forgery-control");
    expect(await (await f.request(other, charlie)).text()).toContain("unrelated-control");
    await f.stop();
    expect(
      ((await f.snapshot("messages")).flat() as any[]).find((m) => m.id === message.id),
    ).toMatchObject({
      sender_id: alice.account.id,
      sender_nick: "alice",
      content: "forgery-control",
    });
    await f.restart();
    expect(await (await f.request(route, alice)).text()).toContain("forgery-control");
  } finally {
    await f.dispose();
  }
});

it("MSG-002: outsider cannot send to a secret channel", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const a = await f.connect(alice),
      b = await f.connect(bob);
    b.send("JOIN #private");
    await b.waitForNumeric(366);
    b.send("MODE #private +s");
    await b.waitForLine((l) => l.includes(" MODE #private +s"));
    a.send("JOIN #unrelated");
    await a.waitForNumeric(366);
    const route = "/api/v1/channels/%23private/messages";
    expect((await f.request(route, bob, "POST", { content: "member-control" })).status).toBe(201);
    const response = await f.request(route, alice, "POST", { content: "forbidden-secret-send" });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("member-control");
    await Promise.all([f.barrier(a), f.barrier(b)]);
    expect(b.lines.join("\n")).not.toContain("forbidden-secret-send");
    expect(await (await f.request(route, bob)).text()).toContain("member-control");
    await f.stop();
    const rows = (await f.snapshot("messages")).flat() as any[];
    expect(rows.some((m) => m.content === "forbidden-secret-send")).toBe(false);
    expect(rows.some((m) => m.content === "member-control")).toBe(true);
    await f.restart();
    expect(await (await f.request(route, bob)).text()).toContain("member-control");
  } finally {
    await f.dispose();
  }
});

it("MSG-014 MSG-016 MSG-017 MSG-019: author and moderator redact without granting moderator edit authority", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const x of [a, b]) {
      x.send("JOIN #history");
      await x.waitForNumeric(366);
    }
    c.send("JOIN #unrelated");
    await c.waitForNumeric(366);
    const route = "/api/v1/channels/%23history/messages",
      unrelated = "/api/v1/channels/%23unrelated/messages";
    const post = async (path: string, actor: typeof alice, content: string) => {
      const r = await f.request(path, actor, "POST", { content });
      expect(r.status).toBe(201);
      return ((await r.json()) as any).message;
    };
    const own = await post(route, bob, "bob-own-delete"),
      moderated = await post(route, bob, "bob-moderated-delete"),
      other = await post(unrelated, charlie, "unrelated-retained");
    const denied = await f.request(`${route}/${moderated.id}`, alice, "PATCH", {
      content: "moderator-fake-edit",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("You can only edit your own messages");
    expect(await (await f.request(route, bob)).text()).toContain("bob-moderated-delete");
    expect((await f.request(`${route}/${own.id}`, bob, "DELETE")).status).toBe(200);
    expect((await f.request(`${route}/${moderated.id}`, alice, "DELETE")).status).toBe(200);
    await b.waitForLine(
      (l) => l.includes(` REDACT #history ${moderated.id}`) && l.includes(":alice!"),
    );
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
    expect(c.lines.join("\n")).not.toMatch(
      /bob-own-delete|bob-moderated-delete|moderator-fake-edit| REDACT #history/,
    );
    expect(await (await f.request(route, bob)).text()).not.toMatch(
      /bob-own-delete|bob-moderated-delete|moderator-fake-edit/,
    );
    expect(await (await f.request(unrelated, charlie)).text()).toContain("unrelated-retained");
    await f.stop();
    const rows = (await f.snapshot("messages")).flat() as any[];
    for (const m of [own, moderated])
      expect(rows.find((x) => x.id === m.id)).toMatchObject({
        sender_id: bob.account.id,
        redacted: 1,
        content: "",
      });
    expect(rows.find((x) => x.id === other.id)).toMatchObject({
      content: "unrelated-retained",
      redacted: 0,
    });
    await f.restart();
    expect(await (await f.request(route, bob)).text()).not.toMatch(
      /bob-own-delete|bob-moderated-delete|moderator-fake-edit/,
    );
  } finally {
    await f.dispose();
  }
});

/** Local fixture: two members, a separate private channel, and all three real event streams. */
async function messageContext() {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    for (const client of [a, b, c]) {
      client.send("CAP REQ :message-tags server-time batch chathistory draft/message-redaction");
      await client.waitForLine((l) => l.includes(" ACK "));
    }
    for (const client of [a, b]) {
      client.send("JOIN #history");
      await client.waitForLine((l) => l.includes(" 366 ") && l.includes("#history"));
    }
    a.send("MODE #history +sn");
    await a.waitForLine((l) => l.includes(" MODE #history +s"));
    c.send("JOIN #private");
    await c.waitForNumeric(366);
    c.send("MODE #private +sn");
    await c.waitForLine((l) => l.includes(" MODE #private +s"));
    const base = "/api/v1/channels/%23history/messages",
      other = "/api/v1/channels/%23private/messages";
    const post = async (actor: typeof alice, content: string, route = base, extra: any = {}) => {
      const r = await f.request(route, actor, "POST", { content, ...extra });
      expect(r.status).toBe(201);
      return ((await r.json()) as any).message;
    };
    const am = await post(alice, "alice-original"),
      bm = await post(bob, "bob-original"),
      cm = await post(charlie, "private-original", other);
    const events: any[][] = [[], [], []];
    for (const [i, actor] of [alice, bob, charlie].entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(ticket.status).toBe(200);
      const ws = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
        ["flarc.events.v2"],
      );
      sockets.push(ws);
      ws.on("message", (data) => {
        if (!isReaderControl(ws, data)) events[i].push(JSON.parse(data.toString()));
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
    }
    const history = async (route = base, actor = alice) => {
      const r = await f.request(route, actor);
      expect(r.status).toBe(200);
      return (await r.json()) as any;
    };
    const accessState = async () => {
      const state = [];
      for (const [channel, actor] of [
        ["%23history", alice],
        ["%23private", charlie],
      ] as const)
        for (const resource of ["info", "roles"]) {
          const r = await f.request(`/api/v1/channels/${channel}/${resource}`, actor);
          expect(r.status).toBe(200);
          state.push(await r.json());
        }
      return state;
    };
    const stableAccess = await accessState();
    const settle = async () => {
      const marker = `barrier-${randomUUID()}`;
      await post(alice, marker);
      await post(charlie, marker, other);
      await vi.waitFor(() => {
        for (const e of events) expect(e.some((x) => x.data?.content === marker)).toBe(true);
      });
      await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
    };
    const unchanged = async () => {
      expect(await accessState()).toEqual(stableAccess);
      expect((await history()).messages.find((m: any) => m.id === bm.id)).toMatchObject({
        content: "bob-original",
        senderId: bob.account.id,
        redacted: false,
      });
      expect(
        (await history(other, charlie)).messages.find((m: any) => m.id === cm.id),
      ).toMatchObject({
        content: "private-original",
        senderId: charlie.account.id,
        redacted: false,
      });
    };
    const persist = async (check: (rows: any[]) => void | Promise<void>) => {
      expect(await accessState()).toEqual(stableAccess);
      sockets.forEach((s) => {
        s.terminate();
      });
      await f.stop();
      await check((await f.snapshot("messages")).flat() as any[]);
      const accounts = (await f.snapshot("users")).flat() as any[];
      const roles = (await f.snapshot("account_roles")).flat() as any[];
      for (const actor of [alice, bob, charlie]) {
        const row = accounts.find((x) => x.id === actor.account.id);
        expect(row).toBeDefined();
        expect(roles.filter((x) => x.user_id === actor.account.id)).toEqual([]);
      }
      expect((await f.snapshot("channel_user_roles")).flat()).toHaveLength(0);
      await f.restart();
    };
    return {
      f,
      alice,
      bob,
      charlie,
      a,
      b,
      c,
      base,
      other,
      am,
      bm,
      cm,
      events,
      sockets,
      post,
      history,
      accessState,
      stableAccess,
      settle,
      unchanged,
      persist,
      dispose: async () => {
        sockets.forEach((s) => {
          s.terminate();
        });
        await f.dispose();
      },
    };
  } catch (error) {
    sockets.forEach((s) => {
      s.terminate();
    });
    await f.dispose();
    throw error;
  }
}

for (const prefix of ["NickServ!service@services", "irc.flarc.local"]) {
  it(`MSG-004: forged ${prefix} prefix retains real account attribution`, async () => {
    const x = await messageContext();
    try {
      const content = `forged-prefix-${prefix}`;
      x.a.send(
        `@account=bob;draft/oper=rootadmin;+role=admin;+badge=staff :${prefix} PRIVMSG #history :${content}`,
      );
      const line = await x.b.waitForLine((l) => l.includes(` PRIVMSG #history :${content}`));
      expect(line).toContain(":alice!");
      expect(line).toContain("account=alice");
      expect(line).not.toMatch(
        /:NickServ!|:irc\.flarc\.local |account=bob|draft\/oper=|\+role=admin|\+badge=staff/,
      );
      await x.settle();
      const msg = (await x.history()).messages.find((m: any) => m.content === content);
      expect(msg).toMatchObject({
        senderId: x.alice.account.id,
        senderNick: "alice",
        senderAccount: "alice",
      });
      for (const events of x.events.slice(0, 2))
        expect(events.find((e) => e.messageId === msg.id)?.data).toMatchObject({
          senderId: x.alice.account.id,
          senderNick: "alice",
          content,
        });
      expect(JSON.stringify(x.events[2])).not.toContain(content);
      expect(x.c.lines.join("\n")).not.toContain(content);
      await x.unchanged();
      await x.persist((rows) => {
        expect(rows.find((m) => m.id === msg.id)).toMatchObject({
          sender_id: x.alice.account.id,
          sender_nick: "alice",
          content,
        });
      });
      expect((await x.history()).messages.find((m: any) => m.id === msg.id)).toMatchObject({
        content,
        senderId: x.alice.account.id,
      });
    } finally {
      await x.dispose();
    }
  });
}

for (const transport of ["IRC", "REST"] as const) {
  for (const tag of ["+ircord/edit", "+draft/edit", "+edit"]) {
    for (const target of ["cross-author", "foreign-ID", "inaccessible", "missing"] as const) {
      it(`MSG-013: ${transport} ${tag} ${target} edit has no persistent or recipient effects`, async () => {
        const x = await messageContext();
        try {
          const id =
            target === "cross-author"
              ? x.bm.id
              : target === "missing"
                ? "missing-message-id"
                : x.cm.id;
          const channel = target === "inaccessible" ? "#private" : "#history";
          let denial: string;
          if (transport === "IRC") {
            x.a.send(`@${tag}=${id} PRIVMSG ${channel} :forbidden-irc-edit`);
            denial = await x.a.waitForNumeric(404);
            expect(denial).toContain(
              target === "inaccessible"
                ? "Cannot send to channel (+n)"
                : "You can only edit your own existing messages",
            );
          } else {
            const response = await x.f.request(
              target === "inaccessible" ? x.other : x.base,
              x.alice,
              "POST",
              { content: "forbidden-irc-edit", tags: { [tag]: id } },
            );
            expect(response.status).toBe(target === "inaccessible" ? 403 : 400);
            denial = await response.text();
            expect(denial).toContain(
              target === "inaccessible"
                ? "Channel membership is required"
                : "You can only edit your own existing messages",
            );
          }
          expect(denial).not.toMatch(/bob-original|private-original/);
          await x.settle();
          expect(JSON.stringify(x.events)).not.toMatch(
            /forbidden-irc-edit|message\.updated|message\.deleted/,
          );
          expect([x.b, x.c].flatMap((c) => c.lines).join("\n")).not.toContain("forbidden-irc-edit");
          await x.unchanged();
          // An actual authorized IRC edit proves the extension is active.
          if (transport === "IRC")
            x.a.send(`@${tag}=${x.am.id} PRIVMSG #history :legitimate-irc-edit`);
          else await x.post(x.alice, "legitimate-irc-edit", x.base, { tags: { [tag]: x.am.id } });
          await x.b.waitForLine((l) => l.includes(" PRIVMSG #history :legitimate-irc-edit"));
          await vi.waitFor(() => {
            for (const e of x.events.slice(0, 2))
              expect(
                e.some(
                  (v) =>
                    v.type === "message.updated" &&
                    v.messageId === x.am.id &&
                    v.data.editor === "alice" &&
                    v.data.newContent === "legitimate-irc-edit",
                ),
              ).toBe(true);
          });
          await x.settle();
          expect(JSON.stringify(x.events[2])).not.toContain("legitimate-irc-edit");
          await x.persist((rows) => {
            expect(rows.some((m) => m.content === "forbidden-irc-edit")).toBe(false);
            expect(rows.find((m) => m.id === x.bm.id)).toMatchObject({
              content: "bob-original",
              redacted: 0,
            });
            expect(rows.find((m) => m.id === x.cm.id)).toMatchObject({
              content: "private-original",
              redacted: 0,
            });
            expect(rows.find((m) => m.id === x.am.id)).toMatchObject({
              content: "legitimate-irc-edit",
              sender_id: x.alice.account.id,
            });
          });
          await x.unchanged();
          expect((await x.history()).messages.find((m: any) => m.id === x.am.id).content).toBe(
            "legitimate-irc-edit",
          );
        } finally {
          await x.dispose();
        }
      });
    }
  }
}

it("MSG-018: IRC and REST redaction scrub edit chains from CHATHISTORY and search after restart", async () => {
  const x = await messageContext();
  try {
    x.b.send(`@+ircord/edit=${x.bm.id} PRIVMSG #history :erasededitedpayload`);
    await x.a.waitForLine((l) => l.includes(" PRIVMSG #history :erasededitedpayload"));
    const control = await x.post(x.bob, "searchablecontrol");
    const readIRC = async () => {
      const start = x.b.lines.length;
      x.b.send("CHATHISTORY LATEST #history * 100");
      await x.f.barrier(x.b);
      const lines = x.b.lines.slice(start).join("\n");
      expect(lines).toContain("searchablecontrol");
      expect(lines).toContain(`msgid=${control.id}`);
      return lines;
    };
    expect(await readIRC()).toContain("erasededitedpayload");
    x.a.send(`REDACT #history ${x.bm.id} :moderated`);
    await x.b.waitForLine(
      (l) => l.includes(` REDACT #history ${x.bm.id}`) && l.includes(":alice!"),
    );
    expect((await x.f.request(`${x.base}/${x.am.id}`, x.alice, "DELETE")).status).toBe(200);
    await x.settle();
    for (const e of x.events.slice(0, 2))
      for (const id of [x.am.id, x.bm.id])
        expect(e.some((v) => v.type === "message.deleted" && v.messageId === id)).toBe(true);
    expect(JSON.stringify(x.events[2])).not.toMatch(
      /erasededitedpayload|searchablecontrol|message\.deleted/,
    );
    expect(await readIRC()).not.toMatch(/erasededitedpayload|bob-original|alice-original/);
    const search = await x.f.request(`${x.base}/search?q=erasededitedpayload`, x.bob);
    expect(search.status).toBe(200);
    expect(((await search.json()) as any).messages).toEqual([]);
    expect(JSON.stringify(await x.history())).not.toMatch(
      /erasededitedpayload|bob-original|alice-original/,
    );
    await x.persist((rows) => {
      const edited = rows.filter((m) => m.sender_id === x.bob.account.id && m.id !== control.id);
      expect(edited.length).toBeGreaterThanOrEqual(2);
      for (const m of edited)
        expect(m).toMatchObject({ content: "", redacted: 1, tags_json: "{}" });
      expect(rows.find((m) => m.id === control.id)).toMatchObject({
        content: "searchablecontrol",
        redacted: 0,
      });
      expect(rows.find((m) => m.id === x.cm.id)).toMatchObject({
        content: "private-original",
        redacted: 0,
      });
    });
    const fresh = await x.f.connect(x.bob, "bobfresh");
    fresh.send("CAP REQ :message-tags batch chathistory");
    await fresh.waitForLine((l) => l.includes(" ACK "));
    fresh.send("JOIN #history");
    await fresh.waitForNumeric(366);
    const start = fresh.lines.length;
    fresh.send("CHATHISTORY LATEST #history * 100");
    await x.f.barrier(fresh);
    expect(fresh.lines.slice(start).join("\n")).toContain("searchablecontrol");
    expect(fresh.lines.slice(start).join("\n")).not.toMatch(
      /erasededitedpayload|bob-original|alice-original/,
    );
    const after = await x.f.request(`${x.base}/search?q=erasededitedpayload`, x.bob);
    expect(after.status).toBe(200);
    expect(((await after.json()) as any).messages).toEqual([]);
  } finally {
    await x.dispose();
  }
});

for (const transport of ["REST", "IRC"] as const) {
  it(`MSG-020: ${transport} reply references never resolve inaccessible bodies or metadata`, async () => {
    const x = await messageContext();
    try {
      const reply = async (id: string, content: string) => {
        if (transport === "REST") return x.post(x.alice, content, x.base, { replyToMessageId: id });
        x.a.send(`@+draft/reply=${id} PRIVMSG #history :${content}`);
        await x.b.waitForLine((l) => l.includes(` PRIVMSG #history :${content}`));
        return (await x.history()).messages.find((m: any) => m.content === content);
      };
      const legitimate = await reply(x.bm.id, "legitimate-reply");
      expect(legitimate.tags["+draft/reply"]).toBe(x.bm.id);
      const restricted = await reply(x.cm.id, "restricted-reference");
      expect(restricted.tags["+draft/reply"]).toBe(x.cm.id); // opaque reference, not a permission grant
      const nonexistent = await reply("unknown-private-id", "unknown-reference");
      await x.settle();
      for (const m of [restricted, nonexistent]) {
        expect(Object.keys(m).sort()).toEqual(Object.keys(legitimate).sort());
        expect(JSON.stringify(m)).not.toMatch(/private-original|charlie|#private/);
        for (const e of x.events.slice(0, 2)) {
          const created = e.find((v) => v.type === "message.created" && v.messageId === m.id);
          expect(created?.data).toMatchObject({
            id: m.id,
            content: m.content,
            senderId: x.alice.account.id,
          });
          expect(JSON.stringify(created)).not.toMatch(/private-original|charlie|#private/);
        }
      }
      const denied = await x.f.request(x.other, x.alice);
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("Channel membership is required");
      const before = x.a.lines.length;
      x.a.send(`CHATHISTORY AROUND #private msgid=${x.cm.id} 10`);
      await x.f.barrier(x.a);
      expect(x.a.lines.slice(before).join("\n")).toContain(
        "FAIL CHATHISTORY INVALID_TARGET AROUND #private :Messages could not be retrieved",
      );
      expect(x.a.lines.slice(before).join("\n")).not.toContain("private-original");
      expect(JSON.stringify(x.events.slice(0, 2))).not.toContain("private-original");
      expect(JSON.stringify(x.events[2])).not.toMatch(
        /legitimate-reply|restricted-reference|unknown-reference/,
      );
      expect(x.c.lines.join("\n")).not.toMatch(
        /legitimate-reply|restricted-reference|unknown-reference/,
      );
      await x.unchanged();
      await x.persist((rows) => {
        expect(rows.find((m) => m.id === restricted.id)).toMatchObject({
          content: "restricted-reference",
          sender_id: x.alice.account.id,
        });
        expect(rows.find((m) => m.id === x.cm.id)).toMatchObject({
          content: "private-original",
          redacted: 0,
        });
      });
      const after = (await x.history()).messages.find((m: any) => m.id === restricted.id);
      expect(after.tags["+draft/reply"]).toBe(x.cm.id);
      expect(JSON.stringify(after)).not.toMatch(/private-original|charlie|#private/);
      expect((await x.f.request(x.other, x.alice)).status).toBe(403);
    } finally {
      await x.dispose();
    }
  });
}

for (const tag of ["+draft/react", "+draft/unreact", "+react", "+unreact"]) {
  it(`MSG-021: IRC ${tag} requires channel access and delivers only to members`, async () => {
    const x = await messageContext();
    try {
      x.a.send(`@${tag}=denied-reaction;+draft/reply=${x.cm.id} TAGMSG #private`);
      expect(await x.a.waitForNumeric(404)).toContain("Cannot send to channel (+n)");
      const denied = await x.f.request(x.other, x.alice, "POST", {
        content: "denied-rest-reaction",
        tags: { [tag]: "denied-reaction", "+draft/reply": x.cm.id },
      });
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("Channel membership is required");
      await x.settle();
      expect(JSON.stringify(x.events)).not.toContain("denied-reaction");
      expect(x.c.lines.join("\n")).not.toContain("denied-reaction");
      x.a.send(`@${tag}=member-reaction;+draft/reply=${x.bm.id} TAGMSG #history`);
      const line = await x.b.waitForLine(
        (l) => l.includes(" TAGMSG #history") && l.includes(`${tag}=member-reaction`),
      );
      expect(line).toContain(":alice!");
      expect(line).toContain(`+draft/reply=${x.bm.id}`);
      await x.settle();
      const reaction = (await x.history()).messages.find(
        (m: any) => m.command === "TAGMSG" && m.tags[tag] === "member-reaction",
      );
      expect(reaction).toMatchObject({ senderId: x.alice.account.id, content: "" });
      for (const e of x.events.slice(0, 2))
        expect(
          e.some((v) => v.messageId === reaction.id && v.data.tags[tag] === "member-reaction"),
        ).toBe(true);
      expect(JSON.stringify(x.events[2])).not.toContain("member-reaction");
      expect(x.c.lines.join("\n")).not.toContain("member-reaction");
      await x.unchanged();
      await x.persist((rows) => {
        expect(
          rows.some(
            (m) => m.tags_json.includes("denied-reaction") || m.content === "denied-rest-reaction",
          ),
        ).toBe(false);
        const row = rows.find((m) => m.id === reaction.id);
        expect(row).toMatchObject({ command: "TAGMSG", sender_id: x.alice.account.id });
        expect(JSON.parse(row.tags_json)[tag]).toBe("member-reaction");
        expect(rows.find((m) => m.id === x.cm.id)).toMatchObject({
          content: "private-original",
          redacted: 0,
        });
      });
      expect((await x.history()).messages.find((m: any) => m.id === reaction.id).tags[tag]).toBe(
        "member-reaction",
      );
    } finally {
      await x.dispose();
    }
  });
}

it("MSG-023 MSG-024 MSG-028: arbitrary ID injection cannot overwrite and REST IRC events share canonical creation state", async () => {
  const x = await messageContext();
  try {
    const [response, concurrent] = await Promise.all([
      x.f.request(x.base, x.alice, "POST", {
        content: "id-injection-control",
        id: x.bm.id,
        messageId: x.bm.id,
        sequence: x.bm.sequence,
        tags: { msgid: x.bm.id, account: "bob", "+client/key": "opaque" },
      }),
      x.f.request(x.base, x.alice, "POST", {
        content: "concurrent-id-injection",
        id: x.bm.id,
        messageId: x.bm.id,
        sequence: x.bm.sequence,
        tags: { msgid: x.bm.id },
      }),
    ]);
    expect(concurrent.status).toBe(201);
    const concurrentMessage = ((await concurrent.json()) as any).message;
    expect(response.status).toBe(201);
    const msg = ((await response.json()) as any).message;
    expect(msg.id).not.toBe(x.bm.id);
    expect(msg.sequence).toBeGreaterThan(x.bm.sequence);
    expect(msg.senderId).toBe(x.alice.account.id);
    expect(msg.tags.msgid).toBeUndefined();
    expect(new Set([msg.id, concurrentMessage.id, x.bm.id]).size).toBe(3);
    const ordered = [msg, concurrentMessage].sort((a, b) => a.sequence - b.sequence);
    expect(ordered[1].sequence).toBe(ordered[0].sequence + 1);
    const line = await x.b.waitForLine((l) =>
      l.includes(" PRIVMSG #history :id-injection-control"),
    );
    expect(line).toContain(`msgid=${msg.id}`);
    expect(line).toContain(new Date(msg.createdAt).toISOString());
    expect(line).toContain(":alice!");
    await x.b.waitForLine((l) => l.includes(" PRIVMSG #history :concurrent-id-injection"));
    await x.settle();
    const delivered = x.b.lines.filter(
      (l) =>
        l.includes(" PRIVMSG #history :id-injection-control") ||
        l.includes(" PRIVMSG #history :concurrent-id-injection"),
    );
    expect(delivered.map((l) => l.match(/msgid=([^; ]+)/)?.[1])).toEqual(ordered.map((m) => m.id));
    for (const e of x.events.slice(0, 2)) {
      expect(e.find((v) => v.messageId === concurrentMessage.id)?.data).toMatchObject({
        id: concurrentMessage.id,
        content: "concurrent-id-injection",
        senderId: x.alice.account.id,
      });
      const created = e.find((v) => v.type === "message.created" && v.messageId === msg.id);
      expect(created).toMatchObject({
        channelId: "#history",
        messageId: msg.id,
        data: {
          id: msg.id,
          senderId: msg.senderId,
          senderNick: msg.senderNick,
          content: msg.content,
          createdAt: msg.createdAt,
        },
      });
    }
    expect(JSON.stringify(x.events[2])).not.toMatch(/id-injection-control|concurrent-id-injection/);
    expect(x.c.lines.join("\n")).not.toMatch(/id-injection-control|concurrent-id-injection/);
    const hist = (await x.history()).messages.find((m: any) => m.id === msg.id);
    expect(hist).toMatchObject({
      id: msg.id,
      sequence: msg.sequence,
      senderId: msg.senderId,
      content: msg.content,
      createdAt: msg.createdAt,
    });
    // The reverse transport also produces the same event/history/IRC identity.
    x.a.send("PRIVMSG #history :irc-canonical-control");
    const ircLine = await x.b.waitForLine((l) =>
      l.includes(" PRIVMSG #history :irc-canonical-control"),
    );
    const ircID = ircLine.match(/msgid=([^; ]+)/)?.[1];
    expect(ircID).toBeTruthy();
    await x.settle();
    const ircMessage = (await x.history()).messages.find((m: any) => m.id === ircID);
    expect(ircMessage).toMatchObject({
      content: "irc-canonical-control",
      senderId: x.alice.account.id,
    });
    for (const e of x.events.slice(0, 2))
      expect(e.find((v) => v.messageId === ircID)?.data).toMatchObject({
        id: ircID,
        content: ircMessage.content,
        senderId: ircMessage.senderId,
        createdAt: ircMessage.createdAt,
      });
    expect(JSON.stringify(x.events[2])).not.toContain("irc-canonical-control");
    await x.unchanged();
    await x.persist((rows) => {
      expect(rows.filter((m) => m.id === x.bm.id)).toHaveLength(1);
      expect(rows.find((m) => m.id === x.bm.id)).toMatchObject({
        content: "bob-original",
        sender_id: x.bob.account.id,
      });
      expect(rows.find((m) => m.id === msg.id)).toMatchObject({
        content: msg.content,
        sequence: msg.sequence,
        sender_id: msg.senderId,
      });
      expect(rows.find((m) => m.id === concurrentMessage.id)).toMatchObject({
        content: "concurrent-id-injection",
        sequence: concurrentMessage.sequence,
        sender_id: x.alice.account.id,
      });
      expect(rows.find((m) => m.id === ircID)).toMatchObject({
        content: "irc-canonical-control",
        sender_id: x.alice.account.id,
      });
    });
    expect((await x.history()).messages.find((m: any) => m.id === msg.id)).toMatchObject({
      content: msg.content,
      sequence: msg.sequence,
    });
    expect(
      (await x.history()).messages
        .filter((m: any) => ordered.some((o) => o.id === m.id))
        .map((m: any) => m.id),
    ).toEqual(ordered.map((m) => m.id).reverse());
  } finally {
    await x.dispose();
  }
});

it("MSG-027: disabling an account removes publishing and receiving on its already-open IRC and event sockets", async () => {
  const x = await messageContext();
  try {
    const root = await x.f.createActor("rootadmin", true);
    // Both independently authenticated sockets are live before revocation.
    x.b.send("PRIVMSG #history :before-disable-control");
    await x.a.waitForLine((l) => l.includes("before-disable-control"));
    await x.settle();
    expect(x.events[1].some((e) => e.data?.content === "before-disable-control")).toBe(true);
    const forbidden = await x.f.request("/admin/accounts/bob/disable", x.charlie, "POST");
    expect(forbidden.status).toBe(403);
    expect(x.b.ws.readyState).toBe(WebSocket.OPEN);
    const ircClosed = new Promise<void>((resolve) => x.b.ws.once("close", () => resolve()));
    const eventsClosed = new Promise<void>((resolve) =>
      x.sockets[1].once("close", () => resolve()),
    );
    const deniedSend = "disabled-publish";
    const disabled = x.f.request("/admin/accounts/bob/disable", root, "POST");
    expect((await disabled).status).toBe(200);
    // Try on the original connection if it has not processed the server close yet.
    if (x.b.ws.readyState === WebSocket.OPEN) x.b.send(`PRIVMSG #history :${deniedSend}`);
    const rest = await x.f.request(x.base, x.bob, "POST", { content: deniedSend });
    expect(rest.status).toBe(401);
    expect(await rest.text()).not.toMatch(/bob-original|private-original/);
    const msg = await x.post(x.alice, "private-after-disable");
    await Promise.all([ircClosed, eventsClosed]);
    await vi.waitFor(() => expect(x.events[0].some((e) => e.messageId === msg.id)).toBe(true));
    await x.f.barrier(x.a);
    await x.f.barrier(x.c);
    expect(x.b.lines.join("\n")).not.toContain("private-after-disable");
    expect(JSON.stringify(x.events[1])).not.toContain("private-after-disable");
    expect(JSON.stringify(x.events[2])).not.toMatch(/private-after-disable|disabled-publish/);
    expect(x.a.lines.join("\n")).not.toContain(deniedSend);
    expect(JSON.stringify(await x.history())).not.toContain(deniedSend);
    expect(
      (await x.history(x.other, x.charlie)).messages.find((m: any) => m.id === x.cm.id).content,
    ).toBe("private-original");
    x.sockets.forEach((s) => {
      s.terminate();
    });
    await x.f.stop();
    const rows = (await x.f.snapshot("messages")).flat() as any[];
    expect(rows.some((m) => m.content === deniedSend)).toBe(false);
    expect(rows.find((m) => m.id === msg.id)).toMatchObject({
      content: "private-after-disable",
      sender_id: x.alice.account.id,
    });
    expect(rows.find((m) => m.id === x.bm.id)).toMatchObject({
      content: "bob-original",
      sender_id: x.bob.account.id,
    });
    const accounts = (await x.f.snapshot("users")).flat() as any[];
    expect(accounts.find((a) => a.id === x.bob.account.id).disabled_at).toBeTypeOf("number");
    expect(accounts.find((a) => a.id === x.alice.account.id).disabled_at).toBeNull();
    expect((await x.f.snapshot("channel_user_roles")).flat()).toHaveLength(0);
    await x.f.restart();
    expect((await x.f.request(x.base, x.bob)).status).toBe(401);
    expect((await x.history()).messages.find((m: any) => m.id === msg.id).content).toBe(
      "private-after-disable",
    );
    const login = await x.f.request("/api/v1/auth/login", null, "POST", {
      username: x.bob.username,
      password: x.bob.password,
    });
    expect(login.status).toBe(401);
  } finally {
    await x.dispose();
  }
});

it("MSG-002: REST and IRC secret-channel send denials preserve access and exclude all recipients", async () => {
  const x = await messageContext();
  try {
    const r = await x.f.request(x.other, x.alice, "POST", { content: "denied-private-send" });
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("Channel membership is required");
    x.a.send("PRIVMSG #private :denied-private-send");
    expect(await x.a.waitForNumeric(404)).toContain("Cannot send to channel (+n)");
    await x.settle();
    expect(JSON.stringify(x.events)).not.toContain("denied-private-send");
    expect([x.b, x.c].flatMap((c) => c.lines).join("\n")).not.toContain("denied-private-send");
    await x.unchanged();
    await x.persist((rows) => {
      expect(rows.some((m) => m.content === "denied-private-send")).toBe(false);
      expect(rows.find((m) => m.id === x.cm.id)).toMatchObject({
        content: "private-original",
        redacted: 0,
      });
      expect(rows.find((m) => m.id === x.bm.id)).toMatchObject({
        content: "bob-original",
        redacted: 0,
      });
    });
    await x.unchanged();
    expect((await x.f.request(x.other, x.alice)).status).toBe(403);
  } finally {
    await x.dispose();
  }
});

it("MSG-025: a failed append stays absent after recreation while unrelated history and the next durable sequence remain correct", async () => {
  const f = await createMatrixFixture();
  const sockets: WebSocket[] = [];
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const channel = "/api/v1/channels/%23fault/messages",
      other = "/api/v1/channels/%23other/messages";
    const joinActors = async () => {
      const a = await f.connect(alice),
        b = await f.connect(bob),
        c = await f.connect(charlie);
      for (const [client, name] of [
        [a, "#fault"],
        [b, "#fault"],
        [c, "#other"],
      ] as const) {
        client.send(`JOIN ${name}`);
        await client.waitForLine((l) => l.includes(" 366 ") && l.includes(name));
      }
      return [a, b, c];
    };
    const initial = await joinActors();
    initial[0].send("MODE #fault +s");
    await initial[0].waitForLine((l) => l.includes(" MODE #fault +s"));
    initial[2].send("MODE #other +s");
    await initial[2].waitForLine((l) => l.includes(" MODE #other +s"));
    const post = async (path: string, actor: typeof alice, content: string) => {
      const r = await f.request(path, actor, "POST", { content });
      expect(r.status).toBe(201);
      return ((await r.json()) as any).message;
    };
    const original = await post(channel, alice, "fault-original"),
      unrelated = await post(other, charlie, "unrelated-fault-control");
    await f.stop();
    // Only fault injection touches SQLite; actors and operations still use public interfaces.
    const sqliteFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? sqliteFiles(join(dir, entry.name))
          : entry.name.endsWith(".sqlite")
            ? [join(dir, entry.name)]
            : [],
      );
    let injected = false;
    for (const file of sqliteFiles(f.directory)) {
      const db = new DatabaseSync(file);
      try {
        if (!db.prepare("SELECT name FROM sqlite_master WHERE name='messages'").get()) continue;
        if (
          (db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as any)
            ?.value !== "#fault"
        )
          continue;
        db.exec(
          "CREATE TRIGGER messaging_append_fault BEFORE INSERT ON messages WHEN NEW.content = 'failed-durable-body' BEGIN SELECT RAISE(ABORT,'messaging append fault'); END",
        );
        injected = true;
      } finally {
        db.close();
      }
    }
    expect(injected).toBe(true);
    await f.restart();
    const [a, b, c] = await joinActors();
    const events: any[][] = [[], [], []];
    for (const [i, actor] of [alice, bob, charlie].entries()) {
      const r = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(r.status).toBe(200);
      const ws = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await r.json()) as any).ticket}`,
        ["flarc.events.v2"],
      );
      sockets.push(ws);
      ws.on("message", (data) => {
        if (!isReaderControl(ws, data)) events[i].push(JSON.parse(data.toString()));
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
    }
    const before = await (await f.request(channel, alice)).json();
    const access = async () => {
      const values = [];
      for (const [name, actor] of [
        ["%23fault", alice],
        ["%23other", charlie],
      ] as const)
        for (const type of ["info", "roles"]) {
          const r = await f.request(`/api/v1/channels/${name}/${type}`, actor);
          expect(r.status).toBe(200);
          values.push(await r.json());
        }
      return values;
    };
    const beforeAccess = await access();
    const failure = await f.request(channel, alice, "POST", { content: "failed-durable-body" });
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toMatch(/messaging append fault|sqlite|stack|fault-original/);
    expect(await (await f.request(channel, alice)).json()).toEqual(before);
    const denied = await f.request(`${channel}/${original.id}`, bob, "PATCH", {
      content: "forbidden-after-fault",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("You can only edit your own messages");
    const accepted = await post(channel, alice, "accepted-after-fault");
    expect(accepted.sequence).toBe(original.sequence + 1);
    await b.waitForLine((l) => l.includes(" PRIVMSG #fault :accepted-after-fault"));
    const marker = await post(other, charlie, "fault-stream-barrier");
    await vi.waitFor(() => {
      for (const e of events.slice(0, 2))
        expect(e.some((v) => v.messageId === accepted.id)).toBe(true);
      expect(events[2].some((v) => v.messageId === marker.id)).toBe(true);
    });
    await Promise.all([f.barrier(a), f.barrier(b), f.barrier(c)]);
    expect(JSON.stringify(events)).not.toMatch(/failed-durable-body|forbidden-after-fault/);
    expect(JSON.stringify(events[2])).not.toContain("accepted-after-fault");
    expect([a, b, c].flatMap((client) => client.lines).join("\n")).not.toMatch(
      /failed-durable-body|forbidden-after-fault/,
    );
    expect(await access()).toEqual(beforeAccess);
    sockets.forEach((s) => {
      s.terminate();
    });
    await f.stop();
    const rows = (await f.snapshot("messages")).flat() as any[];
    expect(rows.some((m) => /failed-durable-body|forbidden-after-fault/.test(m.content))).toBe(
      false,
    );
    expect(rows.find((m) => m.id === original.id)).toMatchObject({
      content: "fault-original",
      redacted: 0,
    });
    expect(rows.find((m) => m.id === unrelated.id)).toMatchObject({
      content: "unrelated-fault-control",
      redacted: 0,
    });
    expect(rows.find((m) => m.id === accepted.id)).toMatchObject({
      content: "accepted-after-fault",
      sequence: original.sequence + 1,
    });
    await f.restart();
    const after = (await (await f.request(channel, alice)).json()) as any;
    expect(after.messages.map((m: any) => m.id)).toEqual([accepted.id, original.id]);
    expect(await (await f.request(other, charlie)).text()).toContain("unrelated-fault-control");
  } finally {
    sockets.forEach((s) => {
      s.terminate();
    });
    await f.dispose();
  }
});

for (const hibernate of [false, true]) {
  it(`MSG-011 MSG-028: REST author edits immediately notify passive IRC author and member devices without replay requests${hibernate ? " after local hibernation" : ""}`, async () => {
    const x = await messageContext();
    try {
      // docs/drafts/ircord-edit.md requires these capabilities, not an ircord/edit CAP.
      const phone = await x.f.connect(x.alice, "alicephone");
      const devices = [x.a, phone, x.b, x.c];
      for (const client of devices) {
        const ack = client.waitForNewLine((l) => l.includes(" CAP ") && l.includes(" ACK "));
        client.send("CAP REQ :message-tags echo-message account-tag server-time batch chathistory");
        expect(await ack).toContain(
          "message-tags echo-message account-tag server-time batch chathistory",
        );
        expect(client.lines.join("\n")).toContain("CLIENTTAGDENY=*,-ircord/edit");
      }
      phone.send("JOIN #history");
      await phone.waitForNumeric(366);
      const liveAccess = await x.accessState();
      const unrelated = await x.history(x.other, x.charlie);
      // Wire-origin edit proves every passive recipient really understands/receives the edit protocol.
      x.b.send(`@+ircord/edit=${x.bm.id} PRIVMSG #history :wire-edit-live-control`);
      for (const client of devices.slice(0, 3)) {
        const control = await client.waitForLine((l) =>
          l.includes(" PRIVMSG #history :wire-edit-live-control"),
        );
        expect(control).toContain(`+ircord/edit=${x.bm.id}`);
        expect(control).toContain("account=bob");
        expect(control).toContain(":bob!");
      }
      await vi.waitFor(() => {
        for (const events of x.events.slice(0, 2))
          expect(
            events.some(
              (event) =>
                event.type === "message.updated" &&
                event.data?.newContent === "wire-edit-live-control",
            ),
          ).toBe(true);
      });
      await x.settle();
      expect(JSON.stringify(x.events[2])).not.toContain("wire-edit-live-control");
      const deniedStarts = devices.map((client) => client.lines.length);
      const deniedEventStarts = x.events.map((events) => events.length);
      const denied = await x.f.request(`${x.base}/${x.bm.id}`, x.alice, "PATCH", {
        content: "forbidden-passive-edit",
      });
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("You can only edit your own messages");
      const inaccessible = await x.f.request(`${x.other}/${x.cm.id}`, x.alice, "PATCH", {
        content: "forbidden-private-edit",
      });
      expect(inaccessible.status).toBe(403);
      expect(await inaccessible.text()).toContain("Channel membership is required");
      await x.settle();
      await x.f.barrier(phone);
      for (const [i, client] of devices.entries())
        expect(client.lines.slice(deniedStarts[i]).join("\n")).not.toMatch(
          /forbidden-passive-edit|forbidden-private-edit|\+ircord\/edit=/,
        );
      for (const [i, events] of x.events.entries())
        expect(JSON.stringify(events.slice(deniedEventStarts[i]))).not.toMatch(
          /forbidden-passive-edit|forbidden-private-edit|message\.updated/,
        );
      expect((await x.history()).messages.find((m: any) => m.id === x.bm.id)).toMatchObject({
        content: "wire-edit-live-control",
        senderId: x.bob.account.id,
      });
      const starts = devices.map((client) => client.lines.length);
      if (hibernate)
        await x.f.server.mf.unsafeEvictDurableObject("", "SessionDO", {
          name: "FlaRC",
          webSockets: "hibernate",
        });
      // No IRC input is sent between eviction and PATCH; a dormant recipient must be restored lazily.
      const patch = await x.f.request(`${x.base}/${x.am.id}`, x.alice, "PATCH", {
        content: "rest-passive-edited",
      });
      expect(patch.status).toBe(200);
      expect(((await patch.json()) as any).message).toMatchObject({
        id: x.am.id,
        content: "rest-passive-edited",
      });
      await vi.waitFor(() => {
        for (const events of x.events.slice(0, 2))
          expect(
            events.some(
              (e) =>
                e.type === "message.updated" &&
                e.messageId === x.am.id &&
                e.data.editor === "alice" &&
                e.data.newContent === "rest-passive-edited",
            ),
          ).toBe(true);
      });
      // Independent valid deliveries and PONGs bound the observation window; nobody requests replay yet.
      const marker = await x.post(x.alice, "passive-edit-after-marker");
      for (const client of devices.slice(0, 3))
        await client.waitForLine((l) => l.includes(" PRIVMSG #history :passive-edit-after-marker"));
      await x.post(x.charlie, "outsider-live-marker", x.other);
      await x.c.waitForLine((l) => l.includes(" PRIVMSG #private :outsider-live-marker"));
      await Promise.all(devices.map((client) => x.f.barrier(client)));
      const actual = devices.map((client, i) => client.lines.slice(starts[i]));
      const editTrackingIds: string[] = [];
      for (const [i, lines] of actual.slice(0, 3).entries()) {
        const edits = lines.filter(
          (l) =>
            l.includes(" PRIVMSG #history :rest-passive-edited") &&
            l.includes(`+ircord/edit=${x.am.id}`),
        );
        expect
          .soft(
            edits,
            `passive device ${i} must receive the REST edit before any CHATHISTORY; live lines: ${lines.join("\n")}`,
          )
          .toHaveLength(1);
        if (edits.length) {
          expect(edits[0]).toContain(":alice!");
          expect(edits[0]).toContain("account=alice");
          const trackingId = edits[0].match(/msgid=([^; ]+)/)?.[1];
          expect(trackingId).toBeTruthy();
          expect(trackingId).not.toBe(x.am.id);
          editTrackingIds.push(trackingId!);
        }
      }
      if (editTrackingIds.length) {
        expect(new Set(editTrackingIds).size).toBe(1);
        for (const events of x.events.slice(0, 2))
          expect(
            events.find((event) => event.type === "message.updated" && event.messageId === x.am.id)
              ?.data.editMessageId,
          ).toBe(editTrackingIds[0]);
      }
      expect(actual[3].join("\n")).not.toMatch(
        /rest-passive-edited|passive-edit-after-marker|wire-edit-live-control/,
      );
      expect(JSON.stringify(x.events[2])).not.toContain("rest-passive-edited");
      const history = await x.history();
      expect(history.messages.find((m: any) => m.id === x.am.id)).toMatchObject({
        content: "rest-passive-edited",
        senderId: x.alice.account.id,
        senderNick: "alice",
      });
      expect(await x.accessState()).toEqual(liveAccess);
      // Replay proves the divergence: new text is readable even when passive update delivery is missing.
      const replayStart = x.b.lines.length;
      x.b.send("CHATHISTORY LATEST #history * 100");
      await x.f.barrier(x.b);
      const replay = x.b.lines
        .slice(replayStart)
        .filter(
          (l) =>
            l.includes(`msgid=${x.am.id}`) && l.includes(" PRIVMSG #history :rest-passive-edited"),
        );
      expect(replay).toHaveLength(1);
      expect(replay[0]).toContain(":alice!");
      expect(replay[0]).toContain("account=alice");
      expect(
        (await x.history(x.other, x.charlie)).messages.find((m: any) => m.id === x.cm.id),
      ).toEqual(unrelated.messages.find((m: any) => m.id === x.cm.id));
      x.sockets.forEach((socket) => {
        socket.terminate();
      });
      await x.f.stop();
      const rows = (await x.f.snapshot("messages")).flat() as any[];
      expect(rows.find((m) => m.id === x.am.id)).toMatchObject({
        content: "rest-passive-edited",
        sender_id: x.alice.account.id,
        sender_nick: "alice",
        redacted: 0,
      });
      expect(
        rows.some((m) => /forbidden-passive-edit|forbidden-private-edit/.test(m.content)),
      ).toBe(false);
      expect(rows.find((m) => m.id === x.cm.id)).toMatchObject({
        content: "private-original",
        sender_id: x.charlie.account.id,
      });
      expect(rows.find((m) => m.id === marker.id)).toMatchObject({
        content: "passive-edit-after-marker",
      });
      expect((await x.f.snapshot("channel_user_roles")).flat()).toHaveLength(0);
      await x.f.restart();
      expect((await x.history()).messages.find((m: any) => m.id === x.am.id)).toMatchObject({
        content: "rest-passive-edited",
        senderId: x.alice.account.id,
      });
    } finally {
      await x.dispose();
    }
  });
}

for (const hibernate of [false, true]) {
  it(`MSG-027: disabled authority is rechecked on surviving sockets despite lost invalidation delivery${hibernate ? " after local hibernation" : ""}`, async () => {
    const f = await createMatrixFixture();
    const directory = mkdtempSync(join(tmpdir(), "messaging-invalidation-fault-"));
    const clients: TestIRCClient[] = [];
    const sockets: WebSocket[] = [];
    let mf: Miniflare | undefined;
    try {
      // Authentication and bootstrap remain public real REST flows; no account/session flags are injected.
      const root = await f.createActor("rootadmin", true),
        alice = await f.createActor("alice"),
        bob = await f.createActor("bob"),
        charlie = await f.createActor("charlie");
      await f.stop();
      const bundle = await ensureNitroBuilt();
      cpSync(dirname(bundle), join(directory, "production"), { recursive: true });
      const wrapper = join(directory, "wrapper.mjs");
      writeFileSync(
        wrapper,
        `export { default, AccountsDO, ChannelDO } from './production/index.mjs';
import { SessionDO as ProductionSessionDO } from './production/index.mjs';
export class SessionDO extends ProductionSessionDO {
  // Simulate the invalidation RPC being lost after Accounts committed disable.
  // Ingress checks, outbound checks, persistence and WebSocket attachments are untouched.
  async invalidateAccountPermissions(_username) { return 0; }
}
`,
      );
      mf = new Miniflare({
        modules: true,
        scriptPath: wrapper,
        modulesRoot: directory,
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
      const request: typeof f.request = async (route, actor, method = "GET", body) => {
        const response = await fetch(new URL(route, url), {
          method,
          headers: {
            ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        observedRoutes.push({
          testTitle: expect.getState().currentTestName,
          alias: route,
          method,
          status: response.status,
        });
        return response;
      };
      const connect = async (actor: typeof alice, nick = actor.username) => {
        const client = new TestIRCClient(`ws://${url.host}/irc`);
        clients.push(client);
        await client.connect();
        client.send(`PASS ${actor.username}:${actor.password}`);
        await client.register(nick);
        const ack = client.waitForNewLine((l) => l.includes(" CAP ") && l.includes(" ACK "));
        client.send("CAP REQ :message-tags echo-message account-tag");
        await ack;
        return client;
      };
      const owner = await connect(alice),
        sender = await connect(bob),
        receiver = await connect(bob, "bobphone"),
        outsider = await connect(charlie);
      for (const [client, channel] of [
        [owner, "#survive"],
        [sender, "#survive"],
        [receiver, "#survive"],
        [outsider, "#unrelated"],
      ] as const) {
        client.send(`JOIN ${channel}`);
        await client.waitForNumeric(366);
      }
      owner.send("MODE #survive +s");
      await owner.waitForLine((l) => l.includes(" MODE #survive +s"));
      outsider.send("MODE #unrelated +s");
      await outsider.waitForLine((l) => l.includes(" MODE #unrelated +s"));
      const events: any[][] = [[], [], []];
      for (const [i, actor] of [alice, bob, charlie].entries()) {
        const ticket = await request("/api/v1/auth/events-ticket", actor, "POST");
        expect(ticket.status).toBe(200);
        const ws = new WebSocket(
          `ws://${url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
          ["flarc.events.v2"],
        );
        sockets.push(ws);
        ws.on("message", (data) => {
          if (!isReaderControl(ws, data)) events[i].push(JSON.parse(data.toString()));
        });
        await new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
      }
      const channel = "/api/v1/channels/%23survive/messages",
        unrelated = "/api/v1/channels/%23unrelated/messages";
      const post = async (route: string, actor: typeof alice, content: string) => {
        const r = await request(route, actor, "POST", { content });
        expect(r.status).toBe(201);
        return ((await r.json()) as any).message;
      };
      const original = await post(channel, alice, "surviving-socket-original"),
        other = await post(unrelated, charlie, "surviving-unrelated-control");
      sender.send("PRIVMSG #survive :surviving-authorized-control");
      await owner.waitForLine((l) => l.includes(" PRIVMSG #survive :surviving-authorized-control"));
      await receiver.waitForLine((l) =>
        l.includes(" PRIVMSG #survive :surviving-authorized-control"),
      );
      await vi.waitFor(() => {
        for (const e of events.slice(0, 2))
          expect(e.some((v) => v.data?.content === "surviving-authorized-control")).toBe(true);
      });
      const denied = await request("/admin/accounts/bob/disable", charlie, "POST");
      expect(denied.status).toBe(403);
      const disable = await request("/admin/accounts/bob/disable", root, "POST");
      expect(disable.status).toBe(200);
      expect(await disable.json()).toMatchObject({ ok: true, invalidatedSessions: 0 });
      // This unconditional OPEN check and send distinguish the test from closure-only revocation.
      expect(sender.ws.readyState).toBe(WebSocket.OPEN);
      expect(receiver.ws.readyState).toBe(WebSocket.OPEN);
      if (hibernate)
        await mf.unsafeEvictDurableObject("", "SessionDO", {
          name: "FlaRC",
          webSockets: "hibernate",
        });
      expect(sender.ws.readyState).toBe(WebSocket.OPEN);
      expect(receiver.ws.readyState).toBe(WebSocket.OPEN);
      const senderClosed = new Promise<{ code: number; reason: string }>((resolve) =>
        sender.ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
      );
      const receiverClosed = new Promise<void>((resolve) =>
        receiver.ws.once("close", () => resolve()),
      );
      const eventsClosed = new Promise<void>((resolve) =>
        sockets[1].once("close", () => resolve()),
      );
      sender.send("PRIVMSG #survive :disabled-surviving-socket-publish");
      expect(await senderClosed).toMatchObject({
        code: 1000,
        reason: "Account no longer available",
      });
      const rejected = await request(channel, bob, "POST", {
        content: "disabled-surviving-rest-publish",
      });
      expect(rejected.status).toBe(401);
      const after = await post(channel, alice, "private-after-lost-invalidation");
      await owner.waitForLine((l) =>
        l.includes(" PRIVMSG #survive :private-after-lost-invalidation"),
      );
      // Another device may remain open after account-wide membership cleanup; its next input must also recheck credentials.
      if (receiver.ws.readyState === WebSocket.OPEN)
        receiver.send("PING :disabled-authority-probe");
      await Promise.all([receiverClosed, eventsClosed]);
      await vi.waitFor(() => expect(events[0].some((e) => e.messageId === after.id)).toBe(true));
      const marker = await post(unrelated, charlie, "lost-invalidation-marker");
      await outsider.waitForLine((l) =>
        l.includes(" PRIVMSG #unrelated :lost-invalidation-marker"),
      );
      await vi.waitFor(() => expect(events[2].some((e) => e.messageId === marker.id)).toBe(true));
      expect(receiver.lines.join("\n")).not.toContain("private-after-lost-invalidation");
      expect(JSON.stringify(events[1])).not.toContain("private-after-lost-invalidation");
      expect(outsider.lines.join("\n")).not.toContain("private-after-lost-invalidation");
      expect(JSON.stringify(events[2])).not.toContain("private-after-lost-invalidation");
      expect(owner.lines.join("\n")).not.toContain("disabled-surviving-socket-publish");
      expect(JSON.stringify(events)).not.toMatch(
        /disabled-surviving-socket-publish|disabled-surviving-rest-publish/,
      );
      expect(await (await request(channel, alice)).text()).not.toMatch(
        /disabled-surviving-socket-publish|disabled-surviving-rest-publish/,
      );
      sockets.forEach((socket) => {
        socket.terminate();
      });
      clients.forEach((client) => {
        client.close();
      });
      await mf.dispose();
      mf = undefined;
      const rows = (await f.snapshot("messages")).flat() as any[];
      expect(
        rows.some((row) =>
          /disabled-surviving-socket-publish|disabled-surviving-rest-publish/.test(row.content),
        ),
      ).toBe(false);
      expect(rows.find((row) => row.id === original.id)).toMatchObject({
        content: "surviving-socket-original",
        sender_id: alice.account.id,
      });
      expect(rows.find((row) => row.id === other.id)).toMatchObject({
        content: "surviving-unrelated-control",
        sender_id: charlie.account.id,
      });
      expect(rows.find((row) => row.id === after.id)).toMatchObject({
        content: "private-after-lost-invalidation",
        sender_id: alice.account.id,
      });
      const users = (await f.snapshot("users")).flat() as any[];
      expect(users.find((row) => row.id === bob.account.id).disabled_at).toBeTypeOf("number");
      expect(users.find((row) => row.id === alice.account.id).disabled_at).toBeNull();
      const roles = (await f.snapshot("account_roles")).flat() as any[];
      expect(roles.filter((row) => row.user_id === bob.account.id)).toEqual([]);
      expect(roles.filter((row) => row.user_id === root.account.id).map((row) => row.role)).toEqual(
        ["admin"],
      );
      expect((await f.snapshot("channel_user_roles")).flat()).toHaveLength(0);
      await f.restart();
      expect((await f.request(channel, bob)).status).toBe(401);
      expect(await (await f.request(channel, alice)).text()).toContain(
        "private-after-lost-invalidation",
      );
      expect(await (await f.request(unrelated, charlie)).text()).toContain(
        "surviving-unrelated-control",
      );
    } finally {
      sockets.forEach((socket) => {
        socket.terminate();
      });
      clients.forEach((client) => {
        client.close();
      });
      await mf?.dispose();
      await f.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
