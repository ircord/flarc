import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import type { IRCMessage } from "~/protocol/irc/types";
import {
  handleAuthenticate,
  handleCap,
  handleNick,
  handlePass,
  handleQuit,
  handleRegisterCommand,
  handleUser,
  handleVerifyCommand,
} from "./auth";
import {
  handleInvite,
  handleJoin,
  handleKick,
  handleList,
  handleMode,
  handleNames,
  handlePart,
  handleTopic,
  handleUninvite,
} from "./channel";
import {
  handleAcceptCommand,
  handleAway,
  handleChathistory,
  handleHistoryCommand,
  handleIsupportCommand,
  handleLanguageCommand,
  handleMarkread,
  handleMetadata,
  handleMonitor,
  handlePersistence,
  handleRoleplayCommand,
  handleSearch,
  handleWebpush,
} from "./extensions";
import {
  handleClientBatch,
  handlePrivmsgOrNotice,
  handleRedact,
  handleRelaymsg,
  handleTagmsg,
} from "./messaging";
import {
  handleChghost,
  handleDeoperCommand,
  handleKillCommand,
  handleOperCommand,
  handleRename,
  handleSajoinCommand,
  handleSanickCommand,
  handleSetname,
} from "./oper";
import {
  handleHelpCommand,
  handleInfoCommand,
  handleIson,
  handleLinks,
  handlePing,
  handleTime,
  handleUserhost,
  handleVersion,
  handleWallops,
  handleWho,
  handleWhoami,
  handleWhois,
  handleWhowas,
} from "./queries";
import {
  handleBouncerCommand,
  handleChanServ,
  handleFBot,
  handleHistServ,
  handleHostServ,
  handleNickServ,
  handleZncCommand,
} from "./services";
import type { ISessionDO } from "./types";

