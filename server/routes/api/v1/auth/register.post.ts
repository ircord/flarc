import { createError, defineEventHandler, getHeader, setResponseStatus } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { accountSourceMask, requestSource } from "~/core/request-source";
import { RegisterRequestSchema } from "~/schemas/auth";
import { getEnv } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event);

  const parsed = RegisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const source = requestSource(event.req, env);
  if (
    !source ||
    (await accountsStub.isNetworkBanned("", accountSourceMask(parsed.data.username, source)))
  )
    throw createError({ statusCode: 403, statusMessage: "Network access denied" });

  const res = await accountsStub.registerAccount({
    username: parsed.data.username,
    password: parsed.data.password,
    displayName: parsed.data.displayName,
    bootstrapToken: getHeader(event, "x-bootstrap-token"),
    signupToken: getHeader(event, "x-signup-token"),
  });

  if (!res.ok) {
    throw createError({ statusCode: 400, statusMessage: res.error });
  }

  setResponseStatus(event, 201);
  return res;
});
