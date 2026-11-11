import { SERVER_CONFIG } from "~/core/config";
import { formatMemberPrefix, matchesWildcard } from "~/core/permissions/authorization";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "./types";

export function handleTime(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const timeTarget = msg.params[0]?.trim();
  if (
    timeTarget &&
    canonicalizeIRCName(timeTarget) !== canonicalizeIRCName(SERVER_CONFIG.serverName) &&
    session.getAllSessionsForNick(timeTarget).length === 0
  ) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOSUCHSERVER,
      [timeTarget, "No such server"],
      labelTags,
    );
    return;
  }
  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_TIME,
    [SERVER_CONFIG.serverName, new Date().toUTCString()],
    labelTags,
  );
}

export function handleVersion(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const verTarget = msg.params[0]?.trim();
  if (
    verTarget &&
    canonicalizeIRCName(verTarget) !== canonicalizeIRCName(SERVER_CONFIG.serverName) &&
    session.getAllSessionsForNick(verTarget).length === 0
  ) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOSUCHSERVER,
      [verTarget, "No such server"],
      labelTags,
    );
    return;
  }
  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_VERSION,
    [SERVER_CONFIG.version, SERVER_CONFIG.serverName, "Cloudflare Workers IRCv3"],
    labelTags,
  );
  for (const row of session.getIsupportTokens()) {
    session.sendNumeric(ws, attachment, Numerics.RPL_ISUPPORT, row, labelTags);
  }
}

export function handlePing(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const token = msg.params[0] ?? "";
  if (!token) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NOORIGIN, ["No origin specified"], labelTags);
    return;
  }
  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, labelTags),
      prefix: SERVER_CONFIG.serverName,
      command: "PONG",
      params: [SERVER_CONFIG.serverName, token],
    }),
  );
}

export function handleWhoami(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  labelTags?: Record<string, string | true>,
): void {
  if (attachment.accountName) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_LOGGEDIN,
      [
        session.getUserPrefix(attachment),
        attachment.accountName,
        `You are logged in as ${attachment.accountName}`,
      ],
      labelTags,
    );
  } else {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_LOGGEDOUT,
      [session.getUserPrefix(attachment), "You are not logged in"],
      labelTags,
    );
  }
}

