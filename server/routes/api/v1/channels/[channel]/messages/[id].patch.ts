import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { EditMessageSchema } from "~/schemas/messages";
import { clientRequest, getEnv, parseChannelParam, requireChannelRead } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event): Promise<any> => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  const messageId = getRouterParam(event, "id", { decode: true });
  if (!rawChan || !messageId) {
    throw createError({ statusCode: 400, statusMessage: "Channel and message ID required" });
  }

  const body = await readJsonBody(event);

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

  const _actor = await requireChannelRead(event, rawChan);
  const res = (await clientRequest(event, stub, "edit", {
    id: messageId,
    content: parsed.data.content,
  })) as {
    ok: boolean;
    error?: string;
    message?: Record<string, any>;
    generation: string;
  };

  if (!res.ok) {
    throw createError({ statusCode: 403, statusMessage: res.error || "Cannot edit message" });
  }

  return { ok: true, message: res.message, generation: res.generation };
});
