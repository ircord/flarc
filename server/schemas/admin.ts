import { z } from "zod";

export const AdminConfigSchema = z.object({
  filehostEnabled: z.boolean().optional(),
  filehostRequireRegistration: z.boolean().optional(),
  zncMaxMessages: z.number().int().min(1).max(1000).optional(),
  signupPolicy: z.enum(["open", "closed", "invite"]).optional(),
  minPasswordLength: z.number().int().min(1).max(1024).optional(),
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

import { RegisterAccountSchema } from "./auth";
import { UpdateChannelInfoSchema } from "./channels";
import { UserProfileInputSchema } from "./profiles";

const name = z.string().min(1).max(32);
const role = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
export const AdminAccountCreateSchema = RegisterAccountSchema.extend({
  roles: z.array(role).max(32).optional(),
});
export const AdminAccountUpdateSchema = z
  .object({
    displayName: z.string().max(64).nullable().optional(),
    roles: z.array(role).max(32).optional(),
  })
  .strict();
export const AdminPasswordSchema = z.object({ password: z.string().min(1).max(1024) }).strict();
export const AdminRoleSchema = z
  .object({ role, action: z.enum(["grant", "revoke"]).default("grant") })
  .strict();
export const AdminMetadataSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-zA-Z0-9_.:/-]{1,64}$/)
      .optional(),
    value: z.string().max(2048).nullable().optional(),
    entries: z
      .record(z.string().regex(/^[a-zA-Z0-9_.:/-]{1,64}$/), z.string().max(2048).nullable())
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      Boolean(
        body.key ||
          (body.entries &&
            Object.keys(body.entries).length > 0 &&
            Object.keys(body.entries).length <= 32),
      ),
    "Provide key/value or up to 32 entries",
  );
export const AdminRedactSchema = z
  .object({
    channel: z.string().min(2).max(64),
    msgId: z.string().min(1).max(128),
    reason: z.string().max(256).optional(),
  })
  .strict();
export const AdminDestroySchema = z.object({ purgeMessages: z.boolean() }).strict();
export const AdminRegisterChannelSchema = z.object({ founder: name.optional() }).strict();
export const AdminModesSchema = z
  .object({
    modeString: z.string().min(1).max(64),
    modeArgs: z.array(z.string().max(256)).max(64).default([]),
  })
  .strict();
export const AdminTopicSchema = z
  .object({ topic: z.string().max(390), setBy: z.string().max(64).optional() })
  .strict();
export const AdminKickSchema = z
  .object({ nickname: name, reason: z.string().max(390).optional() })
  .strict();
export const AdminBotSchema = z
  .object({
    enabled: z.boolean().optional(),
    welcomeMessage: z.string().max(390).nullable().optional(),
  })
  .strict();
export const AdminPurgeSchema = z
  .object({
    all: z.boolean().optional(),
    beforeTimestamp: z.number().int().nonnegative().optional(),
    beforeMsgId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    (body) => Boolean(body.all || body.beforeTimestamp !== undefined || body.beforeMsgId),
    "Provide a purge boundary or all=true",
  );

export function adminBodySchema(path: string, method: string): z.ZodType {
  if (path === "/config") return AdminConfigSchema;
  if (path === "/broadcast")
    return AdminBroadcastSchema.extend({
      notice: z.boolean().optional(),
      wallops: z.boolean().optional(),
    }).strict();
  if (path === "/sessions/disconnect")
    return AdminDisconnectSessionSchema.strict().refine(
      (body) => body.sessionId || body.nickname,
      "Session or nickname required",
    );
  if (path === "/accounts" || path === "/accounts/register") return AdminAccountCreateSchema;
  if (path === "/accounts/disable") return z.object({ username: name }).strict();
  if (/^\/profile\/[^/]+$/.test(path)) return UserProfileInputSchema.strict();
  if (/^\/accounts\/[^/]+\/password$/.test(path)) return AdminPasswordSchema;
  if (/^\/accounts\/[^/]+\/roles$/.test(path)) return AdminRoleSchema;
  if (/^\/accounts\/[^/]+$/.test(path) && method === "PATCH") return AdminAccountUpdateSchema;
  if (/^\/metadata\/(users|channels)\/[^/]+$/.test(path)) return AdminMetadataSchema;
  if (path === "/messages/redact") return AdminRedactSchema;
  if (/^\/channels\/[^/]+$/.test(path) && method === "DELETE") return AdminDestroySchema;
  if (/^\/channels\/[^/]+\/register$/.test(path)) return AdminRegisterChannelSchema;
  if (/^\/channels\/[^/]+\/info$/.test(path)) return UpdateChannelInfoSchema.strict();
  if (/^\/channels\/[^/]+\/modes$/.test(path)) return AdminModesSchema;
  if (/^\/channels\/[^/]+\/topic$/.test(path)) return AdminTopicSchema;
  if (/^\/channels\/[^/]+\/kick$/.test(path)) return AdminKickSchema;
  if (/^\/channels\/[^/]+\/bot$/.test(path)) return AdminBotSchema;
  if (/^\/channels\/[^/]+\/messages\/purge$/.test(path)) return AdminPurgeSchema;
  return z.object({}).strict();
}