export async function handleWho(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const mask = msg.params[0] ?? "*";
  const flagsArg = msg.params[1] ?? "";
  const pctIdx = flagsArg.indexOf("%");
  const isWhox = pctIdx !== -1;
  let whoxFields = "";
  let whoxToken = "";
  if (isWhox) {
    const afterPct = flagsArg.slice(pctIdx + 1);
    const commaIdx = afterPct.indexOf(",");
    whoxFields = (commaIdx !== -1 ? afterPct.slice(0, commaIdx) : afterPct).toLowerCase();
    whoxToken = commaIdx !== -1 ? afterPct.slice(commaIdx + 1) : "";
  }

  const multiPrefix = session.hasCap(attachment, "multi-prefix");

  const emitWhoEntry = (entry: {
    channel: string;
    username: string;
    hostname: string;
    nickname: string;
    flags: string;
    account: string;
    realname: string;
  }) => {
    if (!isWhox) {
      session.sendNumeric(ws, attachment, Numerics.RPL_WHOREPLY, [
        entry.channel,
        entry.username,
        entry.hostname,
        SERVER_CONFIG.serverName,
        entry.nickname,
        entry.flags,
        `0 ${entry.realname}`,
      ]);
      return;
    }

    // WHOX field ordering: t, c, u, i, h, s, n, f, d, l, a, o, r
    const params: string[] = [];
    if (whoxFields.includes("t")) params.push(whoxToken || "0");
    if (whoxFields.includes("c")) params.push(entry.channel);
    if (whoxFields.includes("u")) params.push(entry.username);
    if (whoxFields.includes("i")) params.push(entry.hostname);
    if (whoxFields.includes("h")) params.push(entry.hostname);
    if (whoxFields.includes("s")) params.push(SERVER_CONFIG.serverName);
    if (whoxFields.includes("n")) params.push(entry.nickname);
    if (whoxFields.includes("f")) params.push(entry.flags);
    if (whoxFields.includes("d")) params.push("0");
    if (whoxFields.includes("l")) params.push("0");
    if (whoxFields.includes("a")) params.push(entry.account || "0");
    if (whoxFields.includes("o")) params.push("0");
    if (whoxFields.includes("r")) params.push(entry.realname);
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOSPCRPL, params);
  };

  if (mask.startsWith("#") || mask.startsWith("&")) {
    const stub = session.getChannelStub(mask);
    const summary = await stub.getChannelSummary(mask);
    const isJoined = summary.members.some((m) => m.sessionId === attachment.sessionId);
    if (
      !(summary.modes.includes("s") && !isJoined && !attachment.isOper) &&
      (!SERVER_CONFIG.requireAccounts ||
        (await stub.canReadAccount({
          id: attachment.userId,
          username: attachment.accountName ?? "",
          isAdmin: attachment.isOper,
        })))
    ) {
      for (const m of summary.members) {
        const sess = session.sessionsById.get(m.sessionId);
        const isInvisible = (sess?.attachment.userModes ?? "").includes("i");
        if (!isJoined && !attachment.isOper && isInvisible) {
          continue;
        }
        const awayFlag = sess?.attachment.awayMessage ? "G" : "H";
        const operFlag = sess?.attachment.isOper ? "*" : "";
        const botFlag = sess?.attachment.isBot ? "B" : "";
        const prefixFlag = formatMemberPrefix(m.modes, multiPrefix);

        emitWhoEntry({
          channel: summary.name,
          username: m.username,
          hostname: m.hostname,
          nickname: m.nickname,
          flags: `${awayFlag}${operFlag}${botFlag}${prefixFlag}`,
          account: m.accountName ?? "0",
          realname: m.realname,
        });
      }
    }
  } else {
    const svc = session.getServiceDefinition(mask);
    if (svc) {
      emitWhoEntry({
        channel: "*",
        username: svc.name,
        hostname: SERVER_CONFIG.serverName,
        nickname: svc.name,
        flags: "H*B",
        account: "0",
        realname: svc.realname,
      });
    } else {
      const isWildcard =
        mask === "*" ||
        mask.includes("*") ||
        mask.includes("?") ||
        mask.includes("!") ||
        mask.includes("@");
      const sharedSessions = isWildcard
        ? await session.getSharedChannelSessions(attachment.sessionId)
        : null;
      const canon = canonicalizeIRCName(mask);

      for (const { attachment: a } of session.sessionsById.values()) {
        if (!a.registered || !a.nickname) continue;

        let matches = false;
        if (!isWildcard) {
          matches = canonicalizeIRCName(a.nickname) === canon;
        } else if (mask === "*") {
          matches = true;
        } else {
          const canonNick = canonicalizeIRCName(a.nickname);
          const canonMask = canonicalizeIRCName(mask);
          if (mask.includes("!") || mask.includes("@")) {
            const fullMask = `${canonNick}!${canonicalizeIRCName(a.username ?? "user")}@${canonicalizeIRCName(a.hostname)}`;
            matches = matchesWildcard(canonMask, fullMask);
          } else {
            matches = matchesWildcard(canonMask, canonNick);
          }
        }

        if (!matches) continue;

        if (isWildcard) {
          const isInvisible = (a.userModes ?? "").includes("i");
          const isFriend =
            a.sessionId === attachment.sessionId || (sharedSessions?.has(a.sessionId) ?? false);
          if (!attachment.isOper && isInvisible && !isFriend) {
            continue;
          }
        }

        const awayFlag = a.awayMessage ? "G" : "H";
        const operFlag = a.isOper ? "*" : "";
        const botFlag = a.isBot ? "B" : "";
        emitWhoEntry({
          channel: "*",
          username: a.username ?? "user",
          hostname: a.hostname,
          nickname: a.nickname,
          flags: `${awayFlag}${operFlag}${botFlag}`,
          account: a.accountName ?? "0",
          realname: a.realname ?? a.username ?? "user",
        });
      }
    }
  }

  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_ENDOFWHO,
    [mask, "End of /WHO list."],
    labelTags,
  );
}

