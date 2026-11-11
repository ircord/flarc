import { z } from "zod";

export const AdminConfigSchema = z.object({
  filehostEnabled: z.boolean().optional(),
  filehostRequireRegistration: z.boolean().optional(),
  zncMaxMessages: z.number().int().min(1).max(1000).optional(),
});

export const AdminBroadcastSchema = z.object({
  message: z.string().min(1).max(512),
  sender: z.string().max(32).optional(),
});

export const AdminDisconnectSessionSchema = z.object({
  sessionId: z.string().optional(),
  nickname: z.string().optional(),
  reason: z.string().max(128).optional(),
});

export type AdminConfigInput = z.infer<typeof AdminConfigSchema>;
export type AdminBroadcastInput = z.infer<typeof AdminBroadcastSchema>;
export type AdminDisconnectSessionInput = z.infer<typeof AdminDisconnectSessionSchema>;
