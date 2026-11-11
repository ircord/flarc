import { createError, defineEventHandler, getRouterParam, readBody } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { UserProfileInputSchema } from "~/schemas/profiles";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const rawUser = getRouterParam(event, "username");
  const username = decodeURIComponent(rawUser || "").trim();
  if (!username) {
    throw createError({ statusCode: 400, statusMessage: "Username required" });
  }

  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON body" });
  }

  const parsed = UserProfileInputSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i: any) => i.message).join(", "),
    });
  }

  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const profile = await accountsStub.setUserProfile(username, parsed.data);
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  return { ok: true, profile };
});
