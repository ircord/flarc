import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

export function handleMonitor(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const sub = (msg.params[0] ?? "").toUpperCase();
  const targetsRaw = msg.params[1] ?? "";
  const targets = targetsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (sub === "+") {
    const online: string[] = [];
    const offline: string[] = [];

    for (const t of targets) {
      const canon = canonicalizeIRCName(t);
      session.sql.exec(
        "INSERT OR IGNORE INTO session_monitors (session_id, target_nick) VALUES (?, ?)",
        attachment.sessionId,
        canon,
      );
      const svc = session.getServiceDefinition(t);
      if (svc) {
        online.push(`${svc.name}!${svc.name}@${SERVER_CONFIG.serverName}`);
        continue;
      }
      const matches = session.getAllSessionsForNick(t);
      if (matches.length > 0 && matches[0].attachment.registered) {
        online.push(session.getUserPrefix(matches[0].attachment));
      } else {
        offline.push(t);
      }
    }

    if (online.length > 0) {
      session.sendNumeric(ws, attachment, Numerics.RPL_MONONLINE, [online.join(",")], labelTags);
    }
    if (offline.length > 0) {
      session.sendNumeric(ws, attachment, Numerics.RPL_MONOFFLINE, [offline.join(",")], labelTags);
    }
  } else if (sub === "-") {
    for (const t of targets) {
      session.sql.exec(
        "DELETE FROM session_monitors WHERE session_id = ? AND target_nick = ?",
        attachment.sessionId,
        canonicalizeIRCName(t),
      );
    }
    session.sendAck(ws, attachment, labelTags);
  } else if (sub === "C") {
    session.sql.exec("DELETE FROM session_monitors WHERE session_id = ?", attachment.sessionId);
    session.sendAck(ws, attachment, labelTags);
  } else if (sub === "L") {
    const rows = session.sql
      .exec<{ target_nick: string }>(
        "SELECT target_nick FROM session_monitors WHERE session_id = ?",
        attachment.sessionId,
      )
      .toArray();
    if (rows.length > 0) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.RPL_MONLIST,
        [rows.map((r) => r.target_nick).join(",")],
        labelTags,
      );
    }
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_ENDOFMONLIST,
      ["End of MONITOR list"],
      labelTags,
    );
  } else if (sub === "S") {
    const rows = session.sql
      .exec<{ target_nick: string }>(
        "SELECT target_nick FROM session_monitors WHERE session_id = ?",
        attachment.sessionId,
      )
      .toArray();
    const online: string[] = [];
    const offline: string[] = [];
    for (const r of rows) {
      const svc = session.getServiceDefinition(r.target_nick);
      if (svc) {
        online.push(`${svc.name}!${svc.name}@${SERVER_CONFIG.serverName}`);
        continue;
      }
      const matches = session.getAllSessionsForNick(r.target_nick);
      if (matches.length > 0 && matches[0].attachment.registered) {
        online.push(session.getUserPrefix(matches[0].attachment));
      } else {
        offline.push(r.target_nick);
      }
    }
    if (online.length > 0) {
      session.sendNumeric(ws, attachment, Numerics.RPL_MONONLINE, [online.join(",")], labelTags);
    }
    if (offline.length > 0) {
      session.sendNumeric(ws, attachment, Numerics.RPL_MONOFFLINE, [offline.join(",")], labelTags);
    }
  }
}
