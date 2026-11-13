import {
  createError,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireChannelOpOrOwner } from "~/utils/auth";

const webhookSchema = z.object({
  name: z.string().min(1).max(32),
  avatar_url: z.string().url().optional(),
  created_by: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const channel = getRouterParam(event, "channel", { decode: true });
  if (!channel) {
    throw createError({ statusCode: 400, statusMessage: "Channel required" });
  }

  await requireChannelOpOrOwner(event, channel);

  const body = await readBody(event);
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Validation error",
      data: parsed.error.issues,
    });
  }

  const { canon } = parseChannelParam(channel);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const result = await clientRequest(event, stub, "webhook.create", {
    name: parsed.data.name,
    avatar: parsed.data.avatar_url,
    channelName: channel,
  });

  setResponseStatus(event, 201);
  return result;
});
