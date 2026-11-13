import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { z } from "zod";
import { channelFeature } from "~/services/channels/feature-errors";
import { channelFeatureStub } from "~/services/channels/feature-rpc";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";
import { readJsonBody } from "~/utils/body";

const schema = z.object({ purge: z.boolean().default(false) }).strict();
export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const channel = parseChannelParam(getRouterParam(event, "channel", { decode: true }) ?? "");
  const body = schema.safeParse((await readJsonBody(event)) ?? {});
  if (!body.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid channel removal" });
  const env = getEnv(event),
    stub = channelFeatureStub(env, channel.canon);
  const generation = await stub.getExistingChannelGeneration();
  if (!generation) throw createError({ statusCode: 404, statusMessage: "Channel unavailable" });
  return channelFeature(
    stub.accountDestroy(getSessionToken(event)!, channel.name, generation, body.data.purge),
  );
});
