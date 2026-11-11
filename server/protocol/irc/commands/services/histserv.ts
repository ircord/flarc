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
import { handleChathistory } from "../extensions";

export async function handleHistServ(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawText: string,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "HELP").toUpperCase();

  if (sub === "PLAY") {
    const target = parts[1] ?? "";
    const limit = parts[2] ?? "25";
    if (!target) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HistServ",
        ["Syntax: /HISTSERV PLAY <target> [limit]"],
        labelTags,
      );
      return;
    }
    await handleChathistory(
      session,
      ws,
      attachment,
      {
        tags: {},
        prefix: null,
        command: "CHATHISTORY",
        params: ["LATEST", target, "*", limit],
      },
      labelTags,
    );
    return;
  }

  if (sub === "DELETE") {
    const target = parts[1] ?? "";
    const msgid = parts[2] ?? (parts[1] && !parts[1].startsWith("#") ? parts[1] : "");
    if (!target || !msgid) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HistServ",
        ["Syntax: /HISTSERV DELETE <#channel> <msgid>"],
        labelTags,
      );
      return;
    }
    if (target.startsWith("#") || target.startsWith("&")) {
      const stub = session.getChannelStub(target);
      const res = await stub.histServDelete(target, msgid);
      if (!res.ok) {
        sendServiceResponse(
          session,
          ws,
          attachment,
          "HistServ",
          [`Could not delete message ${msgid}`],
          labelTags,
        );
        return;
      }
      const redactLine = encodeIRCMessage({
        prefix: `HistServ!HistServ@${SERVER_CONFIG.serverName}`,
        command: "REDACT",
        params: [res.channelName, msgid],
      });
      for (const sid of res.recipientSessionIds) {
        const sess = session.sessionsById.get(sid);
        if (sess) session.sendLine(sess.ws, sess.attachment, redactLine);
      }
    } else {
      session.sql.exec("UPDATE direct_messages SET redacted = 1, content = '' WHERE id = ?", msgid);
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "HistServ",
      [`Successfully deleted message ${msgid}`],
      labelTags,
    );
    return;
  }

  if (sub === "FORGET") {
    const accountOrNick = parts[1] ?? attachment.accountName ?? attachment.nickname ?? "";
    if (!accountOrNick) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HistServ",
        ["Syntax: /HISTSERV FORGET <account>"],
        labelTags,
      );
      return;
    }
    let total = 0;
    const rows = session.sql
      .exec<{ channel_name: string }>("SELECT DISTINCT channel_name FROM session_channels")
      .toArray();
    for (const r of rows) {
      const res = await session
        .getChannelStub(r.channel_name)
        .histServForget(r.channel_name, accountOrNick);
      total += res.count;
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "HistServ",
      [`Successfully forgot ${total} message(s) from ${accountOrNick}`],
      labelTags,
    );
    return;
  }

  if (sub === "EXPORT") {
    const target = parts[1] ?? "";
    if (!target) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HistServ",
        ["Syntax: /HISTSERV EXPORT <#channel>"],
        labelTags,
      );
      return;
    }
    const res = await session.getChannelStub(target).queryHistory({
      channelName: target,
      sessionId: attachment.sessionId,
      nickname: attachment.nickname!,
      username: attachment.username!,
      hostname: attachment.hostname,
      accountName: attachment.accountName,
      subcommand: "LATEST",
      reference1: "*",
      limit: 100,
      isOper: attachment.isOper,
    });
    const lines = [
      `Export of ${target} (${res.messages.length} messages):`,
      ...res.messages.map(
        (m) => `[${new Date(m.createdAt).toISOString()}] <${m.senderNick}> ${m.content}`,
      ),
    ];
    sendServiceResponse(session, ws, attachment, "HistServ", lines, labelTags);
    return;
  }

  sendServiceResponse(
    session,
    ws,
    attachment,
    "HistServ",
    ["HistServ commands: PLAY, DELETE, FORGET, EXPORT"],
    labelTags,
  );
}

