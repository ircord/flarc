import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam, requireChannelOpOrOwner } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const channel = getRouterParam(event, "channel");
  if (!channel) {
    throw createError({ statusCode: 400, statusMessage: "Channel required" });
  }

  await requireChannelOpOrOwner(event, channel);

  const { name, canon } = parseChannelParam(channel);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const webhooks = await (stub as any).getWebhooks();
  return {
    ok: true,
    channel: name,
    webhooks,
  };
});
