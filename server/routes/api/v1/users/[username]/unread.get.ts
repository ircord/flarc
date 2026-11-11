import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, parseChannelParam } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawUser = getRouterParam(event, "username");
  const username = decodeURIComponent(rawUser || "").trim();
  if (!username) {
    throw createError({ statusCode: 400, statusMessage: "Username required" });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  const activeChannels = await sessionStub.adminListChannels();
  const autoJoins = await accountsStub.getUserAutoJoinChannels(username);
  const channelNames = Array.from(
    new Set([...autoJoins, ...activeChannels.map((c: any) => c.channelName), "#general"]),
  );

  const unreadList = [];
  for (const ch of channelNames) {
    const { name, canon } = parseChannelParam(ch);
    const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));
    const lastReadTimestamp = await accountsStub.getReadMarker(username, name);
    const lastReadMs = lastReadTimestamp ? Date.parse(lastReadTimestamp) || 0 : 0;
    const summary = await stub.getUnreadSummary(username, lastReadMs);
    unreadList.push({
      channel: name,
      unreadCount: summary.unreadCount,
      mentionCount: summary.mentionCount,
      lastMessageId: summary.lastMessageId,
      lastMessageTime: summary.lastMessageTime,
      lastReadTimestamp,
    });
  }

  return { ok: true, username, channels: unreadList };
});
