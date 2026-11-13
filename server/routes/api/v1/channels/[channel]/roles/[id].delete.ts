import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireChannelFounder } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  const id = getRouterParam(event, "id", { decode: true });
  if (!rawChan || !id) {
    throw createError({ statusCode: 400, statusMessage: "Channel and role ID required" });
  }

  const _actor = await requireChannelFounder(event, rawChan);
  const { name, canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const deleted = await clientRequest(event, stub, "role.delete", { channelName: name, id });
  return { ok: deleted, id };
});
