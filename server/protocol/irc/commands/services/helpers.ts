import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import type { ISessionDO } from "../types";

export function sendServiceResponse(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  serviceName: "NickServ" | "ChanServ" | "HostServ" | "HistServ" | "F",
  lines: string[],
  labelTags?: Record<string, string | true>,
): void {
  const prefix =
    serviceName === "F"
      ? `F!services@${SERVER_CONFIG.serverName}`
      : `${serviceName}!${serviceName}@${SERVER_CONFIG.serverName}`;
  const target = attachment.nickname ?? "*";
  const useLabeledBatch =
    Boolean(labelTags?.label) &&
    session.hasCap(attachment, "labeled-response") &&
    session.hasCap(attachment, "batch");

  const batchId = crypto.randomUUID().slice(0, 8);
  if (useLabeledBatch) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`+${batchId}`, "labeled-response"],
      }),
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const tags: Record<string, string | true> | undefined = useLabeledBatch
      ? { batch: batchId }
      : i === 0
        ? labelTags
        : undefined;

    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, tags),
        prefix,
        command: "NOTICE",
        params: [target, lines[i]],
      }),
    );
  }

  if (useLabeledBatch) {
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
