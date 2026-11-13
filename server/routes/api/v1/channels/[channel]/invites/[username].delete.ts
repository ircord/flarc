import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { channelFeature } from "~/services/channels/feature-errors";
import { channelFeatureStub } from "~/services/channels/feature-rpc";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";
export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const channel = parseChannelParam(getRouterParam(event, "channel", { decode: true }) ?? ""),
    username = getRouterParam(event, "username", { decode: true });
  if (!username) throw createError({ statusCode: 400, statusMessage: "Username required" });
  const env = getEnv(event),
    stub = channelFeatureStub(env, channel.canon);
  const generation = await stub.getExistingChannelGeneration();
  if (!generation) throw createError({ statusCode: 404, statusMessage: "Channel unavailable" });
  const result = await channelFeature(
    stub.accountInvite(getSessionToken(event)!, channel.name, generation, username, true),
  );
  if (!result.ok) throw createError({ statusCode: 403, statusMessage: "Invitation denied" });
  return { ok: true, channel: channel.name, generation, username };
});
