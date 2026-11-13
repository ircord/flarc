/**
 * Per-connection acknowledgement window. The transport owns a single ordered
 * send queue and must charge the complete encoded frame before handing it off.
 * Socket send completion is not an acknowledgement. `now` is a trusted,
 * millisecond wall-clock reading; backwards readings fail closed across wakes.
 * This bounds this connection's charged output, not provider or OS memory.
 * IRC callers must use a distinct feature-challenge namespace: only a PONG
 * bearing that namespace is an ACK here. Ordinary or unsolicited protocol
 * PONGs are not feature acknowledgements and must not be passed to this class.
 */
export const READER_WINDOW_LIMITS = Object.freeze({
  maxBytes: 256 * 1024,
  maxFrames: 1024,
  challengeBytes: 64 * 1024,
  challengeFrames: 32,
  oldestTimeoutMs: 30_000,
  challengeTimeoutMs: 10_000,
});

export type ReaderChallengePolicy = { challengeBytes: number; challengeFrames: number };
/** IRC replies routinely exceed 32 small numerics; keep event negotiation unchanged. */
export const IRC_READER_CHALLENGE_POLICY: Readonly<ReaderChallengePolicy> = Object.freeze({
  challengeBytes: READER_WINDOW_LIMITS.challengeBytes,
  challengeFrames: 512,
});

export type ReaderDecision =
  | { kind: "continue" }
  | { kind: "challenge" }
  | { kind: "close"; reason: "capacity" | "timeout" | "clock" | "protocol" };

type Pending = { c: string; b: number; f: number; d: number; a: number };
type Reservation = { c: string; d: number };
export type ReaderWindowState = {
  v: 1;
  b: number;
  f: number;
  t: number;
  n: number;
  p?: Pending;
  r?: Reservation;
  x?: Extract<ReaderDecision, { kind: "close" }>["reason"];
};

const hexChallenge = /^[0-9a-f]{32}$/;
const safe = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const closed = (reason: Extract<ReaderDecision, { kind: "close" }>["reason"]): ReaderDecision => ({
  kind: "close",
  reason,
});

/** UTF-8 payload plus explicit transport overhead, measured before sending. */
export function encodedBytes(payload: string | Uint8Array, overhead = 0): number {
  if (!safe(overhead)) throw new RangeError("Invalid frame overhead");
  const size =
    typeof payload === "string" ? new TextEncoder().encode(payload).byteLength : payload.byteLength;
  if (!Number.isSafeInteger(size + overhead)) throw new RangeError("Encoded frame is too large");
  return size + overhead;
}

/** Exact RFC 6455 frame size for a known payload; caller supplies masking. */
export function websocketFrameBytes(payloadBytes: number, masked = false): number {
  if (!safe(payloadBytes)) throw new RangeError("Invalid payload size");
  const overhead = 2 + (payloadBytes < 126 ? 0 : payloadBytes <= 65535 ? 2 : 8) + (masked ? 4 : 0);
  if (!Number.isSafeInteger(payloadBytes + overhead))
    throw new RangeError("Encoded frame is too large");
  return payloadBytes + overhead;
}

export class AcknowledgedReaderWindow {
  private state: ReaderWindowState;

  constructor(
    saved?: ReaderWindowState,
    private readonly policy: Readonly<ReaderChallengePolicy> = READER_WINDOW_LIMITS,
  ) {
    if (
      !safe(policy.challengeBytes) ||
      !safe(policy.challengeFrames) ||
      policy.challengeBytes === 0 ||
      policy.challengeBytes >= READER_WINDOW_LIMITS.maxBytes ||
      policy.challengeFrames === 0 ||
      policy.challengeFrames >= READER_WINDOW_LIMITS.maxFrames
    )
      throw new TypeError("Invalid reader challenge policy");
    if (saved === undefined) {
      this.state = { v: 1, b: 0, f: 0, t: 0, n: 0 };
      return;
    }
    if (
      !saved ||
      typeof saved !== "object" ||
      Object.keys(saved).some((key) => !["v", "b", "f", "t", "n", "p", "r", "x"].includes(key))
    )
      throw new TypeError("Invalid reader window state");
    const p = saved.p,
      r = saved.r;
    if (
      saved.v !== 1 ||
      !safe(saved.b) ||
      !safe(saved.f) ||
      !safe(saved.t) ||
      !safe(saved.n) ||
      saved.b > READER_WINDOW_LIMITS.maxBytes ||
      saved.f > READER_WINDOW_LIMITS.maxFrames ||
      (saved.b === 0) !== (saved.f === 0) ||
      (saved.b === 0) !== (saved.t === 0) ||
      saved.t > saved.n ||
      (p !== undefined &&
        (!p ||
          typeof p !== "object" ||
          Object.keys(p).some((key) => !["c", "b", "f", "d", "a"].includes(key)) ||
          typeof p.c !== "string" ||
          !hexChallenge.test(p.c) ||
          !safe(p.b) ||
          !safe(p.f) ||
          !safe(p.d) ||
          !safe(p.a) ||
          p.b > saved.b ||
          p.f > saved.f ||
          p.b === 0 ||
          p.f === 0 ||
          p.a > saved.n ||
          (p.a > 0 && p.a < saved.t) ||
          (p.b === saved.b) !== (p.a === 0) ||
          (p.f === saved.f) !== (p.a === 0))) ||
      (r !== undefined &&
        (!r ||
          typeof r !== "object" ||
          Object.keys(r).some((key) => !["c", "d"].includes(key)) ||
          typeof r.c !== "string" ||
          !hexChallenge.test(r.c) ||
          !safe(r.d) ||
          saved.b === 0)) ||
      (p !== undefined && r !== undefined) ||
      (saved.x !== undefined && !["capacity", "timeout", "clock", "protocol"].includes(saved.x))
    )
      throw new TypeError("Invalid reader window state");
    this.state = { ...saved, ...(p ? { p: { ...p } } : {}), ...(r ? { r: { ...r } } : {}) };
  }

