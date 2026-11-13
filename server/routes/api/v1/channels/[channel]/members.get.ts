import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { channelFeature } from "~/services/channels/feature-errors";
import { channelFeatureStub } from "~/services/channels/feature-rpc";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";
export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const channel = parseChannelParam(getRouterParam(event, "channel", { decode: true }) ?? "");
  const env = getEnv(event),
    stub = channelFeatureStub(env, channel.canon);
  const generation = await stub.getExistingChannelGeneration();
  if (!generation) throw createError({ statusCode: 404, statusMessage: "Channel unavailable" });
  return channelFeature(stub.accountMembers(getSessionToken(event)!, channel.name, generation));
});
