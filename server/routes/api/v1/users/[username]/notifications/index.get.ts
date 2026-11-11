import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const username = getRouterParam(event, "username");
  if (!username) {
    throw createError({ statusCode: 400, statusMessage: "Username required" });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const user = await accountsStub.getAccountByUsername(username);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const notifications = await accountsStub.listChannelNotifications(user.id);
  return {
    ok: true,
    username,
    notifications,
  };
});
