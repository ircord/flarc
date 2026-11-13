import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { UpdateChannelInfoSchema } from "~/schemas/channels";
import { clientRequest, getEnv, parseChannelParam, requireChannelRead } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  const body = await readJsonBody(event);

  const parsed = UpdateChannelInfoSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  await requireChannelRead(event, rawChan);
  const { name, canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const channel = await clientRequest(event, stub, "info.update", {
    updates: parsed.data,
    channelName: name,
  });
  return { ok: true, channel };
});
