import { SERVER_CONFIG } from "~/core/config";
import { formatMemberPrefix, matchesWildcard } from "~/core/permissions/authorization";
import { isValidChannelName } from "~/core/permissions/validation";
import type { ChannelMemberInfo, SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import { sendReadMarkerOnJoin, syncChannelMemberMetadataOnJoin } from "./extensions";
import type { ISessionDO } from "./types";

async function channelCommandGeneration(
  session: ISessionDO,
  attachment: SessionAttachment,
  channel: string,
): Promise<string | undefined> {
  const bound = session
    .getSessionChannels(attachment.sessionId)
    .find((row) => row.canonicalChannel === canonicalizeIRCName(channel));
  return (
    (bound as { generation?: string } | undefined)?.generation ??
    (await session.getChannelStub(channel).getExistingChannelGeneration()) ??
    undefined
  );
}

export async function handleJoin(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
  expectedGenerations?: Record<string, string>,
): Promise<void> {
  if (msg.params.length < 1 || !msg.params[0]) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["JOIN", "Not enough parameters"],
      labelTags,
    );
    return;
  }

  if (msg.params[0] === "0") {
    const currentChannels = session.getSessionChannels(attachment.sessionId);
    for (const ch of currentChannels) {
      await performPart(session, ws, attachment, ch.channelName, "Left all channels");
    }
    if (labelTags?.label) {
      session.sendAck(ws, attachment, labelTags);
    }
    return;
  }

  const needsBatch = Boolean(labelTags?.label) && session.hasCap(attachment, "batch");
  const joinBatchId = needsBatch ? crypto.randomUUID().slice(0, 8) : null;
  const batchTagObj = joinBatchId ? { batch: joinBatchId } : undefined;

  if (joinBatchId) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`+${joinBatchId}`, "labeled-response"],
      }),
    );
  }

  const channelList = msg.params[0]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const keyList = (msg.params[1] ?? "").split(",");

  for (let i = 0; i < channelList.length; i++) {
    const rawChannel = channelList[i];
    const key = keyList[i];

    if (!isValidChannelName(rawChannel)) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOSUCHCHANNEL,
        [rawChannel, "No such channel"],
        batchTagObj,
      );
      continue;
    }

    const stub = session.getChannelStub(rawChannel);
    if (
      attachment.authenticated &&
      !(await session
        .getAccountsStub()
        .authorizeAccountActor(
          attachment.userId,
          attachment.credentialVersion ?? 0,
          "channel.join",
          canonicalizeIRCName(rawChannel),
        ))
    ) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOPRIVILEGES,
        ["Channel access denied"],
        batchTagObj,
      );
      continue;
    }
    const expectedGeneration = expectedGenerations
      ? expectedGenerations[canonicalizeIRCName(rawChannel)]
      : await stub.getChannelGeneration(rawChannel);
    if (
      !expectedGeneration ||
      (expectedGenerations && (await stub.getExistingChannelGeneration()) !== expectedGeneration)
    ) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOSUCHCHANNEL,
        [rawChannel, "Channel changed"],
        batchTagObj,
      );
      continue;
    }
    const isUserPersistent = attachment.authenticated
      ? await session.getAccountsStub().getPersistence(attachment.userId)
      : false;
    let res = await stub.join({
      channelName: rawChannel,
      sessionId: attachment.sessionId,
      userId: attachment.userId,
      accountName: attachment.accountName,
      nickname: attachment.nickname!,
      username: attachment.username!,
      hostname: attachment.hostname,
      realname: attachment.realname ?? attachment.username!,
      key,
      isOper: attachment.isOper,
      isPersistent: isUserPersistent,
      activeSessionIds: Array.from(session.sessionsById.keys()),
      expectedGeneration,
    });

    if (!res.ok && res.forwardChannel && isValidChannelName(res.forwardChannel)) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_LINKCHANNEL,
        [rawChannel, res.forwardChannel, "Forwarding to another channel"],
        batchTagObj,
      );
      const fwdStub = session.getChannelStub(res.forwardChannel);
      if (
        attachment.authenticated &&
        !(await session
          .getAccountsStub()
          .authorizeAccountActor(
            attachment.userId,
            attachment.credentialVersion ?? 0,
            "channel.join",
            canonicalizeIRCName(res.forwardChannel),
          ))
      ) {
        session.sendNumeric(
          ws,
          attachment,
          Numerics.ERR_NOPRIVILEGES,
          ["Channel access denied"],
          batchTagObj,
        );
        continue;
      }
      const forwardGeneration = expectedGenerations
        ? expectedGenerations[canonicalizeIRCName(res.forwardChannel)]
        : await fwdStub.getChannelGeneration(res.forwardChannel);
      if (
        !forwardGeneration ||
        (expectedGenerations &&
          (await fwdStub.getExistingChannelGeneration()) !== forwardGeneration)
      )
        continue;
      res = await fwdStub.join({
        channelName: res.forwardChannel,
        sessionId: attachment.sessionId,
        userId: attachment.userId,
        accountName: attachment.accountName,
        nickname: attachment.nickname!,
        username: attachment.username!,
        hostname: attachment.hostname,
        realname: attachment.realname ?? attachment.username!,
        isOper: attachment.isOper,
        isPersistent: isUserPersistent,
        expectedGeneration: forwardGeneration,
      });
    }

    if (!res.ok) {
      session.sendNumeric(
        ws,
        attachment,
        res.numeric ?? Numerics.ERR_NOSUCHCHANNEL,
        [rawChannel, res.errorText ?? "Cannot join channel"],
        batchTagObj,
      );
      continue;
    }

    if (
      !res.generation ||
      (await session.getChannelStub(res.channelName).getExistingChannelGeneration()) !==
        res.generation
    )
      continue;

    const canonChan = canonicalizeIRCName(res.channelName);
    session.sql.exec(
      `INSERT OR REPLACE INTO session_channels (session_id, canonical_channel, channel_name, generation)
         VALUES (?, ?, ?, ?)`,
      attachment.sessionId,
      canonChan,
      res.channelName,
      res.generation,
    );
    if (res.generation)
      await (session as any).bindSessionChannelGeneration(
        attachment.sessionId,
        res.channelName,
        res.generation,
      );

    if (attachment.authenticated) {
      const isPersistent = await session.getAccountsStub().getPersistence(attachment.userId);
      if (session.hasCap(attachment, "draft/auto-join") || isPersistent) {
        await session
          .getAccountsStub()
          .addAutoJoinChannel(attachment.userId, res.channelName, key, res.generation);
      }
    }
    if (
      (await session.getChannelStub(res.channelName).getExistingChannelGeneration()) !==
      res.generation
    )
      continue;

    const joinerPrefix = session.getUserPrefix(attachment);
    const nowIso = new Date().toISOString();
    const joinMsgId = crypto.randomUUID();
    const isAuditorium = (res.modes ?? "").includes("u");
    const joinerPrivileged = /[vhoaq]/.test(res.memberModes ?? "");

    for (const member of res.members) {
      const targetSess = session.sessionsById.get(member.sessionId);
      if (!targetSess) continue;

      const isSelf = member.sessionId === attachment.sessionId;
      if (res.isReattach && !isSelf) {
        continue;
      }
      if (isAuditorium && !joinerPrivileged && !isSelf && !/[vhoaq]/.test(member.modes)) {
        continue;
      }

      const joinTags = session.filterOutgoingTags(targetSess.attachment, {
        time: nowIso,
        msgid: joinMsgId,
        ...(attachment.accountName ? { account: attachment.accountName } : {}),
        ...(isSelf && batchTagObj ? batchTagObj : {}),
      });

      const params = session.hasCap(targetSess.attachment, "extended-join")
        ? [
            res.channelName,
            attachment.accountName ?? "*",
            attachment.realname ?? attachment.username!,
          ]
        : [res.channelName];

      session.sendChannelLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          tags: joinTags,
          prefix: joinerPrefix,
          command: "JOIN",
          params,
        }),
        res.channelName,
        res.generation,
      );

      if (
        attachment.awayMessage &&
        member.sessionId !== attachment.sessionId &&
        session.hasCap(targetSess.attachment, "away-notify")
      ) {
        session.sendChannelLine(
          targetSess.ws,
          targetSess.attachment,
          encodeIRCMessage({
            prefix: joinerPrefix,
            command: "AWAY",
            params: [attachment.awayMessage],
          }),
          res.channelName,
          res.generation,
        );
      }
    }

    if (res.topic) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.RPL_TOPIC,
        [res.channelName, res.topic],
        batchTagObj,
      );
      if (res.topicSetBy && res.topicSetAt) {
        session.sendNumeric(
          ws,
          attachment,
          Numerics.RPL_TOPICWHOTIME,
          [res.channelName, res.topicSetBy, String(Math.floor(res.topicSetAt / 1000))],
          batchTagObj,
        );
      }
    }

    // Send MARKREAD before RPL_ENDOFNAMES per draft/read-marker spec
    await sendReadMarkerOnJoin(session, ws, attachment, res.channelName, batchTagObj);
    if (
      (await session.getChannelStub(res.channelName).getExistingChannelGeneration()) !==
      res.generation
    )
      continue;

    if (
      !session.hasCap(attachment, "no-implicit-names") &&
      !session.hasCap(attachment, "draft/no-implicit-names")
    ) {
      sendNamesForChannel(
        session,
        ws,
        attachment,
        res.channelName,
        res.members,
        batchTagObj,
        res.modes,
      );
    }

    // Sync subscribed user metadata for channel members if draft/metadata-3 is active
    await syncChannelMemberMetadataOnJoin(session, ws, attachment, res.channelName, res.members);

    if (res.fBotWelcome) {
      session.sendChannelLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: `F!services@${SERVER_CONFIG.serverName}`,
          command: "NOTICE",
          params: [attachment.nickname ?? "*", `[${res.channelName}] ${res.fBotWelcome}`],
        }),
        res.channelName,
        res.generation,
      );
    }

    session.sql.exec(
      "INSERT OR IGNORE INTO known_channels (canonical_channel, channel_name, created_at) VALUES (?, ?, ?)",
      canonicalizeIRCName(res.channelName),
      res.channelName,
      Date.now(),
    );

    if (attachment.nickname) {
      session.sql.exec(
        "DELETE FROM session_invites WHERE canon_nick = ? AND channel_name = ? AND generation = ?",
        canonicalizeIRCName(attachment.nickname),
        res.channelName,
        res.generation,
      );
    }
  }

  if (joinBatchId) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`-${joinBatchId}`],
      }),
    );
  }
}

