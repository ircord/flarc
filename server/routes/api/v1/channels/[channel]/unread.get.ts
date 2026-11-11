import { createError, defineEventHandler, getQuery, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel");
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  const { name, canon } = parseChannelParam(rawChan);
  const query = getQuery(event);
  const username =
    typeof query.username === "string"
      ? query.username
      : typeof query.user === "string"
        ? query.user
        : null;

  const env = getEnv(event);
  let lastReadMs = 0;
  let lastReadTimestamp: string | null = null;

  if (username) {
    const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
    lastReadTimestamp = await accountsStub.getReadMarker(username, name);
    if (lastReadTimestamp) {
      lastReadMs = Date.parse(lastReadTimestamp) || 0;
    }
  }

  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));
  const summary = await stub.getUnreadSummary(username || "", lastReadMs);

  return {
    ok: true,
    channel: name,
    username,
    unreadCount: summary.unreadCount,
    mentionCount: summary.mentionCount,
    lastMessageId: summary.lastMessageId,
    lastMessageTime: summary.lastMessageTime,
    lastReadTimestamp,
  };
});
