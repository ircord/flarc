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
