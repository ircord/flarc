import type { SessionAttachment } from "~/core/types";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { ISessionDO } from "../types";
import { serviceAudit, serviceAuditActor, serviceAudited } from "./audit";
import { sendServiceResponse } from "./helpers";

export async function handleNickServ(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawText: string,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "HELP").toUpperCase();
  const accountsStub = session.getAccountsStub();
  const actor = await serviceAuditActor(session, attachment);

  if (sub === "REGISTER" || sub === "SAREGISTER") {
    const isSa = sub === "SAREGISTER";
    if (isSa && !attachment.isOper) {
      await serviceAudit(
        session,
        actor,
        "service.nickserv.saregister",
        "account",
        parts[1] ?? "",
        "denied",
      );
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Insufficient privileges"],
        labelTags,
      );
      return;
    }
    const accountName = isSa ? (parts[1] ?? "") : (attachment.nickname ?? "user");
    const password = isSa ? (parts[2] ?? "") : (parts[1] ?? "");
    const res = await serviceAudited(
      session,
      actor,
      isSa ? "service.nickserv.saregister" : "service.nickserv.register",
      "account",
      accountName,
      async () =>
        await accountsStub.registerAccount({
          username: accountName,
          password,
          registrationPolicyBypass: isSa,
        }),
      (result) => result.ok,
    );
    if (!res.ok) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        [`Could not register account: ${res.error}`],
        labelTags,
      );
      return;
    }

    if (!isSa) {
      await session.prepareAccountChange(attachment, res.account.id);
      attachment.authenticated = true;
      attachment.userId = res.account.id;
      attachment.credentialVersion = res.account.credentialVersion ?? 0;
      attachment.accountName = res.account.username;
      attachment.roles = res.account.roles;
      session.saveAttachment(ws, attachment);
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [isSa ? `Successfully registered account ${res.account.username}` : "Account created"],
      labelTags,
    );
    if (!isSa) {
      await session.broadcastAccountChange(attachment);
      session.saveAttachment(ws, attachment);
    }
    return;
  }

  if (sub === "IDENTIFY" || sub === "LOGIN") {
    const hasTwoArgs = parts.length >= 3;
    const username = hasTwoArgs ? parts[1] : (attachment.nickname ?? "");
    const password = hasTwoArgs ? parts[2] : (parts[1] ?? "");
    const res = await accountsStub.verifyCredentials(username, password);
    if (!res.ok) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Invalid account or password"],
        labelTags,
      );
      return;
    }

    await session.prepareAccountChange(attachment, res.account.id);

    attachment.authenticated = true;
    attachment.userId = res.account.id;
    attachment.credentialVersion = res.account.credentialVersion ?? 0;
    attachment.accountName = res.account.username;
    attachment.roles = res.account.roles;
    attachment.isOper = res.account.roles.includes("oper") || res.account.roles.includes("admin");
    const vhostInfo = await accountsStub.getVhostInfo(res.account.username);
    if (vhostInfo.enabled && vhostInfo.vhost) {
      attachment.vhost = vhostInfo.vhost;
      attachment.hostname = vhostInfo.vhost;
    }
    session.saveAttachment(ws, attachment);

    session.sendNumeric(ws, attachment, Numerics.RPL_LOGGEDIN, [
      session.getUserPrefix(attachment),
      res.account.username,
      `You are now logged in as ${res.account.username}`,
    ]);
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [`You are now logged in as ${res.account.username}`],
      labelTags,
    );
    await session.broadcastAccountChange(attachment);
    session.saveAttachment(ws, attachment);
    return;
  }

  if (sub === "INFO") {
    const targetAcct = parts[1] ?? attachment.accountName ?? attachment.nickname ?? "";
    const info = await accountsStub.getAccountByUsername(targetAcct);
    if (!info) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        [`Account ${targetAcct} is not registered`],
        labelTags,
      );
      return;
    }
    const nicks = await accountsStub.getAccountNicks(info.id);
    const vhostInfo = await accountsStub.getVhostInfo(info.username);
    const lines = [
      `Account ${info.username} is registered`,
      `Registered at: ${new Date(info.createdAt).toUTCString()}`,
      `Nicks: ${nicks.join(", ") || info.username}`,
    ];
    if (vhostInfo.vhost) {
      lines.push(`VHost: ${vhostInfo.vhost} (${vhostInfo.enabled ? "enabled" : "disabled"})`);
    }
    sendServiceResponse(session, ws, attachment, "NickServ", lines, labelTags);
    return;
  }

  if (sub === "GROUP") {
    if (!attachment.accountName || !attachment.nickname) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["You must be logged in to group a nickname"],
        labelTags,
      );
      return;
    }
    const ok = await serviceAudited(
      session,
      actor,
      "service.nickserv.group",
      "account",
      attachment.nickname,
      () => accountsStub.registerNickname(attachment.userId, attachment.nickname!),
      (result) => result,
    );
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [
        ok
          ? `Successfully grouped nickname ${attachment.nickname} to account ${attachment.accountName}`
          : `Could not group nickname ${attachment.nickname}`,
      ],
      labelTags,
    );
    return;
  }

  if (sub === "DROP") {
    if (!attachment.accountName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["You must be logged in to drop a nickname"],
        labelTags,
      );
      return;
    }
    const targetNick = parts[1] ?? attachment.nickname ?? "";
    const ok = await serviceAudited(
      session,
      actor,
      "service.nickserv.drop",
      "account",
      targetNick,
      () => accountsStub.dropNickname(attachment.userId, targetNick),
      (result) => result,
    );
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [
        ok
          ? `Successfully dropped nickname ${targetNick}`
          : `Could not drop nickname ${targetNick}`,
      ],
      labelTags,
    );
    return;
  }

  if (sub === "UNREGISTER" || sub === "ERASE" || sub === "SADROP") {
    const isSa = sub === "SADROP";
    if (isSa && !attachment.isOper) {
      await serviceAudit(
        session,
        actor,
        "service.nickserv.sadrop",
        "account",
        parts[1] ?? "",
        "denied",
      );
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Insufficient privileges"],
        labelTags,
      );
      return;
    }
    const targetAcct = isSa ? (parts[1] ?? "") : (parts[1] ?? attachment.accountName ?? "");
    if (!targetAcct || (!isSa && !attachment.accountName)) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["You must be logged in to unregister your account"],
        labelTags,
      );
      return;
    }
    if (!isSa && canonicalizeIRCName(targetAcct) !== canonicalizeIRCName(attachment.accountName!)) {
      await serviceAudit(
        session,
        actor,
        sub === "ERASE" ? "service.nickserv.erase" : "service.nickserv.unregister",
        "account",
        targetAcct,
        "denied",
      );
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Insufficient privileges"],
        labelTags,
      );
      return;
    }
    const ok = await serviceAudited(
      session,
      actor,
      `service.nickserv.${sub.toLowerCase()}` as
        | "service.nickserv.unregister"
        | "service.nickserv.erase"
        | "service.nickserv.sadrop",
      "account",
      targetAcct,
      () => accountsStub.unregisterAccount(targetAcct),
      (result) => result,
    );
    if (ok) await session.invalidateAccountPermissions(targetAcct);
    if (ok && !isSa) {
      attachment.authenticated = false;
      attachment.accountName = null;
      session.saveAttachment(ws, attachment);
      await session.broadcastAccountChange(attachment);
      session.saveAttachment(ws, attachment);
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [
        ok
          ? `Successfully unregistered account ${targetAcct}`
          : `Account ${targetAcct} is not registered`,
      ],
      labelTags,
    );
    return;
  }

  if (sub === "PASSWD" || sub === "PASSWORD") {
    const newPass = parts[1] ?? "";
    if (!attachment.accountName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["You must be logged in to change your password"],
        labelTags,
      );
      return;
    }
    const changedAccount = attachment.accountName;
    const ok = await serviceAudited(
      session,
      actor,
      sub === "PASSWD" ? "service.nickserv.passwd" : "service.nickserv.password",
      "account",
      changedAccount,
      () => accountsStub.changePassword(changedAccount, newPass),
      (result) => result,
    );
    if (ok) await session.invalidateAccountPermissions(changedAccount);
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [
        ok
          ? "Successfully changed password"
          : "Could not change password (check the configured password policy)",
      ],
      labelTags,
    );
    return;
  }

  if (sub === "GHOST") {
    const targetNick = parts[1] ?? "";
    const pass = parts[2];
    if (!targetNick) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Syntax: /NS GHOST <nickname> [password]"],
        labelTags,
      );
      return;
    }
    const ownerId = await accountsStub.getNickOwner(targetNick);
    let authorized = Boolean(attachment.isOper || (ownerId && ownerId === attachment.userId));
    if (!authorized && pass) {
      const verify = await accountsStub.verifyCredentials(targetNick, pass);
      authorized = verify.ok;
    }
    if (!authorized) {
      await serviceAudit(session, actor, "service.nickserv.ghost", "account", targetNick, "denied");
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Could not ghost client: insufficient privileges"],
        labelTags,
      );
      return;
    }
    const sessions = session
      .getAllSessionsForNick(targetNick)
      .filter((s) => s.attachment.sessionId !== attachment.sessionId);
    for (const s of sessions) {
      await session.disconnectSession(s.ws, s.attachment, "Ghosted by NickServ");
    }
    await serviceAudit(session, actor, "service.nickserv.ghost", "account", targetNick, "allowed");
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [`Successfully ghosted ${targetNick} (${sessions.length} session(s) disconnected)`],
      labelTags,
    );
    return;
  }

  if (sub === "CLIENTS" || sub === "SESSIONS") {
    const targetAcct = parts[1] ?? attachment.accountName ?? "";
    if (
      !attachment.isOper &&
      canonicalizeIRCName(targetAcct) !== canonicalizeIRCName(attachment.accountName ?? "")
    ) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Insufficient privileges"],
        labelTags,
      );
      return;
    }
    if (!targetAcct) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["You must be logged in to list sessions"],
        labelTags,
      );
      return;
    }
    const canon = canonicalizeIRCName(targetAcct);
    const lines: string[] = [`Sessions for account ${targetAcct}:`];
    for (const { attachment: a } of session.sessionsById.values()) {
      if (a.accountName && canonicalizeIRCName(a.accountName) === canon) {
        lines.push(`- ${a.nickname ?? "*"}!${a.username ?? "user"}@${a.hostname}`);
      }
    }
    sendServiceResponse(session, ws, attachment, "NickServ", lines, labelTags);
    return;
  }

  if (sub === "LIST") {
    const accts = await accountsStub.listAccounts();
    const lines = [
      `Registered accounts (${accts.length}):`,
      ...accts.map((a) => `- ${a.username}`),
    ];
    sendServiceResponse(session, ws, attachment, "NickServ", lines, labelTags);
    return;
  }

  if (sub === "GET") {
    if (!attachment.accountName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["You must be logged in to view account settings"],
        labelTags,
      );
      return;
    }
    const settings = await accountsStub.getAccountSettings(attachment.userId);
    const key = (parts[1] ?? "").toLowerCase();
    if (key && Object.hasOwn(settings, key)) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        [`Account setting ${key}=${settings[key]}`],
        labelTags,
      );
    } else {
      const lines = Object.entries(settings).map(([k, v]) => `${k}=${v}`);
      sendServiceResponse(session, ws, attachment, "NickServ", lines, labelTags);
    }
    return;
  }

  if (sub === "SET") {
    if (!attachment.accountName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["You must be logged in to change account settings"],
        labelTags,
      );
      return;
    }
    const key = (parts[1] ?? "").toLowerCase();
    const val = (parts[2] ?? "default").toLowerCase();
    if (!key) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "NickServ",
        ["Syntax: /NS SET <setting> <value>"],
        labelTags,
      );
      return;
    }
    await serviceAudited(
      session,
      actor,
      "service.nickserv.set",
      "account",
      attachment.accountName,
      () => accountsStub.setAccountSetting(attachment.userId, key, val),
      (result) => result,
    );
    if (key === "always-on") {
      const isPers = val === "true" || val === "on";
      const chans = session.getSessionChannels(attachment.sessionId);
      for (const ch of chans) {
        try {
          await session
            .getChannelStub(ch.channelName)
            .setMemberPersistence(attachment.userId, isPers, ch.generation);
        } catch {
          // ignore
        }
      }
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "NickServ",
      [`Successfully changed account setting ${key}=${val}`],
      labelTags,
    );
    return;
  }

  sendServiceResponse(
    session,
    ws,
    attachment,
    "NickServ",
    [
      "NickServ commands: REGISTER, IDENTIFY, INFO, GROUP, DROP, GHOST, PASSWD, UNREGISTER, CLIENTS, GET, SET, LIST",
    ],
    labelTags,
  );
}
