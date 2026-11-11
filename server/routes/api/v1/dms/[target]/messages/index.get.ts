import { createError, defineEventHandler, getQuery, getRouterParam } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const target = getRouterParam(event, "target", { decode: true });
  if (!target) {
    throw createError({ statusCode: 400, statusMessage: "Target required" });
  }

  // 1. Authenticate caller
  const authUser = await requireAuthenticatedUser(event);

  const query = getQuery(event);
  const requestedUser = typeof query.user === "string" ? query.user : undefined;
  const user = requestedUser || authUser.username;

  // 2. Access control: Only participants in the DM or server admins can query messages
  const authCanon = canonicalizeIRCName(authUser.username);
  const targetCanon = canonicalizeIRCName(target);
  const userCanon = canonicalizeIRCName(user);

  const isParticipant = authCanon === targetCanon || authCanon === userCanon;
  if (!isParticipant) {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden: You can only query direct messages you participate in",
    });
  }

  const limitStr = typeof query.limit === "string" ? query.limit : undefined;
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 100) : 50;
  const before = typeof query.before === "string" ? query.before : undefined;
  const after = typeof query.after === "string" ? query.after : undefined;

  const env = getEnv(event);
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  const result = await (sessionStub as any).clientDirectMessages(
    getSessionToken(event)!,
    user,
    target,
    limit,
    before,
    after,
  );

  return {
    ok: true,
    user,
    target,
    ...result,
  };
});
