import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment, StoredChannelMessage } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import { deliverMultilineOrFallback } from "../messaging";
import type { ISessionDO } from "../types";

export async function handleHistoryCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const target = msg.params[0] ?? "";
  const limit = msg.params[1] ?? "25";
  if (!target) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["HISTORY", "Not enough parameters"],
      labelTags,
    );
    return;
  }
  await handleChathistory(
    session,
    ws,
    attachment,
    {
      tags: {},
      prefix: null,
      command: "CHATHISTORY",
      params: ["LATEST", target, "*", limit],
    },
    labelTags,
  );
}

export async function handleChathistory(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (msg.params.length < 3) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["CHATHISTORY", "NEED_MORE_PARAMS", msg.params[0] ?? "*", "Not enough parameters"],
      }),
    );
    return;
  }

  const subcommand = msg.params[0].toUpperCase();

  if (subcommand === "TARGETS") {
    let startTs = 0;
    let endTs = Number.MAX_SAFE_INTEGER;
    if (msg.params[1] && msg.params[1] !== "*") {
      if (msg.params[1].startsWith("timestamp=")) {
        startTs = Date.parse(msg.params[1].slice("timestamp=".length)) || 0;
      }
    }
    if (msg.params[2] && msg.params[2] !== "*") {
      if (msg.params[2].startsWith("timestamp=")) {
        endTs = Date.parse(msg.params[2].slice("timestamp=".length)) || Number.MAX_SAFE_INTEGER;
      }
    }
    const limitRaw = parseInt(msg.params[3], 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, limitRaw)
      : SERVER_CONFIG.defaultHistoryLimit;

    const batchId = crypto.randomUUID().slice(0, 8);
    const supportsBatch = session.hasCap(attachment, "batch");
    if (supportsBatch) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, {
            ...(labelTags ?? {}),
            "draft/chathistory-end": true,
          }),
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`+${batchId}`, "draft/chathistory-targets"],
        }),
      );
    }

    const candidateTargets: Array<{
      target: string;
      latestTs: number;
      latestIso: string;
    }> = [];

    const channels = session.getSessionChannels(attachment.sessionId);
    for (const ch of channels) {
      const stub = session.getChannelStub(ch.channelName);
      const latest = await stub.getLatestMessageTime();
      if (latest && latest.createdAt > startTs && latest.createdAt < endTs) {
        candidateTargets.push({
          target: ch.channelName,
          latestTs: latest.createdAt,
          latestIso: latest.timestamp,
        });
      }
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
        max_ts: number;
      }>(
        `SELECT sender_nick, target_nick, MAX(created_at) AS max_ts
           FROM direct_messages
           WHERE redacted = 0${dmAcctClause}
           GROUP BY peer_pair
           ORDER BY max_ts ASC`,
        ...dmAcctParams,
      )
      .toArray();

    for (const row of dmPeers) {
      const sCanon = canonicalizeIRCName(row.sender_nick);
      const tCanon = canonicalizeIRCName(row.target_nick);
      if (sCanon !== myCanon && tCanon !== myCanon) continue;
      const peerNick = sCanon === myCanon ? row.target_nick : row.sender_nick;
      if (row.max_ts > startTs && row.max_ts < endTs) {
        candidateTargets.push({
          target: peerNick,
          latestTs: row.max_ts,
          latestIso: new Date(row.max_ts).toISOString(),
        });
      }
    }

    candidateTargets.sort((a, b) => a.latestTs - b.latestTs);
    const finalTargets = candidateTargets.slice(0, limit);

    for (const item of finalTargets) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: supportsBatch ? { batch: batchId } : undefined,
          prefix: SERVER_CONFIG.serverName,
          command: "CHATHISTORY",
          params: ["TARGETS", item.target, item.latestIso],
        }),
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
    return;
  }

  const target = msg.params[1];
  const ref1 = msg.params[2];
  const ref2 = subcommand === "BETWEEN" ? msg.params[3] : undefined;
  const limitRaw = parseInt(msg.params[msg.params.length - 1], 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : SERVER_CONFIG.defaultHistoryLimit;

  let messages: StoredChannelMessage[] = [];
  let isEnd = true;
  // For DM history, replay each message with its ORIGINAL target (per IRCv3 chathistory spec)
  const dmOriginalTargets = new Map<string, string>();

  if (target.startsWith("#") || target.startsWith("&")) {
    const stub = session.getChannelStub(target);
    const res = await stub.queryHistory({
      channelName: target,
      sessionId: attachment.sessionId,
      nickname: attachment.nickname!,
      username: attachment.username!,
      hostname: attachment.hostname,
      accountName: attachment.accountName,
      subcommand,
      reference1: ref1,
      reference2: ref2,
      limit,
      isOper: attachment.isOper,
      includeEvents: session.hasCap(attachment, "draft/event-playback"),
    });

    if (!res.ok) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: [
            "CHATHISTORY",
            res.errorCode ?? "INVALID_PARAMS",
            subcommand,
            target,
            res.errorMessage ?? "History query failed",
          ],
        }),
      );
      return;
    }

    messages = res.messages;
    isEnd = res.isEnd ?? true;
  } else {
    // Direct message history from SessionDO SQLite with full LATEST/BEFORE/AFTER/AROUND/BETWEEN support
    const targetUserId =
      session.getAllSessionsForNick(target)[0]?.attachment.userId ??
      (await session.getAccountsStub().resolveConversationAccount(target))?.id;
    const peerPair = session.getCanonicalDmPair(attachment.userId, targetUserId ?? "missing");
    const hasEventPlayback = session.hasCap(attachment, "draft/event-playback");
    const cmdClause = hasEventPlayback ? "" : " AND command IN ('PRIVMSG', 'NOTICE')";
    const acctClause = attachment.accountName
      ? " AND (sender_account = ? OR target_account = ?)"
      : " AND (sender_account IS NULL AND target_account IS NULL)";
    const acctParams: any[] = attachment.accountName
      ? [peerPair, attachment.accountName, attachment.accountName]
      : [peerPair];
    const allDmRows = session.sql
      .exec<{
        sequence: number;
        id: string;
        sender_id: string;
        sender_account: string | null;
        sender_nick: string;
        sender_user: string;
        sender_host: string;
        target_nick: string;
        target_account: string | null;
        command: "PRIVMSG" | "NOTICE" | "TAGMSG";
        content: string;
        tags_json: string;
        multiline_json: string | null;
        redacted: number;
        created_at: number;
      }>(
        `SELECT * FROM direct_messages WHERE peer_pair = ?${acctClause} AND redacted = 0 AND COALESCE(expires_at, created_at + ${SERVER_CONFIG.retentionMs}) > ${Date.now()}${cmdClause} ORDER BY sequence ASC`,
        ...acctParams,
      )
      .toArray();

    const resolveDmRef = (
      ref: string | undefined,
    ): { type: "seq" | "ts" | "wildcard"; val: number } | null => {
      if (!ref || ref === "*") return { type: "wildcard", val: 0 };
      if (ref.startsWith("msgid=")) {
        const id = ref.slice("msgid=".length);
        const found = allDmRows.find((r) => r.id === id);
        if (!found) return null;
        return { type: "seq", val: found.sequence };
      }
      if (ref.startsWith("timestamp=")) {
        const parsed = Date.parse(ref.slice("timestamp=".length));
        if (Number.isNaN(parsed)) return null;
        return { type: "ts", val: parsed };
      }
      return null;
    };

    const r1 = resolveDmRef(ref1);
    let sliced: typeof allDmRows = [];

    if (subcommand === "LATEST") {
      if (!r1) {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: ["CHATHISTORY", "INVALID_PARAMS", subcommand, target, "Invalid reference"],
          }),
        );
        return;
      }
      const filtered =
        r1.type === "wildcard"
          ? allDmRows
          : allDmRows.filter((r) =>
              r1.type === "seq" ? r.sequence > r1.val : r.created_at > r1.val,
            );
      isEnd = filtered.length <= limit;
      sliced = filtered.slice(-limit);
    } else if (subcommand === "BEFORE") {
      if (!r1 || r1.type === "wildcard") {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: [
              "CHATHISTORY",
              "INVALID_PARAMS",
              subcommand,
              target,
              "Invalid BEFORE reference",
            ],
          }),
        );
        return;
      }
      const filtered = allDmRows.filter((r) =>
        r1.type === "seq" ? r.sequence < r1.val : r.created_at < r1.val,
      );
      isEnd = filtered.length <= limit;
      sliced = filtered.slice(-limit);
    } else if (subcommand === "AFTER") {
      if (!r1 || r1.type === "wildcard") {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: [
              "CHATHISTORY",
              "INVALID_PARAMS",
              subcommand,
              target,
              "Invalid AFTER reference",
            ],
          }),
        );
        return;
      }
      const filtered = allDmRows.filter((r) =>
        r1.type === "seq" ? r.sequence > r1.val : r.created_at > r1.val,
      );
      isEnd = filtered.length <= limit;
      sliced = filtered.slice(0, limit);
    } else if (subcommand === "AROUND") {
      if (!r1 || r1.type === "wildcard") {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: [
              "CHATHISTORY",
              "INVALID_PARAMS",
              subcommand,
              target,
              "Invalid AROUND reference",
            ],
          }),
        );
        return;
      }
      const beforeCount = Math.floor((limit - 1) / 2) + 1; // includes center
      const beforeRows = allDmRows
        .filter((r) => (r1.type === "seq" ? r.sequence <= r1.val : r.created_at <= r1.val))
        .slice(-beforeCount);
      const afterCount = limit - beforeRows.length;
      const afterRows =
        afterCount <= 0
          ? []
          : allDmRows
              .filter((r) => (r1.type === "seq" ? r.sequence > r1.val : r.created_at > r1.val))
              .slice(0, afterCount);
      sliced = [...beforeRows, ...afterRows];
      isEnd = sliced.length < limit;
    } else if (subcommand === "BETWEEN") {
      const r2 = resolveDmRef(ref2);
      if (!r1 || !r2) {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: [
              "CHATHISTORY",
              "INVALID_PARAMS",
              subcommand,
              target,
              "Invalid BETWEEN references",
            ],
          }),
        );
        return;
      }
      const v1 = r1.val;
      const v2 = r2.val;
      const isForward = r1.type === "wildcard" || r2.type === "wildcard" ? true : v1 <= v2;
      const minVal = Math.min(v1, v2);
      const maxVal = Math.max(v1, v2);

      const inRange = allDmRows.filter((r) => {
        const val = r1.type === "seq" ? r.sequence : r.created_at;
        const lowerOk =
          r1.type === "wildcard" || r2.type === "wildcard"
            ? r1.type === "wildcard"
              ? true
              : val > r1.val
            : val > minVal;
        const upperOk =
          r1.type === "wildcard" || r2.type === "wildcard"
            ? r2.type === "wildcard"
              ? true
              : val < r2.val
            : val < maxVal;
        return lowerOk && upperOk;
      });
      isEnd = inRange.length <= limit;
      sliced = isForward ? inRange.slice(0, limit) : inRange.slice(-limit);
    }

    for (const r of sliced) {
      dmOriginalTargets.set(r.id, r.target_nick);
    }

    messages = sliced.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      senderId: r.sender_id,
      senderAccount: r.sender_account,
      senderNick: r.sender_nick,
      senderUser: r.sender_user,
      senderHost: r.sender_host,
      command: r.command,
      content: r.content,
      tags: r.tags_json && r.tags_json !== "{}" ? JSON.parse(r.tags_json) : undefined,
      multilineLines: r.multiline_json ? JSON.parse(r.multiline_json) : undefined,
      createdAt: r.created_at,
      expiresAt: r.created_at + SERVER_CONFIG.retentionMs,
    }));
  }

  const batchId = crypto.randomUUID().slice(0, 8);
  const supportsBatch = session.hasCap(attachment, "batch");

  if (supportsBatch) {
    const batchTags: Record<string, string | true> = {
      ...(labelTags ?? {}),
      ...(isEnd ? { "draft/chathistory-end": true } : {}),
    };
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, batchTags),
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`+${batchId}`, "chathistory", target],
      }),
    );
  }

  for (const m of messages) {
    const senderPrefix = `${m.senderNick}!${m.senderUser}@${m.senderHost}`;
    const msgTarget = dmOriginalTargets.get(m.id) ?? target;

    if (m.command === "TAGMSG") {
      if (!session.hasCap(attachment, "message-tags")) continue;
      const msgTags: Record<string, string | true> = {
        ...(m.tags ?? {}),
        msgid: m.id,
        time: new Date(m.createdAt).toISOString(),
        ...(m.senderAccount ? { account: m.senderAccount } : {}),
        ...(supportsBatch ? { batch: batchId } : {}),
      };
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, msgTags),
          prefix: senderPrefix,
          command: "TAGMSG",
          params: [msgTarget],
        }),
      );
      continue;
    }

    if (m.multilineLines && m.multilineLines.length > 1) {
      deliverMultilineOrFallback(
        session,
        ws,
        attachment,
        senderPrefix,
        msgTarget,
        m,
        m.multilineLines,
        undefined,
        supportsBatch ? batchId : undefined,
      );
      continue;
    }

    const msgTags: Record<string, string | true> = {
      ...(m.tags ?? {}),
      msgid: m.id,
      time: new Date(m.createdAt).toISOString(),
      ...(m.senderAccount ? { account: m.senderAccount } : {}),
      ...(supportsBatch ? { batch: batchId } : {}),
    };

    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, msgTags),
        prefix: senderPrefix,
        command: m.command,
        params: [msgTarget, m.content],
      }),
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