export function sendNamesForChannel(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  channelName: string,
  members: ChannelMemberInfo[],
  tags?: Record<string, string | true>,
  channelModes?: string,
  skipEndOfNames: boolean = false,
): void {
  const multiPrefix = session.hasCap(attachment, "multi-prefix");
  const userhostInNames = session.hasCap(attachment, "userhost-in-names");

  let visibleMembers = members;
  if (channelModes?.includes("u")) {
    const requester = members.find((m) => m.sessionId === attachment.sessionId);
    const isPrivileged = requester && /[vhoaq]/.test(requester.modes);
    if (!isPrivileged) {
      // Unprivileged members in auditorium mode only see privileged members
      visibleMembers = members.filter((m) => /[vhoaq]/.test(m.modes));
    }
  }

  if (visibleMembers.length > 0) {
    let chanSymbol = "=";
    if (channelModes?.includes("s")) {
      chanSymbol = "@";
    } else if (channelModes?.includes("p")) {
      chanSymbol = "*";
    }

    const seenNicks = new Set<string>();
    const dedupedMembers: ChannelMemberInfo[] = [];
    for (const m of visibleMembers) {
      const canon = canonicalizeIRCName(m.nickname);
      if (!seenNicks.has(canon)) {
        seenNicks.add(canon);
        dedupedMembers.push(m);
      }
    }

    const names = dedupedMembers.map((m) => {
      const prefix = formatMemberPrefix(m.modes, multiPrefix);
      const ident = userhostInNames ? `${m.nickname}!${m.username}@${m.hostname}` : m.nickname;
      return `${prefix}${ident}`;
    });

    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_NAMREPLY,
      [chanSymbol, channelName, names.join(" ")],
      tags,
    );
  }

  if (!skipEndOfNames) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.RPL_ENDOFNAMES,
      [channelName, "End of /NAMES list."],
      tags,
    );
  }
}

