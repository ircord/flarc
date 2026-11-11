import {
  createError,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam, requireChannelOpOrOwner } from "~/utils/auth";

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

  const user = await requireChannelOpOrOwner(event, channel);

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

  const result = await (stub as any).createWebhook(
    parsed.data.name,
    user.username,
    parsed.data.avatar_url,
  );

  setResponseStatus(event, 201);
  return result;
});
