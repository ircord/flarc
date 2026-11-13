import { createError, defineEventHandler, getHeader, toRequest } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { requestSource } from "~/core/request-source";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const upgrade = getHeader(event, "upgrade");
  if (upgrade?.toLowerCase() !== "websocket") {
    throw createError({ statusCode: 426, statusMessage: "Expected WebSocket upgrade" });
  }

  const env = getEnv(event);
  const source = requestSource(event.req, env);
  if (!source) throw createError({ statusCode: 403, statusMessage: "Unverified request source" });
  console.log(`[FlaRC HTTP] WebSocket upgrade on /irc from ${source.ip}`);

  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));
  const req = toRequest((event as any).req);
  return sessionStub.fetch(req);
});
