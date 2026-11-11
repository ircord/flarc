import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

export async function handlePersistence(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const sub = (msg.params[0] ?? "").toUpperCase();
  const val = (msg.params[1] ?? "ON").toUpperCase();
  if (sub === "SET" && attachment.authenticated) {
    await session.getAccountsStub().setPersistence(attachment.userId, val === "ON");
  }
  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, labelTags),
      prefix: SERVER_CONFIG.serverName,
      command: "PERSISTENCE",
      params: [val === "OFF" ? "OFF" : "ON"],
    }),
  );
}