export async function handlePart(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  if (msg.params.length < 1 || !msg.params[0]) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "PART",
      "Not enough parameters",
    ]);
    return;
  }

  const channels = msg.params[0]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const reason = msg.params[1];

  for (const rawChannel of channels) {
    await performPart(session, ws, attachment, rawChannel, reason);
  }
}

export async function performPart(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawChannel: string,
  reason?: string,
): Promise<void> {
  const stub = session.getChannelStub(rawChannel);
  const bound = session
    .getSessionChannels(attachment.sessionId)
    .find((item) => item.canonicalChannel === canonicalizeIRCName(rawChannel));
  const generation = (bound as { generation?: string } | undefined)?.generation;
  const res = await stub.part(attachment.sessionId, undefined, false, generation);
  if (!res.ok) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NOTONCHANNEL, [
      rawChannel,
      "You're not on that channel",
    ]);
    return;
  }

  const canonChan = canonicalizeIRCName(res.channelName || rawChannel);
  session.sql.exec(
    "DELETE FROM session_channels WHERE session_id = ? AND canonical_channel = ? AND generation = ?",
    attachment.sessionId,
    canonChan,
    generation ?? "",
  );

  if (attachment.authenticated && generation) {
    await session
      .getAccountsStub()
      .removeAutoJoinChannel(attachment.userId, res.channelName || rawChannel, generation);
  }

  if (!generation || (await stub.getExistingChannelGeneration()) !== generation) return;

  const partParams = reason !== undefined ? [res.channelName, reason] : [res.channelName];
  const prefix = session.getUserPrefix(attachment);
  const recipients = new Set<string>([attachment.sessionId, ...res.remainingSessionIds]);

  for (const sid of recipients) {
    const targetSess = session.sessionsById.get(sid);
    if (!targetSess) continue;
    const leaving = sid === attachment.sessionId;
    if (leaving && targetSess.attachment.userId !== res.partedUserId) continue;
    session.sendChannelLine(
      targetSess.ws,
      targetSess.attachment,
      encodeIRCMessage({
        prefix,
        command: "PART",
        params: partParams,
      }),
      res.channelName,
      generation,
      leaving,
    );
  }
}

