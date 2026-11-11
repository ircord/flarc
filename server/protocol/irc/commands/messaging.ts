import { SERVER_CONFIG } from "~/core/config";
import { domainEvents } from "~/core/events/emitter";
import { isValidNickname } from "~/core/permissions/validation";
import type { SessionAttachment, StoredChannelMessage } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import {
  handleChanServ,
  handleFBot,
  handleHistServ,
  handleHostServ,
  handleNickServ,
  handleZncPlayback,
} from "./services";
import { type ISessionDO, type PendingMultilineBatch, truncateUtf8 } from "./types";

export async function handlePrivmsgOrNotice(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  command: "PRIVMSG" | "NOTICE",
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (msg.params.length === 0 || !msg.params[0]) {
    if (command === "PRIVMSG") {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NORECIPIENT,
        [`No recipient given (${command})`],
        labelTags,
      );
    }
    return;
  }
  if (msg.params.length < 2 || msg.params[1] === "") {
    if (command === "PRIVMSG") {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOTEXTTOSEND,
        ["No text to send"],
        labelTags,
      );
    }
    return;
  }

  const targets = msg.params[0]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const content = msg.params[1];
  const senderPrefix = session.getUserPrefix(attachment);

  const clientTags: Record<string, string | true> = {};
  for (const [k, v] of Object.entries(msg.tags)) {
    if (k.startsWith("+")) {
      clientTags[k] = v;
    }
  }

  // In-reply-to threading (+draft/reply and +reply)
  const replyTarget = msg.tags["+draft/reply"] || msg.tags["+reply"];
  if (replyTarget && typeof replyTarget === "string") {
    clientTags["+draft/reply"] = replyTarget;
    clientTags["+reply"] = replyTarget;
  }

  // Auto-inject role & badge tags for authenticated / oper / bot users
  let senderRole: string | null = null;
  let senderBadge: string | null = null;
  if (attachment.isOper) {
    senderRole = "admin";
    senderBadge = "staff";
  } else if (attachment.roles && attachment.roles.length > 0) {
    if (attachment.roles.includes("admin")) {
      senderRole = "admin";
      senderBadge = "admin";
    } else if (attachment.roles.includes("moderator")) {
      senderRole = "moderator";
      senderBadge = "mod";
    } else if (attachment.roles.includes("founder")) {
      senderRole = "founder";
      senderBadge = "founder";
    } else if (attachment.roles.includes("vip")) {
      senderRole = "vip";
      senderBadge = "vip";
    } else if (attachment.roles.includes("staff")) {
      senderRole = "staff";
      senderBadge = "staff";
    } else {
      senderRole = attachment.roles[0];
      senderBadge = attachment.roles[0];
    }
  } else if (attachment.isBot) {
    senderRole = "bot";
    senderBadge = "bot";
  } else if (attachment.accountName) {
    senderRole = "member";
    senderBadge = "member";
  }

  if (senderRole && !clientTags["+role"]) {
    clientTags["+role"] = senderRole;
  }
  if (senderBadge && !clientTags["+badge"]) {
    clientTags["+badge"] = senderBadge;
  }

  let echoedToSender = false;

  const needsBatchForEcho =
    targets.length > 1 &&
    Boolean(labelTags?.label) &&
    session.hasCap(attachment, "batch") &&
    session.hasCap(attachment, "echo-message");
  const echoBatchId = needsBatchForEcho ? crypto.randomUUID().slice(0, 8) : null;

  if (echoBatchId) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`+${echoBatchId}`, "labeled-response"],
      }),
    );
  }

  for (const rawTarget of targets) {
    // Support STATUSMSG prefix e.g. @#chan or +#chan
    let target = rawTarget;
    let statusPrefix: string | undefined;
    while (target.length > 1 && "~&@%+".includes(target[0])) {
      statusPrefix = (statusPrefix ?? "") + target[0];
      target = target.slice(1);
    }

    const canonTarget = canonicalizeIRCName(target);
    const svcDef = session.getServiceDefinition(target);
    if (command === "PRIVMSG" && content.startsWith("\x01") && svcDef) {
      const inner = content.replace(/^\x01|\x01$/g, "").trim();
      const sp = inner.indexOf(" ");
      const ctcpCmd = (sp === -1 ? inner : inner.slice(0, sp)).toUpperCase();
      const ctcpArg = sp === -1 ? "" : inner.slice(sp + 1);
      const svcName = svcDef.name;
      const svcPrefix = `${svcName}!${svcName}@${SERVER_CONFIG.serverName}`;
      let replyCtcp: string | null = null;
      if (ctcpCmd === "VERSION") {
        replyCtcp = `\x01VERSION ${svcName} (${SERVER_CONFIG.version})\x01`;
      } else if (ctcpCmd === "TIME") {
        replyCtcp = `\x01TIME ${new Date().toUTCString()}\x01`;
      } else if (ctcpCmd === "PING") {
        replyCtcp = `\x01PING ${ctcpArg}\x01`;
      } else if (ctcpCmd === "SOURCE") {
        replyCtcp = `\x01SOURCE https://ircv3.net/\x01`;
      } else if (ctcpCmd === "CLIENTINFO") {
        replyCtcp = `\x01CLIENTINFO ACTION CLIENTINFO PING SOURCE TIME VERSION\x01`;
      }
      if (replyCtcp) {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            prefix: svcPrefix,
            command: "NOTICE",
            params: [attachment.nickname ?? "*", replyCtcp],
          }),
        );
      }
      echoedToSender = true;
      continue;
    }
    if (canonTarget === "nickserv" || canonTarget === "ns") {
      await handleNickServ(session, ws, attachment, content, labelTags);
      echoedToSender = true;
      continue;
    }
    if (canonTarget === "chanserv" || canonTarget === "cs") {
      await handleChanServ(session, ws, attachment, content, labelTags);
      echoedToSender = true;
      continue;
    }
    if (canonTarget === "hostserv" || canonTarget === "hs") {
      await handleHostServ(session, ws, attachment, content, labelTags);
      echoedToSender = true;
      continue;
    }
    if (canonTarget === "histserv") {
      await handleHistServ(session, ws, attachment, content, labelTags);
      echoedToSender = true;
      continue;
    }
    if (canonTarget === "f" || canonTarget === "flareserv" || canonTarget === "q") {
      await handleFBot(session, ws, attachment, content, labelTags);
      echoedToSender = true;
      continue;
    }
    if (canonTarget === "*playback") {
      await handleZncPlayback(session, ws, attachment, content, labelTags);
      echoedToSender = true;
      continue;
    }

    if (target.startsWith("#") || target.startsWith("&")) {
      const stub = session.getChannelStub(target);
      const res = await stub.appendMessage({
        channelName: target,
        sessionId: attachment.sessionId,
        userId: attachment.userId,
        accountName: attachment.accountName,
        nickname: attachment.nickname!,
        username: attachment.username!,
        hostname: attachment.hostname,
        command,
        content,
        tags: Object.keys(clientTags).length > 0 ? clientTags : undefined,
        isOper: attachment.isOper,
        statusPrefix,
      });

      if (!res.ok || !res.message) {
        if (command === "PRIVMSG") {
          session.sendNumeric(
            ws,
            attachment,
            res.numeric ?? Numerics.ERR_CANNOTSENDTOCHAN,
            [target, res.errorText ?? "Cannot send to channel"],
            labelTags,
          );
          echoedToSender = true;
        }
        continue;
      }

      const stored = res.message;
      const isoTime = new Date(stored.createdAt).toISOString();
      const baseTags: Record<string, string | true> = {
        ...clientTags,
        msgid: stored.id,
        time: isoTime,
        ...(stored.senderAccount ? { account: stored.senderAccount } : {}),
        ...(attachment.isBot ? { bot: true } : {}),
        ...(attachment.isOper ? { "draft/oper": attachment.accountName ?? true } : {}),
      };

      const recipients = new Set(res.recipientSessionIds ?? []);
      for (const sid of recipients) {
        if (sid === attachment.sessionId && !session.hasCap(attachment, "echo-message")) {
          continue;
        }
        const targetSess = session.sessionsById.get(sid);
        if (!targetSess) continue;

        const specificTags = { ...baseTags };
        if (sid === attachment.sessionId) {
          echoedToSender = true;
          if (echoBatchId) {
            specificTags.batch = echoBatchId;
          } else if (labelTags?.label) {
            specificTags.label = labelTags.label;
          }
        }

        session.sendLine(
          targetSess.ws,
          targetSess.attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(targetSess.attachment, specificTags),
            prefix: senderPrefix,
            command,
            params: [rawTarget, content],
          }),
        );
      }
    } else {
      const targetSessions = session.getAllSessionsForNick(target);
      if (targetSessions.length === 0) {
        if (command === "PRIVMSG") {
          session.sendNumeric(
            ws,
            attachment,
            Numerics.ERR_NOSUCHNICK,
            [target, "No such nick/channel"],
            labelTags,
          );
          echoedToSender = true;
        }
        continue;
      }

      const primaryTarget = targetSessions[0];
      const targetModes = primaryTarget.attachment.userModes ?? "";

      // Enforce user mode +R (registered-only DMs unless in target's ACCEPT list or sender is oper)
      if (!attachment.isOper && targetModes.includes("R") && !attachment.accountName) {
        const accepted = (primaryTarget.attachment.acceptList ?? []).some(
          (n) => canonicalizeIRCName(n) === canonicalizeIRCName(attachment.nickname!),
        );
        if (!accepted) {
          if (command === "PRIVMSG") {
            session.sendNumeric(
              ws,
              attachment,
              Numerics.ERR_NEEDREGGEDNICK,
              [
                primaryTarget.attachment.nickname!,
                "You must identify to a registered nick to private message this user",
              ],
              labelTags,
            );
            echoedToSender = true;
          }
          continue;
        }
      }

      // When sending a DM, auto-accept recipient so they can reply even if sender has +R
      if (attachment.nickname && primaryTarget.attachment.nickname) {
        const canonRecipient = canonicalizeIRCName(primaryTarget.attachment.nickname);
        const senderSessions = session.getAllSessionsForNick(attachment.nickname);
        if (senderSessions.length === 0) {
          if (!attachment.acceptList) attachment.acceptList = [];
          if (!attachment.acceptList.some((n) => canonicalizeIRCName(n) === canonRecipient)) {
            attachment.acceptList.push(primaryTarget.attachment.nickname);
          }
          session.saveAttachment(ws, attachment);
        } else {
          for (const s of senderSessions) {
            if (!s.attachment.acceptList) s.attachment.acceptList = [];
            if (!s.attachment.acceptList.some((n) => canonicalizeIRCName(n) === canonRecipient)) {
              s.attachment.acceptList.push(primaryTarget.attachment.nickname);
            }
            session.saveAttachment(s.ws, s.attachment);
          }
        }
      }

      // Enforce user mode +T (block CTCP except ACTION)
      if (
        !attachment.isOper &&
        targetModes.includes("T") &&
        content.startsWith("\x01") &&
        !content.toUpperCase().startsWith("\x01ACTION ") &&
        content.toUpperCase() !== "\x01ACTION\x01"
      ) {
        continue;
      }

      const msgId = crypto.randomUUID();
      const now = Date.now();
      const isoTime = new Date(now).toISOString();

      // Persist DM in SQLite for DM CHATHISTORY & REDACT
      const peerPair = session.getCanonicalDmPair(
        attachment.nickname!,
        primaryTarget.attachment.nickname!,
      );
      session.sql.exec(
        `INSERT INTO direct_messages (id, peer_pair, sender_id, sender_account, sender_nick, sender_user, sender_host, target_nick, target_account, command, content, tags_json, redacted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        msgId,
        peerPair,
        attachment.userId,
        attachment.accountName,
        attachment.nickname!,
        attachment.username!,
        attachment.hostname,
        primaryTarget.attachment.nickname!,
        primaryTarget.attachment.accountName ?? null,
        command,
        content,
        Object.keys(clientTags).length > 0 ? JSON.stringify(clientTags) : "{}",
        now,
      );

      const baseTags: Record<string, string | true> = {
        ...clientTags,
        msgid: msgId,
        time: isoTime,
        ...(attachment.accountName ? { account: attachment.accountName } : {}),
        ...(attachment.isBot ? { bot: true } : {}),
      };

      const senderIsDirectWs = attachment.isDirectWebSocket ?? false;
      for (const targetSess of targetSessions) {
        let outContent = content;
        const targetIsDirectWs = targetSess.attachment.isDirectWebSocket ?? false;
        const targetHasTags = session.hasCap(targetSess.attachment, "message-tags");
        const targetHasMultiline =
          session.hasCap(targetSess.attachment, "multiline") ||
          session.hasCap(targetSess.attachment, "draft/multiline");

        if ((senderIsDirectWs || targetIsDirectWs) && !targetHasTags && !targetHasMultiline) {
          const overhead = `:${senderPrefix} ${command} ${targetSess.attachment.nickname!} :`;
          const overheadBytes = new TextEncoder().encode(overhead).length;
          const maxPayload = 510 - overheadBytes;
          if (maxPayload > 0 && new TextEncoder().encode(outContent).length > maxPayload) {
            outContent = truncateUtf8(outContent, maxPayload);
          }
        }

        session.sendLine(
          targetSess.ws,
          targetSess.attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(targetSess.attachment, baseTags),
            prefix: senderPrefix,
            command,
            params: [targetSess.attachment.nickname!, outContent],
          }),
        );
      }

      const otherSenderSessions = session
        .getAllSessionsForNick(attachment.nickname!)
        .filter((s) => s.attachment.sessionId !== attachment.sessionId);
      for (const otherSess of otherSenderSessions) {
        session.sendLine(
          otherSess.ws,
          otherSess.attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(otherSess.attachment, baseTags),
            prefix: senderPrefix,
            command,
            params: [primaryTarget.attachment.nickname!, content],
          }),
        );
      }

      if (session.hasCap(attachment, "echo-message")) {
        echoedToSender = true;
        const echoTags = { ...baseTags };
        if (echoBatchId) {
          echoTags.batch = echoBatchId;
        } else if (labelTags?.label) {
          echoTags.label = labelTags.label;
        }
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, echoTags),
            prefix: senderPrefix,
            command,
            params: [primaryTarget.attachment.nickname!, content],
          }),
        );
      }

      if (command === "PRIVMSG" && primaryTarget.attachment.awayMessage) {
        session.sendNumeric(ws, attachment, Numerics.RPL_AWAY, [
          primaryTarget.attachment.nickname!,
          primaryTarget.attachment.awayMessage,
        ]);
      }
    }
  }

  if (echoBatchId) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`-${echoBatchId}`],
      }),
    );
  }

  if (!echoedToSender && labelTags?.label) {
    session.sendAck(ws, attachment, labelTags);
  }
}

export async function handleTagmsg(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (msg.params.length === 0 || !msg.params[0]) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NORECIPIENT,
      ["No recipient given (TAGMSG)"],
      labelTags,
    );
    return;
  }

  const target = msg.params[0];
  const senderPrefix = session.getUserPrefix(attachment);

  const clientTags: Record<string, string | true> = {};
  for (const [k, v] of Object.entries(msg.tags)) {
    if (k.startsWith("+")) {
      clientTags[k] = v;
    }
  }

  // In-reply-to threading (+draft/reply and +reply)
  const replyTarget = msg.tags["+draft/reply"] || msg.tags["+reply"];
  if (replyTarget && typeof replyTarget === "string") {
    clientTags["+draft/reply"] = replyTarget;
    clientTags["+reply"] = replyTarget;
  }

  // Auto-inject role & badge tags for authenticated / oper / bot users
  let senderRole: string | null = null;
  let senderBadge: string | null = null;
  if (attachment.isOper) {
    senderRole = "admin";
    senderBadge = "staff";
  } else if (attachment.roles && attachment.roles.length > 0) {
    if (attachment.roles.includes("admin")) {
      senderRole = "admin";
      senderBadge = "admin";
    } else if (attachment.roles.includes("moderator")) {
      senderRole = "moderator";
      senderBadge = "mod";
    } else if (attachment.roles.includes("founder")) {
      senderRole = "founder";
      senderBadge = "founder";
    } else if (attachment.roles.includes("vip")) {
      senderRole = "vip";
      senderBadge = "vip";
    } else if (attachment.roles.includes("staff")) {
      senderRole = "staff";
      senderBadge = "staff";
    } else {
      senderRole = attachment.roles[0];
      senderBadge = attachment.roles[0];
    }
  } else if (attachment.isBot) {
    senderRole = "bot";
    senderBadge = "bot";
  } else if (attachment.accountName) {
    senderRole = "member";
    senderBadge = "member";
  }

  if (senderRole && !clientTags["+role"]) {
    clientTags["+role"] = senderRole;
  }
  if (senderBadge && !clientTags["+badge"]) {
    clientTags["+badge"] = senderBadge;
  }

  // Persist TAGMSG if it carries reactions (+draft/react, +draft/unreact, +react, +unreact) or persistence tag
  const shouldPersist = Boolean(
    clientTags["+draft/react"] ||
      clientTags["+draft/unreact"] ||
      clientTags["+react"] ||
      clientTags["+unreact"] ||
      clientTags["+draft/persist"] ||
      clientTags["+persist"],
  );

  if (target.startsWith("#") || target.startsWith("&")) {
    const stub = session.getChannelStub(target);
    const res = await stub.appendMessage({
      channelName: target,
      sessionId: attachment.sessionId,
      userId: attachment.userId,
      accountName: attachment.accountName,
      nickname: attachment.nickname!,
      username: attachment.username!,
      hostname: attachment.hostname,
      command: "TAGMSG",
      content: "",
      tags: clientTags,
      persist: shouldPersist,
      isOper: attachment.isOper,
    });

    if (!res.ok || !res.message) {
      session.sendNumeric(
        ws,
        attachment,
        res.numeric ?? Numerics.ERR_CANNOTSENDTOCHAN,
        [target, res.errorText ?? "Cannot send to channel"],
        labelTags,
      );
      return;
    }

    const stored = res.message;
    const baseTags: Record<string, string | true> = {
      ...clientTags,
      msgid: stored.id,
      time: new Date(stored.createdAt).toISOString(),
      ...(stored.senderAccount ? { account: stored.senderAccount } : {}),
    };

    let echoedToSender = false;
    for (const sid of res.recipientSessionIds ?? []) {
      if (sid === attachment.sessionId && !session.hasCap(attachment, "echo-message")) {
        continue;
      }
      const targetSess = session.sessionsById.get(sid);
      if (!targetSess || !session.hasCap(targetSess.attachment, "message-tags")) {
        continue;
      }

      const specificTags = { ...baseTags };
      if (sid === attachment.sessionId) {
        echoedToSender = true;
        if (labelTags?.label) {
          specificTags.label = labelTags.label;
        }
      }

      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(targetSess.attachment, specificTags),
          prefix: senderPrefix,
          command: "TAGMSG",
          params: [target],
        }),
      );
    }

    if (!echoedToSender && labelTags?.label) {
      session.sendAck(ws, attachment, labelTags);
    }
  } else {
    const targetSessions = session.getAllSessionsForNick(target);
    if (targetSessions.length === 0) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOSUCHNICK,
        [target, "No such nick/channel"],
        labelTags,
      );
      return;
    }

    const primaryTarget = targetSessions[0];
    const msgId = crypto.randomUUID();
    const now = Date.now();

    if (shouldPersist) {
      const peerPair = session.getCanonicalDmPair(
        attachment.nickname!,
        primaryTarget.attachment.nickname!,
      );
      session.sql.exec(
        `INSERT INTO direct_messages (id, peer_pair, sender_id, sender_account, sender_nick, sender_user, sender_host, target_nick, target_account, command, content, tags_json, redacted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TAGMSG', '', ?, 0, ?)`,
        msgId,
        peerPair,
        attachment.userId,
        attachment.accountName,
        attachment.nickname!,
        attachment.username!,
        attachment.hostname,
        primaryTarget.attachment.nickname!,
        primaryTarget.attachment.accountName ?? null,
        JSON.stringify(clientTags),
        now,
      );
    }

    const baseTags: Record<string, string | true> = {
      ...clientTags,
      msgid: msgId,
      time: new Date(now).toISOString(),
      ...(attachment.accountName ? { account: attachment.accountName } : {}),
    };

    for (const targetSess of targetSessions) {
      if (session.hasCap(targetSess.attachment, "message-tags")) {
        session.sendLine(
          targetSess.ws,
          targetSess.attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(targetSess.attachment, baseTags),
            prefix: senderPrefix,
            command: "TAGMSG",
            params: [targetSess.attachment.nickname!],
          }),
        );
      }
    }

    if (session.hasCap(attachment, "echo-message") && session.hasCap(attachment, "message-tags")) {
      const echoTags = { ...baseTags };
      if (labelTags?.label) {
        echoTags.label = labelTags.label;
      }
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, echoTags),
          prefix: senderPrefix,
          command: "TAGMSG",
          params: [primaryTarget.attachment.nickname!],
        }),
      );
    } else if (labelTags?.label) {
      session.sendAck(ws, attachment, labelTags);
    }
  }
}

