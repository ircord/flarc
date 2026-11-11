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

export function handleIsupportCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  labelTags?: Record<string, string | true>,
): void {
  const tokenRows = session.getIsupportTokens();
  const supportsBatch =
    session.hasCap(attachment, "batch") && session.hasCap(attachment, "draft/extended-isupport");
  const batchId = crypto.randomUUID().slice(0, 8);

  if (supportsBatch) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`+${batchId}`, "draft/isupport"],
      }),
    );
  }

  for (const row of tokenRows) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_ISUPPORT,
      row,
      supportsBatch ? { batch: batchId } : labelTags,
    );
  }

  if (supportsBatch) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`-${batchId}`],
      }),
    );
  }
}

