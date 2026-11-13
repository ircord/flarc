import { z } from "zod";
import { UserProfileInputSchema } from "./profiles";

export const ClientOperationIdSchema = z.string().max(64);
export const ConversationSelectorSchema = z
  .object({
    conversationId: z.string().uuid(),
    senderId: z.string().uuid().optional(),
    recipientId: z.string().uuid().optional(),
  })
  .strict();
export const ConversationSendSchema = ConversationSelectorSchema.extend({
  content: z
    .string()
    .min(1)
    .max(8191)
    .refine((v) => !v.includes("\0"), "NUL is not allowed"),
  tags: z.record(z.string().max(64), z.union([z.string().max(4096), z.literal(true)])).optional(),
  clientOperationId: ClientOperationIdSchema,
}).strict();
export const ConversationEditSchema = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().min(1).max(128),
    content: z
      .string()
      .min(1)
      .max(8191)
      .refine((v) => !v.includes("\0"), "NUL is not allowed"),
    expectedRevision: z.number().int().nonnegative(),
    clientOperationId: ClientOperationIdSchema,
  })
  .strict();
export const ConversationRedactSchema = ConversationEditSchema.omit({ content: true });
export const EventSubscriptionsSchema = z
  .object({
    channels: z
      .array(
        z.object({ channel: z.string().max(64), generation: z.string().min(1).max(128) }).strict(),
      )
      .max(100)
      .optional(),
    conversations: z.array(z.string().uuid()).max(100).optional(),
    profiles: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();
export const EventCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("subscribe"),
      requestId: z.string().max(64).optional(),
      resources: EventSubscriptionsSchema,
      cursor: z.string().max(128).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("replay"),
      requestId: z.string().max(64).optional(),
      cursor: z.string().max(128),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("mutate"),
      requestId: z.string().max(64),
      operation: z.enum([
        "conversation.send",
        "conversation.edit",
        "conversation.redact",
        "conversation.read",
        "profile.update",
        "metadata.update",
        "channel.create",
        "channel.join",
        "channel.leave",
        "channel.invite",
        "channel.uninvite",
        "channel.delete",
        "channel.send",
        "channel.edit",
        "channel.redact",
        "channel.bulk.redact",
        "channel.topic",
        "channel.role.create",
        "channel.role.update",
        "channel.role.delete",
        "channel.role.assign",
        "channel.role.remove",
      ]),
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("bootstrap"),
      requestId: z.string().max(64).optional(),
      pageToken: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    })
    .strict(),
]);

export const ChannelLifecycleInputSchema = z
  .object({
    channel: z.string().min(2).max(64).regex(/^[#&]/),
    generation: z.string().max(128).optional(),
    key: z.string().max(128).optional(),
    target: z.string().max(128).optional(),
    purge: z.boolean().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    clientOperationId: ClientOperationIdSchema,
  })
  .strict();
const ChannelMutationBase = z
  .object({
    channel: z.string().min(2).max(64).regex(/^[#&]/),
    generation: z.string().min(1).max(128),
    clientOperationId: ClientOperationIdSchema,
  })
  .strict();
export const ChannelMutationInputSchemas: Record<string, z.ZodType> = {
  "channel.send": ChannelMutationBase.extend({
    content: z.string().min(1).max(8191),
    tags: z.record(z.string(), z.union([z.string(), z.literal(true)])).optional(),
  }),
  "channel.edit": ChannelMutationBase.extend({
    id: z.string().max(128),
    content: z.string().min(1).max(8191),
  }),
  "channel.redact": ChannelMutationBase.extend({
    id: z.string().max(128),
    reason: z.string().max(512).optional(),
  }),
  "channel.bulk.redact": ChannelMutationBase.extend({
    ids: z.array(z.string().min(1).max(128)).min(1).max(100),
    reason: z.string().max(512).optional(),
  }),
  "channel.topic": ChannelMutationBase.extend({ topic: z.string().max(390) }),
  "channel.role.create": ChannelMutationBase.extend({ group: z.record(z.string(), z.unknown()) }),
  "channel.role.update": ChannelMutationBase.extend({
    id: z.string().max(128),
    updates: z.record(z.string(), z.unknown()),
  }),
  "channel.role.delete": ChannelMutationBase.extend({ id: z.string().max(128) }),
  "channel.role.assign": ChannelMutationBase.extend({
    userId: z.string().uuid(),
    roleGroupId: z.string().max(128),
  }),
  "channel.role.remove": ChannelMutationBase.extend({
    userId: z.string().uuid(),
    roleGroupId: z.string().max(128),
  }),
};

export const ConversationCreateSchema = z
  .object({ peer: z.string().min(1).max(128), clientOperationId: ClientOperationIdSchema })
  .strict();
export const ConversationReadSchema = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().min(1).max(128),
    clientOperationId: ClientOperationIdSchema,
  })
  .strict();
export const MetadataMutationSchema = z
  .object({
    target: z.string().min(1).max(128).optional(),
    key: z.string().regex(/^[a-zA-Z0-9_.:/-]{1,64}$/),
    value: z.string().max(2048).nullable(),
    expectedRevision: z.number().int().nonnegative().optional(),
    clientOperationId: ClientOperationIdSchema.optional(),
  })
  .strict();

export const ProfileFeatureMutationSchema = UserProfileInputSchema.extend({
  expectedRevision: z.number().int().nonnegative().optional(),
  clientOperationId: ClientOperationIdSchema.optional(),
}).strict();
export const ConversationHistoryQuerySchema = z
  .object({
    senderId: z.string().uuid().optional(),
    recipientId: z.string().uuid().optional(),
    before: z.string().max(128).optional(),
    after: z.string().max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export const ConversationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    after: z.string().uuid().optional(),
  })
  .strict();
export const EventReplayQuerySchema = z
  .object({
    cursor: z.string().min(1).max(128),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const EventBootstrapQuerySchema = z
  .object({
    pageToken: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();
