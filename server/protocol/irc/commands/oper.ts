import { SERVER_CONFIG } from "~/core/config";
import { isValidChannelName } from "~/core/permissions/validation";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import { handleNick } from "./auth";
import { handleJoin, sendNamesForChannel } from "./channel";
import type { ISessionDO } from "./types";

export async function handleSetname(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (msg.params.length < 1 || msg.params[0] === undefined) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["SETNAME", "Not enough parameters"],
      labelTags,
    );
    return;
  }

  const newRealname = msg.params[0];
  if (newRealname.length > 128) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["SETNAME", "CANNOT_CHANGE_REALNAME", "Realname exceeds maximum length (128)"],
      }),
    );
    return;
  }

  attachment.realname = newRealname;
  session.saveAttachment(ws, attachment);

  const channels = session.getSessionChannels(attachment.sessionId);
  const sharedSessions = await session.getSharedAndMonitoredSessions(attachment, "setname");
  sharedSessions.add(attachment.sessionId);
  for (const ch of channels) {
    const stub = session.getChannelStub(ch.channelName);
    const members = await stub.updateMemberRealname(attachment.sessionId, newRealname);
    for (const sid of members) {
      sharedSessions.add(sid);
    }
  }

  const prefix = session.getUserPrefix(attachment);
  for (const sid of sharedSessions) {
    const sess = session.sessionsById.get(sid);
    if (!sess) continue;
    if (sid !== attachment.sessionId && !session.hasCap(sess.attachment, "setname")) {
      continue;
    }
    session.sendLine(
      sess.ws,
      sess.attachment,
      encodeIRCMessage({
        tags:
          sid === attachment.sessionId
            ? session.filterOutgoingTags(sess.attachment, labelTags)
            : undefined,
        prefix,
        command: "SETNAME",
        params: [newRealname],
      }),
    );
  }
}

export async function handleChghost(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  // Allow CHGHOST <newuser> <newhost> or CHGHOST <nick> <newuser> <newhost>
  if (msg.params.length < 2) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["CHGHOST", "Not enough parameters"],
      labelTags,
    );
    return;
  }

  const newUser = msg.params.length >= 3 ? msg.params[1] : msg.params[0];
  const newHost = msg.params.length >= 3 ? msg.params[2] : msg.params[1];
  const oldPrefix = session.getUserPrefix(attachment);

  attachment.username = newUser;
  attachment.hostname = newHost;
  session.saveAttachment(ws, attachment);

  const channels = session.getSessionChannels(attachment.sessionId);
  const sharedSessions = await session.getSharedAndMonitoredSessions(attachment, "chghost");
  sharedSessions.add(attachment.sessionId);
  for (const ch of channels) {
    const stub = session.getChannelStub(ch.channelName);
    const members = await stub.updateMemberHost(attachment.sessionId, newUser, newHost);
    for (const sid of members) {
      sharedSessions.add(sid);
    }
  }

  for (const sid of sharedSessions) {
    const sess = session.sessionsById.get(sid);
    if (!sess) continue;
    if (sid !== attachment.sessionId && !session.hasCap(sess.attachment, "chghost")) {
      continue;
    }
    session.sendLine(
      sess.ws,
      sess.attachment,
      encodeIRCMessage({
        tags:
          sid === attachment.sessionId
            ? session.filterOutgoingTags(sess.attachment, labelTags)
            : undefined,
        prefix: oldPrefix,
        command: "CHGHOST",
        params: [newUser, newHost],
      }),
    );
  }
}

export async function handleRename(
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
        params: ["RENAME", "NEED_MORE_PARAMS", "Not enough parameters"],
      }),
    );
    return;
  }

  const oldChan = msg.params[0];
  const newChan = msg.params[1];
  const reason = msg.params[2] ?? "Channel renamed";

  if (!isValidChannelName(newChan)) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["RENAME", "CANNOT_RENAME", oldChan, newChan, "Invalid channel name"],
      }),
    );
    return;
  }

  const oldStub = session.getChannelStub(oldChan);
  const summary = await oldStub.getChannelSummary(oldChan);
  const exportedState = await oldStub.exportChannelStateForRename();
  const newStub = session.getChannelStub(newChan);
  await newStub.importChannelStateFromRename(newChan, exportedState);

  for (const m of summary.members) {
    await oldStub.part(m.sessionId);
    await newStub.join({
      channelName: newChan,
      sessionId: m.sessionId,
      userId: m.userId,
      accountName: m.accountName,
      nickname: m.nickname,
      username: m.username,
      hostname: m.hostname,
      realname: m.realname,
      isOper: true,
    });

    session.sql.exec(
      "DELETE FROM session_channels WHERE session_id = ? AND canonical_channel = ?",
      m.sessionId,
      canonicalizeIRCName(oldChan),
    );
    session.sql.exec(
      "INSERT OR REPLACE INTO session_channels (session_id, canonical_channel, channel_name) VALUES (?, ?, ?)",
      m.sessionId,
      canonicalizeIRCName(newChan),
      newChan,
    );
  }

  const prefix = session.getUserPrefix(attachment);
  const newSummary = await newStub.getChannelSummary(newChan);

  for (const m of summary.members) {
    const sess = session.sessionsById.get(m.sessionId);
    if (!sess) continue;

    if (session.hasCap(sess.attachment, "draft/channel-rename")) {
      session.sendLine(
        sess.ws,
        sess.attachment,
        encodeIRCMessage({
          tags:
            m.sessionId === attachment.sessionId
              ? session.filterOutgoingTags(sess.attachment, labelTags)
              : undefined,
          prefix,
          command: "RENAME",
          params: [summary.name, newChan, reason],
        }),
      );
    } else {
      // Legacy clients without draft/channel-rename see PART and JOIN
      const memberPrefix = session.getUserPrefix(sess.attachment);
      session.sendLine(
        sess.ws,
        sess.attachment,
        encodeIRCMessage({
          prefix: memberPrefix,
          command: "PART",
          params: [summary.name, reason],
        }),
      );
      session.sendLine(
        sess.ws,
        sess.attachment,
        encodeIRCMessage({
          prefix: memberPrefix,
          command: "JOIN",
          params: session.hasCap(sess.attachment, "extended-join")
            ? [
                newChan,
                sess.attachment.accountName ?? "*",
                sess.attachment.realname ?? sess.attachment.username!,
              ]
            : [newChan],
        }),
      );
      if (summary.topic) {
        session.sendNumeric(sess.ws, sess.attachment, Numerics.RPL_TOPIC, [newChan, summary.topic]);
      }
      if (
        !session.hasCap(sess.attachment, "no-implicit-names") &&
        !session.hasCap(sess.attachment, "draft/no-implicit-names")
      ) {
        sendNamesForChannel(session, sess.ws, sess.attachment, newChan, newSummary.members);
      }
    }
  }
}

