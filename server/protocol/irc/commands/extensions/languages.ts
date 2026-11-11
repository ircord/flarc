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

export function handleLanguageCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const langs = msg.params.filter(Boolean).map((l) => l.toLowerCase());
  if (langs.length > 0) {
    attachment.languages = langs;
    session.saveAttachment(ws, attachment);
  }
  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_YOURLANGUAGESARE,
    [...(attachment.languages ?? ["en"]), "are your preferred languages"],
    labelTags,
  );
}

