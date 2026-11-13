import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

/** Explicit structured IRC parity; legacy PRIVMSG/REDACT/CHATHISTORY remain valid. */
export async function handleConversation(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
) {
  const names: Record<string, string> = {
    LIST: "conversations.list",
    CREATE: "conversations.create",
    GET: "conversation.get",
    HISTORY: "conversation.history",
    MESSAGE: "conversation.message",
    SEND: "conversation.send",
    EDIT: "conversation.edit",
    REDACT: "conversation.redact",
    READ: "conversation.read",
    UNREAD: "conversation.unread",
    BOOTSTRAP: "events.bootstrap",
    REPLAY: "events.replay",
  };
  const operation = names[msg.params[0]?.toUpperCase()];
  if (!operation) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["CONVERSATION", "UNKNOWN_OPERATION", "Unknown operation"],
      }),
    );
    return;
  }
  try {
    const input = msg.params[1] ? JSON.parse(msg.params[1]) : {};
    const result = await session.featureRequest(
      { ircSessionId: attachment.sessionId },
      operation,
      input,
    );
    // Each reply is independently tagged; history is a bounded structured batch.
    const batch = crypto.randomUUID();
    if (session.hasCap(attachment, "batch"))
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          tags: labelTags,
          command: "BATCH",
          params: [`+${batch}`, "flarc/conversation", msg.params[0]],
        }),
      );
    const items = Array.isArray(result.messages)
      ? result.messages.map((message: any) => ({ message }))
      : Array.isArray(result.events)
        ? result.events.map((event: any) => ({ event }))
        : [];
    for (const item of items)
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          tags: session.filterOutgoingTags(attachment, {
            ...labelTags,
            ...(session.hasCap(attachment, "batch") ? { batch } : {}),
          }),
          command: "CONVERSATION",
          params: [msg.params[0], JSON.stringify(item)],
        }),
      );
    const summary = { ...result };
    if (items.length) {
      delete summary.messages;
      delete summary.events;
    }
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        tags: session.filterOutgoingTags(attachment, {
          ...labelTags,
          ...(session.hasCap(attachment, "batch") ? { batch } : {}),
        }),
        command: "CONVERSATION",
        params: [msg.params[0], JSON.stringify(summary)],
      }),
    );
    if (session.hasCap(attachment, "batch"))
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`-${batch}`],
        }),
      );
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    const match = text.match(/F3:(\d+):([A-Z_]+):(.+)/);
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        tags: session.filterOutgoingTags(attachment, labelTags),
        command: "FAIL",
        params: ["CONVERSATION", match?.[2] ?? "INVALID_INPUT", match?.[3] ?? "Invalid request"],
      }),
    );
  }
}