export async function handleNames(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  if (!msg.params[0]) {
    session.sendNumeric(ws, attachment, Numerics.RPL_ENDOFNAMES, ["*", "End of /NAMES list."]);
    return;
  }
  const channels = msg.params[0]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const isMulti = channels.length > 1;
  for (const ch of channels) {
    if (!isValidChannelName(ch)) {
      if (!isMulti) {
        session.sendNumeric(ws, attachment, Numerics.RPL_ENDOFNAMES, [ch, "End of /NAMES list."]);
      }
      continue;
    }
    const stub = session.getChannelStub(ch);
    const summary = await stub.getChannelSummary(ch);
    const member = summary.members.some((m) => m.sessionId === attachment.sessionId);
    const restricted = SERVER_CONFIG.requireAccounts
      ? /[spik]/.test(summary.modes)
      : /[sp]/.test(summary.modes);
    if (restricted && !member && !attachment.isOper) {
      if (!isMulti)
        session.sendNumeric(ws, attachment, Numerics.RPL_ENDOFNAMES, [ch, "End of /NAMES list."]);
      continue;
    }
    if (summary.members.length === 0) {
      if (!isMulti) {
        session.sendNumeric(ws, attachment, Numerics.RPL_ENDOFNAMES, [ch, "End of /NAMES list."]);
      }
      continue;
    }
    sendNamesForChannel(
      session,
      ws,
      attachment,
      summary.name,
      summary.members,
      undefined,
      summary.modes,
      isMulti,
    );
  }
  if (isMulti) {
    session.sendNumeric(ws, attachment, Numerics.RPL_ENDOFNAMES, [
      msg.params[0],
      "End of /NAMES list.",
    ]);
  }
}

export async function handleTopic(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  if (msg.params.length < 1 || !msg.params[0]) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "TOPIC",
      "Not enough parameters",
    ]);
    return;
  }

  const rawChannel = msg.params[0];
  const stub = session.getChannelStub(rawChannel);
  const expectedGeneration = await channelCommandGeneration(session, attachment, rawChannel);

  if (msg.params.length === 1) {
    const summary = await stub.getChannelSummary(rawChannel);
    if (summary.members.length === 0) {
      session.sendNumeric(ws, attachment, Numerics.ERR_NOSUCHCHANNEL, [
        rawChannel,
        "No such channel",
      ]);
      return;
    }
    const isMember = summary.members.some((m) => m.sessionId === attachment.sessionId);
    if (!isMember && !attachment.isOper) {
      session.sendNumeric(ws, attachment, Numerics.ERR_NOTONCHANNEL, [
        rawChannel,
        "You're not on that channel",
      ]);
      return;
    }
    const info = await stub.getTopicInfo(rawChannel);
    if (!info.topic) {
      session.sendNumeric(ws, attachment, Numerics.RPL_NOTOPIC, [
        info.channelName,
        "No topic is set",
      ]);
    } else {
      session.sendNumeric(ws, attachment, Numerics.RPL_TOPIC, [info.channelName, info.topic]);
      if (info.topicSetBy && info.topicSetAt) {
        session.sendNumeric(ws, attachment, Numerics.RPL_TOPICWHOTIME, [
          info.channelName,
          info.topicSetBy,
          String(Math.floor(info.topicSetAt / 1000)),
        ]);
      }
    }
    return;
  }

  const newTopic = msg.params[1];
  const res = await stub.setTopic({
    channelName: rawChannel,
    sessionId: attachment.sessionId,
    nickname: attachment.nickname!,
    topic: newTopic,
    isOper: attachment.isOper,
    expectedGeneration,
  });

  if (!res.ok) {
    session.sendNumeric(ws, attachment, res.numeric ?? Numerics.ERR_CHANOPRIVSNEEDED, [
      rawChannel,
      res.errorText ?? "Cannot change topic",
    ]);
    return;
  }

  if (!expectedGeneration || (await stub.getExistingChannelGeneration()) !== expectedGeneration)
    return;

  const prefix = session.getUserPrefix(attachment);
  const nowIso = res.createdAt ? new Date(res.createdAt).toISOString() : new Date().toISOString();
  const topicTags: Record<string, string | true> = {
    ...(res.messageId ? { msgid: res.messageId } : {}),
    time: nowIso,
  };

  for (const sid of res.recipientSessionIds ?? []) {
    const targetSess = session.sessionsById.get(sid);
    if (targetSess) {
      session.sendChannelLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(targetSess.attachment, topicTags),
          prefix,
          command: "TOPIC",
          params: [res.channelName, newTopic],
        }),
        res.channelName,
        expectedGeneration,
      );
    }
  }
}

