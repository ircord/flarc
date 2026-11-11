import { createError, defineEventHandler, getQuery, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { canAccessChannelHistory, getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel");
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  // Check channel access permissions (private/secret/invite-only channels require membership or admin)
  const access = await canAccessChannelHistory(event, rawChan);
  if (!access.allowed) {
    throw createError({
      statusCode: 403,
      statusMessage: access.reason || "Forbidden: Cannot access message history for this channel",
    });
  }

  const query = getQuery(event);
  const limitStr = typeof query.limit === "string" ? query.limit : undefined;
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 100) : 50;
  const before = typeof query.before === "string" ? query.before : undefined;
  const after = typeof query.after === "string" ? query.after : undefined;
  const around = typeof query.around === "string" ? query.around : undefined;

  const { name, canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const messages = await stub.getMessagesForAdmin(limit, before, after, around);
  const oldest = messages.length > 0 ? messages[messages.length - 1].id : null;
  const newest = messages.length > 0 ? messages[0].id : null;

  return {
    ok: true,
    channel: name,
    messages,
    pagination: {
      count: messages.length,
      limit,
      has_more: messages.length >= limit,
      oldest_id: oldest,
      newest_id: newest,
      before: before ?? null,
      after: after ?? null,
      around: around ?? null,
    },
  };
});
