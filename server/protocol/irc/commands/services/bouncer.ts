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
import { sendServiceResponse } from "./helpers";
import { handleChathistory } from "../extensions";

export function handleBouncerCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const sub = (msg.params[0] ?? "").toUpperCase();
  if (sub === "LISTNETWORKS") {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "BOUNCER",
        params: [
          "NETWORK",
          SERVER_CONFIG.networkId,
          `name=${SERVER_CONFIG.networkId};state=connected`,
        ],
      }),
    );
    if (SERVER_CONFIG.networkId.toLowerCase() !== "cfcord") {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "BOUNCER",
          params: ["NETWORK", "cfcord", "name=cfcord;state=connected"],
        }),
      );
    }
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "BOUNCER",
        params: ["LISTNETWORKS", "200", "OK"],
      }),
    );
    return;
  }
  session.sendAck(ws, attachment, labelTags);
}


export async function handleZncCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const mod = (msg.params[0] ?? "").toLowerCase();
  if (mod === "*playback") {
    await handleZncPlayback(session, ws, attachment, msg.params.slice(1).join(" "), labelTags);
    return;
  }
  session.sendAck(ws, attachment, labelTags);
}

export async function handleZncPlayback(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawText: string,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "").toUpperCase();
  if (sub === "PLAY") {
    const target = parts[1] ?? "*";

    const parseTs = (raw?: string): string | null => {
      if (!raw) return null;
      const num = parseFloat(raw);
      if (!isNaN(num) && num > 0) {
        const ms = num < 10000000000 ? Math.floor(num * 1000) : Math.floor(num);
        return new Date(ms).toISOString();
      }
      if (raw.includes("T") || raw.includes("-")) {
        return raw.startsWith("timestamp=") ? raw.slice(10) : raw;
      }
      return null;
    };

    const startIso = parseTs(parts[2]);
    const endIso = parseTs(parts[3]);

    const maxZnc = SERVER_CONFIG.zncMaxMessages ?? 50;

    let histParams: string[];
    if (startIso && endIso) {
      histParams = ["BETWEEN", "", `timestamp=${startIso}`, `timestamp=${endIso}`, String(maxZnc)];
    } else if (startIso) {
      const futureIso = new Date(Date.now() + 86400000).toISOString();
      histParams = [
        "BETWEEN",
        "",
        `timestamp=${futureIso}`,
        `timestamp=${startIso}`,
        String(maxZnc),
      ];
    } else {
      histParams = ["LATEST", "", "*", String(maxZnc)];
    }

    const targetsToPlay: string[] = [];
    if (target === "*") {
      for (const ch of session.getSessionChannels(attachment.sessionId)) {
        targetsToPlay.push(ch.channelName);
      }

      const myNick = attachment.nickname!;
      const myCanon = canonicalizeIRCName(myNick);
      const dmAcctClause = attachment.accountName
        ? " AND (sender_account = ? OR target_account = ?)"
        : " AND (sender_account IS NULL AND target_account IS NULL)";
      const dmAcctParams: any[] = attachment.accountName
        ? [attachment.accountName, attachment.accountName]
        : [];
      const dmPeers = session.sql
        .exec<{
          sender_nick: string;
          target_nick: string;
        }>(
          `SELECT sender_nick, target_nick
             FROM direct_messages
             WHERE redacted = 0${dmAcctClause}
             GROUP BY peer_pair`,
          ...dmAcctParams,
        )
        .toArray();

      for (const row of dmPeers) {
        const sCanon = canonicalizeIRCName(row.sender_nick);
        const tCanon = canonicalizeIRCName(row.target_nick);
        if (sCanon !== myCanon && tCanon !== myCanon) continue;
        const peerNick = sCanon === myCanon ? row.target_nick : row.sender_nick;
        if (!targetsToPlay.includes(peerNick)) {
          targetsToPlay.push(peerNick);
        }
      }
    } else {
      targetsToPlay.push(target);
    }

    for (const t of targetsToPlay) {
      const p = [...histParams];
      p[1] = t;
      await handleChathistory(
        session,
        ws,
        attachment,
        {
          tags: {},
          prefix: null,
          command: "CHATHISTORY",
          params: p,
        },
        labelTags,
      );
    }
    return;
  }
  if (sub === "LIST") {
    for (const ch of session.getSessionChannels(attachment.sessionId)) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: "*playback!znc@znc.in",
          command: "NOTICE",
          params: [
            attachment.nickname ?? "*",
            `${ch.channelName} 0 ${Math.floor(Date.now() / 1000)}`,
          ],
        }),
      );
    }
    return;
  }
  session.sendAck(ws, attachment, labelTags);
}


