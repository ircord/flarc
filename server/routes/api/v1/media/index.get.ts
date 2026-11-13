import { createError, defineEventHandler, getQuery } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const query = getQuery(event);
  if (
    (query.channel && query.dm) ||
    (query.channel && typeof query.channel !== "string") ||
    (query.dm && typeof query.dm !== "string")
  )
    throw createError({ statusCode: 400, statusMessage: "Choose one media scope" });
  const scope =
    typeof query.channel === "string"
      ? { kind: "channel" as const, target: parseChannelParam(query.channel).name }
      : typeof query.dm === "string"
        ? { kind: "dm" as const, target: query.dm }
        : { kind: "private" as const };
  const env = getEnv(event);
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  if (query.pending !== undefined) {
    if (query.pending !== "1" || query.channel || query.dm)
      throw createError({ statusCode: 400, statusMessage: "Invalid pending media query" });
    const items = await accounts.listPendingMedia(getSessionToken(event)!);
    if (!items) throw createError({ statusCode: 403, statusMessage: "Media scope denied" });
    return { ok: true, items };
  }
  const items = await accounts.listPrivateMedia(getSessionToken(event)!, scope);
  if (!items) throw createError({ statusCode: 403, statusMessage: "Media scope denied" });
  return { ok: true, items };
});
