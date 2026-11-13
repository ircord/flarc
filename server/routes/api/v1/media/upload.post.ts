import {
  createError,
  defineEventHandler,
  getHeader,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  toRequest,
} from "nitro/h3";
import { filehostMaxRequestBytes, filehostMaxUploadBytes, SERVER_CONFIG } from "~/core/config";
import { getEnv, getSessionToken, parseChannelParam, requireAuthenticatedUser } from "~/utils/auth";
import { readBoundedBody } from "~/utils/body";

export default defineEventHandler(async (event) => {
  const env = getEnv(event);
  const settings = await env.ACCOUNTS.get(
    env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
  ).getRuntimeConfig();
  if (!settings.filehostEnabled) {
    setResponseStatus(event, 403);
    return { ok: false, error: "File hosting is disabled on this server" };
  }
  const req = toRequest((event as any).req);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  const _sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  const actor = await requireAuthenticatedUser(event);
  const maxBytes = filehostMaxUploadBytes(env);
  const contentType = getHeader(event, "content-type") || "";
  const requestLimit = filehostMaxRequestBytes(env, contentType);
  const bytes = await readBoundedBody(req, requestLimit);
  let filename = `upload-${Date.now()}`;
  let mimeType = "application/octet-stream";
  let data: ArrayBuffer;

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    try {
      const formData = await new Response(bytes, {
        headers: { "Content-Type": contentType },
      }).formData();
      const fileEntry = formData.get("file") ?? formData.get("media");
      if (!fileEntry || typeof fileEntry === "string") {
        throw createError({
          statusCode: 400,
          statusMessage: "No file found in form data field 'file'",
        });
      }
      const fileObj = fileEntry as File;
      filename = fileObj.name || filename;
      mimeType = fileObj.type || mimeType;
      data = await fileObj.arrayBuffer();
    } catch (err: any) {
      throw createError({
        statusCode: 400,
        statusMessage: `Failed to parse multipart: ${err.message}`,
      });
    }
  } else {
    mimeType = contentType.split(";")[0].trim() || mimeType;
    const xFilename = getHeader(event, "x-filename");
    const contentDisp = getHeader(event, "content-disposition");
    if (xFilename) {
      filename = xFilename.trim();
    } else if (contentDisp) {
      const match = contentDisp.match(/filename="?([^";]+)"?/);
      if (match?.[1]) filename = match[1];
    }
    data = bytes;
  }

  if (!data || data.byteLength === 0) {
    throw createError({ statusCode: 400, statusMessage: "Empty file payload" });
  }

  if (data.byteLength > maxBytes)
    throw createError({ statusCode: 413, statusMessage: "Upload exceeds configured file limit" });

  let ext = "";
  if (filename.includes(".")) {
    ext = `.${filename.split(".").pop()}`;
  } else if (mimeType.includes("/")) {
    const sub = mimeType.split("/")[1];
    if (sub === "jpeg") ext = ".jpg";
    else if (sub === "png" || sub === "gif" || sub === "webp") ext = `.${sub}`;
  }

  // Metadata may retain the original display name; object IDs must remain one
  // safe path segment regardless of multipart filenames or MIME labels.
  if (!/^\.[a-zA-Z0-9]{1,10}$/.test(ext)) ext = "";
  const fileId = `${crypto.randomUUID()}${ext.toLowerCase()}`;
  const size = data.byteLength;

  filename = filename.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 255);
  const query = getQuery(event);
  const scope =
    typeof query.channel === "string"
      ? { kind: "channel" as const, target: parseChannelParam(query.channel).name }
      : typeof query.dm === "string"
        ? { kind: "dm" as const, target: query.dm }
        : { kind: "private" as const };
  const token = getSessionToken(event)!;
  let reservation: "ok" | "denied" | "too_large";
  try {
    // Reserve quota and persist access metadata before writing external storage.
    reservation = await accountsStub.storePrivateMedia(
      token,
      {
        id: fileId,
        filename,
        mimeType,
        size,
        data: env.MEDIA_BUCKET ? new ArrayBuffer(0) : data,
        storageKind: env.MEDIA_BUCKET ? "r2" : "sqlite",
      },
      scope,
    );
  } catch {
    throw createError({ statusCode: 503, statusMessage: "Media storage unavailable" });
  }
  if (reservation === "too_large")
    throw createError({ statusCode: 413, statusMessage: "Upload exceeds configured file limit" });
  if (reservation !== "ok")
    throw createError({ statusCode: 403, statusMessage: "Upload denied by scope or quota policy" });
  if (env.MEDIA_BUCKET) {
    let published: boolean;
    try {
      const objectKey = await accountsStub.getMediaReservationKey(token, fileId, actor.id);
      if (!objectKey) throw new Error("Media reservation expired");
      await env.MEDIA_BUCKET.put(objectKey, data, { httpMetadata: { contentType: mimeType } });
      published = await accountsStub.finalizeMediaReservation(token, fileId, actor.id, objectKey);
      if (!published) await accountsStub.rollbackMediaReservation(fileId, actor.id);
    } catch {
      // A failed put can have written an object; cleanup is limited to the
      // unpublished reservation and does not rely on a still-valid token.
      try {
        await accountsStub.rollbackMediaReservation(fileId, actor.id);
      } catch {
        // The pending row remains inaccessible if provider cleanup fails.
      }
      throw createError({ statusCode: 503, statusMessage: "Media storage unavailable" });
    }
    if (!published)
      throw createError({
        statusCode: 403,
        statusMessage: "Upload denied by scope or quota policy",
      });
  }

  const uploadUrl = `/media/${fileId}`;
  setResponseHeader(event, "Location", uploadUrl);
  setResponseStatus(event, 201);

  return {
    ok: true,
    id: fileId,
    url: uploadUrl,
    filename,
    size,
    mimeType,
    uploader: actor.username,
  };
});
