import { createError, defineEventHandler, getQuery, getRouterParam } from "nitro/h3";
import { sessionFeature } from "~/features/session/http";

import { requireAuthenticatedUser } from "~/utils/auth";

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

  const limitStr = typeof query.limit === "string" ? query.limit : undefined;
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 100) : 50;
  const before = typeof query.before === "string" ? query.before : undefined;
  const after = typeof query.after === "string" ? query.after : undefined;

  const result = await sessionFeature(event, "legacy.history", {
    user,
    target,
    limit,
    before,
    after,
  });

  return {
    ok: true,
    user,
    target,
    ...result,
  };
});
