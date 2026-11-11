import { createError, defineEventHandler, getQuery } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const username = typeof query.username === "string" ? query.username : "";
  const endpoint = typeof query.endpoint === "string" ? query.endpoint : "";

  if (!username || !endpoint) {
    throw createError({ statusCode: 400, statusMessage: "username and endpoint are required" });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  await accountsStub.unregisterWebpush(username, endpoint);
  return { ok: true, removed: true };
});
