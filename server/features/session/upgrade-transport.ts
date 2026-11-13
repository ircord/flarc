import { EVENT_INPUT_LIMITS } from "./event-input-limits";

/**
 * Terminate the public handshake outside the hibernating Durable Object.
 * workerd can exchange Close frames with a hibernating socket without ending
 * the public TCP stream. An explicitly accepted pair completes that handshake;
 * shard ownership, admission, authorization and reader credit stay at the edge.
 * Forward synchronously without retaining payloads or introducing a JS queue.
 */
export function relayEventUpgrade(response: Response): Response {
  const backend = response.webSocket;
  if (!backend) throw new Error("Event upgrade did not return a WebSocket");
  const [client, frontend] = Object.values(new WebSocketPair());
  let closed = false;
  let inputWindow = { start: Date.now(), count: 0 };
  const close = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    const validCode = [1005, 1006, 1015].includes(code) ? 1008 : code;
    for (const socket of [frontend, backend]) {
      try {
        socket.close(validCode, reason);
      } catch {
        // The other endpoint may already have completed its handshake.
      }
    }
  };
  for (const [source, target] of [
    [backend, frontend],
    [frontend, backend],
  ]) {
    source.addEventListener("message", (event) => {
      if (closed || target.readyState !== WebSocket.OPEN) return;
      if (source === frontend) {
        const now = Date.now();
        if (now - inputWindow.start >= EVENT_INPUT_LIMITS.windowMs)
          inputWindow = { start: now, count: 0 };
        if (++inputWindow.count > EVENT_INPUT_LIMITS.maxFramesPerWindow) {
          close(1008, "Event command rate exceeded");
          return;
        }
        const bytes =
          typeof event.data === "string"
            ? new TextEncoder().encode(event.data).byteLength
            : event.data.byteLength;
        if (bytes > EVENT_INPUT_LIMITS.maxFrameBytes) {
          close(1008, "Event input frame too large");
          return;
        }
      }
      try {
        target.send(event.data);
      } catch {
        close(1008, "Event transport unavailable");
      }
    });
    source.addEventListener("close", (event) => close(event.code, event.reason));
    source.addEventListener("error", () => close(1008, "Event transport unavailable"));
  }
  backend.accept();
  frontend.accept();
  return new Response(null, { status: 101, headers: response.headers, webSocket: client });
}
