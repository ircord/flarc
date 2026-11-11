import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel");
  const messageId = getRouterParam(event, "id");
  if (!rawChan || !messageId) {
    throw createError({ statusCode: 400, statusMessage: "Channel and message ID required" });
  }

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const redacted = await stub.adminRedactMessage(messageId);
  return { ok: redacted, id: messageId };
});
