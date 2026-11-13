import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireChannelOpOrOwner } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const channel = getRouterParam(event, "channel", { decode: true });
  const id = getRouterParam(event, "id", { decode: true });
  if (!channel || !id) {
    throw createError({ statusCode: 400, statusMessage: "Channel and webhook ID required" });
  }

  await requireChannelOpOrOwner(event, channel);

  const { canon } = parseChannelParam(channel);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  await clientRequest(event, stub, "webhook.delete", { id, channelName: channel });
  return { ok: true };
});
