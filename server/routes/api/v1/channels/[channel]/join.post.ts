import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { z } from "zod";
import { channelFeature } from "~/services/channels/feature-errors";
import { channelFeatureStub } from "~/services/channels/feature-rpc";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";
import { readJsonBody } from "~/utils/body";

const schema = z.object({ key: z.string().max(128).optional() }).strict();
export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const channel = parseChannelParam(getRouterParam(event, "channel", { decode: true }) ?? "");
  const parsed = schema.safeParse((await readJsonBody(event)) ?? {});
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid join request" });
  const env = getEnv(event);
  const stub = channelFeatureStub(env, channel.canon);
  const generation = await stub.getExistingChannelGeneration();
  if (!generation) throw createError({ statusCode: 404, statusMessage: "Channel unavailable" });
  const result = await channelFeature<{ ok: boolean; channelName: string }>(
    stub.accountJoin(getSessionToken(event)!, channel.name, generation, parsed.data.key),
  );
  if (!result.ok) throw createError({ statusCode: 403, statusMessage: "Channel join denied" });
  return { ok: true, channel: result.channelName, generation };
});
