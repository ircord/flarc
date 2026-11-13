import { createError, defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { WebPushSubscribeSchema } from "~/schemas/notifications";
import { clientRequest, getEnv, requireSelf } from "~/utils/auth";
import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event);

  const parsed = WebPushSubscribeSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  await requireSelf(event, parsed.data.username);
  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const result = await clientRequest(event, accountsStub, "push.register", {
    username: parsed.data.username,
    endpoint: parsed.data.endpoint,
    keys: JSON.stringify(parsed.data.keys ?? {}),
  });
  if (!result.ok) {
    if (result.code === "SUBSCRIPTION_LIMIT")
      throw createError({ statusCode: 429, statusMessage: "Push subscription limit reached" });
    throw createError({ statusCode: 400, statusMessage: "Invalid push subscription" });
  }

  return { ok: true, registered: true, endpoint: parsed.data.endpoint };
});
