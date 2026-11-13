import { createError, defineEventHandler, getRouterParam } from "nitro/h3";
import { sessionFeature } from "~/features/session/http";
import { UserProfileInputSchema } from "~/schemas/profiles";
import { requireSelf } from "~/utils/auth";
import { readJsonBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const rawUser = getRouterParam(event, "username", { decode: true });
  const username = (rawUser || "").trim();
  if (!username) {
    throw createError({ statusCode: 400, statusMessage: "Username required" });
  }

  const body = await readJsonBody(event);

  if (!body || typeof body !== "object" || Array.isArray(body))
    throw createError({ statusCode: 400, statusMessage: "Invalid profile request" });
  const { expectedRevision, clientOperationId, ...updates } = body as Record<string, unknown>;
  if (
    expectedRevision !== undefined &&
    (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0)
  )
    throw createError({ statusCode: 400, statusMessage: "Invalid revision" });
  const parsed = UserProfileInputSchema.strict().safeParse(updates);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  await requireSelf(event, username);

  const profile = await sessionFeature(event, "profile.update", {
    username,
    updates: parsed.data,
    expectedRevision,
    clientOperationId,
  });
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const { ok, ...canonical } = profile;
  return { ok: true, profile: canonical };
});
