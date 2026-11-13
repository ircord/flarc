import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireChannelOpOrOwner } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel required" });
  }

  await requireChannelOpOrOwner(event, rawChan);

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const webhooks = await clientRequest(event, stub, "outgoing.list", { channelName: rawChan });
  return { ok: true, webhooks };
});