export async function handleMode(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
  isSamode: boolean = false,
): Promise<void> {
  if (msg.params.length < 1 || !msg.params[0]) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      [isSamode ? "SAMODE" : "MODE", "Not enough parameters"],
      labelTags,
    );
    return;
  }

  if (isSamode && !attachment.isOper) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOPRIVILEGES,
      ["Permission Denied - You're not an IRC operator"],
      labelTags,
    );
    return;
  }

  const target = msg.params[0];
  if (target.startsWith("#") || target.startsWith("&")) {
    const stub = session.getChannelStub(target);
    const expectedGeneration = await channelCommandGeneration(session, attachment, target);
    const modeString = msg.params[1];
    const modeArgs = msg.params.slice(2);

    if (modeString?.includes("f") && !modeString.startsWith("-")) {
      const forwardArg = modeArgs[0];
      if (!forwardArg || !isValidChannelName(forwardArg)) {
        session.sendNumeric(
          ws,
          attachment,
          Numerics.ERR_INVALIDMODEPARAM,
          [target, "f", forwardArg ?? "*", "Invalid channel name"],
          labelTags,
        );
        return;
      }
      if (canonicalizeIRCName(forwardArg) === canonicalizeIRCName(target)) {
        session.sendNumeric(
          ws,
          attachment,
          Numerics.ERR_INVALIDMODEPARAM,
          [target, "f", forwardArg, "You can't forward a channel to itself"],
          labelTags,
        );
        return;
      }
      const fwdStub = session.getChannelStub(forwardArg);
      const fwdVal = await fwdStub.validateForwardTarget(
        attachment.sessionId,
        attachment.isOper || isSamode,
      );
      if (!fwdVal.exists) {
        session.sendNumeric(
          ws,
          attachment,
          Numerics.ERR_INVALIDMODEPARAM,
          [target, "f", forwardArg, "No such channel"],
          labelTags,
        );
        return;
      }
      if (!fwdVal.isOp) {
        session.sendNumeric(
          ws,
          attachment,
          Numerics.ERR_CHANOPRIVSNEEDED,
          [forwardArg, "You must be a channel operator in the channel you are forwarding to"],
          labelTags,
        );
        return;
      }
    }

    const res = await stub.handleModeCommand({
      channelName: target,
      actorSessionId: attachment.sessionId,
      actorPrefix: session.getUserPrefix(attachment),
      modeString,
      modeArgs,
      isOper: attachment.isOper || isSamode,
      expectedGeneration,
    });

    if (!res.ok) {
      if (res.numeric === Numerics.ERR_USERNOTINCHANNEL && res.errorTarget) {
        const canonTarget = canonicalizeIRCName(res.errorTarget);
        if (!session.sessionsByNick.has(canonTarget)) {
          session.sendNumeric(
            ws,
            attachment,
            Numerics.ERR_NOSUCHNICK,
            [res.errorTarget, "No such nick/channel"],
            labelTags,
          );
          return;
        }
        session.sendNumeric(
          ws,
          attachment,
          Numerics.ERR_USERNOTINCHANNEL,
          [res.errorTarget, target, "They aren't on that channel"],
          labelTags,
        );
        return;
      }

      session.sendNumeric(
        ws,
        attachment,
        res.numeric ?? Numerics.ERR_CHANOPRIVSNEEDED,
        res.errorParams ?? [target, res.errorText ?? "Cannot set mode"],
        labelTags,
      );
      return;
    }

    if (!expectedGeneration || (await stub.getExistingChannelGeneration()) !== expectedGeneration)
      return;

    if (res.currentModes) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.RPL_CHANNELMODEIS,
        [res.channelName, res.currentModes, ...(res.modeParams ?? [])],
        labelTags,
      );
      if (res.createdAt) {
        session.sendNumeric(ws, attachment, Numerics.RPL_CREATIONTIME, [
          res.channelName,
          String(Math.floor(res.createdAt / 1000)),
        ]);
      }
      return;
    }

    if (res.banList) {
      const listType = res.listModeType ?? "b";
      const itemNumeric =
        listType === "e"
          ? Numerics.RPL_EXCEPTLIST
          : listType === "I"
            ? Numerics.RPL_INVITELIST
            : listType === "q"
              ? Numerics.RPL_QUIETLIST
              : Numerics.RPL_BANLIST;
      const endNumeric =
        listType === "e"
          ? Numerics.RPL_ENDOFEXCEPTLIST
          : listType === "I"
            ? Numerics.RPL_ENDOFINVITELIST
            : listType === "q"
              ? Numerics.RPL_ENDOFQUIETLIST
              : Numerics.RPL_ENDOFBANLIST;
      const endText =
        listType === "e"
          ? "End of Channel Exception List"
          : listType === "I"
            ? "End of Channel Invite Exception List"
            : listType === "q"
              ? "End of Channel Quiet List"
              : "End of Channel Ban List";

      for (const b of res.banList) {
        const params =
          listType === "q"
            ? [res.channelName, "q", b.mask, b.createdBy, String(Math.floor(b.createdAt / 1000))]
            : [res.channelName, b.mask, b.createdBy, String(Math.floor(b.createdAt / 1000))];
        session.sendNumeric(ws, attachment, itemNumeric, params, labelTags);
      }
      session.sendNumeric(
        ws,
        attachment,
        endNumeric,
        listType === "q" ? [res.channelName, "q", endText] : [res.channelName, endText],
        labelTags,
      );
      return;
    }

    if (res.appliedModeString) {
      const modeLine = encodeIRCMessage({
        prefix: session.getUserPrefix(attachment),
        command: "MODE",
        params: [res.channelName, res.appliedModeString, ...(res.appliedModeArgs ?? [])],
      });
      for (const sid of res.recipientSessionIds ?? []) {
        const targetSess = session.sessionsById.get(sid);
        if (targetSess) {
          session.sendChannelLine(
            targetSess.ws,
            targetSess.attachment,
            modeLine,
            res.channelName,
            expectedGeneration,
            !/[kf]/.test(res.appliedModeString),
          );
        }
      }
    }
  } else {
    const isSelf = canonicalizeIRCName(target) === canonicalizeIRCName(attachment.nickname!);
    if (!isSelf && !attachment.isOper && !isSamode) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_USERSDONTMATCH,
        ["Cant change mode for other users"],
        labelTags,
      );
      return;
    }
    const targetSess = isSelf ? { ws, attachment } : session.getAllSessionsForNick(target)[0];
    if (!targetSess) {
      session.sendNumeric(
        ws,
        attachment,
        Numerics.ERR_NOSUCHNICK,
        [target, "No such nick/channel"],
        labelTags,
      );
      return;
    }
    const modeArg = msg.params[1];
    if (modeArg) {
      let adding = true;
      let applied = "";
      let currentSign: "+" | "-" | null = null;
      const uSet = new Set((targetSess.attachment.userModes ?? "").split("").filter(Boolean));
      for (const ch of modeArg) {
        if (ch === "+") adding = true;
        else if (ch === "-") adding = false;
        else if (["i", "w", "B", "Z", "T", "R", "E", "s"].includes(ch)) {
          const had = uSet.has(ch);
          if (adding && !had) {
            uSet.add(ch);
            if (currentSign !== "+") {
              applied += "+";
              currentSign = "+";
            }
            applied += ch;
          } else if (!adding && had) {
            uSet.delete(ch);
            if (currentSign !== "-") {
              applied += "-";
              currentSign = "-";
            }
            applied += ch;
          }
        } else if (ch === "o" && !adding && targetSess.attachment.isOper) {
          targetSess.attachment.isOper = false;
          if (currentSign !== "-") {
            applied += "-";
            currentSign = "-";
          }
          applied += "o";
        }
      }
      targetSess.attachment.userModes = Array.from(uSet).join("");
      targetSess.attachment.isBot = uSet.has("B");
      session.saveAttachment(targetSess.ws, targetSess.attachment);

      const modePrefix = session.getUserPrefix(attachment);
      const modeChange = applied || modeArg;
      session.sendLine(
        targetSess.ws,
        targetSess.attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(targetSess.attachment, labelTags),
          prefix: modePrefix,
          command: "MODE",
          params: [targetSess.attachment.nickname!, modeChange],
        }),
      );
      if (!isSelf) {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: modePrefix,
            command: "MODE",
            params: [targetSess.attachment.nickname!, modeChange],
          }),
        );
      }
      return;
    }
    const umodes = `+${targetSess.attachment.userModes ?? ""}${targetSess.attachment.accountName ? "r" : ""}${targetSess.attachment.isOper ? "o" : ""}`;
    session.sendNumeric(ws, attachment, Numerics.RPL_UMODEIS, [umodes], labelTags);
  }
}

