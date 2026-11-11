import { createError, defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const env = getEnv(event);
  const ticket = await env.ACCOUNTS.get(
    env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
  ).createEventTicket(getSessionToken(event)!);
  if (!ticket) throw createError({ statusCode: 401, statusMessage: "An API session is required" });
  return { ok: true, ticket, expiresIn: 30 };
});
