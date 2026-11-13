import { afterEach, expect, it, vi } from "vitest";
import { ReaderTransport } from "../../server/features/session/reader-transport";

function socket() {
  let attachment: Record<string, any> = {};
  const sent: Array<string | ArrayBuffer | Uint8Array> = [];
  const transport = {
    readyState: 1,
    code: undefined as number | undefined,
    reason: "",
    send(payload: string | ArrayBuffer | Uint8Array) {
      sent.push(payload);
    },
    serializeAttachment(value: Record<string, any>) {
      attachment = structuredClone(value);
    },
    deserializeAttachment() {
      return structuredClone(attachment);
    },
    close(code: number, reason: string) {
      this.code = code;
      this.reason = reason;
      this.readyState = 2;
    },
  };
  return { ws: transport as unknown as WebSocket, transport, sent };
}

afterEach(() => vi.restoreAllMocks());

it("places IRC reader challenges after a complete response and retains pending authorized output", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const f = socket(),
    reader = new ReaderTransport(() => {});
  reader.beginIRCResponse(f.ws);
  // Session retains one response guard while its asynchronous authorized
  // output queue is still draining after the command has finished.
  reader.beginIRCResponse(f.ws);
  for (let i = 0; i < 140; i++)
    expect(reader.send(f.ws, `:server 352 bob #room :${"x".repeat(490)}`, "irc")).toBe(true);
  reader.endIRCResponse(f.ws);
  expect(f.sent.some((line) => String(line).startsWith("PING "))).toBe(false);
  reader.send(f.ws, ":server 315 bob #room :End of WHO", "irc");
  reader.endIRCResponse(f.ws);
  expect(f.sent.at(-2)).toBe(":server 315 bob #room :End of WHO");
  expect(f.sent.at(-1)).toMatch(/^PING :flarc-reader:[0-9a-f]{32}\r\n$/);
  expect(f.sent.filter((line) => String(line).startsWith("PING "))).toHaveLength(1);
  const token = String(f.sent.at(-1)).match(/flarc-reader:([0-9a-f]{32})/)![1];
  expect(reader.acknowledge(f.ws, token, "irc")).toBe(true);
  expect(f.transport.deserializeAttachment().readerWindow).toMatchObject({ b: 0, f: 0, t: 0 });
});

it("keeps a challenge outside an outgoing IRC BATCH while event v2 still challenges at32 frames", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const irc = socket(),
    events = socket(),
    reader = new ReaderTransport(() => {});
  reader.send(irc.ws, ":server BATCH +history chathistory #room\r\n", "irc");
  for (let i = 0; i < 140; i++)
    reader.send(irc.ws, `@batch=history :bob PRIVMSG #room :${"x".repeat(490)}\r\n`, "irc");
  expect(irc.sent.some((line) => String(line).startsWith("PING "))).toBe(false);
  reader.send(irc.ws, ":server BATCH -history\r\n", "irc");
  expect(irc.sent.at(-2)).toBe(":server BATCH -history\r\n");
  expect(irc.sent.at(-1)).toMatch(/^PING :flarc-reader:/);
  for (let i = 0; i < 32; i++) reader.send(events.ws, "{}", "events-v2");
  expect(JSON.parse(String(events.sent.at(-1)))).toMatchObject({ type: "reader.challenge" });
});

it("defers idle challenges during replies without extending the absolute oldest debt deadline", () => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = socket(),
    deadlines: number[] = [],
    reader = new ReaderTransport((deadline) => deadlines.push(deadline));
  reader.beginIRCResponse(f.ws);
  reader.send(f.ws, ":server 352 bob #room :reply pending", "irc");
  now = 21000;
  expect(reader.inspect(f.ws, "irc")).toBe(31000);
  expect(f.sent).toHaveLength(1);
  now = 31000;
  expect(reader.inspect(f.ws, "irc")).toBeNull();
  expect(f.transport.code).toBe(1008);
  expect(f.transport.reason).toContain("timed out");
  expect(Math.max(...deadlines)).toBe(31000);
});

it("keeps byte and frame hard limits while a reply defers its challenge", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  for (const payload of ["x", "x".repeat(64000)]) {
    const f = socket(),
      reader = new ReaderTransport(() => {});
    reader.beginIRCResponse(f.ws);
    let accepted = 0;
    while (reader.send(f.ws, payload, "irc")) accepted++;
    expect(f.transport.code).toBe(1008);
    expect(f.sent.some((line) => String(line).startsWith("PING "))).toBe(false);
    const state = f.transport.deserializeAttachment().readerWindow;
    expect(state.b).toBeLessThanOrEqual(262144);
    expect(state.f).toBeLessThanOrEqual(1024);
    expect(accepted).toBe(payload.length === 1 ? 1024 : 4);
  }
});