export async function dispatchIRCCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  const cmd = msg.command;
  if (
    SERVER_CONFIG.requireAccounts &&
    !attachment.registered &&
    !new Set([
      "CAP",
      "AUTHENTICATE",
      "PASS",
      "NICK",
      "USER",
      "REGISTER",
      "VERIFY",
      "PING",
      "PONG",
      "QUIT",
      "WEBIRC",
    ]).has(cmd)
  ) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NOTREGISTERED, [
      "Authenticate before using this command",
    ]);
    return;
  }
  if (attachment.registered && attachment.authenticated && attachment.accountName) {
    const current = await session.getAccountsStub().getAccountByUsername(attachment.accountName);
    if (
      !current ||
      current.id !== attachment.userId ||
      current.credentialVersion !== attachment.credentialVersion
    ) {
      await session.disconnectSession(ws, attachment, "Account no longer available");
      return;
    }
    attachment.roles = current.roles;
    attachment.isOper = Boolean(
      attachment.isOper && (current.roles.includes("admin") || current.roles.includes("oper")),
    );
    session.saveAttachment(ws, attachment);
  }
  if (SERVER_CONFIG.requireAccounts && attachment.registered && !attachment.authenticated) {
    await session.disconnectSession(ws, attachment, "Account login required");
    return;
  }

  const clientLabel =
    typeof msg.tags.label === "string" && session.hasCap(attachment, "labeled-response")
      ? msg.tags.label
      : undefined;
  const labelTags = clientLabel ? { label: clientLabel } : undefined;

  // Check if this message belongs to a client-opened draft/multiline batch
  const activeBatchRef = session.activeBatchRefBySession.get(attachment.sessionId);
  if (activeBatchRef) {
    const sessionBatches = session.pendingBatchesBySession.get(attachment.sessionId);
    const pending = sessionBatches?.get(activeBatchRef);

    if (cmd === "BATCH") {
      // Allow BATCH command through to handleClientBatch to close or fail the batch
    } else if (pending) {
      if (cmd !== "PRIVMSG" && cmd !== "NOTICE") {
        pending.invalid = true;
        return;
      }

      const batchTag = typeof msg.tags.batch === "string" ? msg.tags.batch : null;
      if (batchTag !== activeBatchRef) {
        // Unexpected or missing batch tag while batch is active
        pending.invalid = true;
        return;
      }

      const lineText = msg.params[1] ?? "";
      const concat = Object.hasOwn(msg.tags, "draft/multiline-concat");

      if (concat && lineText === "") {
        // Concat on empty message is invalid per spec
        pending.invalid = true;
        return;
      }

      const lineBytes = new TextEncoder().encode(lineText).byteLength;
      if (pending.lines.length + 1 > 32) {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: ["BATCH", "MULTILINE_MAX_LINES", "32", "Multiline line limit exceeded"],
          }),
        );
        sessionBatches?.delete(activeBatchRef);
        session.activeBatchRefBySession.delete(attachment.sessionId);
        return;
      }

      if (pending.totalBytes + lineBytes > 4096) {
        session.sendLine(
          ws,
          attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(attachment, labelTags),
            prefix: SERVER_CONFIG.serverName,
            command: "FAIL",
            params: ["BATCH", "MULTILINE_MAX_BYTES", "4096", "Multiline byte limit exceeded"],
          }),
        );
        sessionBatches?.delete(activeBatchRef);
        session.activeBatchRefBySession.delete(attachment.sessionId);
        return;
      }

      pending.command = pending.command ?? cmd;
      pending.lines.push({ content: lineText, concat });
      pending.totalBytes += lineBytes;
      for (const [k, v] of Object.entries(msg.tags)) {
        if (k.startsWith("+")) {
          pending.tags[k] = v;
        }
      }
      return;
    }
  }

  switch (cmd) {
    case "WEBIRC": {
      if (attachment.registered) {
        session.sendNumeric(ws, attachment, Numerics.ERR_ALREADYREGISTRED, [
          "You may not reregister",
        ]);
        return;
      }
      if (msg.params.length < 4) {
        session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
          "WEBIRC",
          "Not enough parameters",
        ]);
        return;
      }
      const [webircPass, _gateway, clientHost, clientIp] = msg.params;
      const requiredPass = (session.env as any)?.WEBIRC_PASSWORD ?? SERVER_CONFIG.webircPassword;
      if (!requiredPass || webircPass !== requiredPass) {
        session.sendNumeric(ws, attachment, Numerics.ERR_PASSWDMISMATCH, ["Password incorrect"]);
        return;
      }
      attachment.hostname = clientHost || clientIp || attachment.hostname;
      session.saveAttachment(ws, attachment);
      return;
    }
    case "CAP":
      await handleCap(session, ws, attachment, msg);
      return;
    case "AUTHENTICATE":
      await handleAuthenticate(session, ws, attachment, msg);
      return;
    case "PASS":
      await handlePass(session, ws, attachment, msg);
      return;
    case "NICK":
      await handleNick(session, ws, attachment, msg, labelTags);
      return;
    case "USER":
      await handleUser(session, ws, attachment, msg);
      return;
    case "REGISTER":
      await handleRegisterCommand(session, ws, attachment, msg, labelTags);
      return;
    case "VERIFY":
      handleVerifyCommand(session, ws, attachment, msg, labelTags);
      return;
    case "BOUNCER":
      handleBouncerCommand(session, ws, attachment, msg, labelTags);
      return;
    case "METADATA":
      await handleMetadata(session, ws, attachment, msg, labelTags);
      return;
    case "ISUPPORT":
      handleIsupportCommand(session, ws, attachment, labelTags);
      return;
    case "PING":
      handlePing(session, ws, attachment, msg, labelTags);
      return;
    case "PONG":
      if (labelTags?.label) {
        session.sendAck(ws, attachment, labelTags);
      }
      return;
    case "QUIT":
      await handleQuit(session, ws, attachment, msg);
      return;
    case "AWAY":
      if (!attachment.registered && session.hasCap(attachment, "draft/pre-away")) {
        attachment.awayMessage = msg.params[0] || null;
        session.saveAttachment(ws, attachment);
        return;
      }
      break;
    default:
      break;
  }

  if (!attachment.registered) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOTREGISTERED,
      ["You have not registered"],
      labelTags,
    );
    return;
  }

  switch (cmd) {
    case "JOIN":
      await handleJoin(session, ws, attachment, msg, labelTags);
      break;
    case "PART":
      await handlePart(session, ws, attachment, msg);
      break;
    case "PRIVMSG":
    case "NOTICE":
      await handlePrivmsgOrNotice(session, ws, attachment, msg, cmd, labelTags);
      break;
    case "TAGMSG":
      await handleTagmsg(session, ws, attachment, msg, labelTags);
      break;
    case "BATCH":
      await handleClientBatch(session, ws, attachment, msg, labelTags);
      break;
    case "REDACT":
      await handleRedact(session, ws, attachment, msg, labelTags);
      break;
    case "METADATA":
      await handleMetadata(session, ws, attachment, msg, labelTags);
      break;
    case "MARKREAD":
      await handleMarkread(session, ws, attachment, msg, labelTags);
      break;
    case "SETNAME":
      await handleSetname(session, ws, attachment, msg, labelTags);
      break;
    case "CHGHOST":
      await handleChghost(session, ws, attachment, msg, labelTags);
      break;
    case "SEARCH":
      await handleSearch(session, ws, attachment, msg, labelTags);
      break;
    case "MONITOR":
      handleMonitor(session, ws, attachment, msg, labelTags);
      break;
    case "RENAME":
      await handleRename(session, ws, attachment, msg, labelTags);
      break;
    case "WHOAMI":
      handleWhoami(session, ws, attachment, labelTags);
      break;
    case "RELAYMSG":
      await handleRelaymsg(session, ws, attachment, msg, labelTags);
      break;
    case "WEBPUSH":
      await handleWebpush(session, ws, attachment, msg, labelTags);
      break;
    case "PERSISTENCE":
      await handlePersistence(session, ws, attachment, msg, labelTags);
      break;
    case "NS":
    case "NICKSERV":
      await handleNickServ(session, ws, attachment, msg.params.join(" "), labelTags);
      break;
    case "CS":
    case "CHANSERV":
      await handleChanServ(session, ws, attachment, msg.params.join(" "), labelTags);
      break;
    case "HS":
    case "HOSTSERV":
      await handleHostServ(session, ws, attachment, msg.params.join(" "), labelTags);
      break;
    case "HISTSERV":
      await handleHistServ(session, ws, attachment, msg.params.join(" "), labelTags);
      break;
    case "F":
    case "FLARESERV":
    case "Q":
      await handleFBot(session, ws, attachment, msg.params.join(" "), labelTags);
      break;
    case "ZNC":
      await handleZncCommand(session, ws, attachment, msg, labelTags);
      break;
    case "NAMES":
      await handleNames(session, ws, attachment, msg);
      break;
    case "TOPIC":
      await handleTopic(session, ws, attachment, msg);
      break;
    case "MODE":
    case "SAMODE":
      await handleMode(session, ws, attachment, msg, labelTags, cmd === "SAMODE");
      break;
    case "KICK":
      await handleKick(session, ws, attachment, msg);
      break;
    case "INVITE":
      await handleInvite(session, ws, attachment, msg);
      break;
    case "UNINVITE":
      await handleUninvite(session, ws, attachment, msg, labelTags);
      break;
    case "WHO":
      await handleWho(session, ws, attachment, msg, labelTags);
      break;
    case "WHOIS":
      await handleWhois(session, ws, attachment, msg, labelTags);
      break;
    case "WHOWAS":
      handleWhowas(session, ws, attachment, msg, labelTags);
      break;
    case "USERHOST":
      handleUserhost(session, ws, attachment, msg, labelTags);
      break;
    case "ISON":
      handleIson(session, ws, attachment, msg, labelTags);
      break;
    case "TIME":
      handleTime(session, ws, attachment, msg, labelTags);
      break;
    case "VERSION":
      handleVersion(session, ws, attachment, msg, labelTags);
      break;
    case "INFO":
      handleInfoCommand(session, ws, attachment, labelTags);
      break;
    case "HELP":
    case "HELPOP":
      handleHelpCommand(session, ws, attachment, msg, labelTags);
      break;
    case "LANGUAGE":
      handleLanguageCommand(session, ws, attachment, msg, labelTags);
      break;
    case "ACCEPT":
      handleAcceptCommand(session, ws, attachment, msg, labelTags);
      break;
    case "OPER":
      await handleOperCommand(session, ws, attachment, msg, labelTags);
      break;
    case "DEOPER":
      handleDeoperCommand(session, ws, attachment, labelTags);
      break;
    case "SAJOIN":
      await handleSajoinCommand(session, ws, attachment, msg, labelTags);
      break;
    case "SANICK":
      await handleSanickCommand(session, ws, attachment, msg, labelTags);
      break;
    case "KILL":
      await handleKillCommand(session, ws, attachment, msg, labelTags);
      break;
    case "NPC":
    case "NPCA":
    case "SCENE":
    case "AMBIANCE":
      await handleRoleplayCommand(session, ws, attachment, msg, cmd, labelTags);
      break;
    case "HISTORY":
      await handleHistoryCommand(session, ws, attachment, msg, labelTags);
      break;
    case "AWAY":
      await handleAway(session, ws, attachment, msg, labelTags);
      break;
    case "MOTD":
      session.sendMotd(ws, attachment);
      break;
    case "LUSERS":
      session.sendLusers(ws, attachment);
      break;
    case "LIST":
      await handleList(session, ws, attachment, msg, labelTags);
      break;
    case "CHATHISTORY":
      await handleChathistory(session, ws, attachment, msg, labelTags);
      break;
    case "WALLOPS":
      await handleWallops(session, ws, attachment, msg, labelTags);
      break;
    case "LINKS":
      handleLinks(session, ws, attachment, msg, labelTags);
      break;
    default:
      if (cmd !== "NOTICE") {
        session.sendNumeric(
          ws,
          attachment,
          Numerics.ERR_UNKNOWNCOMMAND,
          [cmd, "Unknown command"],
          labelTags,
        );
      }
      break;
  }
}
