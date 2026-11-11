import { defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const env = getEnv(event);
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  const channels = await sessionStub.adminListChannels();
  return { ok: true, channels };
});
