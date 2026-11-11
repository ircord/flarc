import { createError, defineEventHandler, getQuery, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import {
  clientRequest,
  getEnv,
  parseChannelParam,
  requireAuthenticatedUser,
  requireChannelRead,
  requireSelf,
} from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel parameter required" });
  }

  await requireChannelRead(event, rawChan);
  const { name, canon } = parseChannelParam(rawChan);
  const query = getQuery(event);
  const actor = await requireAuthenticatedUser(event);
  const username =
    typeof query.username === "string"
      ? query.username
      : typeof query.user === "string"
        ? query.user
        : actor.username;

  await requireSelf(event, username);
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
  const summary = await clientRequest(event, stub, "unread", { username, lastReadMs });

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
