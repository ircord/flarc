import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { EditMessageSchema } from "~/schemas/messages";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event): Promise<any> => {
  const rawChan = getRouterParam(event, "channel");
  const messageId = getRouterParam(event, "id");
  if (!rawChan || !messageId) {
    throw createError({ statusCode: 400, statusMessage: "Channel and message ID required" });
  }

  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const parsed = EditMessageSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const senderNick = parsed.data.senderNick || "APIUser";
  const res = (await (stub as any).editMessage(messageId, senderNick, parsed.data.content)) as {
    ok: boolean;
    error?: string;
    message?: Record<string, any>;
  };

  if (!res.ok) {
    throw createError({ statusCode: 403, statusMessage: res.error || "Cannot edit message" });
  }

  return { ok: true, message: res.message };
});
