import { SERVER_CONFIG } from "~/core/config";
import type {
  ChannelMemberInfo,
  ChannelStateSummary,
  SessionAttachment,
  StoredChannelMessage,
} from "~/core/types";
import { encodeIRCMessage, encodeNumeric } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import { deliverMultilineOrFallback } from "../messaging";
import type { ISessionDO } from "../types";
import { sendServiceResponse } from "./helpers";
import { hasChannelOp } from "~/core/permissions/authorization";

export async function handleFBot(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawText: string,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  const cmd = (parts[0] ?? "HELP").toUpperCase();
  const args = parts.slice(1);

  if (cmd === "HELP") {
    const topic = (args[0] ?? "").toUpperCase();
    if (topic === "AUTH") {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [
          "Syntax: AUTH <username> <password>",
          "Authenticates you to your network account, granting your registered privileges.",
        ],
        labelTags,
      );
      return;
    }
    if (topic === "REQUESTBOT") {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [
          "Syntax: REQUESTBOT <#channel>",
          "Requests F to join and protect your registered channel.",
        ],
        labelTags,
      );
      return;
    }
    if (topic === "UNREQUESTBOT") {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Syntax: UNREQUESTBOT <#channel>", "Removes F from your channel."],
        labelTags,
      );
      return;
    }
    if (topic === "CHANLEV") {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [
          "Syntax: CHANLEV <#channel> [nickname] [flags]",
          "Views or sets channel access flags (+o, +v, +q, etc.) for a user.",
        ],
        labelTags,
      );
      return;
    }
    if (topic === "WELCOME") {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [
          "Syntax: WELCOME <#channel> [message...]",
          "Sets or clears (with CLEAR or OFF) the greeting message sent by F when users join.",
        ],
        labelTags,
      );
      return;
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "F",
      [
        "***** FlareServ (F) Channel Service Bot *****",
        "F is Flare Relay Chat's channel bot, inspired by QuakeNet's Q bot.",
        "Available commands:",
        "  AUTH <username> <password>     - Authenticate to your account",
        "  REQUESTBOT <#channel>          - Request F to join a registered channel",
        "  UNREQUESTBOT <#channel>        - Request F to leave a channel",
        "  OP <#channel> [nickname]       - Grant channel operator status",
        "  DEOP <#channel> [nickname]     - Remove channel operator status",
        "  VOICE <#channel> [nickname]    - Grant channel voice status",
        "  DEVOICE <#channel> [nickname]  - Remove channel voice status",
        "  CHANLEV <#channel> [nick] [+/-flags] - View or modify channel access list",
        "  WELCOME <#channel> [message]   - Set greeting message when users join",
        "  STATUS <#channel>              - View bot status for a channel",
        "  HELP [command]                 - Display help on a command",
        "***** End of Help *****",
      ],
      labelTags,
    );
    return;
  }

  if (cmd === "AUTH") {
    if (args.length < 2) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Syntax: AUTH <username> <password>"],
        labelTags,
      );
      return;
    }
    const [username, password] = args;
    const accountsStub = session.getAccountsStub();
    const authRes = await accountsStub.verifyCredentials(username, password);
    if (!authRes.ok) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [`Authentication failed: ${authRes.error}`],
        labelTags,
      );
      return;
    }
    attachment.authenticated = true;
    attachment.userId = authRes.account.id;
    attachment.accountName = authRes.account.username;
    attachment.roles = authRes.account.roles;
    if (!(attachment.userModes ?? "").includes("r")) {
      attachment.userModes = (attachment.userModes ?? "") + "r";
    }
    session.sendNumeric(ws, attachment, Numerics.RPL_LOGGEDIN, [
      session.getUserPrefix(attachment),
      authRes.account.username,
      `You are now logged in as ${authRes.account.username}`,
    ]);
    await session.broadcastAccountChange(attachment);
    session.saveAttachment(ws, attachment);
    sendServiceResponse(
      session,
      ws,
      attachment,
      "F",
      [`AUTH successful: You are now logged in as ${authRes.account.username}.`],
      labelTags,
    );
    return;
  }

  if (cmd === "REQUESTBOT") {
    if (args.length < 1) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Syntax: REQUESTBOT <#channel>"],
        labelTags,
      );
      return;
    }
    const rawChan = args[0];
    const channelName = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
    const chanStub = session.getChannelStub(channelName);
    const chanInfo = await chanStub.csInfo(channelName);
    if (!chanInfo.registered) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [
          `Channel ${channelName} is not registered. Register it with ChanServ first (/CS REGISTER ${channelName}).`,
        ],
        labelTags,
      );
      return;
    }
    const members = await chanStub.getMembers();
    const caller = members.find((m) => m.sessionId === attachment.sessionId);
    const isOwner = Boolean(
      attachment.accountName &&
        chanInfo.founder &&
        canonicalizeIRCName(attachment.accountName) === canonicalizeIRCName(chanInfo.founder),
    );
    if (!attachment.isOper && !isOwner && !hasChannelOp(caller?.modes ?? "", false)) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["You must be a channel operator or channel owner to request F."],
        labelTags,
      );
      return;
    }

    await chanStub.setBotConfig({ enabled: true });
    const botPrefix = `F!services@${SERVER_CONFIG.serverName}`;
    for (const m of members) {
      if (m.sessionId.startsWith("service:")) continue;
      const targetSess = session.sessionsById.get(m.sessionId);
      if (!targetSess) continue;
      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          prefix: botPrefix,
          command: "JOIN",
          params: [channelName],
        }),
      );
      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          prefix: botPrefix,
          command: "MODE",
          params: [channelName, "+q", "F"],
        }),
      );
    }
    sendServiceResponse(session, ws, attachment, "F", [`F has joined ${channelName}.`], labelTags);
    return;
  }

  if (cmd === "UNREQUESTBOT") {
    if (args.length < 1) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Syntax: UNREQUESTBOT <#channel>"],
        labelTags,
      );
      return;
    }
    const rawChan = args[0];
    const channelName = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
    const chanStub = session.getChannelStub(channelName);
    const chanInfo = await chanStub.csInfo(channelName);
    const members = await chanStub.getMembers();
    const caller = members.find((m) => m.sessionId === attachment.sessionId);
    const isOwner = Boolean(
      attachment.accountName &&
        chanInfo.founder &&
        canonicalizeIRCName(attachment.accountName) === canonicalizeIRCName(chanInfo.founder),
    );
    if (!attachment.isOper && !isOwner && !hasChannelOp(caller?.modes ?? "", false)) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["You must be a channel operator or channel owner to remove F."],
        labelTags,
      );
      return;
    }

    await chanStub.setBotConfig({ enabled: false });
    const botPrefix = `F!services@${SERVER_CONFIG.serverName}`;
    for (const m of members) {
      if (m.sessionId.startsWith("service:")) continue;
      const targetSess = session.sessionsById.get(m.sessionId);
      if (!targetSess) continue;
      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          prefix: botPrefix,
          command: "PART",
          params: [channelName, `Requested by ${attachment.nickname ?? "operator"}`],
        }),
      );
    }
    sendServiceResponse(session, ws, attachment, "F", [`F has left ${channelName}.`], labelTags);
    return;
  }

  if (cmd === "OP" || cmd === "DEOP" || cmd === "VOICE" || cmd === "DEVOICE") {
    if (args.length < 1) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [`Syntax: ${cmd} <#channel> [nickname]`],
        labelTags,
      );
      return;
    }
    const rawChan = args[0];
    const channelName = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
    const targetNick = args[1] || attachment.nickname || "*";
    const chanStub = session.getChannelStub(channelName);
    const chanInfo = await chanStub.csInfo(channelName);
    const members = await chanStub.getMembers();
    const caller = members.find((m) => m.sessionId === attachment.sessionId);
    const isOwner = Boolean(
      attachment.accountName &&
        chanInfo.founder &&
        canonicalizeIRCName(attachment.accountName) === canonicalizeIRCName(chanInfo.founder),
    );
    if (!attachment.isOper && !isOwner && !hasChannelOp(caller?.modes ?? "", false)) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Access denied: You must be a channel operator or channel owner."],
        labelTags,
      );
      return;
    }

    const modeFlag = cmd === "OP" || cmd === "DEOP" ? "o" : "v";
    const add = cmd === "OP" || cmd === "VOICE";
    const modRes = await chanStub.setMemberModes({
      channelName,
      actorSessionId: attachment.sessionId,
      targetNick,
      add,
      mode: modeFlag,
      isOper: attachment.isOper || isOwner,
    });

    if (!modRes.ok) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [modRes.errorText ?? "Failed to change modes."],
        labelTags,
      );
      return;
    }

    const botPrefix = `F!services@${SERVER_CONFIG.serverName}`;
    const modeLine = `${add ? "+" : "-"}${modeFlag}`;
    for (const sid of modRes.recipientSessionIds) {
      const targetSess = session.sessionsById.get(sid);
      if (!targetSess) continue;
      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          prefix: botPrefix,
          command: "MODE",
          params: [channelName, modeLine, targetNick],
        }),
      );
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "F",
      [`${cmd} applied for ${targetNick} on ${channelName}.`],
      labelTags,
    );
    return;
  }

  if (cmd === "CHANLEV") {
    if (args.length < 1) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Syntax: CHANLEV <#channel> [nickname] [+/-flags]"],
        labelTags,
      );
      return;
    }
    const rawChan = args[0];
    const channelName = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
    const chanStub = session.getChannelStub(channelName);
    if (args.length === 1) {
      const res = await chanStub.csAmode({
        channelName,
        actorSessionId: attachment.sessionId,
        actorUserId: attachment.userId,
        actorAccount: attachment.accountName,
        isOper: attachment.isOper,
      });
      sendServiceResponse(session, ws, attachment, "F", res.lines, labelTags);
      return;
    }
    const targetNick = args[1];
    const flags = args[2] ?? "";
    let targetUserId: string | undefined;
    let resolvedAccount: string | undefined;
    if (targetNick) {
      const cleanAcct = targetNick.replace(/^\$/, "");
      const acctInfo = await session.getAccountsStub().getAccountByUsername(cleanAcct);
      if (acctInfo) {
        targetUserId = acctInfo.id;
        resolvedAccount = acctInfo.username;
      } else {
        const liveSessions = session.getAllSessionsForNick(cleanAcct);
        if (liveSessions.length > 0 && liveSessions[0].attachment.accountName) {
          targetUserId = liveSessions[0].attachment.userId;
          resolvedAccount = liveSessions[0].attachment.accountName;
        }
      }
    }
    const res = await chanStub.csAmode({
      channelName,
      actorSessionId: attachment.sessionId,
      actorUserId: attachment.userId,
      actorAccount: attachment.accountName,
      modeChange: flags,
      targetAccount: resolvedAccount,
      targetUserId,
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "F", res.lines, labelTags);
    return;
  }

  if (cmd === "WELCOME") {
    if (args.length < 1) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Syntax: WELCOME <#channel> [message...]"],
        labelTags,
      );
      return;
    }
    const rawChan = args[0];
    const channelName = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
    const chanStub = session.getChannelStub(channelName);
    const chanInfo = await chanStub.csInfo(channelName);
    const members = await chanStub.getMembers();
    const caller = members.find((m) => m.sessionId === attachment.sessionId);
    const isOwner = Boolean(
      attachment.accountName &&
        chanInfo.founder &&
        canonicalizeIRCName(attachment.accountName) === canonicalizeIRCName(chanInfo.founder),
    );
    if (!attachment.isOper && !isOwner && !hasChannelOp(caller?.modes ?? "", false)) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        ["Access denied: You must be a channel operator or channel owner."],
        labelTags,
      );
      return;
    }

    const welcomeMsg = args.slice(1).join(" ");
    if (!welcomeMsg || welcomeMsg.toUpperCase() === "CLEAR" || welcomeMsg.toUpperCase() === "OFF") {
      await chanStub.setBotConfig({ welcomeMessage: null });
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [`Welcome message cleared for ${channelName}.`],
        labelTags,
      );
    } else {
      await chanStub.setBotConfig({ welcomeMessage: welcomeMsg });
      sendServiceResponse(
        session,
        ws,
        attachment,
        "F",
        [`Welcome message updated for ${channelName}: "${welcomeMsg}"`],
        labelTags,
      );
    }
    return;
  }

  if (cmd === "STATUS") {
    if (args.length < 1) {
      sendServiceResponse(session, ws, attachment, "F", ["Syntax: STATUS <#channel>"], labelTags);
      return;
    }
    const rawChan = args[0];
    const channelName = rawChan.startsWith("#") ? rawChan : `#${rawChan}`;
    const chanStub = session.getChannelStub(channelName);
    const chanInfo = await chanStub.csInfo(channelName);
    const botConfig = await chanStub.getBotConfig();
    const members = await chanStub.getMembers();

    const lines = [
      `Status for channel ${channelName}:`,
      `  Registered: ${chanInfo.registered ? "Yes (founder: " + chanInfo.founder + ")" : "No"}`,
      `  F Bot Active: ${botConfig.enabled ? "Yes" : "No"}`,
      `  Welcome Greeting: ${
        botConfig.welcomeMessage ? `"${botConfig.welcomeMessage}"` : "(none)"
      }`,
      `  Member Count: ${members.length}`,
    ];
    sendServiceResponse(session, ws, attachment, "F", lines, labelTags);
    return;
  }

  sendServiceResponse(
    session,
    ws,
    attachment,
    "F",
    [`Unknown command "${cmd}". Type /MSG F HELP for help.`],
    labelTags,
  );
}

