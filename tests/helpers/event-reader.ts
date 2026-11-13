import type WebSocket from "ws";

/** Handle only transport frames; every domain frame remains visible to the caller. */
export function isReaderControl(ws: WebSocket, data: WebSocket.RawData): boolean {
  const frame = JSON.parse(data.toString());
  if (frame.type === "reader.challenge") {
    if (typeof frame.token !== "string") throw new Error("Invalid reader challenge");
    ws.send(JSON.stringify({ type: "reader.ack", token: frame.token }));
    return true;
  }
  return frame.type === "hello" && frame.protocol === 2;
}
