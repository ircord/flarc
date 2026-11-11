import { createError, defineEventHandler, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { LoginRequestSchema } from "~/schemas/auth";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const parsed = LoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const res = await accountsStub.verifyCredentials(parsed.data.username, parsed.data.password);

  if (!res.ok) {
    throw createError({ statusCode: 401, statusMessage: res.error });
  }

  const session = await accountsStub.createApiSession(res.account.id);
  return { ...res, ...session };
});