  snapshot(): ReaderWindowState {
    const { p, r, ...base } = this.state;
    return { ...base, ...(p ? { p: { ...p } } : {}), ...(r ? { r: { ...r } } : {}) };
  }

  /** Schedule a timer for this absolute deadline even if no more frames arrive. */
  nextDeadline(): number | null {
    const s = this.state;
    if (s.x) return s.n || 1;
    const deadlines = [
      ...(s.t ? [s.t + READER_WINDOW_LIMITS.oldestTimeoutMs] : []),
      ...(s.t && !s.p && !s.r
        ? [
            s.b >= this.policy.challengeBytes || s.f >= this.policy.challengeFrames
              ? s.n
              : s.t +
                READER_WINDOW_LIMITS.oldestTimeoutMs -
                READER_WINDOW_LIMITS.challengeTimeoutMs,
          ]
        : []),
      ...(s.p ? [s.p.d] : []),
      ...(s.r ? [s.r.d] : []),
    ];
    return deadlines.length ? Math.min(...deadlines) : null;
  }

  private close(reason: Extract<ReaderDecision, { kind: "close" }>["reason"]): ReaderDecision {
    this.state.x = reason;
    return closed(reason);
  }

  check(now: number): ReaderDecision {
    if (this.state.x) return closed(this.state.x);
    if (
      !safe(now) ||
      now === 0 ||
      now > Number.MAX_SAFE_INTEGER - READER_WINDOW_LIMITS.oldestTimeoutMs
    )
      return this.close("clock");
    const s = this.state;
    if (s.n && now < s.n) return this.close("clock");
    s.n = now;
    if (
      (s.t && now - s.t >= READER_WINDOW_LIMITS.oldestTimeoutMs) ||
      (s.p && now >= s.p.d) ||
      (s.r && now >= s.r.d)
    )
      return this.close("timeout");
    if (
      !s.p &&
      !s.r &&
      (s.b >= this.policy.challengeBytes ||
        s.f >= this.policy.challengeFrames ||
        (s.t > 0 &&
          now - s.t >=
            READER_WINDOW_LIMITS.oldestTimeoutMs - READER_WINDOW_LIMITS.challengeTimeoutMs))
    )
      return { kind: "challenge" };
    return { kind: "continue" };
  }

  /** Charges an ordinary, fully encoded frame. A reserved challenge must be committed first. */
  charge(frameBytes: number, now: number): ReaderDecision {
    const decision = this.check(now);
    if (decision.kind === "close") return decision;
    const s = this.state;
    if (s.r || !safe(frameBytes) || frameBytes === 0) return this.close("protocol");
    if (frameBytes > READER_WINDOW_LIMITS.maxBytes - s.b || s.f >= READER_WINDOW_LIMITS.maxFrames)
      return this.close("capacity");
    if (!s.b) s.t = now;
    if (s.p && !s.p.a) s.p.a = now;
    s.b += frameBytes;
    s.f++;
    return this.check(now);
  }

  /** Reserve a fresh connection-specific token, then encode it before commitChallenge. */
  reserveChallenge(now: number): { decision: ReaderDecision; token?: string } {
    const decision = this.check(now);
    if (decision.kind === "close") return { decision };
    if (this.state.p || this.state.r || !this.state.b) return { decision: this.close("protocol") };
    const random = crypto.getRandomValues(new Uint8Array(16));
    const token = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
    this.state.r = { c: token, d: now + READER_WINDOW_LIMITS.challengeTimeoutMs };
    return { decision: { kind: "continue" }, token };
  }

  /** Charge the encoded challenge and fix the only byte boundary this token can acknowledge. */
  commitChallenge(token: string, frameBytes: number, now: number): ReaderDecision {
    const decision = this.check(now);
    if (decision.kind === "close") return decision;
    const s = this.state,
      reservation = s.r;
    if (!reservation || reservation.c !== token || !safe(frameBytes) || !frameBytes)
      return this.close("protocol");
    if (frameBytes > READER_WINDOW_LIMITS.maxBytes - s.b || s.f >= READER_WINDOW_LIMITS.maxFrames)
      return this.close("capacity");
    s.b += frameBytes;
    s.f++;
    s.p = { c: token, b: s.b, f: s.f, d: reservation.d, a: 0 };
    delete s.r;
    return { kind: "continue" };
  }

  acknowledge(token: string, now: number): ReaderDecision {
    const decision = this.check(now);
    if (decision.kind === "close") return decision;
    const s = this.state,
      pending = s.p;
    if (!pending || token !== pending.c) return this.close("protocol");
    s.b -= pending.b;
    s.f -= pending.f;
    s.t = s.b ? pending.a : 0;
    delete s.p;
    return this.check(now);
  }
}
