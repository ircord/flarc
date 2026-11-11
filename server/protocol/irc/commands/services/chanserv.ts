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

export async function handleChanServ(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawText: string,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "HELP").toUpperCase();
  const accountsStub = session.getAccountsStub();

  if (sub === "INFO") {
    const channelName = parts[1] ?? "";
    if (!channelName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["Syntax: /CS INFO #channel"],
        labelTags,
      );
      return;
    }
    const stub = session.getChannelStub(channelName);
    const info = await stub.csInfo(channelName);
    if (!info.registered) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        [`Channel ${info.channelName} is not registered`],
        labelTags,
      );
      return;
    }
    const regDate = new Date(info.registeredAt ?? Date.now()).toUTCString();
    sendServiceResponse(
      session,
      ws,
      attachment,
      "ChanServ",
      [
        `Channel ${info.channelName} is registered`,
        `Founder: ${info.founder ?? "*"}`,
        `Registered at: ${regDate}`,
      ],
      labelTags,
    );
    return;
  }

  if (sub === "REGISTER") {
    const channelName = parts[1] ?? "";
    if (!channelName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["Syntax: /CS REGISTER #channel"],
        labelTags,
      );
      return;
    }
    if (!attachment.accountName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["You must be logged in to register a channel"],
        labelTags,
      );
      return;
    }
    const stub = session.getChannelStub(channelName);
    const res = await stub.csRegister({
      channelName,
      actorSessionId: attachment.sessionId,
      actorUserId: attachment.userId,
      actorAccount: attachment.accountName,
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "ChanServ", [res.message], labelTags);

    if (res.ok && res.appliedModes && res.appliedNick) {
      const modeLine = encodeIRCMessage({
        prefix: `ChanServ!ChanServ@${SERVER_CONFIG.serverName}`,
        command: "MODE",
        params: [res.channelName, res.appliedModes, res.appliedNick],
      });
      for (const sid of res.recipientSessionIds ?? []) {
        const sess = session.sessionsById.get(sid);
        if (sess) session.sendLine(sess.ws, sess.attachment, modeLine);
      }
    }
    return;
  }

  if (sub === "OP" || sub === "DEOP") {
    const channelName = parts[1] ?? "";
    const targetNick = parts[2] ?? attachment.nickname ?? "";
    if (!channelName || !targetNick) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        [`Syntax: /CS ${sub} #channel [nickname]`],
        labelTags,
      );
      return;
    }
    const stub = session.getChannelStub(channelName);
    const res = await stub.csOpDeop({
      channelName,
      actorSessionId: attachment.sessionId,
      actorAccount: attachment.accountName,
      targetNick,
      adding: sub === "OP",
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "ChanServ", res.lines, labelTags);
    if (res.ok && res.appliedModeString && res.appliedModeNick) {
      const modeLine = encodeIRCMessage({
        prefix: `ChanServ!ChanServ@${SERVER_CONFIG.serverName}`,
        command: "MODE",
        params: [channelName, res.appliedModeString, res.appliedModeNick],
      });
      for (const sid of res.recipientSessionIds ?? []) {
        const sess = session.sessionsById.get(sid);
        if (sess) session.sendLine(sess.ws, sess.attachment, modeLine);
      }
    }
    return;
  }

  if (sub === "AMODE") {
    const channelName = parts[1] ?? "";
    const modeChange = parts[2];
    const targetAccount = parts[3];
    if (!channelName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["Syntax: /CS AMODE #channel [mode account]"],
        labelTags,
      );
      return;
    }

    let targetUserId: string | undefined;
    let resolvedAccount: string | undefined;
    if (targetAccount) {
      const cleanAcct = targetAccount.replace(/^\$/, "");
      const acctInfo = await accountsStub.getAccountByUsername(cleanAcct);
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

    const stub = session.getChannelStub(channelName);
    const res = await stub.csAmode({
      channelName,
      actorSessionId: attachment.sessionId,
      actorUserId: attachment.userId,
      actorAccount: attachment.accountName,
      modeChange,
      targetAccount: resolvedAccount,
      targetUserId,
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "ChanServ", res.lines, labelTags);

    if (res.ok && res.appliedModeString && res.appliedModeNick) {
      const modeLine = encodeIRCMessage({
        prefix: `ChanServ!ChanServ@${SERVER_CONFIG.serverName}`,
        command: "MODE",
        params: [channelName, res.appliedModeString, res.appliedModeNick],
      });
      for (const sid of res.recipientSessionIds ?? []) {
        const sess = session.sessionsById.get(sid);
        if (sess) session.sendLine(sess.ws, sess.attachment, modeLine);
      }
    }
    return;
  }

  if (sub === "UNREGISTER" || sub === "DROP" || sub === "PURGE") {
    const channelName = parts[1] ?? "";
    const code = sub === "PURGE" && attachment.isOper ? undefined : parts[2];
    if (!channelName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        [`Syntax: /CS ${sub} #channel [code]`],
        labelTags,
      );
      return;
    }
    const stub = session.getChannelStub(channelName);
    const res = await stub.csUnregister({
      channelName,
      actorSessionId: attachment.sessionId,
      actorAccount: attachment.accountName,
      code,
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "ChanServ", res.lines, labelTags);
    return;
  }

  if (sub === "CLEAR") {
    const channelName = parts[1] ?? "";
    const clearTarget = parts[2] ?? "";
    if (!channelName || !clearTarget) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["Syntax: /CS CLEAR #channel <users|access>"],
        labelTags,
      );
      return;
    }
    const stub = session.getChannelStub(channelName);
    const res = await stub.csClear({
      channelName,
      actorSessionId: attachment.sessionId,
      actorAccount: attachment.accountName,
      target: clearTarget,
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "ChanServ", res.lines, labelTags);
    if (res.ok && res.kickedMembers && res.kickedMembers.length > 0) {
      for (const k of res.kickedMembers) {
        session.sql.exec(
          "DELETE FROM session_channels WHERE session_id = ? AND canonical_channel = ?",
          k.sessionId,
          canonicalizeIRCName(channelName),
        );
        const kickLine = encodeIRCMessage({
          prefix: `ChanServ!ChanServ@${SERVER_CONFIG.serverName}`,
          command: "KICK",
          params: [channelName, k.nickname, "CLEAR USERS by ChanServ"],
        });
        for (const sid of res.recipientSessionIds ?? []) {
          const sess = session.sessionsById.get(sid);
          if (sess) session.sendLine(sess.ws, sess.attachment, kickLine);
        }
      }
    }
    return;
  }

  if (sub === "GET" || sub === "SET") {
    const channelName = parts[1] ?? "";
    const setting = parts[2];
    const value = parts[3];
    if (!channelName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        [`Syntax: /CS ${sub} #channel <setting> [value]`],
        labelTags,
      );
      return;
    }
    const stub = session.getChannelStub(channelName);
    const res = await stub.csGetSet({
      channelName,
      actorSessionId: attachment.sessionId,
      actorAccount: attachment.accountName,
      subcmd: sub,
      setting,
      value,
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "ChanServ", res.lines, labelTags);
    return;
  }

  if (sub === "LIST") {
    const rows = session.sql
      .exec<{ channel_name: string }>("SELECT DISTINCT channel_name FROM session_channels")
      .toArray();
    const lines: string[] = [`Channels (${rows.length}):`];
    for (const r of rows) {
      const info = await session.getChannelStub(r.channel_name).csInfo(r.channel_name);
      lines.push(
        `- ${info.channelName}${info.registered ? ` (registered by ${info.founder ?? "*"})` : ""}`,
      );
    }
    sendServiceResponse(session, ws, attachment, "ChanServ", lines, labelTags);
    return;
  }

  if (sub === "HOWTOBAN") {
    const channelName = parts[1] ?? "";
    const targetNick = parts[2] ?? "";
    if (!channelName || !targetNick) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["Syntax: /CS HOWTOBAN #channel <nickname>"],
        labelTags,
      );
      return;
    }
    const sess = session.getAllSessionsForNick(targetNick)[0];
    const mask = sess?.attachment.accountName
      ? `$a:${sess.attachment.accountName}`
      : `*!*@${sess?.attachment.hostname ?? "*"}`;
    sendServiceResponse(
      session,
      ws,
      attachment,
      "ChanServ",
      [`To ban ${targetNick} on ${channelName}, run: /MODE ${channelName} +b ${mask}`],
      labelTags,
    );
    return;
  }

  if (sub === "TRANSFER") {
    const arg1 = parts[1] ?? "";
    const isAccept = arg1.toLowerCase() === "accept";
    const channelName = isAccept ? (parts[2] ?? "") : arg1;
    const targetAccount = isAccept ? (attachment.accountName ?? "") : (parts[2] ?? "");
    const code = isAccept ? undefined : parts[3];

    if (!channelName || !targetAccount) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["Syntax: /CS TRANSFER #channel account [code]"],
        labelTags,
      );
      return;
    }

    const acctInfo = await accountsStub.getAccountByUsername(targetAccount);
    if (!acctInfo) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "ChanServ",
        ["Account does not exist"],
        labelTags,
      );
      return;
    }

    const stub = session.getChannelStub(channelName);
    const res = await stub.csTransfer({
      channelName,
      actorAccount: attachment.accountName,
      targetAccount: acctInfo.username,
      targetUserId: acctInfo.id,
      code,
      isAccept,
      isOper: attachment.isOper,
    });
    sendServiceResponse(session, ws, attachment, "ChanServ", res.lines, labelTags);
    return;
  }

  sendServiceResponse(
    session,
    ws,
    attachment,
    "ChanServ",
    [
      "ChanServ commands: OP, DEOP, REGISTER, UNREGISTER, AMODE, CLEAR, TRANSFER, LIST, INFO, GET, SET, HOWTOBAN",
    ],
    labelTags,
  );
}

