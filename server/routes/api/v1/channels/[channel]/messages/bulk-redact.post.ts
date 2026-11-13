import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { clientRequest, getEnv, parseChannelParam, requireChannelRead } from "~/utils/auth";
import { readJsonBody } from "~/utils/body";

const schema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(50),
    operationId: z
      .string()
      .regex(/^\d{13}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  })
  .strict()
  .refine((body) => new Set(body.ids).size === body.ids.length);

export default defineEventHandler(async (event) => {
  const channel = getRouterParam(event, "channel", { decode: true });
  if (!channel) throw createError({ statusCode: 400, statusMessage: "Channel required" });
  const body = schema.safeParse(await readJsonBody(event));
  if (!body.success) throw createError({ statusCode: 400, statusMessage: "Invalid bulk request" });
  await requireChannelRead(event, channel);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(
    env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${parseChannelParam(channel).canon}`),
  );
  const stamp = Number(body.data.operationId.slice(0, 13));
  if (stamp < Date.now() - 86400000 || stamp > Date.now() + 300000)
    throw createError({
      statusCode: 400,
      statusMessage: "Operation ID is outside the allowed time window",
    });
  const result = await clientRequest(event, stub, "bulk.redact", {
    ...body.data,
    channelName: channel,
  });
  if (result.capacity)
    throw createError({ statusCode: 429, statusMessage: "Operation capacity reached" });
  if (!result.ok) throw createError({ statusCode: 409, statusMessage: "Operation ID conflict" });
  return result;
});
