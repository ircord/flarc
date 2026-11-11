import { createError, defineEventHandler, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { WebPushSubscribeSchema } from "~/schemas/notifications";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const parsed = WebPushSubscribeSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  await accountsStub.registerWebpush(
    parsed.data.username,
    parsed.data.endpoint,
    JSON.stringify(parsed.data.keys ?? {}),
  );

  return { ok: true, registered: true, endpoint: parsed.data.endpoint };
});
