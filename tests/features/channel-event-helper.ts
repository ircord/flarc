import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import WebSocket from "ws";
import type { createMatrixFixture, MatrixActor } from "../helpers/matrix-fixture";

export async function channelEventStream(
  fixture: Awaited<ReturnType<typeof createMatrixFixture>>,
  actor: MatrixActor,
) {
  const response = await fixture.request("/api/v1/auth/events-ticket", actor, "POST");
  expect(response.status).toBe(200);
  const { ticket } = (await response.json()) as { ticket: string };
  const socket = new WebSocket(`ws://${fixture.server.url.host}/api/v1/events?ticket=${ticket}`);
  const events: string[] = [];
  socket.on("message", (message) => events.push(message.toString()));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    events,
    close: () => socket.terminate(),
    async subscribe(channel: string, generation: string) {
      const requestId = crypto.randomUUID();
      socket.send(
        JSON.stringify({
          type: "subscribe",
          requestId,
          resources: { channels: [{ channel, generation }] },
        }),
      );
      for (let i = 0; i < 500; i++) {
        const item = events
          .map((value) => JSON.parse(value))
          .find((value) => value.requestId === requestId);
        if (item) return item;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Missing subscription result");
    },
    async replay(cursor: string) {
      const requestId = crypto.randomUUID();
      socket.send(JSON.stringify({ type: "replay", requestId, cursor, limit: 100 }));
      for (let i = 0; i < 500; i++) {
        const item = events
          .map((value) => JSON.parse(value))
          .find((value) => value.requestId === requestId);
        if (item) return item;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Missing replay result");
    },
    async command(operation: string, input: Record<string, unknown>) {
      const requestId = crypto.randomUUID();
      socket.send(JSON.stringify({ type: "mutate", requestId, operation, input }));
      for (let i = 0; i < 500; i++) {
        const item = events
          .map((value) => JSON.parse(value))
          .find((value) => value.requestId === requestId);
        if (item) return item;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Missing command result: ${operation}`);
    },
    async until(needle: string) {
      for (let i = 0; i < 500; i++) {
        const event = events.find((value) => value.includes(needle));
        if (event) return JSON.parse(event);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Missing event: ${needle}`);
    },
  };
}

export async function insertLegacyChannelMetadata(directory: string, channel: string) {
  async function files(folder: string): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((entry) =>
          entry.isDirectory()
            ? files(path.join(folder, entry.name))
            : Promise.resolve(
                entry.name.endsWith(".sqlite") ? [path.join(folder, entry.name)] : [],
              ),
        ),
      )
    ).flat();
  }
  for (const file of await files(directory)) {
    const db = new DatabaseSync(file);
    try {
      if (
        !db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='channel_metadata'")
          .get()
      )
        continue;
      const name = db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as
        | { value: string }
        | undefined;
      if (name?.value !== channel) continue;
      db.prepare("INSERT INTO channel_kv_metadata(key,value,updated_at) VALUES(?,?,?)").run(
        "legacy-secret",
        "must-stay-archived",
        123,
      );
      return;
    } finally {
      db.close();
    }
  }
  throw new Error(`Missing channel database: ${channel}`);
}
