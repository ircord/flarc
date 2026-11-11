import { createError, defineEventHandler, getRouterParam, setResponseHeader } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, requireAuthenticatedUser } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  await requireAuthenticatedUser(event);
  const id = getRouterParam(event, "id", { decode: true });
  if (!id) throw createError({ statusCode: 400, statusMessage: "File ID required" });
  const env = getEnv(event);
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  const media = await accounts.getPrivateMedia(getSessionToken(event)!, id);
  if (!media) throw createError({ statusCode: 404, statusMessage: "File not found" });
  setResponseHeader(event, "Content-Type", media.mimeType || "application/octet-stream");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Content-Security-Policy", "sandbox; default-src 'none'");
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const inline =
    /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/.test(
      media.mimeType,
    );
  setResponseHeader(
    event,
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(media.filename)}`,
  );
  if (media.storageKind === "r2") {
    if (!env.MEDIA_BUCKET)
      throw createError({ statusCode: 503, statusMessage: "Media storage unavailable" });
    const object = await env.MEDIA_BUCKET.get(id);
    if (!object) throw createError({ statusCode: 404, statusMessage: "File not found" });
    return object.body;
  }
  return media.data;
});
