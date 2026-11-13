import { createError, defineEventHandler, setResponseStatus } from "nitro/h3";
import { ChannelCreateSchema } from "~/schemas/channels";
import { channelFeature } from "~/services/channels/feature-errors";
import { channelFeatureStub } from "~/services/channels/feature-rpc";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";
import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const parsed = ChannelCreateSchema.safeParse(await readJsonBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid channel request" });
  const channel = parseChannelParam(parsed.data.name);
  const env = getEnv(event);
  const stub = channelFeatureStub(env, channel.canon);
  const result = await channelFeature(
    stub.accountCreate(getSessionToken(event)!, channel.name, parsed.data),
  );
  if (!result.ok) throw createError({ statusCode: 409, statusMessage: "Channel name unavailable" });
  setResponseStatus(event, 201);
  return result;
});
