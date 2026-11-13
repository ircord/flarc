import { describe, expect, it } from "vitest";
import {
  AcknowledgedReaderWindow,
  encodedBytes,
  IRC_READER_CHALLENGE_POLICY,
  READER_WINDOW_LIMITS,
  websocketFrameBytes,
} from "../../server/features/session/flow-control";

function challenge(window: AcknowledgedReaderWindow, now: number, overhead = 12) {
  const reserved = window.reserveChallenge(now);
  expect(reserved.decision.kind).toBe("continue");
  expect(reserved.token).toMatch(/^[0-9a-f]{32}$/);
  expect(window.commitChallenge(reserved.token!, overhead, now).kind).toBe("continue");
  return reserved.token!;
}

describe("acknowledged reader window", () => {
  it("keeps IRC small numeric replies below its own threshold without changing event credit or hard bounds", () => {
    const irc = new AcknowledgedReaderWindow(undefined, IRC_READER_CHALLENGE_POLICY),
      events = new AcknowledgedReaderWindow();
    for (let i = 0; i < 511; i++) expect(irc.charge(16, 1000).kind).toBe("continue");
    expect(irc.charge(16, 1000).kind).toBe("challenge");
    for (let i = 0; i < 31; i++) expect(events.charge(16, 1000).kind).toBe("continue");
    expect(events.charge(16, 1000).kind).toBe("challenge");
    const bytes = new AcknowledgedReaderWindow(undefined, IRC_READER_CHALLENGE_POLICY);
    expect(bytes.charge(65536, 1000).kind).toBe("challenge");
    expect(bytes.charge(READER_WINDOW_LIMITS.maxBytes - 65536, 1001).kind).toBe("challenge");
    expect(bytes.charge(1, 1002)).toEqual({ kind: "close", reason: "capacity" });
    expect(
      new AcknowledgedReaderWindow(irc.snapshot(), IRC_READER_CHALLENGE_POLICY).check(31000),
    ).toEqual({ kind: "close", reason: "timeout" });
  });

  it("credits only the committed challenge boundary and retains later debt and its age", () => {
    const window = new AcknowledgedReaderWindow();
    expect(window.charge(100, 1000).kind).toBe("continue");
    const token = challenge(window, 1001, 12);
    expect(window.charge(25, 1002).kind).toBe("continue");
    expect(window.acknowledge(token, 1003).kind).toBe("continue");
    expect(window.snapshot()).toMatchObject({ b: 25, f: 1, t: 1002 });
    expect(window.check(1002 + READER_WINDOW_LIMITS.oldestTimeoutMs)).toEqual({
      kind: "close",
      reason: "timeout",
    });
  });

  it("rejects guessed, foreign, reserved-before-send and replayed challenges without credit", () => {
    const left = new AcknowledgedReaderWindow(),
      right = new AcknowledgedReaderWindow();
    left.charge(80, 1000);
    right.charge(80, 1000);
    const reservation = left.reserveChallenge(1001);
    expect(left.acknowledge(reservation.token!, 1002)).toEqual({
      kind: "close",
      reason: "protocol",
    });
    expect(left.snapshot().b).toBe(80);
    expect(left.commitChallenge(reservation.token!, 8, 1002)).toEqual({
      kind: "close",
      reason: "protocol",
    });
    const unguessed = new AcknowledgedReaderWindow();
    unguessed.charge(80, 1000);
    const token = challenge(unguessed, 1001, 8);
    const other = challenge(right, 1002, 8);
    expect(other).not.toBe(token);
    expect(unguessed.acknowledge(other, 1003)).toEqual({ kind: "close", reason: "protocol" });
    expect(unguessed.acknowledge(token, 1004)).toEqual({ kind: "close", reason: "protocol" });
    expect(unguessed.snapshot().b).toBe(88);
    expect(new AcknowledgedReaderWindow(unguessed.snapshot()).acknowledge(token, 1005)).toEqual({
      kind: "close",
      reason: "protocol",
    });
    const guessed = new AcknowledgedReaderWindow();
    guessed.charge(80, 1000);
    challenge(guessed, 1001, 8);
    expect(guessed.acknowledge("0".repeat(32), 1003)).toEqual({
      kind: "close",
      reason: "protocol",
    });
    const replay = new AcknowledgedReaderWindow();
    replay.charge(80, 1000);
    const valid = challenge(replay, 1001, 8);
    expect(replay.acknowledge(valid, 1004).kind).toBe("continue");
    expect(replay.acknowledge(valid, 1005)).toEqual({
      kind: "close",
      reason: "protocol",
    });
  });

  it("charges UTF-8 bytes and exact websocket header and masking overhead", () => {
    expect(encodedBytes("é🐋", 3)).toBe(9);
    expect(websocketFrameBytes(125)).toBe(127);
    expect(websocketFrameBytes(126)).toBe(130);
    expect(websocketFrameBytes(65536, true)).toBe(65550);
    const window = new AcknowledgedReaderWindow();
    expect(window.charge(websocketFrameBytes(encodedBytes("é🐋")), 2000).kind).toBe("continue");
    expect(window.snapshot().b).toBe(8);
    expect(() => websocketFrameBytes(-1)).toThrow(RangeError);
  });

  it("requests challenges by byte or frame count and refuses a burst beyond capacity", () => {
    const bytes = new AcknowledgedReaderWindow();
    expect(bytes.charge(READER_WINDOW_LIMITS.challengeBytes - 1, 1000).kind).toBe("continue");
    expect(bytes.charge(1, 1001).kind).toBe("challenge");
    expect(
      bytes.charge(READER_WINDOW_LIMITS.maxBytes - READER_WINDOW_LIMITS.challengeBytes, 1002).kind,
    ).toBe("challenge");
    expect(bytes.charge(1, 1003)).toEqual({ kind: "close", reason: "capacity" });
    expect(bytes.snapshot().b).toBe(READER_WINDOW_LIMITS.maxBytes);
    const frames = new AcknowledgedReaderWindow();
    for (let i = 0; i < READER_WINDOW_LIMITS.challengeFrames - 1; i++)
      expect(frames.charge(1, 2000 + i).kind).toBe("continue");
    expect(frames.charge(1, 2100).kind).toBe("challenge");
  });

  it("checks idle deadlines and preserves debt and the challenge deadline across rehydration", () => {
    const window = new AcknowledgedReaderWindow();
    window.charge(512, 1000);
    const token = challenge(window, 2000, 16);
    expect(window.nextDeadline()).toBe(2000 + READER_WINDOW_LIMITS.challengeTimeoutMs);
    window.charge(100, 2001);
    const encoded = JSON.stringify(window.snapshot());
    expect(encoded.length).toBeLessThan(512);
    const wake = new AcknowledgedReaderWindow(JSON.parse(encoded));
    expect(wake.snapshot()).toEqual(window.snapshot());
    expect(wake.check(2000 + READER_WINDOW_LIMITS.challengeTimeoutMs)).toEqual({
      kind: "close",
      reason: "timeout",
    });
    const second = new AcknowledgedReaderWindow(JSON.parse(encoded));
    expect(second.check(1999)).toEqual({ kind: "close", reason: "clock" });
    const third = new AcknowledgedReaderWindow(JSON.parse(encoded));
    expect(third.acknowledge(token, 2002).kind).toBe("continue");
    expect(third.snapshot()).toMatchObject({ b: 100, f: 1, t: 2001 });
    expect(third.nextDeadline()).toBe(
      2001 + READER_WINDOW_LIMITS.oldestTimeoutMs - READER_WINDOW_LIMITS.challengeTimeoutMs,
    );
  });

  it("challenges a low-traffic idle reader early and closes only if it remains silent", () => {
    const first = 1000;
    const challengeAt =
      first + READER_WINDOW_LIMITS.oldestTimeoutMs - READER_WINDOW_LIMITS.challengeTimeoutMs;
    const healthy = new AcknowledgedReaderWindow();
    expect(healthy.charge(12, first).kind).toBe("continue");
    expect(healthy.nextDeadline()).toBe(challengeAt);
    expect(healthy.check(challengeAt - 1).kind).toBe("continue");
    expect(healthy.check(challengeAt).kind).toBe("challenge");
    const token = challenge(healthy, challengeAt);
    expect(healthy.nextDeadline()).toBe(first + READER_WINDOW_LIMITS.oldestTimeoutMs);
    expect(healthy.acknowledge(token, first + READER_WINDOW_LIMITS.oldestTimeoutMs - 1).kind).toBe(
      "continue",
    );
    expect(healthy.nextDeadline()).toBeNull();
    expect(healthy.charge(5, first + READER_WINDOW_LIMITS.oldestTimeoutMs).kind).toBe("continue");

    const silent = new AcknowledgedReaderWindow();
    silent.charge(12, first);
    expect(silent.check(challengeAt).kind).toBe("challenge");
    challenge(silent, challengeAt);
    const restored = new AcknowledgedReaderWindow(JSON.parse(JSON.stringify(silent.snapshot())));
    expect(restored.nextDeadline()).toBe(first + READER_WINDOW_LIMITS.oldestTimeoutMs);
    expect(restored.check(restored.nextDeadline()!)).toEqual({ kind: "close", reason: "timeout" });
  });

  it("keeps attachment state bounded through repeated challenges and rejects corrupted state", () => {
    const window = new AcknowledgedReaderWindow();
    for (let i = 0; i < 1000; i++) {
      const now = 10_000 + i * 3;
      expect(window.charge(3, now).kind).toBe("continue");
      const token = challenge(window, now + 1, 8);
      expect(JSON.stringify(window.snapshot()).length).toBeLessThan(512);
      expect(window.acknowledge(token, now + 2).kind).toBe("continue");
    }
    expect(window.snapshot()).toMatchObject({ b: 0, f: 0, t: 0 });
    expect(() => new AcknowledgedReaderWindow({ v: 1, b: 1, f: 0, t: 1, n: 1 })).toThrow(TypeError);
    expect(
      () => new AcknowledgedReaderWindow({ ...window.snapshot(), unexpected: "x" } as any),
    ).toThrow(TypeError);
  });
});
