import {
  createError,
  defineEventHandler,
  getHeader,
  getRouterParam,
  setResponseStatus,
} from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { SendMessageSchema } from "~/schemas/messages";
import { clientRequest, getEnv, parseChannelParam, requireChannelRead } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  const body = await readJsonBody(event);

  const parsed = SendMessageSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const actor = await requireChannelRead(event, rawChan);
  const member = await stub.getAccountMember(actor.id);
  if (!member)
    throw createError({
      statusCode: 403,
      statusMessage: "Join the channel before sending messages",
    });
  const _senderNick = member.nickname;
  const tags: Record<string, string | true> = {};

  if (parsed.data.tags) {
    for (const [k, v] of Object.entries(parsed.data.tags)) {
      if (!/^\+(?:[A-Za-z0-9.-]+\/)?[A-Za-z0-9-]+$/.test(k)) continue;
      if (v === true) tags[k] = true;
      else if (typeof v === "string") tags[k] = v;
    }
  }

  if (parsed.data.replyToMessageId) {
    tags["+draft/reply"] = parsed.data.replyToMessageId;
    tags["+reply"] = parsed.data.replyToMessageId;
  }

  const res = await clientRequest(event, stub, "send", {
    content: parsed.data.content,
    tags,
    idempotencyKey: getHeader(event, "idempotency-key")?.slice(0, 128),
  });

  if (!res.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: res.errorText || "Failed to send message",
    });
  }

  setResponseStatus(event, 201);
  return { ok: true, message: res.message, generation: res.generation };
});
