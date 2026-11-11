import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

export async function handleAway(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const awayMsg = msg.params[0] ?? "";
  if (!awayMsg) {
    attachment.awayMessage = null;
    session.saveAttachment(ws, attachment);
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_UNAWAY,
      ["You are no longer marked as being away"],
      labelTags,
    );
  } else {
    attachment.awayMessage = awayMsg;
    session.saveAttachment(ws, attachment);
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_NOWAWAY,
      ["You have been marked as being away"],
      labelTags,
    );
  }

  const sharedSessions = await session.getSharedAndMonitoredSessions(attachment, "away-notify");
  const awayLine = encodeIRCMessage({
    prefix: session.getUserPrefix(attachment),
    command: "AWAY",
    params: awayMsg ? [awayMsg] : [],
  });

  for (const sid of sharedSessions) {
    if (sid === attachment.sessionId) continue;
    const sess = session.sessionsById.get(sid);
    if (sess && session.hasCap(sess.attachment, "away-notify")) {
      session.sendLine(sess.ws, sess.attachment, awayLine);
    }
  }
}
