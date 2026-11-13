import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const id = getRouterParam(event, "id") ?? "";
  const env = getEnv(event);
  try {
    const revoked = await env.ACCOUNTS.get(
      env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).revokeAccountSession(getSessionToken(event)!, id);
    if (!revoked) throw createError({ statusCode: 404, statusMessage: "Session not found" });
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "Account access denied")
      throw createError({ statusCode: 403, statusMessage: "Account access denied" });
    throw error;
  }
});
