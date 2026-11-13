import {
  assertBodySize,
  createError,
  defineEventHandler,
  getHeader,
  setResponseHeader,
} from "nitro/h3";
import { filehostMaxRequestBytes, SERVER_CONFIG } from "../core/config";
import { requestSource } from "../core/request-source";
import { adminAuditOperation, adminAuditOutcome, adminAuditTarget } from "../utils/admin-audit";
import {
  getAuthenticatedUser,
  getEnv,
  getSessionToken,
  isAllowedCookieOrigin,
  isCookieAuthentication,
  requireAuthenticatedUser,
} from "../utils/auth";

// Default deny for client APIs, including legacy aliases. New endpoints inherit authentication.
const publicPaths = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/accounts/register",
  "/api/health",
  "/api/status",
]);

export default defineEventHandler(async (event) => {
  // Set only by the local launcher; Cloudflare deployments do not use this fence.
  // The public proxy replaces the corresponding header before forwarding.
  const ingressSecret = getEnv(event).LOCAL_IRC_BRIDGE_SECRET;
  if (ingressSecret && getHeader(event, "x-local-ingress") !== ingressSecret)
    throw createError({ statusCode: 403, statusMessage: "Invalid local ingress" });
  const path = event.path.split("?")[0].replace(/\/+$/, "");
  const adminPath =
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/v1/admin" ||
    path.startsWith("/api/v1/admin/");
  const auditEarly = async (actorId: string | null, outcome: "denied" | "error") => {
    if (!adminPath) return;
    const env = getEnv(event);
    await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).appendAudit(
      actorId,
      adminAuditOperation(path, event.method),
      await adminAuditTarget(path),
      outcome,
      "rest",
    );
  };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(event.method)) {
    const mediaUpload = path === "/api/v1/media/upload" || path === "/api/media/upload";
    const limit = mediaUpload
      ? filehostMaxRequestBytes(getEnv(event), getHeader(event, "content-type") ?? "")
      : 64 * 1024;
    try {
      assertBodySize(event, limit);
    } catch (error) {
      const actor = adminPath ? await getAuthenticatedUser(event).catch(() => null) : null;
      await auditEarly(actor?.id ?? null, adminAuditOutcome(error));
      throw error;
    }
  }
  if (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/metrics" ||
    path === "/media" ||
    path.startsWith("/media/") ||
    path === "/api" ||
    path.startsWith("/api/")
  ) {
    // Both aliases authenticate through central SessionDO admission before the
    // edge upgrades. Do not wrap a native 101 response in ordinary API middleware.
    if (path === "/api/v1/events" || path === "/api/events") return;
    setResponseHeader(event, "Cache-Control", "private, no-store");
    if (publicPaths.has(path)) {
      if (path.includes("auth/") || path.includes("accounts/register")) {
        const env = getEnv(event);
        const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
        const source = requestSource(event.req, env);
        if (!source)
          throw createError({ statusCode: 403, statusMessage: "Invalid request source" });
        const ip = source.ip;
        if (!(await accounts.checkRequestLimit(`public-auth:${ip}`, 50)))
          throw createError({
            statusCode: 429,
            statusMessage: "Authentication request limit reached",
          });
      }
      return;
    }

    // Incoming hooks use their own channel-scoped capability, validated by ChannelDO.
    if (event.method === "POST" && /^\/api\/(?:v1\/)?webhooks\/[^/]+(?:\/[^/]+)?$/.test(path))
      return;
    const env = getEnv(event);
    let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
    try {
      user = await requireAuthenticatedUser(event);
    } catch (error) {
      await auditEarly(null, adminAuditOutcome(error));
      throw error;
    }
    if (
      isCookieAuthentication(event) &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(event.method)
    ) {
      const csrf = getHeader(event, "x-csrf-token") ?? "";
      const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
      if (
        !isAllowedCookieOrigin(event) ||
        !(await accounts.verifySessionCsrf(getSessionToken(event)!, csrf))
      ) {
        await auditEarly(user.id, "denied");
        throw createError({ statusCode: 403, statusMessage: "CSRF validation failed" });
      }
    }
    const currentToken = getSessionToken(event)!;
    const credentialStore = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
    if (
      (await credentialStore.isRestrictedCredential(currentToken)) &&
      !(await credentialStore.authorizeCredential(
        currentToken,
        `rest.${event.method.toLowerCase()}`,
        path,
      ))
    ) {
      await auditEarly(user.id, "denied");
      throw createError({ statusCode: 403, statusMessage: "Credential scope denied" });
    }
    if (
      !(await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).checkRequestLimit(
        `api:${user.id}`,
        300,
        60_000,
      ))
    ) {
      await auditEarly(user.id, "denied");
      throw createError({ statusCode: 429, statusMessage: "API request limit reached" });
    }
  }
});
