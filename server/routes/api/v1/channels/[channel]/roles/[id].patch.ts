import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { CreateRoleGroupSchema } from "~/schemas/channels";
import { clientRequest, getEnv, parseChannelParam, requireChannelFounder } from "~/utils/auth";

export default defineEventHandler(async (event): Promise<any> => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  const id = getRouterParam(event, "id", { decode: true });
  if (!rawChan || !id) {
    throw createError({ statusCode: 400, statusMessage: "Channel and role ID required" });
  }

  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const _actor = await requireChannelFounder(event, rawChan);
  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const parsed = CreateRoleGroupSchema.partial().safeParse(body);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Invalid role update" });
  const role = await clientRequest(event, stub, "role.update", { id, updates: parsed.data });
  if (!role) {
    throw createError({ statusCode: 404, statusMessage: "Role group not found" });
  }

  return { ok: true, role };
});
