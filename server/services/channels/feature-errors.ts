import { createError } from "nitro/h3";

/** Map stable domain denials without exposing internal storage errors. */
export async function channelFeature<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/Channel access denied|Authentication required/i.test(message))
      throw createError({ statusCode: 403, statusMessage: "Channel access denied" });
    if (/Channel target budget exceeded/i.test(message))
      throw createError({ statusCode: 429, statusMessage: "Channel target budget exceeded" });
    if (/Channel generation changed/i.test(message))
      throw createError({ statusCode: 409, statusMessage: "Channel changed; retry" });
    throw error;
  }
}