export async function handleClientBatch(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const refTag = msg.params[0] ?? "";
  if (!refTag || (!refTag.startsWith("+") && !refTag.startsWith("-"))) {
    return;
  }

  const isStart = refTag.startsWith("+");
  const ref = refTag.slice(1);

  let sessionBatches = session.pendingBatchesBySession.get(attachment.sessionId);
  if (!sessionBatches) {
    sessionBatches = new Map();
    session.pendingBatchesBySession.set(attachment.sessionId, sessionBatches);
  }

  if (isStart) {
    const batchType = (msg.params[1] ?? "").toLowerCase();
    const target = msg.params[2] ?? "";
    if (batchType !== "draft/multiline" || !target) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: ["BATCH", "INVALID_PARAMS", batchType, "Unsupported client batch"],
        }),
      );
      return;
    }

    const clientTags: Record<string, string | true> = {};
    for (const [k, v] of Object.entries(msg.tags)) {
      if (k.startsWith("+")) {
        clientTags[k] = v;
      }
    }

    sessionBatches.set(ref, {
      ref,
      target,
      command: null,
      tags: clientTags,
      lines: [],
      totalBytes: 0,
      label: labelTags?.label ? String(labelTags.label) : undefined,
    });
    session.activeBatchRefBySession.set(attachment.sessionId, ref);
    return;
  }

  const pending = sessionBatches.get(ref);
  sessionBatches.delete(ref);
  session.activeBatchRefBySession.delete(attachment.sessionId);
  if (!pending) {
    return;
  }

  const effectiveLabel = pending.label ?? (labelTags?.label ? String(labelTags.label) : undefined);
  const effectiveLabelTags = effectiveLabel ? { label: effectiveLabel } : undefined;

  if (pending.invalid) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, effectiveLabelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["BATCH", "MULTILINE_INVALID", "Invalid multiline batch"],
      }),
    );
    return;
  }

  if (pending.lines.length === 0) {
    return;
  }

  if (pending.lines.length > 32) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, effectiveLabelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["BATCH", "MULTILINE_MAX_LINES", "32", "Multiline batch exceeded line limit"],
      }),
    );
    return;
  }

  if (pending.totalBytes > 4096) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, effectiveLabelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["BATCH", "MULTILINE_MAX_BYTES", "4096", "Multiline batch exceeded byte limit"],
      }),
    );
    return;
  }

  // Reconstruct combined content
  let combined = "";
  for (let i = 0; i < pending.lines.length; i++) {
    const line = pending.lines[i];
    combined += line.content;
    if (i < pending.lines.length - 1 && !line.concat) {
      combined += "\n";
    }
  }

  const command = pending.command ?? "PRIVMSG";
  const target = pending.target;
  const senderPrefix = session.getUserPrefix(attachment);

  if (target.startsWith("#") || target.startsWith("&")) {
    const stub = session.getChannelStub(target);
    const res = await stub.appendMessage({
      channelName: target,
      sessionId: attachment.sessionId,
      userId: attachment.userId,
      accountName: attachment.accountName,
      nickname: attachment.nickname!,
      username: attachment.username!,
      hostname: attachment.hostname,
      command,
      content: combined,
      tags: Object.keys(pending.tags).length > 0 ? pending.tags : undefined,
      multilineLines: pending.lines,
      isOper: attachment.isOper,
    });

    if (!res.ok || !res.message) {
      session.sendNumeric(
        ws,
        attachment,
        res.numeric ?? Numerics.ERR_CANNOTSENDTOCHAN,
        [target, res.errorText ?? "Cannot send to channel"],
        effectiveLabelTags,
      );
      return;
    }

    const stored = res.message;
    for (const sid of res.recipientSessionIds ?? []) {
      if (sid === attachment.sessionId && !session.hasCap(attachment, "echo-message")) {
        continue;
      }
      const targetSess = session.sessionsById.get(sid);
      if (!targetSess) continue;

      const isEcho = sid === attachment.sessionId;
      deliverMultilineOrFallback(
        session,
        targetSess.ws,
        targetSess.attachment,
        senderPrefix,
        target,
        stored,
        pending.lines,
        isEcho ? effectiveLabel : undefined,
      );
    }
  } else {
    const targetSessions = session.getAllSessionsForNick(target);
    if (targetSessions.length === 0) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOSUCHNICK,
        [target, "No such nick/channel"],
        effectiveLabelTags,
      );
      return;
    }

    const primaryTarget = targetSessions[0];
    const msgId = crypto.randomUUID();
    const now = Date.now();
    const peerPair = session.getCanonicalDmPair(
      attachment.nickname!,
      primaryTarget.attachment.nickname!,
    );

    session.sql.exec(
      `INSERT INTO direct_messages (id, peer_pair, sender_id, sender_account, sender_nick, sender_user, sender_host, target_nick, target_account, command, content, tags_json, multiline_json, redacted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      msgId,
      peerPair,
      attachment.userId,
      attachment.accountName,
      attachment.nickname!,
      attachment.username!,
      attachment.hostname,
      primaryTarget.attachment.nickname!,
      primaryTarget.attachment.accountName ?? null,
      command,
      combined,
      Object.keys(pending.tags).length > 0 ? JSON.stringify(pending.tags) : "{}",
      JSON.stringify(pending.lines),
      now,
    );

    const stored: StoredChannelMessage = {
      id: msgId,
      sequence: 0,
      senderId: attachment.userId,
      senderAccount: attachment.accountName,
      senderNick: attachment.nickname!,
      senderUser: attachment.username!,
      senderHost: attachment.hostname,
      command,
      content: combined,
      tags: pending.tags,
      multilineLines: pending.lines,
      createdAt: now,
      expiresAt: now + SERVER_CONFIG.retentionMs,
    };

    for (const targetSess of targetSessions) {
      deliverMultilineOrFallback(
        session,
        targetSess.ws,
        targetSess.attachment,
        senderPrefix,
        targetSess.attachment.nickname!,
        stored,
        pending.lines,
      );
    }

    if (
      session.hasCap(attachment, "echo-message") &&
      primaryTarget.attachment.sessionId !== attachment.sessionId
    ) {
      deliverMultilineOrFallback(
        session,
        ws,
        attachment,
        senderPrefix,
        primaryTarget.attachment.nickname!,
        stored,
        pending.lines,
        effectiveLabel,
      );
    }
  }
}

export function deliverMultilineOrFallback(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  senderPrefix: string,
  target: string,
  stored: StoredChannelMessage,
  lines: Array<{ content: string; concat: boolean }>,
  label?: string,
  outerBatchId?: string,
): void {
  const isoTime = new Date(stored.createdAt).toISOString();
  const supportsMultiline =
    session.hasCap(attachment, "draft/multiline") && session.hasCap(attachment, "batch");

  if (supportsMultiline) {
    const batchId = crypto.randomUUID().slice(0, 8);
    const batchOpenTags: Record<string, string | true> = {
      ...(stored.tags ?? {}),
      msgid: stored.id,
      time: isoTime,
      ...(stored.senderAccount ? { account: stored.senderAccount } : {}),
      ...(label ? { label } : {}),
      ...(outerBatchId ? { batch: outerBatchId } : {}),
    };

    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, batchOpenTags),
        prefix: senderPrefix,
        command: "BATCH",
        params: [`+${batchId}`, "draft/multiline", target],
      }),
    );

    for (const line of lines) {
      const lineTags: Record<string, string | true> = {
        batch: batchId,
        ...(line.concat ? { "draft/multiline-concat": true } : {}),
      };
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, lineTags),
          prefix: senderPrefix,
          command: stored.command,
          params: [target, line.content],
        }),
      );
    }

    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: senderPrefix,
        command: "BATCH",
        params: [`-${batchId}`],
      }),
    );
  } else {
    const nonBlankLines = lines.filter((l) => l.content.length > 0);
    for (let i = 0; i < nonBlankLines.length; i++) {
      const line = nonBlankLines[i];
      const tags: Record<string, string | true> = {
        ...(stored.tags ?? {}),
        ...(i === 0 ? { msgid: stored.id } : {}),
        time: isoTime,
        ...(stored.senderAccount ? { account: stored.senderAccount } : {}),
        ...(i === 0 && label ? { label } : {}),
        ...(outerBatchId ? { batch: outerBatchId } : {}),
      };
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, tags),
          prefix: senderPrefix,
          command: stored.command,
          params: [target, line.content],
        }),
      );
    }
  }
}

export async function handleRedact(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (msg.params.length < 2) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["REDACT", "NEED_MORE_PARAMS", "Not enough parameters"],
      }),
    );
    return;
  }

  const target = msg.params[0];
  const targetMsgId = msg.params[1];
  const reason = msg.params[2];
  const senderPrefix = session.getUserPrefix(attachment);
  const nowIso = new Date().toISOString();

  if (target.startsWith("#") || target.startsWith("&")) {
    const stub = session.getChannelStub(target);
    const res = await stub.redactMessage({
      channelName: target,
      actorSessionId: attachment.sessionId,
      actorUserId: attachment.userId,
      actorAccount: attachment.accountName,
      actorNick: attachment.nickname!,
      targetMsgId,
      reason,
      isOper: attachment.isOper,
    });

    if (!res.ok) {
      const failParams =
        res.errorCode === "INVALID_TARGET"
          ? ["REDACT", "INVALID_TARGET", target, res.errorMessage ?? "Invalid target"]
          : [
              "REDACT",
              res.errorCode ?? "REDACT_FORBIDDEN",
              target,
              targetMsgId,
              res.errorMessage ?? "Cannot redact message",
            ];
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: failParams,
        }),
      );
      return;
    }

    const redactParams = reason
      ? [res.channelName, targetMsgId, reason]
      : [res.channelName, targetMsgId];

    const recipients = new Set([attachment.sessionId, ...(res.recipientSessionIds ?? [])]);

    for (const sid of recipients) {
      const targetSess = session.sessionsById.get(sid);
      if (!targetSess) continue;
      if (!session.hasCap(targetSess.attachment, "draft/message-redaction")) {
        continue;
      }
      const isSender = sid === attachment.sessionId;
      const tags: Record<string, string | true> = {
        msgid: crypto.randomUUID(),
        time: nowIso,
        ...(attachment.accountName ? { account: attachment.accountName } : {}),
        ...(isSender && labelTags?.label ? { label: labelTags.label } : {}),
      };
      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(targetSess.attachment, tags),
          prefix: senderPrefix,
          command: "REDACT",
          params: redactParams,
        }),
      );
    }
  } else {
    // DM redaction
    const dmRows = session.sql
      .exec<{
        id: string;
        sender_id: string;
        sender_account: string | null;
        sender_nick: string;
        redacted: number;
      }>(
        "SELECT id, sender_id, sender_account, sender_nick, redacted FROM direct_messages WHERE id = ?",
        targetMsgId,
      )
      .toArray();

    if (dmRows.length === 0 || dmRows[0].redacted) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: ["REDACT", "UNKNOWN_MSGID", target, targetMsgId, "Message does not exist"],
        }),
      );
      return;
    }

    const dm = dmRows[0];
    const isAuthor =
      dm.sender_id === attachment.userId ||
      canonicalizeIRCName(dm.sender_nick) === canonicalizeIRCName(attachment.nickname!);
    if (!isAuthor && !attachment.isOper) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: [
            "REDACT",
            "REDACT_FORBIDDEN",
            target,
            targetMsgId,
            "You are not authorized to redact this message",
          ],
        }),
      );
      return;
    }

    session.sql.exec(
      "UPDATE direct_messages SET redacted = 1, content = '' WHERE id = ?",
      targetMsgId,
    );

    const redactParams = reason ? [target, targetMsgId, reason] : [target, targetMsgId];
    for (const targetSess of session.getAllSessionsForNick(target)) {
      if (!session.hasCap(targetSess.attachment, "draft/message-redaction")) continue;
      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(targetSess.attachment, {
            msgid: crypto.randomUUID(),
            time: nowIso,
          }),
          prefix: senderPrefix,
          command: "REDACT",
          params: redactParams,
        }),
      );
    }

    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, {
          msgid: crypto.randomUUID(),
          time: nowIso,
          ...(labelTags?.label ? { label: labelTags.label } : {}),
        }),
        prefix: senderPrefix,
        command: "REDACT",
        params: redactParams,
      }),
    );
  }
}

export async function handleRelaymsg(
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
        params: ["RELAYMSG", "NEED_MORE_PARAMS", "Not enough parameters"],
      }),
    );
    return;
  }

  const target = msg.params[0];
  const spoofedNick = msg.params[1];
  const text = msg.params.slice(2).join(" ");

  const nickPart = spoofedNick.split("/")[0];
  if (
    !isValidNickname(nickPart) ||
    spoofedNick.includes("!") ||
    spoofedNick.includes("@") ||
    spoofedNick.includes(" ")
  ) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["RELAYMSG", "INVALID_NICK", "Invalid nickname"],
      }),
    );
    return;
  }

  if (!spoofedNick.includes("/")) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: [
          "RELAYMSG",
          "INVALID_NICK",
          "Relayed nicknames MUST contain a relaymsg separator from this set: /",
        ],
      }),
    );
    return;
  }

  if (!text.trim()) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["RELAYMSG", "BLANK_MSG", "The message must not be blank"],
      }),
    );
    return;
  }

  const stub = session.getChannelStub(target);
  const res = await stub.appendMessage({
    channelName: target,
    sessionId: attachment.sessionId,
    userId: attachment.userId,
    accountName: attachment.accountName,
    nickname: spoofedNick,
    username: attachment.username!,
    hostname: attachment.hostname,
    command: "PRIVMSG",
    content: text,
    tags: { "draft/relaymsg": attachment.nickname! },
    isOper: attachment.isOper,
    requireChanop: true,
  });

  if (!res.ok || !res.message) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["RELAYMSG", "PRIVS_NEEDED", "You cannot relay messages to this channel"],
      }),
    );
    return;
  }

  const stored = res.message;
  const prefix = `${spoofedNick}!${attachment.username}@${attachment.hostname}`;
  for (const sid of res.recipientSessionIds ?? []) {
    const sess = session.sessionsById.get(sid);
    if (!sess) continue;
    session.sendLine(
      sess.ws,
      sess.attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(sess.attachment, {
          msgid: stored.id,
          time: new Date(stored.createdAt).toISOString(),
          "draft/relaymsg": attachment.nickname!,
          ...(sid === attachment.sessionId && labelTags?.label ? { label: labelTags.label } : {}),
        }),
        prefix,
        command: "PRIVMSG",
        params: [target, text],
      }),
    );
  }
}
