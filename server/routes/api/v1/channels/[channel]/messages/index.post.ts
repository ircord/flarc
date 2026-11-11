import {
  createError,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { SendMessageSchema } from "~/schemas/messages";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel");
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const parsed = SendMessageSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const { name, canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const senderNick = parsed.data.senderNick || "APIUser";
  const senderId = `api-${senderNick}`;
  const tags: Record<string, string | true> = {};

  if (parsed.data.tags) {
    for (const [k, v] of Object.entries(parsed.data.tags)) {
      if (v === true) tags[k] = true;
      else if (typeof v === "string") tags[k] = v;
    }
  }

  if (parsed.data.replyToMessageId) {
    tags["+draft/reply"] = parsed.data.replyToMessageId;
    tags["+reply"] = parsed.data.replyToMessageId;
  }

  const res = await stub.appendMessage({
    channelName: name,
    sessionId: senderId,
    userId: senderId,
    accountName: senderNick,
    nickname: senderNick,
    username: "api",
    hostname: "gateway.api",
    command: "PRIVMSG",
    content: parsed.data.content,
    tags,
    isOper: true,
  });

  if (!res.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: res.errorText || "Failed to send message",
    });
  }

  setResponseStatus(event, 201);
  return { ok: true, message: res.message };
});
