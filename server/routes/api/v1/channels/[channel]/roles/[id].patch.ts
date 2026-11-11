import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel");
  const id = getRouterParam(event, "id");
  if (!rawChan || !id) {
    throw createError({ statusCode: 400, statusMessage: "Channel and role ID required" });
  }

  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const role = await (stub as any).updateRoleGroup(id, body);
  if (!role) {
    throw createError({ statusCode: 404, statusMessage: "Role group not found" });
  }

  return { ok: true, role };
});
