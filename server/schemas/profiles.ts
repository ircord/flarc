import { z } from "zod";

export const UserProfileSchema = z.object({
  username: z.string(),
  displayName: z.string().nullable(),
  avatar: z.string().nullable(),
  pronouns: z.string().nullable(),
  bio: z.string().nullable(),
  bot: z.boolean(),
  color: z.string().nullable(),
  customStatus: z.string().nullable(),
  timezone: z.string().nullable(),
  roles: z.array(z.string()),
  createdAt: z.number(),
});

export const UpdateProfileSchema = z.object({
  displayName: z.string().max(64).nullable().optional(),
  avatar: z.string().max(2048).nullable().optional(),
  pronouns: z.string().max(64).nullable().optional(),
  bio: z.string().max(2048).nullable().optional(),
  bot: z.union([z.boolean(), z.string()]).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  customStatus: z.string().max(256).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export const UserProfileInputSchema = UpdateProfileSchema;
