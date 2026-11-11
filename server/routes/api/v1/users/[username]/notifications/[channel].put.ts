import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireSelf } from "~/utils/auth";

const notificationUpdateSchema = z.object({
  level: z.enum(["all", "mentions", "nothing"]).default("mentions"),
  muted_until: z.number().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const username = getRouterParam(event, "username", { decode: true });
  const channel = getRouterParam(event, "channel", { decode: true });
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

  await requireSelf(event, username);
  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const user = await accountsStub.getAccountByUsername(username);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const { name } = parseChannelParam(channel);
  const result = await clientRequest(event, accountsStub, "notifications.update", {
    username,
    channel: name,
    level: parsed.data.level,
    mutedUntil: parsed.data.muted_until,
  });

  return {
    username,
    ...result,
  };
});
