import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireChannelRead } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  const messageId = getRouterParam(event, "id", { decode: true });
  if (!rawChan || !messageId) {
    throw createError({ statusCode: 400, statusMessage: "Channel and message ID required" });
  }

  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const actor = await requireChannelRead(event, rawChan);
  const _member = await stub.getAccountMember(actor.id);
  const result = await clientRequest(event, stub, "redact", { id: messageId });
  if (!result.ok) throw createError({ statusCode: 403, statusMessage: result.errorMessage });
  await env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId)).broadcastLineToChannel(
    rawChan,
    `:${actor.username}!api@gateway.api REDACT ${rawChan} ${messageId}`,
    result.generation,
    true,
  );
  return { ok: true, id: messageId };
});
