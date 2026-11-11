import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel");
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  let body: { userId?: string; roleGroupId?: string; remove?: boolean };
  try {
    body = (await readBody(event)) as typeof body;
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  if (!body.userId || !body.roleGroupId) {
    throw createError({ statusCode: 400, statusMessage: "userId and roleGroupId required" });
  }

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  if (body.remove) {
    await stub.removeUserRole(body.userId, body.roleGroupId);
  } else {
    await stub.assignUserRole(body.userId, body.roleGroupId);
  }

  return { ok: true, userId: body.userId, roleGroupId: body.roleGroupId, assigned: !body.remove };
});
