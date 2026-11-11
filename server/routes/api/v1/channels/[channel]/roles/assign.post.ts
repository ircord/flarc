import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { AssignUserRoleSchema } from "~/schemas/channels";
import { clientRequest, getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  let body: { userId?: string; roleGroupId?: string; remove?: boolean };
  try {
    body = (await readBody(event)) as typeof body;
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const parsed = AssignUserRoleSchema.safeParse(body);
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid role assignment" });
  body = parsed.data;

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  if (body.remove) {
    await clientRequest(event, stub, "role.remove", body);
  } else {
    await clientRequest(event, stub, "role.assign", body);
  }

  return { ok: true, userId: body.userId, roleGroupId: body.roleGroupId, assigned: !body.remove };
});
