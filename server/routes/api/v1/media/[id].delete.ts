import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken } from "~/utils/auth";
export default defineEventHandler(async (event) => {
  const env = getEnv(event);
  const removed = await env.ACCOUNTS.get(
    env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
  ).deletePrivateMedia(getSessionToken(event)!, getRouterParam(event, "id", { decode: true })!);
  if (!removed) throw createError({ statusCode: 404, statusMessage: "File not found" });
  return { ok: true };
});
