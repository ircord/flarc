/** Shared public-relay and shard admission limits, before command dispatch. */
export const EVENT_INPUT_LIMITS = Object.freeze({
  maxFrameBytes: 65536,
  maxFramesPerWindow: 150,
  windowMs: 10000,
});
