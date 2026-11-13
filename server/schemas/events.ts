import { z } from "zod";
import { MAX_REALTIME_EVENT_ID_LENGTH } from "../core/event-identifiers";
import { UserProfileSchema } from "./profiles";

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
  "conversation.created",
  "conversation.message_created",
  "conversation.message_updated",
  "conversation.message_redacted",
  "conversation.read",
  "user.metadata_updated",
  "channel.invited",
]);

export const ConversationMessageEventDataSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    senderId: z.string(),
    senderAccount: z.string().nullable(),
    senderNick: z.string(),
    recipientId: z.string().nullable(),
    content: z.string().nullable(),
    redacted: z.boolean(),
    tags: z.record(z.string(), z.union([z.string(), z.literal(true)])),
    revision: z.number().int().nonnegative(),
    sequence: z.number().int(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export const ConversationCreatedEventDataSchema = z
  .object({
    id: z.string(),
    kind: z.literal("direct"),
    participantIds: z.array(z.string()).min(1).max(2),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const ConversationReadEventDataSchema = z
  .object({
    conversationId: z.string(),
    messageId: z.string(),
    unread: z.number().int().nonnegative(),
  })
  .strict();
export const ProfileEventDataSchema = z
  .object({
    accountId: z.string(),
    profile: UserProfileSchema,
    revision: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.string().nullable()),
  })
  .strict();
export const PrivateMetadataEventDataSchema = z
  .object({
    accountId: z.string(),
    username: z.string(),
    revision: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.string().nullable()),
  })
  .strict();
export const ChannelMembershipEventDataSchema = z
  .object({
    accountId: z.string(),
    joined: z.boolean(),
    generation: z.string(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const ChannelDeletedControlDataSchema = z
  .object({
    channel: z.string(),
    previousGeneration: z.string(),
    generation: z.string(),
    revision: z.number().int().nonnegative().optional(),
    resync: z.literal(true),
  })
  .strict();
export const InvitationEventDataSchema = z
  .object({
    channel: z.string(),
    generation: z.string(),
    invited: z.boolean(),
    actorId: z.string(),
    targetAccountId: z.string(),
  })
  .strict();
export const ChannelMessageCreatedDataSchema = z
  .object({
    id: z.string(),
    senderId: z.string(),
    senderAccount: z.string().nullable().optional(),
    senderNick: z.string(),
    content: z.string(),
    tags: z.record(z.string(), z.union([z.string(), z.literal(true)])),
    createdAt: z.number(),
    sequence: z.number().optional(),
    command: z.string().optional(),
    expiresAt: z.number().optional(),
  })
  .passthrough();
export const ChannelMessageUpdatedDataSchema = z
  .object({
    channel: z.string(),
    messageId: z.string(),
    newContent: z.string(),
    editor: z.string(),
    editMessageId: z.string(),
  })
  .passthrough();
export const ChannelMessageDeletedDataSchema = z
  .object({ id: z.string(), operationId: z.string().optional() })
  .passthrough();
export const ChannelTopicEventDataSchema = z
  .object({ topic: z.string().nullable(), setBy: z.string() })
  .passthrough();
export const ChannelRoleEventDataSchema = z
  .object({
    roleGroupId: z.string(),
    channel: z.string().optional(),
    name: z.string().optional(),
    ircMode: z.string().nullable().optional(),
  })
  .passthrough();
export const ChannelMemberRoleEventDataSchema = z
  .object({ userId: z.string(), roleGroupId: z.string(), assigned: z.boolean() })
  .passthrough();
export const ChannelCreatedEventDataSchema = z
  .object({
    channel: z.string(),
    generation: z.string(),
    revision: z.number().int().nonnegative(),
    privacy: z.enum(["public", "secret"]),
  })
  .strict();
export const RealtimePayloadSchemas: Record<string, z.ZodType> = {
  "channel.created": ChannelCreatedEventDataSchema,
  "message.created": ChannelMessageCreatedDataSchema,
  "message.updated": ChannelMessageUpdatedDataSchema,
  "message.deleted": ChannelMessageDeletedDataSchema,
  "channel.topic_changed": ChannelTopicEventDataSchema,
  "channel.role_created": ChannelRoleEventDataSchema,
  "channel.role_updated": ChannelRoleEventDataSchema,
  "channel.role_deleted": ChannelRoleEventDataSchema,
  "channel.member_role_changed": ChannelMemberRoleEventDataSchema,
  "conversation.created": ConversationCreatedEventDataSchema,
  "conversation.message_created": ConversationMessageEventDataSchema,
  "conversation.message_updated": ConversationMessageEventDataSchema,
  "conversation.message_redacted": ConversationMessageEventDataSchema,
  "conversation.read": ConversationReadEventDataSchema,
  "user.profile_updated": ProfileEventDataSchema,
  "user.metadata_updated": PrivateMetadataEventDataSchema,
  "channel.member_joined": ChannelMembershipEventDataSchema,
  "channel.member_left": ChannelMembershipEventDataSchema,
  "channel.invited": InvitationEventDataSchema,
};

export const RealtimeEventSchema = z
  .object({
    type: EventTypeSchema,
    eventId: z.string().min(1).max(MAX_REALTIME_EVENT_ID_LENGTH),
    channelId: z.string().optional(),
    channelGeneration: z.string().optional(),
    conversationId: z.string().optional(),
    profileAccountId: z.string().optional(),
    ownerId: z.string().optional(),
    operationId: z.string().optional(),
    messageId: z.string().optional(),
    senderId: z.string().optional(),
    sequence: z.number().optional(),
    timestamp: z.string(),
    data: z.record(z.string(), z.unknown()),
  })
  .superRefine((event, context) => {
    const schema =
      event.type === "channel.deleted" && event.ownerId
        ? ChannelDeletedControlDataSchema
        : RealtimePayloadSchemas[event.type];
    if (schema) {
      const parsed = schema.safeParse(event.data);
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          context.addIssue({
            code: "custom",
            path: ["data", ...issue.path],
            message: issue.message,
          });
    }
  });

export type EventType = z.infer<typeof EventTypeSchema>;
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
