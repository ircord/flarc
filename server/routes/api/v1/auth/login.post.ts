import { createError, defineEventHandler, getHeader, setCookie } from "nitro/h3";
import { newSessionToken } from "~/core/authentication/tokens";
import { SERVER_CONFIG } from "~/core/config";
import { accountSourceMask, requestSource } from "~/core/request-source";
import { LoginRequestSchema } from "~/schemas/auth";
import { getEnv, isAllowedCookieOrigin } from "~/utils/auth";

import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event);

  const parsed = LoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const cookieMode = getHeader(event, "x-flarc-session") === "cookie";
  if (cookieMode && !isAllowedCookieOrigin(event))
    throw createError({ statusCode: 403, statusMessage: "Origin denied" });
  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const res = await accountsStub.verifyCredentials(parsed.data.username, parsed.data.password);

  if (!res.ok) {
    throw createError({ statusCode: 401, statusMessage: res.error });
  }

  const source = requestSource(event.req, env);
  if (
    !source ||
    (await accountsStub.isNetworkBanned(
      res.account.id,
      accountSourceMask(res.account.username, source),
    ))
  )
    throw createError({ statusCode: 403, statusMessage: "Network access denied" });

  const session = await accountsStub.createApiSession(res.account.id);
  if (cookieMode) {
    const csrfToken = newSessionToken();
    await accountsStub.setSessionCsrf(session.token, csrfToken);
    setCookie(event, "__Host-flarc_session", session.token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
    return { ...res, expiresAt: session.expiresAt, csrfToken };
  }
  return { ...res, ...session };
});
