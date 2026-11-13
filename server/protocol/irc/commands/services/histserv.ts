import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import { handleChathistory } from "../extensions";
import type { ISessionDO } from "../types";
import { serviceAudit, serviceAuditActor, serviceAudited } from "./audit";
import { sendServiceResponse } from "./helpers";

export async function handleHistServ(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawText: string,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "HELP").toUpperCase();
  const actor = await serviceAuditActor(session, attachment);

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
      const res = await serviceAudited(
        session,
        actor,
        "service.histserv.delete",
        "channel",
        target,
        () =>
          stub.redactMessage({
            channelName: target,
            expectedGeneration: session
              .getSessionChannels(attachment.sessionId)
              .find((c) => c.canonicalChannel === canonicalizeIRCName(target))?.generation,
            actorSessionId: attachment.sessionId,
            actorUserId: attachment.userId,
            actorAccount: attachment.accountName,
            actorNick: attachment.nickname!,
            targetMsgId: msgid,
            isOper: attachment.isOper,
          }),
        (result) => result.ok,
      );
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
      for (const sid of res.recipientSessionIds ?? []) {
        const sess = session.sessionsById.get(sid);
        if (sess) session.sendLine(sess.ws, sess.attachment, redactLine);
      }
    } else {
      if (
        !(await serviceAudited(
          session,
          actor,
          "service.histserv.delete",
          "message",
          msgid,
          () => session.redactDirectMessage(msgid, attachment.userId, attachment.sessionId),
          (result) => result,
        ))
      ) {
        sendServiceResponse(
          session,
          ws,
          attachment,
          "HistServ",
          ["Could not delete message"],
          labelTags,
        );
        return;
      }
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
    if (
      !attachment.isOper &&
      canonicalizeIRCName(accountOrNick) !== canonicalizeIRCName(attachment.accountName ?? "")
    ) {
      await serviceAudit(
        session,
        actor,
        "service.histserv.forget",
        "account",
        accountOrNick,
        "denied",
      );
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HistServ",
        ["Insufficient privileges"],
        labelTags,
      );
      return;
    }
    const targetAccount = await session.getAccountsStub().getAccountByUsername(accountOrNick);
    if (!targetAccount) {
      await serviceAudit(
        session,
        actor,
        "service.histserv.forget",
        "account",
        accountOrNick,
        "denied",
      );
      return;
    }
    const total = await serviceAudited(
      session,
      actor,
      "service.histserv.forget",
      "account",
      accountOrNick,
      async () => {
        let count = 0;
        const rows = session.sql
          .exec<{ channel_name: string; generation: string }>(
            "SELECT DISTINCT channel_name,generation FROM session_channels WHERE generation IS NOT NULL",
          )
          .toArray();
        for (const row of rows) {
          const result = await session
            .getChannelStub(row.channel_name)
            .histServForget(row.channel_name, targetAccount.id, row.generation);
          count += result.count;
        }
        return count;
      },
      () => true,
    );
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
