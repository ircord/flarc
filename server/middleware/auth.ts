import {
  assertBodySize,
  createError,
  defineEventHandler,
  getHeader,
  setResponseHeader,
} from "nitro/h3";
import { SERVER_CONFIG } from "../core/config";
import { getEnv, requireAuthenticatedUser } from "../utils/auth";

// Default deny for client APIs, including legacy aliases. New endpoints inherit authentication.
const publicPaths = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/accounts/register",
  "/api/health",
  "/api/status",
]);

export default defineEventHandler(async (event) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(event.method))
    assertBodySize(event, event.path.includes("/media/upload") ? 10 * 1024 * 1024 : 64 * 1024);
  const path = event.path.split("?")[0].replace(/\/+$/, "");
  if (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/metrics" ||
    path === "/media" ||
    path.startsWith("/media/") ||
    path === "/api" ||
    path.startsWith("/api/")
  ) {
    if (path === "/api/v1/events") return; // SessionDO authenticates the upgrade; avoid wrapping a 101 Response.
    setResponseHeader(event, "Cache-Control", "private, no-store");
    if (publicPaths.has(path)) {
      if (path.includes("auth/") || path.includes("accounts/register")) {
        const env = getEnv(event);
        const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
        const ip = getHeader(event, "cf-connecting-ip") ?? "local";
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
    const user = await requireAuthenticatedUser(event);
    const env = getEnv(event);
    if (
      !(await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).checkRequestLimit(
        `api:${user.id}`,
        300,
        60_000,
      ))
    )
      throw createError({ statusCode: 429, statusMessage: "API request limit reached" });
  }
});
