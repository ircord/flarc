import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { channelFeature } from "~/services/channels/feature-errors";
import { channelFeatureStub } from "~/services/channels/feature-rpc";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const channel = parseChannelParam(getRouterParam(event, "channel", { decode: true }) ?? "");
  const env = getEnv(event);
  const stub = channelFeatureStub(env, channel.canon);
  const generation = await stub.getExistingChannelGeneration();
  if (!generation) throw createError({ statusCode: 404, statusMessage: "Channel unavailable" });
  const result = await channelFeature<{ ok: boolean; channelName: string }>(
    stub.accountLeave(getSessionToken(event)!, channel.name, generation),
  );
  if (!result.ok)
    throw createError({ statusCode: 403, statusMessage: "Channel membership required" });
  return { ok: true, channel: result.channelName, generation };
});
