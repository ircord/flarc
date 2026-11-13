import {
  AcknowledgedReaderWindow,
  encodedBytes,
  IRC_READER_CHALLENGE_POLICY,
  READER_WINDOW_LIMITS,
  type ReaderWindowState,
  websocketFrameBytes,
} from "./flow-control";

export type ReaderMode = "irc" | "events-v1" | "events-v2";
type Attachment = { readerWindow?: ReaderWindowState };
export const IRC_READER_PREFIX = "flarc-reader:";

/** One synchronous, ordered output boundary; native send completion gives no credit. */
export class ReaderTransport {
  private readonly ircReplies = new WeakMap<WebSocket, { responses: number; batches: number }>();
  constructor(private readonly arm: (deadline: number) => void) {}

  private window(ws: WebSocket, mode: ReaderMode) {
    const attachment = (ws.deserializeAttachment() ?? {}) as Attachment;
    return {
      attachment,
      window: new AcknowledgedReaderWindow(
        attachment.readerWindow,
        mode === "irc" ? IRC_READER_CHALLENGE_POLICY : undefined,
      ),
    };
  }

  beginIRCResponse(ws: WebSocket): void {
    const state = this.ircReplies.get(ws) ?? { responses: 0, batches: 0 };
    state.responses++;
    this.ircReplies.set(ws, state);
  }

  hasIRCResponse(ws: WebSocket): boolean {
    return Boolean(this.ircReplies.get(ws)?.responses);
  }

  endIRCResponse(ws: WebSocket): void {
    const state = this.ircReplies.get(ws);
    if (state) state.responses = Math.max(0, state.responses - 1);
    this.inspect(ws, "irc");
  }

  private blocked(ws: WebSocket): boolean {
    const state = this.ircReplies.get(ws);
    return Boolean(state && (state.responses || state.batches));
  }

  private deadline(ws: WebSocket, window: AcknowledgedReaderWindow): number | null {
    const state = window.snapshot();
    // A command/BATCH cannot extend the hard oldest-debt deadline. Its final
    // output boundary will challenge immediately if the soft limit was reached.
    if (this.blocked(ws) && state.t && !state.p && !state.r)
      return state.t + READER_WINDOW_LIMITS.oldestTimeoutMs;
    return window.nextDeadline();
  }

  private trackIRCBatches(ws: WebSocket, payload: string | ArrayBuffer | Uint8Array): void {
    const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
    for (const match of text.matchAll(/^(?:@\S+ )?(?::\S+ )?BATCH ([+-])\S+/gm)) {
      const state = this.ircReplies.get(ws) ?? { responses: 0, batches: 0 };
      state.batches = Math.max(0, state.batches + (match[1] === "+" ? 1 : -1));
      this.ircReplies.set(ws, state);
    }
  }

  private save(ws: WebSocket, window: AcknowledgedReaderWindow, arm = true) {
    // Merge with the latest attachment so authorization/cursor changes survive.
    ws.serializeAttachment({ ...ws.deserializeAttachment(), readerWindow: window.snapshot() });
    const deadline = this.deadline(ws, window);
    if (arm && !window.snapshot().x && deadline !== null) this.arm(deadline);
  }

  private close(ws: WebSocket, reason = "Reader acknowledgement required") {
    ws.serializeAttachment({ ...ws.deserializeAttachment(), readerClosed: true });
    try {
      ws.close(1008, reason);
    } catch {}
    return false;
  }

  private challenge(ws: WebSocket, window: AcknowledgedReaderWindow, mode: ReaderMode) {
    if (mode === "events-v1") {
      const payload = JSON.stringify({
        type: "resync.required",
        code: "READER_ACK_REQUIRED",
        protocol: 2,
      });
      if (window.charge(websocketFrameBytes(encodedBytes(payload)), Date.now()).kind !== "close")
        ws.send(payload);
      this.save(ws, window, false);
      return this.close(ws, "Reconnect with flarc.events.v2 for acknowledged streaming");
    }
    const reservation = window.reserveChallenge(Date.now());
    if (!reservation.token) return this.close(ws);
    const payload =
      mode === "irc"
        ? `PING :${IRC_READER_PREFIX}${reservation.token}\r\n`
        : JSON.stringify({ type: "reader.challenge", token: reservation.token });
    if (
      window.commitChallenge(
        reservation.token,
        websocketFrameBytes(encodedBytes(payload)),
        Date.now(),
      ).kind === "close"
    ) {
      this.save(ws, window);
      return this.close(ws, "Reader output capacity reached");
    }
    this.save(ws, window);
    const binary = mode === "irc" && ws.deserializeAttachment()?.subprotocol === "binary.ircv3.net";
    ws.send(binary ? new TextEncoder().encode(payload) : payload);
    return true;
  }

  send(ws: WebSocket, payload: string | ArrayBuffer | Uint8Array, mode: ReaderMode): boolean {
    if (ws.readyState !== 1 || ws.deserializeAttachment()?.readerClosed) return false;
    try {
      const { window } = this.window(ws, mode);
      const size = typeof payload === "string" ? encodedBytes(payload) : payload.byteLength;
      const decision = window.charge(websocketFrameBytes(size), Date.now());
      if (decision.kind === "close") {
        this.save(ws, window, false);
        return this.close(ws, "Reader output capacity or deadline reached");
      }
      if (mode === "irc") this.trackIRCBatches(ws, payload);
      this.save(ws, window, decision.kind === "continue" || this.blocked(ws));
      ws.send(payload);
      return decision.kind !== "challenge" || this.blocked(ws) || this.challenge(ws, window, mode);
    } catch {
      return this.close(ws);
    }
  }

  acknowledge(ws: WebSocket, token: string, mode: ReaderMode): boolean {
    if (ws.deserializeAttachment()?.readerClosed) return false;
    try {
      const { window } = this.window(ws, mode);
      const decision = window.acknowledge(token, Date.now());
      this.save(ws, window, decision.kind === "continue" || this.blocked(ws));
      if (decision.kind === "close")
        return this.close(ws, "Invalid or expired reader acknowledgement");
      return decision.kind !== "challenge" || this.blocked(ws) || this.challenge(ws, window, mode);
    } catch {
      return this.close(ws);
    }
  }

  inspect(ws: WebSocket, mode: ReaderMode): number | null {
    if (ws.readyState !== 1 || ws.deserializeAttachment()?.readerClosed) return null;
    try {
      const { window } = this.window(ws, mode);
      const decision = window.check(Date.now());
      this.save(ws, window, decision.kind === "continue" || this.blocked(ws));
      if (decision.kind === "close") {
        this.close(ws, "Reader acknowledgement timed out");
        return null;
      }
      if (decision.kind === "challenge" && !this.blocked(ws) && !this.challenge(ws, window, mode))
        return null;
      return this.deadline(ws, window);
    } catch {
      this.close(ws);
      return null;
    }
  }
}
