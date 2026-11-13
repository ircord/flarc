import { createError, defineEventHandler, getQuery, setResponseStatus } from "nitro/h3";
import { SERVER_CONFIG } from "../core/config";
import { AdminConfigSchema, adminBodySchema } from "../schemas/admin";
import { adminAuditOperation, adminAuditOutcome, adminAuditTarget } from "../utils/admin-audit";
import {
  getAuthenticatedUser,
  getEnv,
  getSessionToken,
  parseChannelParam,
  requireAuthenticatedUser,
} from "../utils/auth";
import { readJsonBody } from "../utils/body";

const handleAdmin = defineEventHandler(async (event) => {
  const administrator = await requireAuthenticatedUser(event);
  if (!administrator.isAdmin)
    throw createError({ statusCode: 403, statusMessage: "Administrator role required" });

  const token = getSessionToken(event)!;
  // Each owning object re-verifies the current administrator session. The proxy
  // preserves typed RPC methods while preventing routes from bypassing that facade.
  const authorized = <T extends { adminRequest: (...args: any[]) => any }>(stub: T): T =>
    new Proxy(stub, {
      get(target, property) {
        return (...args: unknown[]) => target.adminRequest(token, String(property), args);
      },
    });
  const env = getEnv(event);
  const sessionStub = authorized(env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId)));
  const accountsStub = authorized(
    env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)),
  );

  const getChanStub = (channelName: string) => {
    const { name, canon } = parseChannelParam(decodeURIComponent(channelName));
    return {
      name,
      canon,
      stub: authorized(
        env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`)),
      ),
    };
  };

  const rawPath = event.path.split("?")[0];
  // Strip /api/v1/admin or /admin prefix
  let path = rawPath;
  if (path.startsWith("/api/v1/admin")) {
    path = path.slice("/api/v1/admin".length);
  } else if (path.startsWith("/admin")) {
    path = path.slice("/admin".length);
  }
  if (!path.startsWith("/")) path = `/${path}`;

  const method = event.method.toUpperCase();
  const parts = path.split("/").filter(Boolean);
  const category = parts[0] || "unknown";
  const resource =
    ["accounts", "channels", "profile"].includes(category) &&
    parts[1] &&
    !["register", "disable"].includes(parts[1])
      ? decodeURIComponent(parts[1]).toLowerCase()
      : "*";
  if (
    !(await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).authorizeCredential(
      token,
      `admin.route.${category}.${method.toLowerCase()}`,
      resource,
    ))
  )
    throw createError({ statusCode: 403, statusMessage: "Administrator scope denied" });
  const query = getQuery(event);
  let validatedBody: any = {};
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const rawBody = await readJsonBody(event);
    const parsed = adminBodySchema(path, method).safeParse(rawBody ?? {});
    if (!parsed.success)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid administrator request",
        data: parsed.error.issues,
      });
    validatedBody = parsed.data;
  }
  event.context.adminAuditAction = adminAuditOperation(event.path, method, validatedBody);
  if (
    path === "/accounts/disable" &&
    method === "POST" &&
    typeof validatedBody.username === "string"
  )
    event.context.adminAuditSubject = validatedBody.username;
  // Validate once before branch-local optional-body handling: malformed DELETE bodies must never fall back to purging.
  const readBody = async (_event: typeof event) => validatedBody;

  if (path === "/audit" && method === "GET") {
    return {
      ok: true,
      records: await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).queryAudit(
        token,
        Number(query.limit) || 100,
      ),
    };
  }
  if (path === "/bans" && method === "GET") {
    return {
      ok: true,
      bans: await env.ACCOUNTS.get(
        env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
      ).listNetworkBans(token),
    };
  }
  if (path === "/bans" && method === "POST") {
    const body = validatedBody as {
      kind: "account" | "hostmask";
      value: string;
      expiresAt?: number | null;
    };
    const ban = await env.ACCOUNTS.get(
      env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).createNetworkBan(token, body.kind, body.value, body.expiresAt ?? null);
    return { ok: true, ban };
  }
  const banMatch = path.match(/^\/bans\/([^/]+)$/);
  if (banMatch && method === "DELETE") {
    const ok = await env.ACCOUNTS.get(
      env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
    ).deleteNetworkBan(token, banMatch[1]);
    if (!ok) throw createError({ statusCode: 404, statusMessage: "Ban not found" });
    return { ok: true };
  }

  // 1. Config & Stats
  if (path === "/config" && method === "POST") {
    const parsed = AdminConfigSchema.safeParse(await readBody(event));
    if (!parsed.success)
      throw createError({ statusCode: 400, statusMessage: "Invalid runtime configuration" });
    const config = await accountsStub.setRuntimeConfig(parsed.data);
    await sessionStub.setRuntimeConfig(config);
    return { ok: true, config };
  }

  if (path === "/stats" && method === "GET") {
    const stats = await sessionStub.getStats();
    return { ok: true, ...stats };
  }

  if (path === "/broadcast" && method === "POST") {
    const body = ((await readBody(event)) || {}) as {
      message?: string;
      notice?: boolean;
      wallops?: boolean;
      sender?: string;
    };
    if (!body.message) {
      throw createError({ statusCode: 400, statusMessage: "message is required" });
    }
    const res = await sessionStub.adminBroadcast(body.message, {
      isNotice: body.notice,
      isWallops: body.wallops,
      sender: body.sender,
    });
    return { ok: true, sentCount: res.sentCount };
  }

  // 2. Sessions Management
  if (path === "/sessions" && method === "GET") {
    const sessions = await sessionStub.adminListSessions();
    return { ok: true, sessions };
  }

  if (path === "/sessions/disconnect" && method === "POST") {
    const body = ((await readBody(event)) || {}) as {
      sessionId?: string;
      nickname?: string;
      reason?: string;
    };
    const identifier = body.sessionId || body.nickname;
    if (!identifier) {
      throw createError({ statusCode: 400, statusMessage: "sessionId or nickname is required" });
    }
    const disconnected = await sessionStub.adminDisconnectSession(identifier, body.reason);
    return { ok: disconnected };
  }

  // 3. Accounts Management
  if (path === "/accounts" && method === "GET") {
    const q = typeof query.query === "string" ? query.query : undefined;
    const role = typeof query.role === "string" ? query.role : undefined;
    const limit = typeof query.limit === "string" ? parseInt(query.limit, 10) : undefined;
    const accounts = await accountsStub.adminListAccounts({ query: q, role, limit });
    return { ok: true, accounts };
  }

  if ((path === "/accounts" || path === "/accounts/register") && method === "POST") {
    const body = ((await readBody(event)) || {}) as {
      username?: string;
      password?: string;
      displayName?: string;
      roles?: string[];
    };
    if (!body.username || !body.password) {
      throw createError({ statusCode: 400, statusMessage: "username and password are required" });
    }
    const res = await accountsStub.registerAccount({
      username: body.username,
      password: body.password,
      displayName: body.displayName,
      roles: body.roles,
      registrationPolicyBypass: true,
    });
    if (!res.ok) {
      throw createError({ statusCode: 400, statusMessage: res.error });
    }
    setResponseStatus(event, 201);
    return res;
  }

  if (path === "/accounts/disable" && method === "POST") {
    const body = ((await readBody(event)) || {}) as { username?: string };
    if (!body.username) {
      throw createError({ statusCode: 400, statusMessage: "username is required" });
    }
    const disabled = await accountsStub.disableAccount(body.username);
    const invalidatedSessions = await sessionStub.invalidateAccountPermissions(body.username);
    return { ok: disabled, invalidatedSessions };
  }

  // Profile sub-routes (/profile/:username)
  const profileMatch = path.match(/^\/profile\/([^/]+)$/);
  if (profileMatch) {
    const username = decodeURIComponent(profileMatch[1]);
    if (method === "GET") {
      const profile = await accountsStub.getUserProfile(username);
      if (!profile) throw createError({ statusCode: 404, statusMessage: "Profile not found" });
      return { ok: true, profile };
    }
    if (method === "PATCH") {
      const body = (await readBody(event)) || {};
      const profile = await accountsStub.setUserProfile(username, body);
      if (!profile) throw createError({ statusCode: 404, statusMessage: "User not found" });
      return { ok: true, profile };
    }
  }

  // Account sub-routes (/accounts/:username/...)
  const accountMatch = path.match(/^\/accounts\/([^/]+)(.*)$/);
  if (accountMatch) {
    const username = decodeURIComponent(accountMatch[1]);
    const subpath = accountMatch[2] || "";

    if (subpath === "/scopes" && method === "GET") {
      const details = await accountsStub.getAccountDetails(username);
      if (!details) throw createError({ statusCode: 404, statusMessage: "Account not found" });
      const policy = await env.ACCOUNTS.get(
        env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
      ).getAdminScopes(token, details.account.id);
      return { ok: true, ...policy };
    }
    if (subpath === "/scopes" && method === "PUT") {
      const details = await accountsStub.getAccountDetails(username);
      if (!details) throw createError({ statusCode: 404, statusMessage: "Account not found" });
      const body = validatedBody as { scopes: { operation: string; resource: string }[] };
      try {
        await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId)).setAdminScopes(
          token,
          details.account.id,
          body.scopes,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          /^(Scope exceeds authority|Administrator authorization required)$/.test(error.message)
        )
          throw createError({ statusCode: 403, statusMessage: "Administrator scope denied" });
        throw error;
      }
      return { ok: true };
    }
    if (subpath === "/sessions" && method === "GET") {
      const details = await accountsStub.getAccountDetails(username);
      if (!details) throw createError({ statusCode: 404, statusMessage: "Account not found" });
      const sessions = await env.ACCOUNTS.get(
        env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId),
      ).listAccountSessions(token, details.account.id);
      return { ok: true, sessions };
    }
    const sessionMatch = subpath.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch && method === "DELETE") {
      const details = await accountsStub.getAccountDetails(username);
      if (!details) throw createError({ statusCode: 404, statusMessage: "Account not found" });
      const rawAccounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
      const sessions = await rawAccounts.listAccountSessions(token, details.account.id);
      if (!sessions.some((session) => session.id === sessionMatch[1]))
        throw createError({ statusCode: 404, statusMessage: "Session not found" });
      return { ok: await rawAccounts.revokeAccountSession(token, sessionMatch[1]) };
    }
    if (subpath === "" && method === "GET") {
      const details = await accountsStub.getAccountDetails(username);
      if (!details) throw createError({ statusCode: 404, statusMessage: "Account not found" });
      return { ok: true, ...details };
    }
    if (subpath === "" && method === "PATCH") {
      const body = (await readBody(event)) || {};
      const res = await accountsStub.updateAccount(username, body);
      if (res.ok && body.roles !== undefined) await sessionStub.refreshAccountPermissions(username);
      return res;
    }
    if (subpath === "/password" && method === "POST") {
      const body = ((await readBody(event)) || {}) as { password?: string };
      if (!body.password)
        throw createError({ statusCode: 400, statusMessage: "password is required" });
      const res = await accountsStub.adminResetPassword(username, body.password);
      if (res.ok) await sessionStub.invalidateAccountPermissions(username);
      return res;
    }
    if (subpath === "/disable" && method === "POST") {
      const disabled = await accountsStub.disableAccount(username);
      const invalidatedSessions = await sessionStub.invalidateAccountPermissions(username);
      return { ok: disabled, invalidatedSessions };
    }
    if (subpath === "/enable" && method === "POST") {
      const enabled = await accountsStub.enableAccount(username);
      return { ok: enabled };
    }
    if (subpath === "/roles" && method === "GET") {
      const roles = await accountsStub.getUserRoles(username);
      return { ok: true, username, roles };
    }
    if (subpath === "/roles" && method === "POST") {
      const body = ((await readBody(event)) || {}) as {
        role?: string;
        action?: "grant" | "revoke";
      };
      if (!body.role) {
        throw createError({ statusCode: 400, statusMessage: "role is required" });
      }
      if (body.action === "revoke") {
        const ok = await accountsStub.revokeRole(username, body.role);
        if (ok) await sessionStub.refreshAccountPermissions(username);
        return { ok, username, action: "revoke", role: body.role };
      }
      const ok = await accountsStub.grantRole(username, body.role);
      if (ok) await sessionStub.refreshAccountPermissions(username);
      return { ok, username, action: "grant", role: body.role };
    }
    if (subpath === "" && method === "DELETE") {
      await sessionStub.invalidateAccountPermissions(username);
      const deleted = await accountsStub.deleteAccount(username);
      return { ok: deleted };
    }
  }

  // 4. Metadata 3 Management (/metadata/users/..., /metadata/channels/...)
  const userMetaMatch = path.match(/^\/metadata\/users\/([^/]+)(.*)$/);
  if (userMetaMatch) {
    const target = decodeURIComponent(userMetaMatch[1]);
    const subpath = userMetaMatch[2] || "";
    if (subpath === "" && method === "GET") {
      const keysParam = typeof query.keys === "string" ? query.keys : undefined;
      const keys = keysParam ? keysParam.split(",").map((k) => k.trim()) : undefined;
      const isOwner = target.toLowerCase() === administrator.username.toLowerCase();
      if (!isOwner && keys?.some((key) => key.toLowerCase().startsWith("private:")))
        throw createError({ statusCode: 403, statusMessage: "Private metadata denied" });
      const metadata = await sessionStub.adminGetMetadata(target, keys);
      if (!isOwner)
        for (const key of Object.keys(metadata))
          if (key.toLowerCase().startsWith("private:")) delete metadata[key];
      return { ok: true, target, metadata };
    }
    if (subpath === "" && method === "PUT") {
      const body = ((await readBody(event)) || {}) as Record<string, any>;
      const keys = body.entries ? Object.keys(body.entries) : [body.key];
      if (
        target.toLowerCase() !== administrator.username.toLowerCase() &&
        keys.some((key) => typeof key === "string" && key.toLowerCase().startsWith("private:"))
      )
        throw createError({ statusCode: 403, statusMessage: "Private metadata denied" });
      if (body.entries) {
        for (const [k, v] of Object.entries(body.entries)) {
          await sessionStub.adminSetMetadata(target, k, v as string | null);
        }
      } else if (body.key) {
        await sessionStub.adminSetMetadata(target, body.key, body.value ?? null);
      } else {
        throw createError({ statusCode: 400, statusMessage: "key and value or entries required" });
      }
      return { ok: true, target };
    }
    const keyMatch = subpath.match(/^\/([^/]+)$/);
    if (keyMatch && method === "DELETE") {
      const key = decodeURIComponent(keyMatch[1]);
      if (
        target.toLowerCase() !== administrator.username.toLowerCase() &&
        key.toLowerCase().startsWith("private:")
      )
        throw createError({ statusCode: 403, statusMessage: "Private metadata denied" });
      await sessionStub.adminSetMetadata(target, key, null);
      return { ok: true, target, deletedKey: key };
    }
  }

  const chanMetaMatch = path.match(/^\/metadata\/channels\/([^/]+)(.*)$/);
  if (chanMetaMatch) {
    const { name } = parseChannelParam(decodeURIComponent(chanMetaMatch[1]));
    const subpath = chanMetaMatch[2] || "";
    if (subpath === "" && method === "GET") {
      const keysParam = typeof query.keys === "string" ? query.keys : undefined;
      const keys = keysParam ? keysParam.split(",").map((k) => k.trim()) : undefined;
      const metadata = await sessionStub.adminGetMetadata(name, keys);
      return { ok: true, channel: name, metadata };
    }
    if (subpath === "" && method === "PUT") {
      const body = ((await readBody(event)) || {}) as Record<string, any>;
      if (body.entries) {
        for (const [k, v] of Object.entries(body.entries)) {
          await sessionStub.adminSetMetadata(name, k, v as string | null);
        }
      } else if (body.key) {
        await sessionStub.adminSetMetadata(name, body.key, body.value ?? null);
      } else {
        throw createError({ statusCode: 400, statusMessage: "key and value or entries required" });
      }
      return { ok: true, channel: name };
    }
    const keyMatch = subpath.match(/^\/([^/]+)$/);
    if (keyMatch && method === "DELETE") {
      const key = decodeURIComponent(keyMatch[1]);
      await sessionStub.adminSetMetadata(name, key, null);
      return { ok: true, channel: name, deletedKey: key };
    }
  }

  // 5. Message Redact (/messages/redact)
  if (path === "/messages/redact" && method === "POST") {
    const body = ((await readBody(event)) || {}) as {
      channel?: string;
      msgId?: string;
      reason?: string;
    };
    if (!body.msgId || !body.channel) {
      throw createError({ statusCode: 400, statusMessage: "channel and msgId are required" });
    }
    if (body.channel) {
      const { stub } = getChanStub(body.channel);
      const redacted = await stub.adminRedactMessage(body.msgId);
      return { ok: redacted, msgId: body.msgId };
    }
    throw createError({
      statusCode: 400,
      statusMessage: "Channel required; DM redaction is participant-only",
    });
  }

  // 6. Channel Management & Bot F (/channels/...)
  if (path === "/channels" && method === "GET") {
    const channels = await sessionStub.adminListChannels();
    return { ok: true, channels };
  }

  const chanMatch = path.match(/^\/channels\/([^/]+)(.*)$/);
  if (chanMatch) {
    const { name, stub } = getChanStub(chanMatch[1]);
    const subpath = chanMatch[2] || "";

    if (subpath === "" && method === "GET") {
      const details = await stub.getChannelFullDetails(name);
      return { ok: true, channel: details };
    }
    if (subpath === "/info" && method === "GET") {
      const info = await stub.getChannelInfo(name);
      return { ok: true, channel: info };
    }
    if (subpath === "/info" && method === "PATCH") {
      const body = (await readBody(event)) || {};
      const info = await stub.setChannelInfo(body, name);
      return { ok: true, channel: info };
    }
    if (subpath === "" && method === "DELETE") {
      let purge = true;
      try {
        const body = (await readBody(event)) as any;
        if (body?.purgeMessages !== undefined) purge = body.purgeMessages;
      } catch {}
      const res = await stub.adminDestroyChannel(purge, name);
      await sessionStub.removeChannelRouting(name, res.recipientSessionIds);
      return { ok: true, ...res };
    }
    if (subpath === "/register" && method === "POST") {
      let founder = (await requireAuthenticatedUser(event)).username;
      try {
        const body = (await readBody(event)) as any;
        if (body?.founder) founder = body.founder;
      } catch {}
      const res = await stub.adminRegister(founder, name);
      return res;
    }
    if (subpath === "/unregister" && method === "POST") {
      const res = await stub.adminUnregister(name);
      return res;
    }
    if (subpath === "/modes" && method === "POST") {
      const body = (await readBody(event)) as any;
      if (!body?.modeString)
        throw createError({ statusCode: 400, statusMessage: "modeString is required" });
      const res = await (sessionStub as any).adminChannelModes(
        name,
        body.modeString,
        body.modeArgs || [],
      );
      return res;
    }
    if (subpath === "/topic" && method === "POST") {
      const body = (await readBody(event)) as any;
      if (body?.topic === undefined)
        throw createError({ statusCode: 400, statusMessage: "topic is required" });
      const res = await (sessionStub as any).adminChannelTopic(name, body.topic);
      return res;
    }
    if (subpath === "/kick" && method === "POST") {
      const body = (await readBody(event)) as any;
      if (!body?.nickname)
        throw createError({ statusCode: 400, statusMessage: "nickname is required" });
      const res = await (sessionStub as any).adminChannelKick(
        name,
        body.nickname,
        body.reason || "Kicked by administrator",
      );
      return res;
    }
    if (subpath === "/bot" && method === "GET") {
      const bot = await stub.getBotConfig();
      return { ok: true, channel: name, bot };
    }
    if (subpath === "/bot" && method === "POST") {
      const body = (await readBody(event)) as any;
      const bot = await stub.setBotConfig(body || {});
      return { ok: true, channel: name, bot };
    }
    if (subpath === "/messages" && method === "GET") {
      const limitStr = typeof query.limit === "string" ? query.limit : undefined;
      const before = typeof query.before === "string" ? query.before : undefined;
      const after = typeof query.after === "string" ? query.after : undefined;
      const limit = limitStr ? parseInt(limitStr, 10) : 50;
      const messages = await stub.getMessagesForAdmin(limit, before, after);
      return { ok: true, channel: name, messages };
    }
    if (subpath === "/messages/purge" && method === "POST") {
      let body: any = {};
      try {
        body = (await readBody(event)) || {};
      } catch {}
      const res = await stub.purgeMessages(body);
      return { ok: true, channel: name, ...res };
    }
  }

  throw createError({ statusCode: 404, statusMessage: `Admin route not found: ${method} ${path}` });
});

export default defineEventHandler(async (event) => {
  const actor = await getAuthenticatedUser(event);
  const env = getEnv(event);
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));
  try {
    const result = await handleAdmin(event);
    const target = await adminAuditTarget(
      event.path,
      typeof event.context.adminAuditSubject === "string"
        ? event.context.adminAuditSubject
        : undefined,
    );
    await accounts.appendAudit(
      actor?.id ?? null,
      typeof event.context.adminAuditAction === "string"
        ? event.context.adminAuditAction
        : adminAuditOperation(event.path, event.method),
      target,
      (result as any)?.ok === false ? "denied" : "allowed",
      "rest",
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status =
      message === "Metadata target unavailable"
        ? 404
        : ["Administrator authorization required", "Account access denied"].includes(message)
          ? 403
          : message === "Invalid metadata"
            ? 400
            : undefined;
    const responseError = status
      ? createError({ statusCode: status, statusMessage: message })
      : error;
    const target = await adminAuditTarget(
      event.path,
      typeof event.context.adminAuditSubject === "string"
        ? event.context.adminAuditSubject
        : undefined,
    );
    await accounts.appendAudit(
      actor?.id ?? null,
      typeof event.context.adminAuditAction === "string"
        ? event.context.adminAuditAction
        : adminAuditOperation(event.path, event.method),
      target,
      adminAuditOutcome(responseError),
      "rest",
    );
    throw responseError;
  }
});