export async function handleKick(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  if (msg.params.length < 2) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "KICK",
      "Not enough parameters",
    ]);
    return;
  }

  const rawChannels = msg.params[0].split(",");
  const rawUsers = msg.params[1].split(",");
  if (rawChannels.length !== rawUsers.length && rawUsers.length !== 1 && rawChannels.length !== 1) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "KICK",
      "Not enough parameters",
    ]);
    return;
  }

  const kicks: Array<{ channel: string; targetNick: string }> = [];
  if (rawUsers.length === 1) {
    const user = rawUsers[0].trim();
    for (const ch of rawChannels) {
      const c = ch.trim();
      if (c) kicks.push({ channel: c, targetNick: user });
    }
  } else {
    let ch = rawChannels[0].trim();
    for (let i = 0; i < rawUsers.length; i++) {
      if (rawChannels.length > 1) {
        ch = rawChannels[i].trim();
      }
      const user = rawUsers[i].trim();
      if (ch && user) kicks.push({ channel: ch, targetNick: user });
    }
  }

  const reason = msg.params[2] ?? attachment.nickname!;

  for (const { channel, targetNick } of kicks) {
    const stub = session.getChannelStub(channel);
    const expectedGeneration = await channelCommandGeneration(session, attachment, channel);
    const res = await stub.kickMember({
      channelName: channel,
      actorSessionId: attachment.sessionId,
      targetNick,
      reason,
      isOper: attachment.isOper,
      expectedGeneration,
    });

    if (!res.ok) {
      session.sendNumeric(ws, attachment, res.numeric ?? Numerics.ERR_CHANOPRIVSNEEDED, [
        channel,
        res.errorText ?? "Cannot kick user",
      ]);
      continue;
    }

    if (!expectedGeneration || (await stub.getExistingChannelGeneration()) !== expectedGeneration)
      continue;

    if (res.kickedSessionId) {
      session.sql.exec(
        "DELETE FROM session_channels WHERE session_id = ? AND canonical_channel = ? AND generation = ?",
        res.kickedSessionId,
        canonicalizeIRCName(res.channelName),
        expectedGeneration,
      );
    }

    const kickLine = encodeIRCMessage({
      prefix: session.getUserPrefix(attachment),
      command: "KICK",
      params: [res.channelName, res.kickedNick ?? targetNick, reason],
    });
    const removedSessionIds = new Set(res.removedSessionIds ?? []);

    for (const sid of res.recipientSessionIds ?? []) {
      const targetSess = session.sessionsById.get(sid);
      if (targetSess) {
        const removed = removedSessionIds.has(sid);
        if (removed && targetSess.attachment.userId !== res.kickedUserId) continue;
        session.sendChannelLine(
          targetSess.ws,
          targetSess.attachment,
          kickLine,
          res.channelName,
          expectedGeneration,
          removed,
        );
      }
    }
  }
}

