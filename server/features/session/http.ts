import { createError, getQuery, getRouterParam, type H3Event, setResponseHeader } from "nitro/h3";
import { SERVER_CONFIG } from "../../core/config";
import { requestSource } from "../../core/request-source";
import { ConversationHistoryQuerySchema } from "../../schemas/conversations";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "../../utils/auth";
import { readJsonBody } from "../../utils/body";

export async function sessionFeature(event: H3Event, operation: string, input: unknown) {
  await requireAuthenticatedUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const env = getEnv(event),
    stub: any = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));
  try {
    const dto = input === undefined ? {} : JSON.parse(JSON.stringify(input));
    return {
      ok: true,
      ...(await stub.clientRequest(
        getSessionToken(event)!,
        operation,
        dto,
        requestSource(event.req, env),
      )),
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    const feature = text.match(/F3:(\d{3}):([A-Z_]+):([^\n]+)/);
    if (feature)
      throw createError({
        statusCode: Number(feature[1]),
        statusMessage: feature[2],
        data: {
          code: feature[2],
          message: feature[3],
          resync: feature[2] === "CURSOR_EXPIRED" || feature[2] === "BOOTSTRAP_PAGE_EXPIRED",
        },
      });
    if (/ZodError|invalid_type|unrecognized_keys|Invalid UUID/.test(text))
      throw createError({ statusCode: 400, statusMessage: "INVALID_INPUT" });
    if (/revision.*conflict|revision.*changed|stale.*revision/i.test(text))
      throw createError({ statusCode: 409, statusMessage: "REVISION_CONFLICT" });
    if (
      /access denied|scope denied|authorization required|owner.only|Account access denied/i.test(
        text,
      )
    )
      throw createError({ statusCode: 403, statusMessage: "FORBIDDEN" });
    if (/Authentication required|expired session/i.test(text))
      throw createError({ statusCode: 401, statusMessage: "SESSION_EXPIRED" });
    if (/Invalid metadata|Invalid.*revision|operation.*format/i.test(text))
      throw createError({ statusCode: 400, statusMessage: "INVALID_INPUT" });
    throw error;
  }
}
export function selectors(event: H3Event) {
  const q = getQuery(event);
  const parsed = ConversationHistoryQuerySchema.safeParse(q);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "INVALID_SELECTOR" });
  return {
    conversationId: getRouterParam(event, "conversation", { decode: true }),
    ...parsed.data,
  };
}
export async function mutation(event: H3Event) {
  const body = await readJsonBody(event);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw createError({ statusCode: 400, statusMessage: "INVALID_INPUT" });
  return body as Record<string, unknown>;
}
