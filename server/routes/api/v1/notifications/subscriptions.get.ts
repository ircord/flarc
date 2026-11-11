import { createError, defineEventHandler, getQuery } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const username = typeof query.username === "string" ? query.username : "";
  if (!username) {
    throw createError({ statusCode: 400, statusMessage: "username parameter required" });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const endpoints = await accountsStub.listWebpush(username);
  return { ok: true, username, endpoints };
});
