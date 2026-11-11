import type { H3Event } from "nitro/h3";
import { createError, getHeader, getQuery } from "nitro/h3";
import { SERVER_CONFIG } from "../core/config";
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
  return ((event.req as any)?.runtime?.cloudflare?.env ||
    (event.context as any)?.cloudflare?.env ||
    (globalThis as any).__env__ ||
    (globalThis as any).env ||
    process.env) as Env;
}

export function parseChannelParam(raw: string): { name: string; canon: string } {
  const decoded = decodeURIComponent(raw);
  const name = decoded.startsWith("#") || decoded.startsWith("&") ? decoded : `#${decoded}`;
  return {
    name,
    canon: canonicalizeIRCName(name),
  };
}

export async function getAuthenticatedUser(event: H3Event): Promise<AuthUser | null> {
  const env = getEnv(event);
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  const adminToken = env.ADMIN_TOKEN || env.ADMIN_API_KEY || SERVER_CONFIG.adminToken;
  const authHeader = getHeader(event, "authorization");
  const xAdminToken = getHeader(event, "x-admin-token");
  const xSessionId = getHeader(event, "x-session-id");
  const query = getQuery(event);

  // 1. Direct Admin Token check
  if (
    adminToken &&
    (authHeader === `Bearer ${adminToken}` ||
      xAdminToken === adminToken ||
      query.token === adminToken)
  ) {
    return {
      id: "admin",
      username: "admin",
      displayName: "Administrator",
      roles: ["admin"],
      isAdmin: true,
    };
  }

  // 2. Bearer token / Session ID check
  let bearerToken: string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    bearerToken = authHeader.slice(7).trim();
  } else if (xSessionId) {
    bearerToken = xSessionId.trim();
  } else if (typeof query.token === "string") {
    bearerToken = query.token.trim();
  } else if (typeof query.session_id === "string") {
    bearerToken = query.session_id.trim();
  }

  if (bearerToken) {
    try {
      const activeUser = await sessionStub.verifyActiveUser({ sessionId: bearerToken });
      if (activeUser.active && (activeUser.accountName || activeUser.nickname)) {
        const username = activeUser.accountName || activeUser.nickname!;
        const account = await accountsStub.getAccountByUsername(username);
        if (account) {
          const isAdmin = await accountsStub.isUserAdmin(account.id);
          return {
            id: account.id,
            username: account.username,
            displayName: account.displayName,
            roles: account.roles,
            isAdmin,
          };
        }
      }
    } catch {}
  }

  // 3. Basic Authentication (user:password)
  if (authHeader?.startsWith("Basic ")) {
    try {
      const creds = atob(authHeader.slice(6).trim());
      const colonIdx = creds.indexOf(":");
      if (colonIdx !== -1) {
        const username = creds.slice(0, colonIdx);
        const password = creds.slice(colonIdx + 1);
        const res = await accountsStub.verifyCredentials(username, password);
        if (res.ok) {
          const isAdmin = await accountsStub.isUserAdmin(res.account.id);
          return {
            id: res.account.id,
            username: res.account.username,
            displayName: res.account.displayName,
            roles: res.account.roles,
            isAdmin,
          };
        }
      }
    } catch {}
  }

  // 4. Registered user check (via trusted internal gateway header only)
  const trustedHeaderUser = getHeader(event, "soju-username") || getHeader(event, "x-user");

  if (trustedHeaderUser) {
    try {
      const account = await accountsStub.getAccountByUsername(trustedHeaderUser);
      if (account) {
        const isAdmin = await accountsStub.isUserAdmin(account.id);
        return {
          id: account.id,
          username: account.username,
          displayName: account.displayName,
          roles: account.roles,
          isAdmin,
        };
      }
    } catch {}
  }

  return null;
}

export async function checkAdminAuth(event: H3Event): Promise<boolean> {
  const user = await getAuthenticatedUser(event);
  return Boolean(user?.isAdmin);
}

export async function requireAuthenticatedUser(event: H3Event): Promise<AuthUser> {
  const user = await getAuthenticatedUser(event);
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication required: must have a registered account in ChanServ/NickServ",
    });
  }
  return user;
}

export async function requireChannelOpOrOwner(
  event: H3Event,
  rawChannel: string,
): Promise<AuthUser> {
  const user = await requireAuthenticatedUser(event);
  if (user.isAdmin) {
    return user;
  }

  const { canon } = parseChannelParam(rawChannel);
  const env = getEnv(event);
  const chanStub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  // Check if channel is registered and caller is founder/owner
  const info = await chanStub.getChannelInfo();
  if (info.founder && canonicalizeIRCName(info.founder) === canonicalizeIRCName(user.username)) {
    return user;
  }

  // Check if caller has operator (+o, +q, +a) modes on this channel
  const members = await chanStub.getMembers();
  const callerMember = members.find(
    (m: any) =>
      canonicalizeIRCName(m.nickname) === canonicalizeIRCName(user.username) ||
      (m.account && canonicalizeIRCName(m.account) === canonicalizeIRCName(user.username)),
  );

  if (callerMember && /[oqa]/.test(callerMember.modes)) {
    return user;
  }

  throw createError({
    statusCode: 403,
    statusMessage: "Forbidden: Only channel owners and operators can perform this action",
  });
}

export async function canAccessChannelHistory(
  event: H3Event,
  rawChannel: string,
): Promise<{ allowed: boolean; reason?: string; user?: AuthUser }> {
  const { canon } = parseChannelParam(rawChannel);
  const env = getEnv(event);
  const chanStub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const info = await chanStub.getChannelInfo();
  const modes = info.modes || "";
  const isRestricted = modes.includes("s") || modes.includes("p") || modes.includes("i");

  // If public and does not require registration (+R) or secret/private/invite-only modes:
  if (!isRestricted && !modes.includes("R")) {
    const user = await getAuthenticatedUser(event);
    return { allowed: true, user: user ?? undefined };
  }

  // Channel is restricted (secret, private, invite-only, or registered-only):
  const user = await getAuthenticatedUser(event);
  if (!user) {
    return {
      allowed: false,
      reason: "Authentication required for private, secret, or invite-only channel",
    };
  }

  if (user.isAdmin) {
    return { allowed: true, user };
  }

  if (info.founder && canonicalizeIRCName(info.founder) === canonicalizeIRCName(user.username)) {
    return { allowed: true, user };
  }

  const isMem = await (chanStub as any).isMember(user.username);
  if (isMem) {
    return { allowed: true, user };
  }

  return {
    allowed: false,
    reason: "Forbidden: You are not a member of this private/restricted channel",
  };
}
