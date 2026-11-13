import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { allowedOutboundUrl } from "~/services/outbound";
import { outboundHosts } from "~/services/outbound-policy";
import { clientRequest, getEnv, parseChannelParam, requireChannelOpOrOwner } from "~/utils/auth";

const outgoingWebhookSchema = z.object({
  target_url: z.string().url(),
  secret: z.string().max(128).optional(),
  events: z.array(z.string()).default(["message.created"]),
});

export default defineEventHandler(async (event) => {
  const rawChan = getRouterParam(event, "channel", { decode: true });
  if (!rawChan) {
    throw createError({ statusCode: 400, statusMessage: "Channel required" });
  }

  await requireChannelOpOrOwner(event, rawChan);

  const body = await readBody(event);
  const parsed = outgoingWebhookSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Validation error",
      data: parsed.error.issues,
    });
  }

  if (!allowedOutboundUrl(parsed.data.target_url, outboundHosts(getEnv(event), "webhooks")))
    throw createError({
      statusCode: 400,
      statusMessage: "Webhook destination is not allowed by the server",
    });
  const { canon } = parseChannelParam(rawChan);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const result = await clientRequest(event, stub, "outgoing.create", {
    url: parsed.data.target_url,
    secret: parsed.data.secret,
    events: parsed.data.events,
    channelName: rawChan,
  });

  return { ok: true, webhook: result.webhook };
});