export async function handleWhois(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const targetNick = msg.params.length > 1 ? msg.params[1] : msg.params[0];
  if (!targetNick) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NONICKNAMEGIVEN,
      ["No nickname given"],
      labelTags,
    );
    return;
  }

  const svc = session.getServiceDefinition(targetNick);
  if (svc) {
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISUSER, [
      svc.name,
      svc.name,
      "localhost",
      "*",
      svc.realname,
    ]);
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISSERVER, [
      svc.name,
      SERVER_CONFIG.serverName,
      "FlaRC (Flare Relay Chat) Serverless Network",
    ]);
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISOPERATOR, [
      svc.name,
      "is a network service",
    ]);
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_ENDOFWHOIS,
      [svc.name, "End of /WHOIS list."],
      labelTags,
    );
    return;
  }

  const targetSessions = session.getAllSessionsForNick(targetNick);
  const targetSess = targetSessions[0];
  if (!targetSess?.attachment.registered) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NOSUCHNICK, [
      targetNick,
      "No such nick/channel",
    ]);
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_ENDOFWHOIS,
      [targetNick, "End of /WHOIS list."],
      labelTags,
    );
    return;
  }

  const a = targetSess.attachment;
  const isSelfOrOper = a.sessionId === attachment.sessionId || attachment.isOper;

  session.sendNumeric(ws, attachment, Numerics.RPL_WHOISUSER, [
    a.nickname!,
    a.username!,
    a.hostname,
    "*",
    a.realname ?? a.username!,
  ]);
  session.sendNumeric(ws, attachment, Numerics.RPL_WHOISSERVER, [
    a.nickname!,
    SERVER_CONFIG.serverName,
    "FlaRC (Flare Relay Chat) Serverless Network",
  ]);
  if (a.isOper) {
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISOPERATOR, [
      a.nickname!,
      "is an IRC operator",
    ]);
  }
  if (a.isBot) {
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISBOT, [
      a.nickname!,
      `is a Bot on ${SERVER_CONFIG.networkId}`,
    ]);
  }
  if (a.accountName) {
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISREGNICK, [
      a.nickname!,
      "is a registered nick",
    ]);
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISACCOUNT, [
      a.nickname!,
      a.accountName,
      "is logged in as",
    ]);
  }
  if (isSelfOrOper) {
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISACTUALLY, [
      a.nickname!,
      `${a.username}@${a.hostname}`,
      a.hostname,
      "Actual user@host, Actual IP",
    ]);
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISHOST, [
      a.nickname!,
      `is connecting from ${a.username}@${a.hostname} ${a.hostname}`,
    ]);
    const umodes = `+${a.userModes ?? ""}${a.accountName ? "r" : ""}${a.isOper ? "o" : ""}`;
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISMODES, [
      a.nickname!,
      `is using modes ${umodes}`,
    ]);
  }
  if ((a.userModes ?? "").includes("Z")) {
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISSECURE, [
      a.nickname!,
      "is using a secure connection",
    ]);
  }
  if (a.awayMessage) {
    session.sendNumeric(ws, attachment, Numerics.RPL_AWAY, [a.nickname!, a.awayMessage]);
  }

  const userChannels = session.getSessionChannels(a.sessionId);
  const visibleChannels: string[] = [];
  const isTargetInvisible = (a.userModes ?? "").includes("i");

  for (const ch of userChannels) {
    const stub = session.getChannelStub(ch.channelName);
    const summary = await stub.getChannelSummary(ch.channelName);
    const isMember = summary.members.some((m) => m.sessionId === attachment.sessionId);
    if (
      SERVER_CONFIG.requireAccounts &&
      !(await stub.canReadAccount({
        id: attachment.userId,
        username: attachment.accountName ?? "",
        isAdmin: attachment.isOper,
      }))
    )
      continue;
    if (!attachment.isOper && (isTargetInvisible || summary.modes.includes("s")) && !isMember) {
      continue;
    }
    const targetMember = summary.members.find((m) => m.sessionId === a.sessionId);
    const pfx = targetMember
      ? formatMemberPrefix(targetMember.modes, session.hasCap(attachment, "multi-prefix"))
      : "";
    visibleChannels.push(`${pfx}${summary.name}`);
  }

  if (visibleChannels.length > 0) {
    session.sendNumeric(ws, attachment, Numerics.RPL_WHOISCHANNELS, [
      a.nickname!,
      visibleChannels.join(" "),
    ]);
  }

  const idleSecs = Math.max(0, Math.floor((Date.now() - (a.lastActiveAt ?? a.connectedAt)) / 1000));
  const signonEpoch = Math.floor(a.connectedAt / 1000);
  session.sendNumeric(ws, attachment, Numerics.RPL_WHOISIDLE, [
    a.nickname!,
    String(idleSecs),
    String(signonEpoch),
    "seconds idle, signon time",
  ]);

  if (
    session.hasCap(attachment, "draft/metadata-3") ||
    session.hasCap(attachment, "draft/metadata-2")
  ) {
    const accountsStub = session.getAccountsStub();
    const metaKey = a.accountName ?? canonicalizeIRCName(a.nickname!);
    const meta = await accountsStub.getMetadata(metaKey);
    for (const [k, v] of Object.entries(meta)) {
      session.sendNumeric(ws, attachment, Numerics.RPL_WHOISKEYVALUE, [a.nickname!, k, "*", v]);
    }
  }

  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_ENDOFWHOIS,
    [a.nickname!, "End of /WHOIS list."],
    labelTags,
  );
}

