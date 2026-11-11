import {
  createError,
  defineEventHandler,
  getHeader,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  toRequest,
} from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { checkAdminAuth, getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  // 1. Check if file hosting is enabled
  if (!SERVER_CONFIG.filehostEnabled) {
    setResponseStatus(event, 403);
    return { ok: false, error: "File hosting is disabled on this server" };
  }

  const env = getEnv(event);
  const req = toRequest((event as any).req);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  // 2. Authentication and Authorization
  const isAdmin = await checkAdminAuth(event);
  let isAuthenticatedUser = false;
  let isActiveSessionUser = false;
  let authUsername: string | null = null;

  // Check Authorization: Basic <base64(user:pass)>
  const authHeader = getHeader(event, "authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
    try {
      const credentials = atob(authHeader.slice(6).trim());
      const colonIdx = credentials.indexOf(":");
      if (colonIdx !== -1) {
        const u = credentials.slice(0, colonIdx);
        const p = credentials.slice(colonIdx + 1);
        const verifyRes = await accountsStub.verifyCredentials(u, p);
        if (verifyRes.ok) {
          isAuthenticatedUser = true;
          authUsername = verifyRes.account.username;
        }
      }
    } catch {
      // ignore
    }
  }

  // Check connected session identification
  const query = getQuery(event);
  const sessionNick =
    getHeader(event, "soju-username") ||
    getHeader(event, "x-irc-nick") ||
    (typeof query.nick === "string" ? query.nick : undefined) ||
    (typeof query.username === "string" ? query.username : undefined);
  const sessionId =
    getHeader(event, "x-session-id") ||
    (typeof query.sessionId === "string" ? query.sessionId : undefined);

  if (sessionNick || sessionId) {
    const activeCheck = await sessionStub.verifyActiveUser({
      nick: sessionNick || undefined,
      sessionId: sessionId || undefined,
    });
    if (activeCheck.active) {
      isActiveSessionUser = true;
      if (activeCheck.authenticated) {
        isAuthenticatedUser = true;
        authUsername = activeCheck.accountName ?? authUsername;
      }
    }
  }

  const requiresRegistration =
    SERVER_CONFIG.filehostRequireRegistration ||
    env.REG_BEFORE_CONNECT === "1" ||
    env.CFCORD_REG_BEFORE_CONNECT === "1";

  if (requiresRegistration) {
    if (!isAdmin && !isAuthenticatedUser) {
      setResponseHeader(event, "WWW-Authenticate", 'Basic realm="FlaRC Filehost"');
      setResponseStatus(event, 401);
      return {
        ok: false,
        error: "This server requires a registered account to upload media",
      };
    }
  } else {
    if (!isAdmin && !isAuthenticatedUser && !isActiveSessionUser) {
      setResponseHeader(event, "WWW-Authenticate", 'Basic realm="FlaRC Filehost"');
      setResponseStatus(event, 401);
      return {
        ok: false,
        error: "Authentication required to upload media",
      };
    }
  }

  const contentType = getHeader(event, "content-type") || "";
  let filename = `upload-${Date.now()}`;
  let mimeType = "application/octet-stream";
  let data: ArrayBuffer;

  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await req.formData();
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
      if (match && match[1]) filename = match[1];
    }
    data = await req.arrayBuffer();
  }

  if (!data || data.byteLength === 0) {
    throw createError({ statusCode: 400, statusMessage: "Empty file payload" });
  }

  let ext = "";
  if (filename.includes(".")) {
    ext = `.${filename.split(".").pop()}`;
  } else if (mimeType.includes("/")) {
    const sub = mimeType.split("/")[1];
    if (sub === "jpeg") ext = ".jpg";
    else if (sub === "png" || sub === "gif" || sub === "webp") ext = `.${sub}`;
  }

  const fileId = `${crypto.randomUUID()}${ext}`;
  const size = data.byteLength;

  if (env.MEDIA_BUCKET) {
    await env.MEDIA_BUCKET.put(fileId, data, {
      httpMetadata: { contentType: mimeType },
    });
  } else {
    await accountsStub.storeMedia({
      id: fileId,
      filename,
      mimeType,
      size,
      data,
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
    uploader: authUsername ?? (sessionNick || "guest"),
  };
});