export async function handleInvite(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  if (msg.params.length === 0) {
    const _canonNick = canonicalizeIRCName(attachment.nickname ?? "");
    const rows = session.sql
      .exec<{ channel_name: string; generation: string | null }>(
        "SELECT channel_name,generation FROM session_invites WHERE target_user_id = ? AND created_at > ?",
        attachment.userId,
        Date.now() - 24 * 60 * 60 * 1000,
      )
      .toArray();
    for (const row of rows) {
      if (!row.generation) continue;
      const snapshot = await session
        .getChannelStub(row.channel_name)
        .getInvitationSnapshot(attachment.userId);
      if (!snapshot.invited || snapshot.generation !== row.generation) continue;
      session.sendNumeric(ws, attachment, "336", [row.channel_name]);
    }
    session.sendNumeric(ws, attachment, "337", ["End of /INVITE list"]);
    return;
  }

  if (msg.params.length < 2) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "INVITE",
      "Not enough parameters",
    ]);
    return;
  }

  const targetNick = msg.params[0];
  const rawChannel = msg.params[1];

  const targetSessions = session.getAllSessionsForNick(targetNick);
  if (targetSessions.length === 0) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NOSUCHNICK, [
      targetNick,
      "No such nick/channel",
    ]);
    return;
  }

  const targetSess = targetSessions[0];
  const stub = session.getChannelStub(rawChannel);
  const expectedGeneration = await channelCommandGeneration(session, attachment, rawChannel);
  const res = await stub.inviteUser({
    channelName: rawChannel,
    actorSessionId: attachment.sessionId,
    actorNick: attachment.nickname!,
    targetNick: targetSess.attachment.nickname!,
    targetUserId: targetSess.attachment.userId,
    isOper: attachment.isOper,
    expectedGeneration,
  });

  if (!res.ok) {
    if (res.numeric === Numerics.ERR_USERONCHANNEL) {
      session.sendNumeric(ws, attachment, Numerics.ERR_USERONCHANNEL, [
        targetSess.attachment.nickname!,
        rawChannel,
        res.errorText ?? "is already on channel",
      ]);
      return;
    }
    session.sendNumeric(ws, attachment, res.numeric ?? Numerics.ERR_CHANOPRIVSNEEDED, [
      rawChannel,
      res.errorText ?? "Cannot invite user",
    ]);
    return;
  }

  if (!expectedGeneration || (await stub.getExistingChannelGeneration()) !== expectedGeneration)
    return;

  session.sendNumeric(ws, attachment, Numerics.RPL_INVITING, [
    targetSess.attachment.nickname!,
    res.channelName,
  ]);

  session.sql.exec(
    `INSERT INTO session_invites (canon_nick, channel_name, created_at, target_user_id, generation)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(canon_nick, channel_name) DO UPDATE SET created_at = excluded.created_at, target_user_id = excluded.target_user_id, generation = excluded.generation`,
    canonicalizeIRCName(targetNick),
    res.channelName,
    Date.now(),
    targetSess.attachment.userId,
    expectedGeneration,
  );

  const inviteTags: Record<string, string | true> = {
    ...(attachment.accountName ? { account: attachment.accountName } : {}),
    time: new Date().toISOString(),
  };

  for (const ts of targetSessions) {
    session.sendLine(
      ts.ws,
      ts.attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(ts.attachment, inviteTags),
        prefix: session.getUserPrefix(attachment),
        command: "INVITE",
        params: [targetSess.attachment.nickname!, res.channelName],
      }),
    );
  }

  // Broadcast invite-notify to channel members who negotiated invite-notify
  for (const sid of res.memberSessionIds ?? []) {
    if (sid === attachment.sessionId) continue;
    const memberSess = session.sessionsById.get(sid);
    if (memberSess && session.hasCap(memberSess.attachment, "invite-notify")) {
      session.sendLine(
        memberSess.ws,
        memberSess.attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(memberSess.attachment, inviteTags),
          prefix: session.getUserPrefix(attachment),
          command: "INVITE",
          params: [targetSess.attachment.nickname!, res.channelName],
        }),
      );
    }
  }
}

