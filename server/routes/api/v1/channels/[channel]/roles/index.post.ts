import { createError, defineEventHandler, getRouterParam, setResponseStatus } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { CreateRoleGroupSchema } from "~/schemas/channels";
import { clientRequest, getEnv, parseChannelParam, requireChannelFounder } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  const body = await readJsonBody(event);

  const parsed = CreateRoleGroupSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const _actor = await requireChannelFounder(event, rawChan);
  const { name, canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  let role: any;
  try {
    role = await clientRequest(event, stub, "role.create", {
      channelName: name,
      group: parsed.data,
    });
  } catch (error) {
    if (error instanceof Error && /^Invalid role (?:parent|inheritance)/.test(error.message))
      throw createError({ statusCode: 400, statusMessage: "Invalid role inheritance" });
    throw error;
  }
  setResponseStatus(event, 201);
  return { ok: true, role };
});
