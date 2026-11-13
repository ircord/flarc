import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { AssignUserRoleSchema } from "~/schemas/channels";
import { clientRequest, getEnv, parseChannelParam } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  const rawBody = await readJsonBody(event);

  const parsed = AssignUserRoleSchema.safeParse(rawBody);
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid role assignment" });
  const body = parsed.data;

  const { name, canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  if (body.remove) {
    await clientRequest(event, stub, "role.remove", { ...body, channelName: name });
  } else {
    await clientRequest(event, stub, "role.assign", { ...body, channelName: name });
  }

  return { ok: true, userId: body.userId, roleGroupId: body.roleGroupId, assigned: !body.remove };
});
