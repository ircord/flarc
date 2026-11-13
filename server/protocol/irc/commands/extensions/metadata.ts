import { SERVER_CONFIG } from "~/core/config";
import type { ChannelMemberInfo, ChannelStateSummary, SessionAttachment } from "~/core/types";
import { encodeIRCMessage, encodeNumeric } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

export async function handleMetadata(
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
      ["METADATA", "Not enough parameters"],
      labelTags,
    );
    return;
  }

  const rawTarget = msg.params[0];
  const subcmd = msg.params[1].toUpperCase();
  const args = msg.params.slice(2);
  const target = rawTarget === "*" ? (attachment.nickname ?? "*") : rawTarget;
  const isChannel = target.startsWith("#") || target.startsWith("&");

  const accountsStub = session.getAccountsStub();
  const getUserMetaKey = (nick: string): string => {
    const sess = session.getAllSessionsForNick(nick)[0];
    return sess?.attachment.accountName ?? canonicalizeIRCName(nick);
  };

  const visibleMetadata = async (key: string, keys?: string[]) => {
    if (attachment.authenticated)
      return (
        await session.featureRequest({ ircSessionId: attachment.sessionId }, "metadata.get", {
          target: key,
          keys,
        })
      ).metadata as Record<string, string>;
    const values = await accountsStub.getMetadata(key, keys);
    return Object.fromEntries(
      Object.entries(values).filter(([name]) => !name.startsWith("private:")),
    );
  };
  const mutateMetadata = async (key: string, value: string | null) => {
    if (!attachment.authenticated) {
      if (key.startsWith("private:")) throw new Error("Private metadata requires authentication");
      return accountsStub.setMetadata(getUserMetaKey(target), key, value);
    }
    const revision = msg.tags["+draft/profile-revision"];
    if (revision !== undefined && (typeof revision !== "string" || !/^\d+$/.test(revision)))
      throw new Error("Invalid profile revision");
    return session.featureRequest({ ircSessionId: attachment.sessionId }, "metadata.update", {
      target: getUserMetaKey(target),
      key,
      value,
      expectedRevision: revision === undefined ? undefined : Number(revision),
      clientOperationId: msg.tags["+draft/client-operation-id"],
    });
  };
  if (subcmd === "SUB") {
    const subs = new Set(attachment.metadataSubs ?? []);
    for (const key of args) {
      const cleanKey = key.toLowerCase();
      if (
        cleanKey.startsWith("private:") &&
        (!attachment.authenticated ||
          (rawTarget !== "*" && getUserMetaKey(target) !== attachment.accountName))
      ) {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: ["METADATA", "KEY_NO_PERMISSION", cleanKey, "Private metadata is owner-only"],
          }),
        );
        continue;
      }
      subs.add(cleanKey);
      session.sendNumeric(ws, attachment, Numerics.RPL_METADATASUBOK, [cleanKey], labelTags);
    }
    attachment.metadataSubs = Array.from(subs);
    session.saveAttachment(ws, attachment);
    return;
  }

  if (subcmd === "UNSUB") {
    const subs = new Set(attachment.metadataSubs ?? []);
    for (const key of args) {
      const cleanKey = key.toLowerCase();
      subs.delete(cleanKey);
      session.sendNumeric(ws, attachment, Numerics.RPL_METADATAUNSUBOK, [cleanKey], labelTags);
    }
    attachment.metadataSubs = Array.from(subs);
    session.saveAttachment(ws, attachment);
    return;
  }

  if (subcmd === "SUBS") {
    for (const key of attachment.metadataSubs ?? []) {
      session.sendNumeric(ws, attachment, Numerics.RPL_METADATASUBS, [key], labelTags);
    }
    session.sendNumeric(ws, attachment, Numerics.RPL_METADATAEND, ["End of metadata"], labelTags);
    return;
  }

  // Target validation & channel permission checks
  let channelSummary: ChannelStateSummary | null = null;
  const readGenerations = new Map<string, string>();
  const requestedMetadataLine = (socket: WebSocket, actor: SessionAttachment, line: string) => {
    const numeric = line.match(/ (?:761|766) \S+ (\S+) (\S+)/);
    if (!numeric) {
      session.sendLine(socket, actor, line);
      return;
    }
    const context = {
      key: numeric[2],
      requested: true,
      sourceUserId: actor.userId,
      ...(/^[#&]/.test(numeric[1])
        ? {
            channel: numeric[1],
            channelGeneration:
              readGenerations.get(canonicalizeIRCName(numeric[1])) ?? channelSummary?.generation,
          }
        : {}),
    };
    (
      session.sendLine as (
        socket: WebSocket,
        actor: SessionAttachment,
        line: string,
        context: unknown,
      ) => void
    )(socket, actor, line, context);
  };

  if (isChannel) {
    const channelStub = session.getChannelStub(target);
    channelSummary = await channelStub.getChannelSummary(target);
    if (channelSummary.memberCount === 0 && !channelSummary.registered) {
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: ["METADATA", "INVALID_TARGET", target, "Target does not exist"],
        }),
      );
      return;
    }

    // Check +i invite-only channel access for non-members
    const callerMember = channelSummary.members.find((m) => m.sessionId === attachment.sessionId);
    if (
      !(await channelStub.canReadAccount({
        id: attachment.userId,
        username: attachment.accountName ?? "",
        isAdmin: attachment.isOper,
      }))
    ) {
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: [
            "METADATA",
            "KEY_NO_PERMISSION",
            target,
            args[0] ?? "*",
            "Cannot view metadata on invite-only channel",
          ],
        }),
      );
      return;
    }

    // Setting / clearing channel metadata requires chanop
    if (subcmd === "SET" || subcmd === "CLEAR") {
      const isOp =
        attachment.isOper ||
        (callerMember &&
          (callerMember.modes.includes("o") ||
            callerMember.modes.includes("a") ||
            callerMember.modes.includes("q")));
      if (!isOp) {
        requestedMetadataLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: ["METADATA", "KEY_NO_PERMISSION", target, args[0] ?? "*", "Permission denied"],
          }),
        );
        return;
      }
    }
  } else if (!(subcmd === "SYNC" && rawTarget.toUpperCase() === "*ALL")) {
    // User target
    const isSelf =
      rawTarget === "*" ||
      (attachment.nickname &&
        canonicalizeIRCName(target) === canonicalizeIRCName(attachment.nickname));
    const sessions = session.getAllSessionsForNick(target);
    if (sessions.length === 0 && !isSelf && !(!attachment.registered && rawTarget === "*")) {
      const acct = await accountsStub.getAccountByUsername(target);
      if (!acct) {
        requestedMetadataLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: ["METADATA", "INVALID_TARGET", target, "Target does not exist"],
          }),
        );
        return;
      }
    }

    if (subcmd === "SET" || subcmd === "CLEAR") {
      if (!isSelf && !attachment.isOper) {
        requestedMetadataLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: ["METADATA", "KEY_NO_PERMISSION", target, args[0] ?? "*", "Permission denied"],
          }),
        );
        return;
      }
    }
  }

  const directNumeric = session.sendNumeric.bind(session);
  const requestedNumeric = (
    socket: WebSocket,
    actor: SessionAttachment,
    numeric: string,
    params: string[],
    tags?: Record<string, string | true>,
  ) => {
    if (numeric !== Numerics.RPL_KEYVALUE && numeric !== Numerics.RPL_KEYNOTSET) {
      directNumeric(socket, actor, numeric, params, tags);
      return;
    }
    directNumeric(socket, actor, numeric, params, tags, {
      key: params[1] ?? "*",
      requested: true,
      sourceUserId: actor.userId,
      ...(isChannel ? { channel: target, channelGeneration: channelSummary?.generation } : {}),
    });
  };
  const channelMetadata = async (keys?: string[]) => {
    const stub = session.getChannelStub(target),
      generation = channelSummary?.generation;
    const values = await stub.getChannelMetadata(keys);
    if (!generation || (await stub.getExistingChannelGeneration()) !== generation)
      throw new Error("Channel generation changed");
    return values;
  };
  const hasBatch = session.hasCap(attachment, "batch");

  if (subcmd === "SET") {
    const key = (args[0] ?? "").toLowerCase();
    const value = args[1] ?? "";
    if (!key || !/^[a-zA-Z0-9_.:/-]+$/.test(key)) {
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: ["METADATA", "KEY_INVALID", key || "*", "Invalid metadata key"],
        }),
      );
      return;
    }

    // Check UTF-8 validity & length limits
    const byteLen = new TextEncoder().encode(value).length;
    if (byteLen > 400 || value.includes("\uFFFD")) {
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: ["METADATA", "INVALID_VALUE", key, "Invalid metadata value"],
        }),
      );
      return;
    }

    if (key.startsWith("private:") && !attachment.authenticated) {
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: [
            "METADATA",
            "KEY_NO_PERMISSION",
            key,
            "Private metadata requires authentication",
          ],
        }),
      );
      return;
    }
    if (!attachment.registered && rawTarget === "*") {
      attachment.preRegMetadata = attachment.preRegMetadata ?? {};
      attachment.preRegMetadata[key] = value;
      session.saveAttachment(ws, attachment);
      if (value) {
        requestedMetadataLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: Numerics.RPL_KEYVALUE,
            params: [attachment.nickname ?? "*", "*", key, "*", value],
          }),
        );
      } else {
        requestedMetadataLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: Numerics.RPL_KEYNOTSET,
            params: [attachment.nickname ?? "*", "*", key, "Key is not set"],
          }),
        );
      }
      return;
    }

    if (isChannel) {
      const stub = session.getChannelStub(target);
      await stub.setChannelMetadata(key, value || null, channelSummary?.generation);
    } else {
      await mutateMetadata(key, value || null);
    }

    if (value) {
      requestedNumeric(ws, attachment, Numerics.RPL_KEYVALUE, [target, key, "*", value], labelTags);
    } else {
      requestedNumeric(
        ws,
        attachment,
        Numerics.RPL_KEYNOTSET,
        [target, key, "Key is not set"],
        labelTags,
      );
    }

    // Notify subscribed peers in shared channels (do NOT send to actor)
    if (isChannel || !attachment.authenticated)
      await broadcastMetadataChange(session, attachment, target, key, value);
    return;
  }

  if (subcmd === "GET") {
    const data = isChannel
      ? await channelMetadata(args)
      : await visibleMetadata(getUserMetaKey(target), args);

    if (hasBatch) {
      const batchId = crypto.randomUUID().slice(0, 8);
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`+${batchId}`, "metadata", target],
        }),
      );
      for (const reqKey of args) {
        const lk = reqKey.toLowerCase();
        if (Object.hasOwn(data, lk)) {
          requestedMetadataLine(
            ws,
            attachment,
            encodeIRCMessage({
              tags: session.filterOutgoingTags(attachment, { batch: batchId }),
              prefix: SERVER_CONFIG.serverName,
              command: Numerics.RPL_KEYVALUE,
              params: [attachment.nickname!, target, lk, "*", data[lk]],
            }),
          );
        } else {
          requestedMetadataLine(
            ws,
            attachment,
            encodeIRCMessage({
              tags: session.filterOutgoingTags(attachment, { batch: batchId }),
              prefix: SERVER_CONFIG.serverName,
              command: Numerics.RPL_KEYNOTSET,
              params: [attachment.nickname!, target, lk, "Key is not set"],
            }),
          );
        }
      }
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`-${batchId}`],
        }),
      );
    } else {
      for (const reqKey of args) {
        const lk = reqKey.toLowerCase();
        if (Object.hasOwn(data, lk)) {
          requestedNumeric(
            ws,
            attachment,
            Numerics.RPL_KEYVALUE,
            [target, lk, "*", data[lk]],
            labelTags,
          );
        } else {
          requestedNumeric(
            ws,
            attachment,
            Numerics.RPL_KEYNOTSET,
            [target, lk, "Key is not set"],
            labelTags,
          );
        }
      }
      requestedNumeric(ws, attachment, Numerics.RPL_METADATAEND, ["End of metadata"], labelTags);
    }
    return;
  }

  if (subcmd === "LIST") {
    const data = isChannel
      ? await channelMetadata()
      : await visibleMetadata(getUserMetaKey(target));

    if (hasBatch) {
      const batchId = crypto.randomUUID().slice(0, 8);
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`+${batchId}`, "metadata", target],
        }),
      );
      for (const [k, v] of Object.entries(data)) {
        requestedMetadataLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, { batch: batchId }),
            prefix: SERVER_CONFIG.serverName,
            command: Numerics.RPL_KEYVALUE,
            params: [attachment.nickname!, target, k, "*", v],
          }),
        );
      }
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`-${batchId}`],
        }),
      );
    } else {
      for (const [k, v] of Object.entries(data)) {
        requestedNumeric(ws, attachment, Numerics.RPL_KEYVALUE, [target, k, "*", v], labelTags);
      }
      requestedNumeric(ws, attachment, Numerics.RPL_METADATAEND, ["End of metadata"], labelTags);
    }
    return;
  }

  if (subcmd === "CLEAR") {
    const cleared = isChannel
      ? await session.getChannelStub(target).clearChannelMetadata(channelSummary?.generation)
      : await (async () => {
          const keys = Object.keys(await visibleMetadata(getUserMetaKey(target)));
          for (const key of keys) await mutateMetadata(key, null);
          return keys;
        })();

    if (hasBatch) {
      const batchId = crypto.randomUUID().slice(0, 8);
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`+${batchId}`, "metadata", target],
        }),
      );
      for (const k of cleared) {
        requestedMetadataLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, { batch: batchId }),
            prefix: SERVER_CONFIG.serverName,
            command: Numerics.RPL_KEYNOTSET,
            params: [attachment.nickname!, target, k, "Key is not set"],
          }),
        );
      }
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`-${batchId}`],
        }),
      );
    } else {
      for (const k of cleared) {
        requestedNumeric(
          ws,
          attachment,
          Numerics.RPL_KEYNOTSET,
          [target, k, "Key is not set"],
          labelTags,
        );
      }
      requestedNumeric(ws, attachment, Numerics.RPL_METADATAEND, ["End of metadata"], labelTags);
    }

    for (const k of cleared) {
      if (isChannel || !attachment.authenticated)
        await broadcastMetadataChange(session, attachment, target, k, "");
    }
    return;
  }

  if (subcmd === "SYNC") {
    const batchId = crypto.randomUUID().slice(0, 8);
    const supportsBatch = session.hasCap(attachment, "batch");
    const subs = attachment.metadataSubs ?? [];
    const filterKeys = subs.length > 0 ? subs : undefined;

    const entries: Array<{ subject: string; key: string; value: string }> = [];
    if (rawTarget.toUpperCase() === "*ALL") {
      const seenSubjects = new Set<string>();
      const addUserSubject = async (nick: string, accountName?: string | null) => {
        const canon = canonicalizeIRCName(nick);
        if (seenSubjects.has(canon)) return;
        seenSubjects.add(canon);
        const metaKey = accountName ?? canon;
        const uData = await visibleMetadata(metaKey, filterKeys);
        for (const [k, v] of Object.entries(uData)) {
          entries.push({ subject: nick, key: k, value: v });
        }
      };
      if (attachment.nickname) {
        await addUserSubject(attachment.nickname, attachment.accountName);
      }
      for (const ch of session.getSessionChannels(attachment.sessionId)) {
        const stub = session.getChannelStub(ch.channelName);
        const summary = await stub.getChannelSummary(ch.channelName);
        if (!ch.generation || summary.generation !== ch.generation) continue;
        readGenerations.set(canonicalizeIRCName(summary.name), ch.generation);
        const chanData = await stub.getChannelMetadata(filterKeys);
        for (const [k, v] of Object.entries(chanData)) {
          entries.push({ subject: summary.name, key: k, value: v });
        }
        for (const m of summary.members) {
          await addUserSubject(m.nickname, m.accountName);
        }
      }
    } else if (isChannel) {
      const stub = session.getChannelStub(target);
      const summary = await stub.getChannelSummary(target);
      if (summary.generation !== channelSummary?.generation)
        throw new Error("Channel generation changed");
      readGenerations.set(canonicalizeIRCName(summary.name), summary.generation!);
      const chanData = await stub.getChannelMetadata(filterKeys);
      for (const [k, v] of Object.entries(chanData)) {
        entries.push({ subject: summary.name, key: k, value: v });
      }
      for (const m of summary.members) {
        const metaKey = m.accountName ?? canonicalizeIRCName(m.nickname);
        const mData = await visibleMetadata(metaKey, filterKeys);
        for (const [k, v] of Object.entries(mData)) {
          entries.push({ subject: m.nickname, key: k, value: v });
        }
      }
    } else {
      const uData = await visibleMetadata(getUserMetaKey(target), filterKeys);
      for (const [k, v] of Object.entries(uData)) {
        entries.push({ subject: target, key: k, value: v });
      }
    }

    const batchTarget = rawTarget.toUpperCase() === "*ALL" ? "*ALL" : target;

    if (supportsBatch) {
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`+${batchId}`, "metadata", batchTarget],
        }),
      );
    }

    for (const item of entries) {
      // Emit Ergo-standard RPL_KEYVALUE (761) with "*" as target client parameter
      requestedMetadataLine(
        ws,
        attachment,
        encodeNumeric(
          Numerics.RPL_KEYVALUE,
          "*",
          [item.subject, item.key, "*", item.value],
          session.filterOutgoingTags(attachment, supportsBatch ? { batch: batchId } : labelTags),
        ),
      );
    }

    if (supportsBatch) {
      requestedMetadataLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "BATCH",
          params: [`-${batchId}`],
        }),
      );
    } else {
      requestedNumeric(ws, attachment, Numerics.RPL_METADATAEND, ["End of metadata"], labelTags);
    }
  }
}

