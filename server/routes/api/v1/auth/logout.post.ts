import { defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const env = getEnv(event);
  await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).revokeApiSession(
    getSessionToken(event)!,
  );
  return { ok: true };
});
