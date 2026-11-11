import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel");
  const id = getRouterParam(event, "id");
  if (!rawChan || !id) {
    throw createError({ statusCode: 400, statusMessage: "Channel and role ID required" });
  }

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const deleted = await stub.deleteRoleGroup(id);
  return { ok: deleted, id };
});
