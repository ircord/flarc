import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import WebSocket from "ws";
import { isReaderControl } from "../../helpers/event-reader";
import { createMatrixFixture, type MatrixActor } from "../../helpers/matrix-fixture";
import type { TestIRCClient } from "../../helpers/miniflare-harness";

export { createMatrixFixture };
export const operation = () => `${Date.now()}.${randomUUID()}`;
export type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
export async function json(
  f: Pick<Fixture, "request">,
  route: string,
  actor: MatrixActor | null,
  method = "GET",
  body?: unknown,
  status = 200,
): Promise<any> {
  const response = await f.request(route, actor, method, body);
  const text = await response.text();
  expect(response.status, `${method} ${route}: ${text}`).toBe(status);
  return text ? JSON.parse(text) : null;
}
export async function wire(c: TestIRCClient, command: string, match: RegExp) {
  const result = c.waitForNewLine((line) => match.test(line));
  c.send(command);
  return result;
}
export async function stream(f: Fixture, actor: MatrixActor) {
  const { ticket } = await json(f, "/api/v1/auth/events-ticket", actor, "POST");
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}`, [
      "flarc.events.v2",
    ]),
    frames: any[] = [];
  ws.on("message", (data) => {
    if (!isReaderControl(ws, data)) frames.push(JSON.parse(data.toString()));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  async function until(predicate: (event: any) => boolean) {
    for (let i = 0; i < 400; i++) {
      const found = frames.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected feature event/result not received");
  }
  async function command(input: Record<string, unknown>) {
    const requestId = randomUUID();
    ws.send(JSON.stringify({ ...input, requestId }));
    return until((event) => event.requestId === requestId);
  }
  return { ws, frames, until, command, close: () => ws.terminate() };
}
