import type { H3Event } from "nitro/h3";
import { createError, getHeader, setResponseHeader } from "nitro/h3";
import { applyEnvConfig, SERVER_CONFIG } from "../core/config";
import { isValidChannelName } from "../core/permissions/validation";
import type { Env } from "../core/types";
import { canonicalizeIRCName } from "../protocol/irc/parser";

export interface AuthUser {
  id: string;
  username: string;
  displayName?: string | null;
  roles: string[];
  isAdmin: boolean;
}

export function getEnv(event: H3Event): Env {
  const env = ((event.req as any)?.runtime?.cloudflare?.env ||
    (event.context as any)?.cloudflare?.env ||
    (globalThis as any).__env__ ||
    (globalThis as any).env ||
    process.env) as Env;
  applyEnvConfig(env);
  return env;
}

export function parseChannelParam(raw: string): { name: string; canon: string } {
  // H3 already decodes router parameters. Decoding again creates aliases and throws on literal '%'.
  const name = raw.startsWith("#") || raw.startsWith("&") ? raw : `#${raw}`;
  if (!isValidChannelName(name))
    throw createError({ statusCode: 400, statusMessage: "Invalid channel name" });
  return { name, canon: canonicalizeIRCName(name) };
}

export function getSessionToken(event: H3Event): string | undefined {
  const auth = getHeader(event, "authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const sessionId = getHeader(event, "x-session-id");
  if (sessionId) return sessionId.trim();
}

export async function getAuthenticatedUser(event: H3Event): Promise<AuthUser | null> {
  if (event.context.authUser) return event.context.authUser as AuthUser;
  const token = getSessionToken(event);
  if (!token) return null;
  const env = getEnv(event);
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  const account = await accounts.verifyApiSession(token);
  if (!account) return null;
  const user = { ...account, isAdmin: account.roles.includes("admin") };
  event.context.authUser = user;
  return user;
}

export async function requireAuthenticatedUser(event: H3Event): Promise<AuthUser> {
  const user = await getAuthenticatedUser(event);
  if (!user) {
    setResponseHeader(event, "WWW-Authenticate", "Bearer");
    throw createError({
      statusCode: 401,
      statusMessage: "A logged-in account session is required",
      headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "private, no-store" },
    });
  }
  return user;
}

export async function checkAdminAuth(event: H3Event): Promise<boolean> {
  return Boolean((await getAuthenticatedUser(event))?.isAdmin);
}

export async function requireSelf(event: H3Event, username: string): Promise<AuthUser> {
  const user = await requireAuthenticatedUser(event);
  if (canonicalizeIRCName(user.username) !== canonicalizeIRCName(username)) {
    throw createError({
      statusCode: 403,
      statusMessage: "This resource belongs to another account",
    });
  }
  return user;
}

export async function requireChannelOpOrOwner(
  event: H3Event,
  rawChannel: string,
): Promise<AuthUser> {
  const user = await requireAuthenticatedUser(event);
  const { canon } = parseChannelParam(rawChannel);
  const env = getEnv(event);
  const channel = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));
  if (!(await channel.canManageAccount(user))) {
    throw createError({
      statusCode: 403,
      statusMessage: "Channel owner or operator permissions required",
    });
  }
  return user;
}

export async function canAccessChannelHistory(
  event: H3Event,
  rawChannel: string,
): Promise<{ allowed: boolean; reason?: string; user: AuthUser }> {
  const user = await requireAuthenticatedUser(event);
  const { canon } = parseChannelParam(rawChannel);
  const env = getEnv(event);
  const channel = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));
  const allowed = await channel.canReadAccount(user);
  return { allowed, user, reason: allowed ? undefined : "Channel membership is required" };
}

export async function requireChannelRead(event: H3Event, rawChannel: string): Promise<AuthUser> {
  const access = await canAccessChannelHistory(event, rawChannel);
  if (!access.allowed) throw createError({ statusCode: 403, statusMessage: access.reason });
  return access.user;
}

export async function requireChannelFounder(event: H3Event, rawChannel: string): Promise<AuthUser> {
  const user = await requireChannelOpOrOwner(event, rawChannel);
  const env = getEnv(event);
  const { canon } = parseChannelParam(rawChannel);
  const channel = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));
  if (!user.isAdmin && !(await channel.isAccountFounder(user.id)))
    throw createError({ statusCode: 403, statusMessage: "Channel founder permissions required" });
  return user;
}

export async function clientRequest(
  event: H3Event,
  domain: any,
  operation: string,
  input?: any,
): Promise<any> {
  try {
    return await domain.clientRequest(getSessionToken(event)!, operation, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/Authentication required/.test(message))
      throw createError({ statusCode: 401, statusMessage: "Session expired" });
    if (
      /access denied|management denied|membership required|Only the founder|Account access denied|Destination denied/i.test(
        message,
      )
    )
      throw createError({ statusCode: 403, statusMessage: "Permission denied" });
    if (/Unknown role target|Unknown role group/i.test(message))
      throw createError({ statusCode: 404, statusMessage: "Role target not found" });
    throw error;
  }
}
