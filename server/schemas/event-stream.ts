import { z } from "zod";

/** Transport-only: does not authorize subscriptions, replay, or domain mutation. */
export const ReaderAckSchema = z
  .object({ type: z.literal("reader.ack"), token: z.string().regex(/^[0-9a-f]{32}$/) })
  .strict();
export const EventStreamHelloSchema = z.object({
  type: z.literal("hello"),
  protocol: z.literal(2),
  ack: z.object({
    type: z.literal("reader.ack"),
    maxBytes: z.literal(262144),
    maxFrames: z.literal(1024),
    maxAgeMs: z.literal(30000),
  }),
});
export const ReaderChallengeSchema = z
  .object({ type: z.literal("reader.challenge"), token: z.string().regex(/^[0-9a-f]{32}$/) })
  .strict();
