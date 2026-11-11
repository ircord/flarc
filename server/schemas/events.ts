import { z } from "zod";

export const EventTypeSchema = z.enum([
  "message.created",
  "message.updated",
  "message.deleted",
  "channel.created",
  "channel.updated",
  "channel.deleted",
  "channel.member_joined",
  "channel.member_left",
  "channel.topic_changed",
  "channel.metadata_updated",
  "channel.role_created",
  "channel.role_updated",
  "channel.role_deleted",
  "channel.member_role_changed",
  "auth.registered",
  "auth.logged_in",
  "user.profile_updated",
  "unread.updated",
]);

export const RealtimeEventSchema = z.object({
  type: EventTypeSchema,
  eventId: z.string(),
  channelId: z.string().optional(),
  messageId: z.string().optional(),
  senderId: z.string().optional(),
  sequence: z.number().optional(),
  timestamp: z.string(),
  data: z.record(z.string(), z.any()),
});

export type EventType = z.infer<typeof EventTypeSchema>;
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
