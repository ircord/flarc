import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

const notificationUpdateSchema = z.object({
  level: z.enum(["all", "mentions", "nothing"]).default("mentions"),
  muted_until: z.number().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const username = getRouterParam(event, "username");
  const channel = getRouterParam(event, "channel");
  if (!username || !channel) {
    throw createError({ statusCode: 400, statusMessage: "Username and channel required" });
  }

  const body = await readBody(event);
  const parsed = notificationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Validation error",
      data: parsed.error.issues,
    });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const user = await accountsStub.getAccountByUsername(username);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const { name } = parseChannelParam(channel);
  const result = await accountsStub.setChannelNotification(
    user.id,
    name,
    parsed.data.level,
    parsed.data.muted_until,
  );

  return {
    username,
    ...result,
  };
});