export async function broadcastMetadataChange(
  session: ISessionDO,
  actor: SessionAttachment,
  target: string,
  key: string,
  value: string,
): Promise<void> {
  const isChannel = target.startsWith("#") || target.startsWith("&");
  let recipientSessionIds: Set<string>;

  if (isChannel) {
    const channelStub = session.getChannelStub(target);
    const members = await channelStub.getMembers();
    recipientSessionIds = new Set(members.map((m) => m.sessionId));
  } else {
    recipientSessionIds = await session.getSharedChannelSessions(actor.sessionId);
  }

  const cleanKey = key.toLowerCase();

  for (const sid of recipientSessionIds) {
    if (
      sid === actor.sessionId ||
      (key.startsWith("private:") &&
        session.sessionsById.get(sid)?.attachment.userId !== actor.userId)
    )
      continue;
    const sess = session.sessionsById.get(sid);
    if (!sess) continue;
    if (
      !session.hasCap(sess.attachment, "draft/metadata-3") &&
      !session.hasCap(sess.attachment, "draft/metadata-2")
    ) {
      continue;
    }
    const subs = sess.attachment.metadataSubs ?? [];
    if (subs.length > 0 && (subs.includes(cleanKey) || subs.includes("*"))) {
      if (value) {
        session.sendNumeric(
          sess.ws,
          sess.attachment,
          Numerics.RPL_KEYVALUE,
          [target, key, "*", value],
          undefined,
          isChannel
            ? { key: cleanKey, channel: target }
            : {
                key: cleanKey,
                sourceSessionId: actor.sessionId,
                sourceUserId: actor.userId,
                sourceNick: actor.nickname ?? undefined,
              },
        );
      } else {
        session.sendNumeric(
          sess.ws,
          sess.attachment,
          Numerics.RPL_KEYNOTSET,
          [target, key, "Key is not set"],
          undefined,
          isChannel
            ? { key: cleanKey, channel: target }
            : {
                key: cleanKey,
                sourceSessionId: actor.sessionId,
                sourceUserId: actor.userId,
                sourceNick: actor.nickname ?? undefined,
              },
        );
      }
    }
  }
}

