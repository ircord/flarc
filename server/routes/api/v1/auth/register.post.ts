import { createError, defineEventHandler, getHeader, readBody, setResponseStatus } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { RegisterRequestSchema } from "~/schemas/auth";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const parsed = RegisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

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
