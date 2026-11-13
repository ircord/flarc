import { defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const env = getEnv(event);
  const sessions = await env.ACCOUNTS.get(
    env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
  ).listAccountSessions(getSessionToken(event)!);
  return { ok: true, sessions };
});
