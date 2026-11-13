import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

export async function sendReadMarkerOnJoin(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  channelName: string,
  tags?: Record<string, string | true>,
): Promise<void> {
  if (!session.hasCap(attachment, "draft/read-marker")) return;
  const userKey = attachment.accountName ?? attachment.userId;
  const stored = await session.getAccountsStub().getReadMarker(userKey, channelName);
  const param = stored ? `timestamp=${stored}` : "*";
  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, tags),
      prefix: SERVER_CONFIG.serverName,
      command: "MARKREAD",
      params: [channelName, param],
    }),
  );
}

export async function handleMarkread(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (msg.params.length < 1 || !msg.params[0]) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["MARKREAD", "NEED_MORE_PARAMS", "Not enough parameters"],
      }),
    );
    return;
  }

  const target = msg.params[0];
  const tsParam = msg.params[1];
  if (!/^[#&]/.test(target) && attachment.authenticated) {
    const account = await session.getAccountsStub().resolveConversationAccount(target);
    if (!account) return;
    const pair = [attachment.userId, account.id].sort().join("<->");
    const conversation = session.sql
      .exec<{ id: string }>("SELECT id FROM conversations WHERE pair_key=?", pair)
      .toArray()[0];
    if (!conversation) return;
    if (!tsParam) {
      const result = await session.featureRequest(
        { ircSessionId: attachment.sessionId },
        "conversation.unread",
        { conversationId: conversation.id },
      );
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          tags: labelTags,
          command: "MARKREAD",
          params: [target, JSON.stringify(result)],
        }),
      );
      return;
    }
    const stamp = tsParam.startsWith("timestamp=") ? Date.parse(tsParam.slice(10)) : NaN;
    const row = tsParam.startsWith("msgid=")
      ? { id: tsParam.slice(6) }
      : Number.isFinite(stamp)
        ? session.sql
            .exec<{ id: string }>(
              "SELECT id FROM direct_messages WHERE conversation_id=? AND created_at<=? ORDER BY sequence DESC LIMIT 1",
              conversation.id,
              stamp,
            )
            .toArray()[0]
        : null;
    if (!row) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: ["MARKREAD", "INVALID_PARAMS", target, "Unknown message or timestamp"],
        }),
      );
      return;
    }
    const result = await session.featureRequest(
      { ircSessionId: attachment.sessionId },
      "conversation.read",
      {
        conversationId: conversation.id,
        messageId: row.id,
        clientOperationId:
          msg.tags["+draft/client-operation-id"] ?? `${Date.now()}.${crypto.randomUUID()}`,
      },
    );
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        tags: labelTags,
        command: "MARKREAD",
        params: [target, JSON.stringify(result)],
      }),
    );
    return;
  }

  const userKey = attachment.accountName ?? attachment.userId;
  const accountsStub = session.getAccountsStub();

  if (!tsParam) {
    const existing = await accountsStub.getReadMarker(userKey, target);
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "MARKREAD",
        params: [target, existing ? `timestamp=${existing}` : "*"],
      }),
    );
    return;
  }

  if (!tsParam.startsWith("timestamp=")) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["MARKREAD", "INVALID_PARAMS", target, tsParam, "Invalid timestamp parameter"],
      }),
    );
    return;
  }

  const rawIso = tsParam.slice("timestamp=".length);
  if (Number.isNaN(Date.parse(rawIso))) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["MARKREAD", "INVALID_PARAMS", target, tsParam, "Invalid ISO timestamp"],
      }),
    );
    return;
  }

  const updatedIso = await accountsStub.updateReadMarker(userKey, target, rawIso);

  // Reply to sender and broadcast to other sessions of the same account
  for (const { ws: sWs, attachment: sAtt } of session.sessionsById.values()) {
    const sameUser =
      sAtt.sessionId === attachment.sessionId ||
      (attachment.accountName &&
        sAtt.accountName &&
        canonicalizeIRCName(attachment.accountName) === canonicalizeIRCName(sAtt.accountName));

    if (!sameUser || !session.hasCap(sAtt, "draft/read-marker")) continue;

    const isSelf = sAtt.sessionId === attachment.sessionId;
    session.sendLine(
      sWs,
      sAtt,
      encodeIRCMessage({
        tags: isSelf ? session.filterOutgoingTags(sAtt, labelTags) : undefined,
        prefix: SERVER_CONFIG.serverName,
        command: "MARKREAD",
        params: [target, `timestamp=${updatedIso}`],
      }),
    );
  }
}
