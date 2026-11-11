import { defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { canAccessChannelHistory, getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const env = getEnv(event);
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  const channels = [];
  for (const channel of await sessionStub.adminListChannels()) {
    if ((await canAccessChannelHistory(event, channel.channelName)).allowed) channels.push(channel);
  }
  return { ok: true, channels };
});
