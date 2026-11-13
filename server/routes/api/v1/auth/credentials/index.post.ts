import { createError, defineEventHandler } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "~/utils/auth";
import { readJsonBody } from "~/utils/body";

const schema = z
  .object({
    label: z.string().min(1).max(64),
    expiresAt: z.number().int().positive(),
    scopes: z
      .array(z.object({ operation: z.string(), resource: z.string() }).strict())
      .min(1)
      .max(32),
  })
  .strict();
export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const parsed = schema.safeParse(await readJsonBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid credential request" });
  const env = getEnv(event);
  try {
    const credential = await env.ACCOUNTS.get(
      env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).createScopedCredential(
      getSessionToken(event)!,
      parsed.data.label,
      parsed.data.scopes,
      parsed.data.expiresAt,
    );
    return { ok: true, credential };
  } catch (error) {
    if (
      error instanceof Error &&
      /Invalid credential|Scope exceeds authority|Account access denied/.test(error.message)
    )
      throw createError({ statusCode: 403, statusMessage: "Credential scope denied" });
    throw error;
  }
});
