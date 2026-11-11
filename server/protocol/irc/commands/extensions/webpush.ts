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

export async function handleWebpush(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const sub = (msg.params[0] ?? "").toUpperCase();
  const userKey = attachment.accountName ?? attachment.userId;
  const accountsStub = session.getAccountsStub();

  if (sub === "VAPID") {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "WEBPUSH",
        params: [
          "VAPID",
          "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
        ],
      }),
    );
    return;
  }

  if (sub === "REGISTER") {
    const endpoint = msg.params[1] ?? "";
    const keys = msg.params.slice(2).join(" ");
    if (!endpoint) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: ["WEBPUSH", "NEED_MORE_PARAMS", "REGISTER", "Missing endpoint"],
        }),
      );
      return;
    }
    await accountsStub.registerWebpush(userKey, endpoint, keys);
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "WEBPUSH",
        params: ["REGISTER", endpoint],
      }),
    );
    return;
  }

  if (sub === "UNREGISTER") {
    const endpoint = msg.params[1] ?? "";
    await accountsStub.unregisterWebpush(userKey, endpoint);
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "WEBPUSH",
        params: ["UNREGISTER", endpoint],
      }),
    );
    return;
  }

  if (sub === "LIST") {
    const endpoints = await accountsStub.listWebpush(userKey);
    for (const ep of endpoints) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "WEBPUSH",
          params: ["LIST", ep],
        }),
      );
    }
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "WEBPUSH",
        params: ["LIST"],
      }),
    );
    return;
  }

  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, labelTags),
      prefix: SERVER_CONFIG.serverName,
      command: "WEBPUSH",
      params: [sub || "OK"],
    }),
  );
}

