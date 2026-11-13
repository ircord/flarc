import { z } from "zod";

export const ChannelCreateSchema = z
  .object({
    name: z.string().min(2).max(64),
    privacy: z.enum(["public", "secret"]).default("secret"),
    inviteOnly: z.boolean().default(false),
    key: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^\s,\x00-\x1f\x7f]+$/)
      .optional(),
    registeredOnly: z.boolean().default(false),
    moderated: z.boolean().default(false),
    readOnly: z.boolean().default(false),
  })
  .strict();

export const ChannelInfoSchema = z.object({
  channel: z.string(),
  generation: z.string().uuid(),
  canonicalName: z.string(),
  topic: z.string().nullable(),
  topicSetBy: z.string().nullable(),
  topicSetAt: z.number().nullable(),
  modes: z.string(),
  registered: z.boolean(),
  founder: z.string().nullable(),
  registeredAt: z.number().nullable(),
  avatar: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  nsfw: z.boolean().default(false),
  color: z.string().nullable(),
  readOnly: z.boolean(),
  memberCount: z.number(),
  createdAt: z.number(),
});

export const UpdateChannelInfoSchema = z.object({
  avatar: z.string().max(2048).nullable().optional(),
  description: z.string().max(2048).nullable().optional(),
  category: z.string().max(128).nullable().optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  nsfw: z.union([z.boolean(), z.string()]).optional(),
  color: z.string().max(32).nullable().optional(),
  readOnly: z.union([z.boolean(), z.string()]).nullable().optional(),
  topic: z.string().max(390).nullable().optional(),
});

export const ChannelRoleGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  ircPrefix: z.string().nullable(),
  ircMode: z.string().nullable(),
  priority: z.number(),
  permissions: z.array(z.string()),
  createdAt: z.number(),
});

export const CreateRoleGroupSchema = z.object({
  name: z.string().min(1).max(32),
  parentId: z.string().uuid().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  ircPrefix: z.enum(["~", "&", "@", "%", "+"]).nullable().optional(),
  ircMode: z.enum(["q", "a", "o", "h", "v"]).nullable().optional(),
  priority: z.number().int().min(0).max(100).default(0),
  permissions: z
    .array(
      z.enum([
        "send_messages",
        "change_topic",
        "kick_members",
        "ban_members",
        "attach_files",
        "manage_channel",
      ]),
    )
    .max(6)
    .default([]),
});

export const UpdateRoleGroupSchema = CreateRoleGroupSchema.partial().extend({
  priority: CreateRoleGroupSchema.shape.priority.unwrap().optional(),
  permissions: CreateRoleGroupSchema.shape.permissions.unwrap().optional(),
});

export const AssignUserRoleSchema = z
  .object({
    userId: z.string().uuid(),
    roleGroupId: z.string().uuid(),
    remove: z.boolean().optional(),
  })
  .strict();

export type ChannelInfo = z.infer<typeof ChannelInfoSchema>;
export type UpdateChannelInfoInput = z.infer<typeof UpdateChannelInfoSchema>;
export type ChannelRoleGroup = z.infer<typeof ChannelRoleGroupSchema>;
export type CreateRoleGroupInput = z.infer<typeof CreateRoleGroupSchema>;
export type AssignUserRoleInput = z.infer<typeof AssignUserRoleSchema>;
