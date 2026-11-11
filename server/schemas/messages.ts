import { z } from "zod";

export const SendMessageSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(8191)
    .regex(/^[^\x00]*$/, "NUL is not valid IRC content"),
  senderNick: z.string().optional(),
  replyToMessageId: z.string().optional(),
  tags: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

export const EditMessageSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(8191)
    .regex(/^[^\x00]*$/, "NUL is not valid IRC content"),
  senderNick: z.string().optional(),
});

export const RedactMessageSchema = z.object({
  reason: z.string().max(256).optional(),
});

export const MessageSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  senderId: z.string(),
  senderAccount: z.string().nullable(),
  senderNick: z.string(),
  senderUser: z.string(),
  senderHost: z.string(),
  command: z.string(),
  content: z.string(),
  tags: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  replyToMessageId: z.string().nullable().optional(),
  redacted: z.boolean(),
  editedAt: z.number().nullable().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
});

export const ChannelUnreadSummarySchema = z.object({
  channel: z.string(),
  username: z.string().nullable(),
  unreadCount: z.number(),
  mentionCount: z.number(),
  lastMessageId: z.string().nullable(),
  lastMessageTime: z.number().nullable(),
  lastReadTimestamp: z.string().nullable(),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type EditMessageInput = z.infer<typeof EditMessageSchema>;
export type RedactMessageInput = z.infer<typeof RedactMessageSchema>;
export type MessageOutput = z.infer<typeof MessageSchema>;
export type ChannelUnreadSummary = z.infer<typeof ChannelUnreadSummarySchema>;
