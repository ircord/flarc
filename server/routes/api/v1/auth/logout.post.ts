import { defineEventHandler, deleteCookie } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import {
  getEnv,
  getSessionToken,
  isCookieAuthentication,
  requireAuthenticatedUser,
} from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const env = getEnv(event);
  await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).revokeApiSession(
    getSessionToken(event)!,
  );
  if (isCookieAuthentication(event))
    deleteCookie(event, "__Host-flarc_session", {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
    });
  return { ok: true };
});
