import { createError, defineEventHandler, getQuery, readBody, setResponseStatus } from "nitro/h3";
import { SERVER_CONFIG } from "../core/config";
import { checkAdminAuth, getEnv, parseChannelParam } from "../utils/auth";

export default defineEventHandler(async (event) => {
  if (!(await checkAdminAuth(event))) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const env = getEnv(event);
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  const getChanStub = (channelName: string) => {
    const { name, canon } = parseChannelParam(channelName);
    return {
      name,
      canon,
      stub: env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`)),
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
  const query = getQuery(event);

  // 1. Config & Stats
  if (path === "/config" && method === "POST") {
    const body = ((await readBody(event)) || {}) as Record<string, any>;
    if (body.zncMaxMessages !== undefined) {
      SERVER_CONFIG.zncMaxMessages = Number(body.zncMaxMessages);
    }
    if (body.filehostEnabled !== undefined) {
      SERVER_CONFIG.filehostEnabled = Boolean(body.filehostEnabled);
    }
    if (body.filehostRequireRegistration !== undefined) {
      SERVER_CONFIG.filehostRequireRegistration = Boolean(body.filehostRequireRegistration);
    }
    return {
      ok: true,
      config: {
        filehostEnabled: SERVER_CONFIG.filehostEnabled,
        filehostRequireRegistration: SERVER_CONFIG.filehostRequireRegistration,
        zncMaxMessages: SERVER_CONFIG.zncMaxMessages,
      },
    };
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
    const res = await accountsStub.registerAccount(body as any);
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

    if (subpath === "" && method === "GET") {
      const details = await accountsStub.getAccountDetails(username);
      if (!details) throw createError({ statusCode: 404, statusMessage: "Account not found" });
      return { ok: true, ...details };
    }
    if (subpath === "" && method === "PATCH") {
      const body = (await readBody(event)) || {};
      const res = await accountsStub.updateAccount(username, body);
      return res;
    }
    if (subpath === "/password" && method === "POST") {
      const body = ((await readBody(event)) || {}) as { password?: string };
      if (!body.password)
        throw createError({ statusCode: 400, statusMessage: "password is required" });
      const res = await accountsStub.adminResetPassword(username, body.password);
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
        return { ok, username, action: "revoke", role: body.role };
      }
      const ok = await accountsStub.grantRole(username, body.role);
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
      const metadata = await sessionStub.adminGetMetadata(target, keys);
      return { ok: true, target, metadata };
    }
    if (subpath === "" && method === "PUT") {
      const body = ((await readBody(event)) || {}) as Record<string, any>;
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
      await sessionStub.adminSetMetadata(target, key, null);
      return { ok: true, target, deletedKey: key };
    }
  }

  const chanMetaMatch = path.match(/^\/metadata\/channels\/([^/]+)(.*)$/);
  if (chanMetaMatch) {
    const { name } = parseChannelParam(chanMetaMatch[1]);
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
    if (!body.msgId) {
      throw createError({ statusCode: 400, statusMessage: "msgId is required" });
    }
    if (body.channel) {
      const { stub } = getChanStub(body.channel);
      const redacted = await stub.adminRedactMessage(body.msgId);
      return { ok: redacted, msgId: body.msgId };
    }
    return { ok: true, msgId: body.msgId };
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
      return { ok: true, ...res };
    }
    if (subpath === "/register" && method === "POST") {
      let founder = "admin";
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
      const res = await stub.handleModeCommand({
        channelName: name,
        actorSessionId: "admin",
        actorPrefix: SERVER_CONFIG.serverName,
        modeString: body.modeString,
        modeArgs: body.modeArgs || [],
        isOper: true,
      });
      return res;
    }
    if (subpath === "/topic" && method === "POST") {
      const body = (await readBody(event)) as any;
      if (body?.topic === undefined)
        throw createError({ statusCode: 400, statusMessage: "topic is required" });
      const res = await stub.adminSetTopic(body.topic, body.setBy || "Administrator", name);
      return res;
    }
    if (subpath === "/kick" && method === "POST") {
      const body = (await readBody(event)) as any;
      if (!body?.nickname)
        throw createError({ statusCode: 400, statusMessage: "nickname is required" });
      const res = await stub.adminKickMember(body.nickname, body.reason, name);
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
