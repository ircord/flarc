import { createError, defineEventHandler, getQuery, getRouterParam, readBody } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

export const webhookExecuteSchema = z
  .object({
    content: z.string().max(4000).optional(),
    username: z.string().max(32).optional(),
    avatar_url: z.string().url().optional(),
    embeds: z
      .array(
        z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          url: z.string().optional(),
          color: z.number().optional(),
          fields: z
            .array(
              z.object({
                name: z.string(),
                value: z.string(),
                inline: z.boolean().optional(),
              }),
            )
            .optional(),
          author: z
            .object({
              name: z.string().optional(),
              icon_url: z.string().optional(),
              url: z.string().optional(),
            })
            .optional(),
          footer: z
            .object({
              text: z.string().optional(),
              icon_url: z.string().optional(),
            })
            .optional(),
          image: z.object({ url: z.string() }).optional(),
          thumbnail: z.object({ url: z.string() }).optional(),
        }),
      )
      .optional(),
  })
  .refine((data) => Boolean(data.content?.trim() || (data.embeds && data.embeds.length > 0)), {
    message: "Either content or embeds must be provided",
  });

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token", { decode: true });
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: "Webhook token required" });
  }

  const queryParams = getQuery(event);
  const targetChannel = (queryParams.channel as string) || "#general";

  const body = await readBody(event);
  const parsed = webhookExecuteSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Validation error",
      data: parsed.error.issues,
    });
  }

  const { name, canon } = parseChannelParam(targetChannel);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const result = await stub.executeWebhook(
    token,
    {
      content: parsed.data.content,
      username: parsed.data.username,
      avatar_url: parsed.data.avatar_url,
      embeds: parsed.data.embeds,
    },
    getRouterParam(event, "id", { decode: true }),
  );

  if (!result.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: result.error || "Webhook execution failed",
    });
  }

  return {
    ok: true,
    channel: name,
    messageId: result.messageId,
  };
});
