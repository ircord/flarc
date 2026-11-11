import { z } from "zod";

export const RegisterAccountSchema = z
  .object({
    username: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-zA-Z0-9_\-[\]\\`^{}|]+$/, "Invalid IRC nickname format"),
    password: z.string().min(1, "Password cannot be empty").max(1024),
    displayName: z.string().max(64).optional(),
  })
  .strict();

export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1).max(1024),
});

export const ChangePasswordSchema = z.object({
  password: z.string().min(1).max(1024),
});

export type RegisterAccountInput = z.infer<typeof RegisterAccountSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const RegisterRequestSchema = RegisterAccountSchema;
export const LoginRequestSchema = LoginSchema;
