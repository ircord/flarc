import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireChannelOpOrOwner } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  const id = getRouterParam(event, "id", { decode: true });
  if (!rawChan || !id) {
    throw createError({ statusCode: 400, statusMessage: "Channel and webhook ID required" });
  }

  await requireChannelOpOrOwner(event, rawChan);

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  await clientRequest(event, stub, "outgoing.delete", { id, channelName: rawChan });
  return { ok: true };
});