export async function handleUninvite(
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
      ["UNINVITE", "Not enough parameters"],
      labelTags,
    );
    return;
  }
  const targetNick = msg.params[0];
  const rawChannel = msg.params[1];
  const stub = session.getChannelStub(rawChannel);
  const expectedGeneration = await channelCommandGeneration(session, attachment, rawChannel);
  // Resolve the current nick before consulting historical invitation names: a
  // reused nickname must never revoke a different account's invitation.
  let targetUserId: string | undefined =
    session.getAllSessionsForNick(targetNick)[0]?.attachment.userId;
  targetUserId ??= (await session.getAccountsStub().getNickOwner(targetNick)) ?? undefined;
  if (!targetUserId) {
    const invitation = session.sql
      .exec<{ channel_name: string; target_user_id: string | null; generation: string | null }>(
        "SELECT channel_name, target_user_id, generation FROM session_invites WHERE canon_nick = ?",
        canonicalizeIRCName(targetNick),
      )
      .toArray()
      .find(
        (row) =>
          row.generation === expectedGeneration &&
          canonicalizeIRCName(row.channel_name) === canonicalizeIRCName(rawChannel),
      );
    targetUserId = invitation?.target_user_id ?? undefined;
  }
  const res = await stub.uninviteUser({
    channelName: rawChannel,
    actorSessionId: attachment.sessionId,
    targetNick,
    targetUserId,
    isOper: attachment.isOper,
    expectedGeneration,
  });
  if (!res.ok) {
    session.sendNumeric(
      ws,
      attachment,
      res.numeric ?? Numerics.ERR_CHANOPRIVSNEEDED,
      [rawChannel, res.errorText ?? "Cannot uninvite user"],
      labelTags,
    );
    return;
  }
  if (!expectedGeneration || (await stub.getExistingChannelGeneration()) !== expectedGeneration)
    return;
  if (targetUserId) {
    session.sql.exec(
      "DELETE FROM session_invites WHERE channel_name = ? AND generation = ? AND (target_user_id = ? OR (target_user_id IS NULL AND canon_nick = ?))",
      res.channelName,
      expectedGeneration,
      targetUserId,
      canonicalizeIRCName(targetNick),
    );
  } else {
    session.sql.exec(
      "DELETE FROM session_invites WHERE canon_nick = ? AND channel_name = ? AND generation = ?",
      canonicalizeIRCName(targetNick),
      res.channelName,
      expectedGeneration,
    );
  }
  session.sendAck(ws, attachment, labelTags);
}

export async function handleList(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg?: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  session.sendNumeric(ws, attachment, Numerics.RPL_LISTSTART, ["Channel", "Users  Name"]);

  const filters = (msg?.params[0] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const rows = session.sql
    .exec<{ channel_name: string }>("SELECT DISTINCT channel_name FROM session_channels")
    .toArray();

  const clientChannels = session.getSessionChannels(attachment.sessionId);
  const clientChanSet = new Set(clientChannels.map((c) => c.canonicalChannel));

  for (const row of rows) {
    const stub = session.getChannelStub(row.channel_name);
    const summary = await stub.getChannelSummary(row.channel_name);
    const isMember = clientChanSet.has(canonicalizeIRCName(summary.name));
    if (
      SERVER_CONFIG.requireAccounts &&
      !(await stub.canReadAccount({
        id: attachment.userId,
        username: attachment.accountName ?? "",
        isAdmin: attachment.isOper,
      }))
    )
      continue;

    // Conceal secret channels (+s) from non-members
    if (summary.modes.includes("s") && !isMember) {
      continue;
    }

    // Conceal private channels (+p) topic from non-members
    const topic = summary.modes.includes("p") && !isMember ? "" : (summary.topic ?? "");

    // Evaluate ELIST and channel mask filters
    if (filters.length > 0) {
      let matches = true;
      for (const f of filters) {
        if (f.startsWith(">")) {
          const min = parseInt(f.slice(1), 10);
          if (!Number.isNaN(min) && summary.memberCount <= min) {
            matches = false;
            break;
          }
        } else if (f.startsWith("<")) {
          const max = parseInt(f.slice(1), 10);
          if (!Number.isNaN(max) && summary.memberCount >= max) {
            matches = false;
            break;
          }
        } else if (f.startsWith("!")) {
          const mask = f.slice(1);
          if (matchesWildcard(canonicalizeIRCName(mask), canonicalizeIRCName(summary.name))) {
            matches = false;
            break;
          }
        } else {
          if (!matchesWildcard(canonicalizeIRCName(f), canonicalizeIRCName(summary.name))) {
            matches = false;
            break;
          }
        }
      }
      if (!matches) {
        continue;
      }
    }

    session.sendNumeric(ws, attachment, Numerics.RPL_LIST, [
      summary.name,
      String(summary.memberCount),
      topic,
    ]);
  }

  session.sendNumeric(ws, attachment, Numerics.RPL_LISTEND, ["End of /LIST"], labelTags);
}
