import { z } from "zod";

export const WebPushSubscribeSchema = z.object({
  username: z.string().min(1).max(32),
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((value) => value.startsWith("https://"), "HTTPS endpoint required"),
  keys: z
    .object({
      p256dh: z.string().max(256).optional(),
      auth: z.string().max(256).optional(),
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
