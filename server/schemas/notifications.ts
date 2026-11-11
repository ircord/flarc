import { z } from "zod";

export const WebPushSubscribeSchema = z.object({
  username: z.string().min(1),
  endpoint: z.string().url(),
  keys: z
    .object({
      p256dh: z.string().optional(),
      auth: z.string().optional(),
    })
    .optional(),
});

export const WebPushSubscriptionsSchema = z.object({
  ok: z.boolean(),
  username: z.string(),
  endpoints: z.array(z.string()),
});

export type WebPushSubscribeInput = z.infer<typeof WebPushSubscribeSchema>;
export type WebPushSubscriptionsOutput = z.infer<typeof WebPushSubscriptionsSchema>;
