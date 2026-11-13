import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { UpdateRoleGroupSchema } from "~/schemas/channels";
import { clientRequest, getEnv, parseChannelParam, requireChannelFounder } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event): Promise<any> => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  const id = getRouterParam(event, "id", { decode: true });
  if (!rawChan || !id) {
    throw createError({ statusCode: 400, statusMessage: "Channel and role ID required" });
  }

  const body = await readJsonBody(event);

  const _actor = await requireChannelFounder(event, rawChan);
  const { name, canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const parsed = UpdateRoleGroupSchema.safeParse(body);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Invalid role update" });
  let role: any;
  try {
    role = await clientRequest(event, stub, "role.update", {
      channelName: name,
      id,
      updates: parsed.data,
    });
  } catch (error) {
    if (error instanceof Error && /^Invalid role (?:parent|inheritance)/.test(error.message))
      throw createError({ statusCode: 400, statusMessage: "Invalid role inheritance" });
    throw error;
  }
  if (!role) {
    throw createError({ statusCode: 404, statusMessage: "Role group not found" });
  }

  return { ok: true, role };
});
