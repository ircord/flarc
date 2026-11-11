import { createError, defineEventHandler, getRouterParam, setResponseHeader } from "nitro/h3";
import { SERVER_CONFIG } from "../../core/config";
import { getEnv } from "../../utils/auth";

export default defineEventHandler(async (event) => {
  const mediaId = getRouterParam(event, "id");
  if (!mediaId) {
    throw createError({ statusCode: 400, statusMessage: "File ID required" });
  }

  const env = getEnv(event);

  if (env.MEDIA_BUCKET) {
    try {
      const obj = await env.MEDIA_BUCKET.get(mediaId);
      if (obj) {
        setResponseHeader(
          event,
          "Content-Type",
          obj.httpMetadata?.contentType || "application/octet-stream",
        );
        setResponseHeader(event, "Cache-Control", "public, max-age=31536000, immutable");
        return obj.body;
      }
    } catch {
      // Fallback to DO
    }
  }

  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  const media = await accountsStub.getMedia(mediaId);
  if (!media) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  setResponseHeader(event, "Content-Type", media.mimeType || "application/octet-stream");
  setResponseHeader(
    event,
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(media.filename)}"`,
  );
  setResponseHeader(event, "Cache-Control", "public, max-age=31536000, immutable");

  return media.data;
});
