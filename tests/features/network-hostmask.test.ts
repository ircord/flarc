import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMatrixFixture } from "../helpers/matrix-fixture";

it("denies a matching hostmask during an actual IRC login while an independent identity remains usable", async () => {
  const f = await createMatrixFixture();
  let socket: WebSocket | undefined;
  try {
    const root = await f.createActor("rootadmin", true);
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const receiver = await f.connect(bob);
    await f.barrier(receiver);
    const ban = await f.request("/admin/bans", root, "POST", {
      kind: "hostmask",
      value: "alice!*@127.0.0.1",
    });
    expect(ban.status).toBe(200);
    const {
      ban: { id },
    } = (await ban.json()) as { ban: { id: string } };
    socket = new WebSocket(f.server.wsUrl, ["text.ircv3.net"]);
    const lines: string[] = [];
    const outcome = new Promise<"welcome" | "closed">((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Neither banned close nor welcome observed")),
        6000,
      );
      socket!.on("message", (data) => {
        const line = data.toString();
        lines.push(line);
        if (line.includes(" 001 ")) {
          clearTimeout(timer);
          resolve("welcome");
        }
      });
      socket!.once("close", () => {
        clearTimeout(timer);
        resolve("closed");
      });
      socket!.once("error", reject);
      socket!.once("open", () => {
        socket!.send(`PASS ${alice.username}:${alice.password}`);
        socket!.send("NICK alice");
        socket!.send("USER alice 0 * :Alice");
      });
    });
    const observed = await outcome;
    let delivered = false;
    if (observed === "welcome") {
      const offset = receiver.lines.length;
      socket.send("PRIVMSG bob :hostmask-denial-marker");
      await f.barrier(receiver);
      delivered = receiver.lines
        .slice(offset)
        .some((line) => line.includes("hostmask-denial-marker"));
    }
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
    expect((await f.request(`/admin/bans/${id}`, root, "DELETE")).status).toBe(200);
    if (socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise<void>((resolve) => socket!.once("close", () => resolve()));
      socket.terminate();
      await closed;
    }
    const healthy = await f.connect(alice);
    await f.barrier(healthy);
    expect(observed).toBe("closed");
    expect(delivered).toBe(false);
    expect(lines.join("\n")).not.toContain(" 001 ");
  } finally {
    socket?.terminate();
    await f.dispose();
  }
}, 20000);

it("blocks an already authenticated hostmask-banned sender while an independent channel peer stays live", async () => {
  const f = await createMatrixFixture();
  try {
    const root = await f.createActor("rootadmin", true),
      alice = await f.createActor("alice"),
      bob = await f.createActor("bob");
    const sender = await f.connect(alice),
      receiver = await f.connect(bob);
    for (const client of [sender, receiver]) {
      const joined = client.waitForNewLine(
        (line) => line.includes(" 366 ") && line.includes("#hostcheck"),
      );
      client.send("JOIN #hostcheck");
      await joined;
    }
    const healthy = receiver.waitForNewLine((line) => line.includes("hostmask-before-ban"));
    sender.send("PRIVMSG #hostcheck :hostmask-before-ban");
    await healthy;
    const ban = await f.request("/admin/bans", root, "POST", {
      kind: "hostmask",
      value: "alice!*@127.0.0.1",
    });
    expect(ban.status).toBe(200);
    const offset = receiver.lines.length,
      nonce = randomUUID();
    const senderDone = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("No sender close or PONG after hostmask ban")),
        5000,
      );
      sender.ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      sender.ws.on("message", (data) => {
        if (data.toString().includes(nonce)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    sender.send("PRIVMSG #hostcheck :hostmask-after-ban-forbidden");
    sender.send(`PING :${nonce}`);
    await senderDone;
    await f.barrier(receiver);
    expect(receiver.lines.slice(offset).join("\n")).not.toContain("hostmask-after-ban-forbidden");
    expect((await f.request("/api/v1/profiles/bob", bob)).status).toBe(200);
  } finally {
    await f.dispose();
  }
}, 20000);