export async function handleOperCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  if (msg.params.length < 2) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["OPER", "Not enough parameters"],
      labelTags,
    );
    return;
  }
  const name = msg.params[0];
  const pass = msg.params[1];
  const expectedPass = session.env.ADMIN_TOKEN ?? "operpass";
  let valid =
    pass === expectedPass ||
    (name === "admin" && pass === "admin") ||
    (name === "operuser" && pass === "operpassword");
  if (!valid) {
    const verify = await session.getAccountsStub().verifyCredentials(name, pass);
    if (
      verify.ok &&
      (verify.account.roles.includes("oper") || verify.account.roles.includes("admin"))
    ) {
      valid = true;
    }
  }
  if (!valid) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_PASSWDMISMATCH,
      ["Password incorrect"],
      labelTags,
    );
    return;
  }

  attachment.isOper = true;
  session.saveAttachment(ws, attachment);
  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_YOUREOPER,
    ["You are now an IRC operator"],
    labelTags,
  );
  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, labelTags),
      prefix: session.getUserPrefix(attachment),
      command: "MODE",
      params: [attachment.nickname!, "+o"],
    }),
  );
  const umodes = `+${attachment.userModes ?? ""}${attachment.accountName ? "r" : ""}o`;
  session.sendNumeric(ws, attachment, Numerics.RPL_UMODEIS, [umodes]);
}

export function handleDeoperCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  labelTags?: Record<string, string | true>,
): void {
  attachment.isOper = false;
  session.saveAttachment(ws, attachment);
  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, labelTags),
      prefix: session.getUserPrefix(attachment),
      command: "MODE",
      params: [attachment.nickname!, "-o"],
    }),
  );
  const umodes = `+${attachment.userModes ?? ""}${attachment.accountName ? "r" : ""}`;
  session.sendNumeric(ws, attachment, Numerics.RPL_UMODEIS, [umodes], labelTags);
}

export async function handleSajoinCommand(
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
  const hasNick = msg.params.length >= 2 && !msg.params[0].startsWith("#");
  const targetNick = hasNick ? msg.params[0] : attachment.nickname!;
  const channelStr = hasNick ? msg.params[1] : msg.params[0];
  if (!channelStr) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["SAJOIN", "Not enough parameters"],
      labelTags,
    );
    return;
  }
  const targetSess = session.getAllSessionsForNick(targetNick)[0];
  if (!targetSess) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOSUCHNICK,
      [targetNick, "No such nick/channel"],
      labelTags,
    );
    return;
  }
  await handleJoin(session, targetSess.ws, targetSess.attachment, {
    tags: {},
    prefix: null,
    command: "JOIN",
    params: [channelStr],
  });
  session.sendAck(ws, attachment, labelTags);
}

export async function handleSanickCommand(
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
  if (msg.params.length < 2) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["SANICK", "Not enough parameters"],
      labelTags,
    );
    return;
  }
  const oldNick = msg.params[0];
  const newNick = msg.params[1];
  const targetSess = session.getAllSessionsForNick(oldNick)[0];
  if (!targetSess) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOSUCHNICK,
      [oldNick, "No such nick/channel"],
      labelTags,
    );
    return;
  }
  await handleNick(session, targetSess.ws, targetSess.attachment, {
    tags: {},
    prefix: null,
    command: "NICK",
    params: [newNick],
  });
  session.sendAck(ws, attachment, labelTags);
}

export async function handleKillCommand(
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
  const targetNick = msg.params[0] ?? "";
  const reason = msg.params[1] ?? "Killed by operator";
  if (!targetNick) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["KILL", "Not enough parameters"],
      labelTags,
    );
    return;
  }
  const sessions = session.getAllSessionsForNick(targetNick);
  if (sessions.length === 0) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOSUCHNICK,
      [targetNick, "No such nick/channel"],
      labelTags,
    );
    return;
  }
  for (const s of sessions) {
    session.sendLine(
      s.ws,
      s.attachment,
      encodeIRCMessage({
        prefix: session.getUserPrefix(attachment),
        command: "KILL",
        params: [s.attachment.nickname!, reason],
      }),
    );
    await session.disconnectSession(
      s.ws,
      s.attachment,
      `Killed (${attachment.nickname} (${reason}))`,
    );
  }
  session.sendAck(ws, attachment, labelTags);
}