export function handleWhowas(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const targetNick = msg.params[0] ?? "";
  if (!targetNick) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NONICKNAMEGIVEN,
      ["No nickname given"],
      labelTags,
    );
    return;
  }

  let limit = 50;
  if (msg.params[1] !== undefined) {
    const parsedCount = parseInt(msg.params[1], 10);
    if (!Number.isNaN(parsedCount) && parsedCount > 0) {
      limit = Math.min(parsedCount, 50);
    }
  }

  const canon = canonicalizeIRCName(targetNick);
  const rows = session.sql
    .exec<{
      nickname: string;
      username: string;
      hostname: string;
      realname: string;
    }>(
      "SELECT nickname, username, hostname, realname FROM whowas_history WHERE canon_nick = ? ORDER BY id DESC LIMIT ?",
      canon,
      limit,
    )
    .toArray();

  if (rows.length === 0) {
    session.sendNumeric(ws, attachment, Numerics.ERR_WASNOSUCHNICK, [
      targetNick,
      "There was no such nickname",
    ]);
  } else {
    for (const r of rows) {
      session.sendNumeric(ws, attachment, Numerics.RPL_WHOWASUSER, [
        r.nickname,
        r.username,
        r.hostname,
        "*",
        r.realname,
      ]);
    }
  }

  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_ENDOFWHOWAS,
    [targetNick, "End of WHOWAS"],
    labelTags,
  );
}

export function handleUserhost(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const replies: string[] = [];
  for (const nick of msg.params.slice(0, 5)) {
    const matches = session.getAllSessionsForNick(nick);
    if (matches.length > 0 && matches[0].attachment.registered) {
      const a = matches[0].attachment;
      const operStar = a.isOper ? "*" : "";
      const awaySign = a.awayMessage ? "-" : "+";
      replies.push(`${a.nickname}${operStar}=${awaySign}${a.username}@${a.hostname}`);
    }
  }
  session.sendNumeric(ws, attachment, Numerics.RPL_USERHOST, [replies.join(" ")], labelTags);
}

export function handleIson(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const online: string[] = [];
  const tokens = msg.params.flatMap((p) => p.split(/\s+/)).filter(Boolean);
  for (const nick of tokens) {
    const svc = session.getServiceDefinition(nick);
    if (svc) {
      online.push(svc.name);
      continue;
    }
    const matches = session.getAllSessionsForNick(nick);
    if (matches.length > 0 && matches[0].attachment.registered) {
      online.push(matches[0].attachment.nickname!);
    }
  }
  session.sendNumeric(ws, attachment, Numerics.RPL_ISON, [online.join(" ")], labelTags);
}

