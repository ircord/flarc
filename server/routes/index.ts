import { defineEventHandler, getHeader, toRequest } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const upgrade = getHeader(event, "upgrade");
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    const env = getEnv(event);
    const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));
    const req = toRequest((event as any).req);
    return sessionStub.fetch(req);
  }

  return {
    service: "FlaRC (Flare Relay Chat) IRCv3 Server",
    websocketEndpoint: "/irc",
    subprotocols: ["text.ircv3.net", "binary.ircv3.net"],
  };
});