export async function syncChannelMemberMetadataOnJoin(
  session: ISessionDO,
  ws: WebSocket,
  joiner: SessionAttachment,
  channelName: string,
  members: ChannelMemberInfo[],
): Promise<void> {
  const joinerHasMeta =
    session.hasCap(joiner, "draft/metadata-3") || session.hasCap(joiner, "draft/metadata-2");
  const joinerSubs = joiner.metadataSubs ?? [];

  const accountsStub = session.getAccountsStub();

  // 1. Send channel's own metadata to joiner if joiner is subscribed
  if (joinerHasMeta && joinerSubs.length > 0) {
    const chanMeta = await session.getChannelStub(channelName).getChannelMetadata(joinerSubs);
    for (const [k, v] of Object.entries(chanMeta)) {
      session.sendNumeric(ws, joiner, Numerics.RPL_KEYVALUE, [channelName, k, "*", v], undefined, {
        key: k.toLowerCase(),
        channel: channelName,
      });
    }
  }

  // 2. Send other members' metadata to joiner
  if (joinerHasMeta && joinerSubs.length > 0) {
    for (const m of members) {
      if (m.sessionId === joiner.sessionId) continue;
      const metaKey = m.accountName ?? canonicalizeIRCName(m.nickname);
      const data = Object.fromEntries(
        Object.entries(await accountsStub.getMetadata(metaKey, joinerSubs)).filter(
          ([key]) => !key.startsWith("private:") || m.userId === joiner.userId,
        ),
      );
      for (const [k, v] of Object.entries(data)) {
        session.sendNumeric(ws, joiner, Numerics.RPL_KEYVALUE, [m.nickname, k, "*", v], undefined, {
          key: k.toLowerCase(),
          sourceSessionId: m.sessionId,
          sourceUserId: m.userId,
          sourceNick: m.nickname,
        });
      }
    }
  }

  // 3. Send joiner's metadata to other channel members who are subscribed
  if (joiner.nickname) {
    const joinerMetaKey = joiner.accountName ?? canonicalizeIRCName(joiner.nickname);
    const joinerData = Object.fromEntries(
      Object.entries(await accountsStub.getMetadata(joinerMetaKey)).filter(
        ([key]) => !key.startsWith("private:"),
      ),
    );
    const joinerEntries = Object.entries(joinerData);
    if (joinerEntries.length > 0) {
      for (const m of members) {
        if (m.sessionId === joiner.sessionId) continue;
        const peerSess = session.sessionsById.get(m.sessionId);
        if (!peerSess) continue;
        if (
          !session.hasCap(peerSess.attachment, "draft/metadata-3") &&
          !session.hasCap(peerSess.attachment, "draft/metadata-2")
        ) {
          continue;
        }
        const peerSubs = peerSess.attachment.metadataSubs ?? [];
        if (peerSubs.length === 0) continue;
        for (const [k, v] of joinerEntries) {
          if (peerSubs.includes(k.toLowerCase())) {
            session.sendNumeric(
              peerSess.ws,
              peerSess.attachment,
              Numerics.RPL_KEYVALUE,
              [joiner.nickname, k, "*", v],
              undefined,
              {
                key: k.toLowerCase(),
                sourceSessionId: joiner.sessionId,
                sourceUserId: joiner.userId,
                sourceNick: joiner.nickname,
              },
            );
          }
        }
      }
    }
  }
}
