// Execute inside the disposable release candidate container, never a live deployment.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import WebSocket from "ws";

const origin = "http://127.0.0.1:8788";
const proofPath = "/data/.container-smoke.json";
async function api(route, actor, method = "GET", body, status = 200) {
  const response = await fetch(new URL(route, origin), {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, `${method} ${route} status`);
  return response.json();
}
async function actor(username) {
  const password = `Smoke-${randomUUID()}!`;
  await api("/api/v1/auth/register", null, "POST", { username, password }, 201);
  return {
    username,
    password,
    ...(await api("/api/v1/auth/login", null, "POST", { username, password })),
  };
}
async function until(test, message) {
  const end = Date.now() + 10000;
  while (!(await test())) {
    if (Date.now() >= end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

await until(async () => {
  try {
    return (await fetch(`${origin}/health`)).ok;
  } catch {
    return false;
  }
}, "Container did not become ready");

if (process.env.FLARC_SMOKE_PHASE === "verify") {
  const proof = JSON.parse(await fs.readFile(proofPath, "utf8"));
  const history = await api(`${proof.room}/messages`, proof.alice);
  assert(JSON.stringify(history).includes(proof.messageId));
  assert(JSON.stringify(history).includes(proof.content));
  const own = await api(`/api/v1/profiles/${proof.alice.username}`, proof.alice);
  assert.equal(own.profile.username, proof.alice.username);
  const login = await api("/api/v1/auth/login", null, "POST", {
    username: proof.alice.username,
    password: proof.alice.password,
  });
  assert.equal(login.account.id, proof.alice.account.id);
  // IRC-only membership ends when that connection closes. Restart must retain
  // founder authority without restoring the departed ordinary member's access.
  await api(`${proof.room}/messages`, proof.bob, "GET", undefined, 403);
  await api(`${proof.room}/join`, proof.bob, "POST", {});
  assert(JSON.stringify(await api(`${proof.room}/messages`, proof.bob)).includes(proof.messageId));
  await api(`${proof.room}/messages`, proof.outsider, "GET", undefined, 403);
  console.log(
    "Container restart: persisted credentials/message, founder access, departed-member denial, rejoin and outsider denial passed",
  );
  await fs.rm(proofPath);
} else {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const alice = await actor(`a${suffix}`),
    bob = await actor(`b${suffix}`),
    outsider = await actor(`c${suffix}`);
  const channel = `#smoke${suffix}`,
    room = `/api/v1/channels/${encodeURIComponent(channel)}`;
  await api("/api/v1/channels", alice, "POST", { name: channel, privacy: "secret" }, 201);
  const lines = [];
  const socket = net.createConnection({ host: "127.0.0.1", port: 6667 });
  let pending = "",
    failure;
  socket.setEncoding("utf8");
  socket.on("error", (error) => {
    failure = error;
  });
  socket.on("data", (chunk) => {
    pending += chunk;
    const complete = pending.split("\n");
    pending = complete.pop();
    for (const raw of complete) {
      const line = raw.replace(/\r$/, "");
      lines.push(line);
      const ping = /^(?::[^ ]+ )?PING (.+)$/.exec(line);
      if (ping) socket.write(`PONG ${ping[1]}\r\n`);
    }
  });
  let events;
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(
      `PASS ${bob.username}:${bob.password}\r\nNICK ${bob.username}\r\nUSER ${bob.username} 0 * :Container smoke\r\n`,
    );
    await until(() => {
      if (failure) throw failure;
      return lines.some((line) => line.includes(" 001 "));
    }, "TCP IRC login failed");
    socket.write(`JOIN ${channel}\r\n`);
    await until(
      () => lines.some((line) => line.includes(" 366 ") && line.includes(channel)),
      "TCP IRC JOIN failed",
    );
    const { ticket } = await api("/api/v1/auth/events-ticket", bob, "POST");
    events = new WebSocket(`${origin.replace("http:", "ws:")}/api/v1/events?ticket=${ticket}`, [
      "flarc.events.v2",
    ]);
    const received = [];
    events.on("error", (error) => {
      failure = error;
    });
    events.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      received.push(frame);
      if (frame.type === "reader.challenge")
        events.send(JSON.stringify({ type: "reader.ack", token: frame.token }));
    });
    await until(() => {
      if (failure) throw failure;
      return received.some((frame) => frame.type === "hello");
    }, "Event v2 handshake failed");
    const content = `container-persisted-${suffix}`;
    const sent = await api(`${room}/messages`, alice, "POST", { content }, 201);
    await until(
      () => lines.some((line) => line.includes(content)),
      "REST message missing from TCP IRC",
    );
    await until(
      () => received.some((frame) => frame.messageId === sent.message.id),
      "REST message missing from event stream",
    );
    await api(`${room}/messages`, outsider, "GET", undefined, 403);
    await fs.writeFile(
      proofPath,
      JSON.stringify({ alice, bob, outsider, room, content, messageId: sent.message.id }),
      { mode: 0o600 },
    );
    console.log(
      "Container seed: actual REST authentication, secret channel, TCP IRC, WebSocket delivery and outsider denial passed",
    );
  } finally {
    events?.terminate();
    socket.destroy();
  }
}
