import type { SessionAttachment } from "~/core/types";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

export function handleAcceptCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const raw = msg.params[0] ?? "*";
  const list = new Set((attachment.acceptList ?? []).map((n) => canonicalizeIRCName(n)));
  if (raw === "*") {
    if (list.size > 0) {
      session.sendNumeric(ws, attachment, Numerics.RPL_ACCEPTLIST, [Array.from(list).join(" ")]);
    }
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_ENDOFACCEPT,
      ["End of /ACCEPT list"],
      labelTags,
    );
    return;
  }

  for (const token of raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)) {
    const removing = token.startsWith("-");
    const nick = token.replace(/^[+-]/, "");
    const canon = canonicalizeIRCName(nick);
    if (!canon) continue;
    if (removing) {
      list.delete(canon);
    } else {
      list.add(canon);
    }
  }
  attachment.acceptList = Array.from(list);
  session.saveAttachment(ws, attachment);
  session.sendAck(ws, attachment, labelTags);
}
