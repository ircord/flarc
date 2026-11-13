import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "./event-reader";
import type { createMatrixFixture, MatrixActor } from "./matrix-fixture";
import type { TestIRCClient } from "./miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
export async function ircCommand(client: TestIRCClient, text: string, pattern: RegExp) {
  const done = client.waitForNewLine((line) => pattern.test(line));
  client.send(text);
  return await done;
}
export async function join(client: TestIRCClient, channel: string) {
  await ircCommand(client, `JOIN ${channel}`, new RegExp(` 366 .* ${channel} `));
}
export async function subscribe(client: TestIRCClient) {
  await ircCommand(client, "CAP REQ :draft/metadata-3", / CAP .* ACK .*draft\/metadata-3/);
  await ircCommand(
    client,
    "METADATA * SUB display-name avatar custom-status",
    / 770 .*display-name/,
  );
}
export async function observers(f: Fixture, actors: MatrixActor[], clients: TestIRCClient[]) {
  const sockets: WebSocket[] = [],
    received: string[][] = actors.map(() => []);
  try {
    for (const [i, actor] of actors.entries()) {
      const ticket = await f.request("/api/v1/auth/events-ticket", actor, "POST");
      expect(ticket.status).toBe(200);
      const socket = new WebSocket(
        `ws://${f.server.url.host}/api/v1/events?ticket=${((await ticket.json()) as any).ticket}`,
        ["flarc.events.v2"],
      );
      sockets.push(socket);
      socket.on("message", (data) => {
        if (!isReaderControl(socket, data)) received[i].push(data.toString());
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
    }
  } catch (error) {
    for (const socket of sockets) socket.terminate();
    throw error;
  }
  const barrier = async () => {
    const marker = `identity-barrier-${randomUUID()}`;
    const promises = sockets.map(
      (socket) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("missing identity event barrier")), 4000);
          socket.on("message", function listener(data) {
            if (data.toString().includes(marker)) {
              clearTimeout(timer);
              socket.off("message", listener);
              resolve();
            }
          });
        }),
    );
    expect(
      (
        await f.request("/api/v1/channels/%23identitybarrier/messages", actors[0], "POST", {
          content: marker,
        })
      ).status,
    ).toBe(201);
    await Promise.all([
      ...promises,
      ...clients.map((c) => c.waitForLine((l) => l.includes(marker))),
    ]);
    return marker;
  };
  return {
    received,
    barrier,
    close() {
      for (const socket of sockets) socket.terminate();
    },
  };
}
