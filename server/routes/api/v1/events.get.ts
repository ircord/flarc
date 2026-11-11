import { createError, defineEventHandler, getHeader, toRequest } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const upgrade = getHeader(event, "upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    throw createError({ statusCode: 426, statusMessage: "Expected WebSocket upgrade" });
  }

  const clientIp =
    getHeader(event, "cf-connecting-ip") ?? getHeader(event, "x-forwarded-for") ?? "127.0.0.1";
  console.log(`[FlaRC HTTP] WebSocket upgrade on /api/v1/events from ${clientIp}`);

  const env = getEnv(event);
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));
  const req = toRequest((event as any).req);
  return sessionStub.fetch(req);
});