export function handleInfoCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  labelTags?: Record<string, string | true>,
): void {
  const infoLines = [
    `${SERVER_CONFIG.serverName} (${SERVER_CONFIG.version})`,
    "FlaRC (Flare Relay Chat) - Cloudflare Workers + Durable Objects IRCv3 Server",
    "Full IRCv3 compliant serverless IRC engine",
  ];
  for (const line of infoLines) {
    session.sendNumeric(ws, attachment, Numerics.RPL_INFO, [line]);
  }
  session.sendNumeric(ws, attachment, Numerics.RPL_ENDOFINFO, ["End of /INFO list"], labelTags);
}

export function handleHelpCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const topic = (msg.params[0] ?? "INDEX").toUpperCase();
  const helpTopics: Record<string, string[]> = {
    INDEX: [
      "FlaRC IRCv3 Help:",
      "Available commands: CAP, AUTHENTICATE, REGISTER, JOIN, PART, PRIVMSG, NOTICE, TAGMSG, BATCH, REDACT,",
      "CHATHISTORY, HISTORY, METADATA, MARKREAD, SETNAME, CHGHOST, MONITOR, RENAME, WHOAMI, RELAYMSG,",
      "NS (NickServ), CS (ChanServ), HS (HostServ), HISTSERV, NPC, NPCA, SCENE, ACCEPT, OPER, DEOPER",
    ],
    NICKSERV: [
      "NickServ (/NS): REGISTER, IDENTIFY, INFO, GROUP, DROP, GHOST, PASSWD, UNREGISTER, CLIENTS, GET, SET, LIST",
    ],
    CHANSERV: [
      "ChanServ (/CS): OP, DEOP, REGISTER, UNREGISTER, AMODE, CLEAR, TRANSFER, LIST, INFO, GET, SET, HOWTOBAN",
    ],
    HOSTSERV: ["HostServ (/HS): ON, OFF, STATUS, SET, DEL"],
    HISTSERV: ["HistServ (/HISTSERV): PLAY, DELETE, FORGET, EXPORT"],
  };
  const lines = helpTopics[topic] ?? [
    `Help for ${topic}:`,
    `${topic} is supported by ${SERVER_CONFIG.serverName}.`,
  ];
  session.sendNumeric(ws, attachment, Numerics.RPL_HELPSTART, [topic, lines[0]]);
  for (let i = 1; i < lines.length; i++) {
    session.sendNumeric(ws, attachment, Numerics.RPL_HELPTXT, [topic, lines[i]]);
  }
  session.sendNumeric(ws, attachment, Numerics.RPL_ENDOFHELP, [topic, "End of /HELP."], labelTags);
}

export async function handleWallops(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (!attachment.isOper) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOPRIVILEGES,
      ["Permission Denied - You're not an IRC operator"],
      labelTags,
    );
    return;
  }
  if (msg.params.length < 1 || !msg.params[0]) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["WALLOPS", "Not enough parameters"],
      labelTags,
    );
    return;
  }
  const text = msg.params[0];
  const prefix = session.getUserPrefix(attachment);
  const wallopsLine = encodeIRCMessage({
    prefix,
    command: "WALLOPS",
    params: [text],
  });
  // Send to sender
  session.sendLine(ws, attachment, wallopsLine);
  // Broadcast to other sessions that have user mode 'w'
  for (const [sid, sess] of session.sessionsById.entries()) {
    if (sid === attachment.sessionId) continue;
    if (sess.attachment.userModes?.includes("w")) {
      session.sendLine(sess.ws, sess.attachment, wallopsLine);
    }
  }
}

export function handleLinks(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const mask = msg.params[0] ?? "*";
  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_ENDOFLINKS,
    [mask, "End of /LINKS list"],
    labelTags,
  );
}
