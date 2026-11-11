import { createError, defineEventHandler, getQuery } from "nitro/h3";
import { z } from "zod";
import { resolveUrlEmbed } from "~/services/embeds/resolver";

const embedQuerySchema = z.object({
  url: z.string().url("Valid URL is required"),
});

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const parsed = embedQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Validation error",
      data: parsed.error.issues,
    });
  }

  const embed = await resolveUrlEmbed(parsed.data.url);
  if (!embed) {
    throw createError({
      statusCode: 404,
      statusMessage: "No embed metadata found for the requested URL",
    });
  }

  return {
    ok: true,
    embed,
  };
});
