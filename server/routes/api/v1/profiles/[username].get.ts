import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawUser = getRouterParam(event, "username");
  const username = decodeURIComponent(rawUser || "").trim();
  if (!username) {
    throw createError({ statusCode: 400, statusMessage: "Username required" });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const profile = await accountsStub.getUserProfile(username);
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: "Profile not found" });
  }

  return { ok: true, profile };
});
