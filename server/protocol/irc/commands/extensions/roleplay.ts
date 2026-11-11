import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import type { IRCMessage } from "~/protocol/irc/types";
import { canSendDirectMessage } from "../messaging";
import type { ISessionDO } from "../types";

export async function handleRoleplayCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  cmd: "NPC" | "NPCA" | "SCENE" | "AMBIANCE",
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const isScene = cmd === "SCENE" || cmd === "AMBIANCE";
  const minParams = isScene ? 2 : 3;
  if (msg.params.length < minParams) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      [cmd, "Not enough parameters"],
      labelTags,
    );
    return;
  }

  const target = msg.params[0];
  const npcNick = isScene ? "=Scene=" : `*${msg.params[1]}*`;
  const rawText = msg.params.slice(isScene ? 1 : 2).join(" ");
  const content =
    cmd === "NPCA"
      ? `\x01ACTION ${rawText} (${attachment.nickname})\x01`
      : `${rawText} (${attachment.nickname})`;

  if (target.startsWith("#") || target.startsWith("&")) {
    const stub = session.getChannelStub(target);
    const res = await stub.appendMessage({
      channelName: target,
      sessionId: attachment.sessionId,
      userId: attachment.userId,
      accountName: attachment.accountName,
      nickname: npcNick,
      username: attachment.username!,
      hostname: attachment.hostname,
      command: "PRIVMSG",
      content,
      requireRoleplayMode: true,
      isOper: attachment.isOper,
    });

    if (!res.ok || !res.message) {
      session.sendNumeric(
        ws,
        attachment,
        res.numeric ?? Numerics.ERR_CANNOTSENDRP,
        [target, res.errorText ?? "Target does not have roleplaying mode (+E) set"],
        labelTags,
      );
      return;
    }

    const stored = res.message;
    const prefix = `${npcNick}!${attachment.username}@${attachment.hostname}`;
    for (const sid of res.recipientSessionIds ?? []) {
      const sess = session.sessionsById.get(sid);
      if (!sess) continue;
      session.sendLine(
        sess.ws,
        sess.attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(sess.attachment, {
            msgid: stored.id,
            time: new Date(stored.createdAt).toISOString(),
            ...(sid === attachment.sessionId && labelTags?.label ? { label: labelTags.label } : {}),
          }),
          prefix,
          command: "PRIVMSG",
          params: [target, content],
        }),
      );
    }
  } else {
    const targetSessions = session.getAllSessionsForNick(target);
    if (targetSessions.length === 0) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOSUCHNICK,
        [target, "No such nick/channel"],
        labelTags,
      );
      return;
    }
    const primary = targetSessions[0];
    if (!(primary.attachment.userModes ?? "").includes("E")) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_CANNOTSENDRP,
        [target, "Target does not have roleplaying mode (+E) set"],
        labelTags,
      );
      return;
    }
    if (
      !canSendDirectMessage(
        session,
        ws,
        attachment,
        primary.attachment,
        "PRIVMSG",
        content,
        labelTags,
      )
    )
      return;
    const message = session.storeDirectMessage({
      sender: attachment,
      target: primary.attachment,
      messageId: crypto.randomUUID(),
      command: "PRIVMSG",
      content,
      displayNick: npcNick,
    });
    const prefix = `${npcNick}!${attachment.username}@${attachment.hostname}`;
    for (const ts of targetSessions) {
      session.sendLine(
        ts.ws,
        ts.attachment,
        encodeIRCMessage({
          prefix,
          tags: session.filterOutgoingTags(ts.attachment, {
            msgid: message.id,
            time: new Date(message.createdAt).toISOString(),
            ...(attachment.accountName ? { account: attachment.accountName } : {}),
          }),
          command: "PRIVMSG",
          params: [ts.attachment.nickname!, content],
        }),
      );
    }
    session.sendAck(ws, attachment, labelTags);
  }
}
