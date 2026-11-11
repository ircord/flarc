import { decodeSaslPlain } from "~/core/authentication/passwords";
import {
  base64ToUint8Array,
  hmacSha256,
  parseClientFinalMessage,
  parseClientFirstMessage,
  sha256,
  uint8ArrayToBase64,
  xorBytes,
} from "~/core/authentication/scram";
import { SERVER_CONFIG } from "~/core/config";
import {
  isReservedServiceNickname,
  isValidNickname,
  isValidUsername,
} from "~/core/permissions/validation";
import type { SessionAttachment } from "~/core/types";
import { formatCapabilitiesList, isSupportedCapability } from "~/protocol/irc/capabilities";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "./types";

export async function handleCap(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  const sub = (msg.params[0] ?? "").toUpperCase();
  const target = attachment.nickname ?? "*";

  if (sub === "LS") {
    if (!attachment.registered) {
      attachment.capNegotiating = true;
      session.saveAttachment(ws, attachment);
    }
    const version = msg.params[1] === "302" ? 302 : 301;
    const capList = formatCapabilitiesList(version >= 302, session.env as any);
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "CAP",
        params: [target, "LS", capList],
      }),
    );
  } else if (sub === "LIST") {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "CAP",
        params: [target, "LIST", attachment.capabilities.join(" ")],
      }),
    );
  } else if (sub === "REQ") {
    if (!attachment.registered) {
      attachment.capNegotiating = true;
    }
    const reqStr = (msg.params[1] ?? "").trim();
    const tokens = reqStr.split(/\s+/).filter(Boolean);
    const nextCaps = new Set(attachment.capabilities);
    let ok = true;

    for (const token of tokens) {
      const removing = token.startsWith("-");
      const rawName = (removing ? token.slice(1) : token).toLowerCase();
      const name = rawName.split("=")[0];
      if (!isSupportedCapability(name)) {
        ok = false;
        break;
      }
      if (removing) {
        nextCaps.delete(name);
      } else {
        nextCaps.add(name);
      }
    }

    if (!ok) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "CAP",
          params: [target, "NAK", reqStr],
        }),
      );
    } else {
      attachment.capabilities = Array.from(nextCaps);
      session.saveAttachment(ws, attachment);
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "CAP",
          params: [target, "ACK", reqStr],
        }),
      );
    }
  } else if (sub === "END") {
    attachment.capNegotiating = false;
    session.saveAttachment(ws, attachment);
    await session.tryCompleteRegistration(ws, attachment);
  } else {
    session.sendNumeric(ws, attachment, Numerics.ERR_INVALIDCAPCMD, [
      sub || "*",
      "Invalid CAP subcommand",
    ]);
  }
}

export async function handleAuthenticate(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  const arg = msg.params[0] ?? "";
  if (arg === "*") {
    attachment.saslMechanism = null;
    attachment.saslBuffer = "";
    attachment.scramState = undefined;
    session.saslBuffersBySession.delete(attachment.sessionId);
    session.saveAttachment(ws, attachment);
    session.sendNumeric(ws, attachment, Numerics.ERR_SASLABORTED, ["SASL authentication aborted"]);
    return;
  }

  if (!attachment.saslMechanism) {
    const mech = arg.toUpperCase();
    if (mech !== "PLAIN" && mech !== "SCRAM-SHA-256") {
      session.sendNumeric(ws, attachment, Numerics.RPL_SASLMECHS, [
        "PLAIN,SCRAM-SHA-256",
        "are available SASL mechanisms",
      ]);
      session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
      return;
    }
    attachment.saslMechanism = mech;
    attachment.saslBuffer = "";
    attachment.scramState = undefined;
    session.saslBuffersBySession.delete(attachment.sessionId);
    session.saveAttachment(ws, attachment);
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "AUTHENTICATE",
        params: ["+"],
      }),
    );
    return;
  }

  let buffer = session.saslBuffersBySession.get(attachment.sessionId) ?? "";
  if (arg !== "+") {
    if (arg.length > 400) {
      attachment.saslMechanism = null;
      attachment.saslBuffer = "";
      attachment.scramState = undefined;
      session.saslBuffersBySession.delete(attachment.sessionId);
      session.saveAttachment(ws, attachment);
      session.sendNumeric(ws, attachment, Numerics.ERR_SASLTOOLONG, ["SASL message too long"]);
      return;
    }
    buffer += arg;
    if (buffer.length > 4096) {
      attachment.saslMechanism = null;
      attachment.saslBuffer = "";
      attachment.scramState = undefined;
      session.saslBuffersBySession.delete(attachment.sessionId);
      session.saveAttachment(ws, attachment);
      session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
      return;
    }
    session.saslBuffersBySession.set(attachment.sessionId, buffer);
    if (arg.length === 400) {
      return;
    }
  }

  const payload = buffer || arg;
  const mech = attachment.saslMechanism;
  const accountsStub = session.getAccountsStub();
  let authenticatedAccount: { id: string; username: string; roles: string[] } | null = null;

  if (mech === "SCRAM-SHA-256") {
    session.saslBuffersBySession.delete(attachment.sessionId);
    if (!attachment.scramState) {
      // Step 1: Client First Message
      let decodedFirst = "";
      try {
        decodedFirst = atob(payload);
      } catch {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const parsedFirst = parseClientFirstMessage(decodedFirst);
      if (
        !parsedFirst ||
        (parsedFirst.authzid &&
          canonicalizeIRCName(parsedFirst.authzid) !== canonicalizeIRCName(parsedFirst.username))
      ) {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const res = await accountsStub.getScramCredentials(parsedFirst.username);
      if (!res.ok) {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const serverNonce = crypto.randomUUID().replace(/-/g, "");
      const combinedNonce = parsedFirst.clientNonce + serverNonce;
      const serverFirst = `r=${combinedNonce},s=${res.scram.salt},i=${res.scram.iterations}`;

      attachment.saslMechanism = "SCRAM-SHA-256";
      attachment.scramState = {
        step: 2,
        username: res.account.username,
        authMessagePrefix: `${parsedFirst.clientFirstBare},${serverFirst}`,
        clientNonce: parsedFirst.clientNonce,
        serverNonce,
        salt: res.scram.salt,
        iterations: res.scram.iterations,
        credentialVersion: res.account.credentialVersion ?? 0,
      };
      session.saveAttachment(ws, attachment);

      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "AUTHENTICATE",
          params: [btoa(serverFirst)],
        }),
      );
      return;
    } else if (attachment.scramState.step === 2) {
      // Step 2: Client Final Message
      let decodedFinal = "";
      try {
        decodedFinal = atob(payload);
      } catch {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const parsedFinal = parseClientFinalMessage(decodedFinal);
      if (
        !parsedFinal ||
        (parsedFinal.channelBinding !== "biws" && parsedFinal.channelBinding !== "eSws") ||
        parsedFinal.nonce !== attachment.scramState.clientNonce + attachment.scramState.serverNonce
      ) {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const credentials = await accountsStub.getScramCredentials(attachment.scramState.username);
      if (
        !credentials.ok ||
        (credentials.account.credentialVersion ?? 0) !== attachment.scramState.credentialVersion ||
        credentials.scram.salt !== attachment.scramState.salt
      ) {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }
      const authMessage = `${attachment.scramState.authMessagePrefix},${parsedFinal.clientFinalWithoutProof}`;
      const storedKeyBytes = base64ToUint8Array(credentials.scram.storedKey);
      const clientSignature = await hmacSha256(storedKeyBytes, authMessage);
      const clientProofBytes = base64ToUint8Array(parsedFinal.proofB64);

      if (clientProofBytes.length !== clientSignature.length) {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const clientKey = xorBytes(clientProofBytes, clientSignature);
      const computedStoredKey = await sha256(clientKey);

      let diff = 0;
      for (let i = 0; i < storedKeyBytes.length; i++) {
        diff |= computedStoredKey[i] ^ storedKeyBytes[i];
      }

      if (diff !== 0) {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const serverKeyBytes = base64ToUint8Array(credentials.scram.serverKey);
      const serverSignature = await hmacSha256(serverKeyBytes, authMessage);
      const serverFinal = `v=${uint8ArrayToBase64(serverSignature)}`;

      attachment.saslMechanism = "SCRAM-SHA-256";
      attachment.scramState.step = 3;
      session.saveAttachment(ws, attachment);

      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          prefix: SERVER_CONFIG.serverName,
          command: "AUTHENTICATE",
          params: [btoa(serverFinal)],
        }),
      );
      return;
    } else if (attachment.scramState.step === 3) {
      // Step 3: Client ack ("+")
      if (payload !== "+") {
        attachment.saslMechanism = null;
        attachment.scramState = undefined;
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const username = attachment.scramState.username;
      const freshCredentials = await accountsStub.getScramCredentials(username);
      const challengeCurrent =
        freshCredentials.ok &&
        (freshCredentials.account.credentialVersion ?? 0) ===
          attachment.scramState.credentialVersion &&
        freshCredentials.scram.salt === attachment.scramState.salt;
      attachment.saslMechanism = null;
      attachment.scramState = undefined;
      const acct = await accountsStub.getAccountByUsername(username);
      if (!acct || !challengeCurrent) {
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }
      authenticatedAccount = acct;
    }
  } else {
    attachment.saslMechanism = null;
    attachment.saslBuffer = "";
    session.saslBuffersBySession.delete(attachment.sessionId);

    {
      const decoded = decodeSaslPlain(payload);
      if (
        !decoded ||
        canonicalizeIRCName(decoded.authzid) !== canonicalizeIRCName(decoded.authcid)
      ) {
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }

      const res = await accountsStub.verifyCredentials(decoded.authcid, decoded.password);
      if (!res.ok) {
        session.saveAttachment(ws, attachment);
        session.sendNumeric(ws, attachment, Numerics.ERR_SASLFAIL, ["SASL authentication failed"]);
        return;
      }
      authenticatedAccount = res.account;
    }
  }

  if (!authenticatedAccount) {
    return;
  }

  await session.prepareAccountChange(attachment, authenticatedAccount.id);
  attachment.authenticated = true;
  attachment.userId = authenticatedAccount.id;
  attachment.credentialVersion = (authenticatedAccount as any).credentialVersion ?? 0;
  attachment.accountName = authenticatedAccount.username;
  attachment.isOper =
    authenticatedAccount.roles.includes("oper") || authenticatedAccount.roles.includes("admin");
  session.saveAttachment(ws, attachment);

  session.sendNumeric(ws, attachment, Numerics.RPL_LOGGEDIN, [
    session.getUserPrefix(attachment),
    authenticatedAccount.username,
    `You are now logged in as ${authenticatedAccount.username}`,
  ]);
  session.sendNumeric(ws, attachment, Numerics.RPL_SASLSUCCESS, ["SASL authentication successful"]);

  if (attachment.registered) {
    await session.broadcastAccountChange(attachment);
    session.saveAttachment(ws, attachment);
  }
}

export async function handleRegisterCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  // draft/account-registration: REGISTER <account> <email|*> <password>
  if (msg.params.length < 3) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["REGISTER", "NEED_MORE_PARAMS", "Not enough parameters"],
      }),
    );
    return;
  }

  const rawAccount =
    msg.params[0] === "*" ? (attachment.nickname ?? attachment.requestedNick ?? "") : msg.params[0];
  const password = msg.params[2];

  const envRegBeforeConnect =
    (session.env as any)?.REG_BEFORE_CONNECT ??
    (session.env as any)?.CFCORD_REG_BEFORE_CONNECT ??
    (typeof process !== "undefined"
      ? (process.env.REG_BEFORE_CONNECT ?? process.env.CFCORD_REG_BEFORE_CONNECT)
      : undefined);
  if (!attachment.registered && envRegBeforeConnect === "0") {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: [
          "REGISTER",
          "COMPLETE_CONNECTION_REQUIRED",
          rawAccount,
          "You must complete registration before registering an account",
        ],
      }),
    );
    return;
  }

  const envRegRequiresEmail =
    (session.env as any)?.REG_REQUIRES_EMAIL ??
    (session.env as any)?.CFCORD_REG_REQUIRES_EMAIL ??
    (typeof process !== "undefined"
      ? (process.env.REG_REQUIRES_EMAIL ?? process.env.CFCORD_REG_REQUIRES_EMAIL)
      : undefined);
  const email = msg.params[1];
  if (envRegRequiresEmail === "1" && (!email || email === "*" || !email.includes("@"))) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["REGISTER", "INVALID_EMAIL", rawAccount, "A valid email address is required"],
      }),
    );
    return;
  }

  if (attachment.nickname && rawAccount.toLowerCase() !== attachment.nickname.toLowerCase()) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: [
          "REGISTER",
          "ACCOUNT_NAME_MUST_BE_NICK",
          rawAccount,
          "Account name must match current nickname",
        ],
      }),
    );
    return;
  }

  if (rawAccount) {
    const canonNick = canonicalizeIRCName(rawAccount);
    const existingOwnerSessionId = session.sessionsByNick.get(canonNick);
    if (existingOwnerSessionId && existingOwnerSessionId !== attachment.sessionId) {
      session.sendLine(
        ws,
        attachment,
        encodeIRCMessage({
          tags: session.filterOutgoingTags(attachment, labelTags),
          prefix: SERVER_CONFIG.serverName,
          command: "FAIL",
          params: [
            "REGISTER",
            "ACCOUNT_EXISTS",
            rawAccount,
            "Nickname is currently in use by another user",
          ],
        }),
      );
      return;
    }
  }

  const accountsStub = session.getAccountsStub();
  const res = await accountsStub.registerAccount({
    username: rawAccount,
    password,
  });

  if (!res.ok) {
    const code = res.error.includes("exists") ? "ACCOUNT_EXISTS" : "WEAK_PASSWORD";
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["REGISTER", code, rawAccount, res.error],
      }),
    );
    return;
  }

  await session.prepareAccountChange(attachment, res.account.id);

  attachment.authenticated = true;
  attachment.userId = res.account.id;
  attachment.credentialVersion = res.account.credentialVersion ?? 0;
  attachment.accountName = res.account.username;
  attachment.roles = res.account.roles;
  session.saveAttachment(ws, attachment);

  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, labelTags),
      prefix: SERVER_CONFIG.serverName,
      command: "REGISTER",
      params: ["SUCCESS", res.account.username, "Account registration successful"],
    }),
  );

  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_LOGGEDIN,
    [
      session.getUserPrefix(attachment),
      res.account.username,
      `You are now logged in as ${res.account.username}`,
    ],
    labelTags,
  );
  session.sendNumeric(
    ws,
    attachment,
    Numerics.RPL_REGISTERSUCCESS,
    [res.account.username, "Account registration successful"],
    labelTags,
  );

  if (attachment.registered) {
    await session.broadcastAccountChange(attachment);
    session.saveAttachment(ws, attachment);
  }
}

export function handleVerifyCommand(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): void {
  const account = msg.params[0] ?? attachment.accountName ?? "*";
  const code = msg.params[1] ?? "";
  if (!code) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "FAIL",
        params: ["VERIFY", "NEED_MORE_PARAMS", "Not enough parameters"],
      }),
    );
    return;
  }
  // No challenge issuer or verifier exists. Never claim arbitrary tokens were verified.
  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      tags: session.filterOutgoingTags(attachment, labelTags),
      prefix: SERVER_CONFIG.serverName,
      command: "FAIL",
      params: ["VERIFY", "INVALID_CODE", account, "Account verification is not configured"],
    }),
  );
}

export async function handlePass(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  if (attachment.registered) {
    session.sendNumeric(ws, attachment, Numerics.ERR_ALREADYREGISTRED, ["You may not reregister"]);
    return;
  }
  if (msg.params.length < 1 || !msg.params[0]) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "PASS",
      "Not enough parameters",
    ]);
    return;
  }
  session.pendingPassBySession.set(attachment.sessionId, msg.params[0]);
}

export async function handleNick(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const newNick = (msg.params[0] ?? "").trim();
  if (!newNick) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NONICKNAMEGIVEN, ["No nickname given"]);
    return;
  }
  if (!isValidNickname(newNick) || isReservedServiceNickname(newNick)) {
    session.sendNumeric(ws, attachment, Numerics.ERR_ERRONEUSNICKNAME, [
      newNick,
      "Erroneous nickname",
    ]);
    return;
  }

  const canonNick = canonicalizeIRCName(newNick);
  attachment.requestedNick = newNick;
  session.saveAttachment(ws, attachment);

  if (SERVER_CONFIG.requireAccounts && attachment.registered) {
    const owner = await session.getAccountsStub().getNickOwner(newNick);
    if (owner && owner !== attachment.userId) {
      session.sendNumeric(ws, attachment, Numerics.ERR_NICKNAMEINUSE, [
        newNick,
        "Nickname belongs to another account",
      ]);
      return;
    }
  }

  const existingOwnerSessionId = session.sessionsByNick.get(canonNick);
  if (existingOwnerSessionId && existingOwnerSessionId !== attachment.sessionId) {
    const existingSess = session.sessionsById.get(existingOwnerSessionId);
    const sameAccount =
      existingSess &&
      attachment.accountName &&
      existingSess.attachment.accountName &&
      canonicalizeIRCName(attachment.accountName) ===
        canonicalizeIRCName(existingSess.attachment.accountName);

    let multiclientAllowed = false;
    if (sameAccount && attachment.userId) {
      const settings = await session.getAccountsStub().getAccountSettings(attachment.userId);
      const mc = settings.multiclient?.toLowerCase();
      multiclientAllowed = mc !== "off" && mc !== "false";
    }

    if (!sameAccount || !multiclientAllowed) {
      session.sendNumeric(ws, attachment, Numerics.ERR_NICKNAMEINUSE, [
        newNick,
        "Nickname is already in use",
      ]);
      return;
    }
  }

  const oldNick = attachment.nickname;
  const oldPrefix = session.getUserPrefix(attachment);

  if (oldNick) {
    const oldCanon = canonicalizeIRCName(oldNick);
    if (session.sessionsByNick.get(oldCanon) === attachment.sessionId) {
      session.sessionsByNick.delete(oldCanon);
    }
  }

  attachment.nickname = newNick;
  session.sessionsByNick.set(canonNick, attachment.sessionId);
  session.saveAttachment(ws, attachment);

  if (attachment.registered && oldNick && oldNick !== newNick) {
    const _nickMsg = encodeIRCMessage({
      prefix: oldPrefix,
      command: "NICK",
      params: [newNick],
    });

    const recipientSessions = new Set<string>([attachment.sessionId]);
    const channels = session.getSessionChannels(attachment.sessionId);
    for (const ch of channels) {
      const stub = session.getChannelStub(ch.channelName);
      const members = await stub.updateMemberNick(attachment.sessionId, newNick);
      for (const sid of members) {
        recipientSessions.add(sid);
      }
    }

    for (const sid of recipientSessions) {
      const sess = session.sessionsById.get(sid);
      if (sess) {
        const tags =
          sid === attachment.sessionId && labelTags?.label ? { label: labelTags.label } : undefined;
        session.sendLine(
          sess.ws,
          sess.attachment,
          encodeIRCMessage({
            tags: session.filterOutgoingTags(sess.attachment, tags),
            prefix: oldPrefix,
            command: "NICK",
            params: [newNick],
          }),
        );
      }
    }

    if (canonicalizeIRCName(oldNick) !== canonicalizeIRCName(newNick)) {
      session.notifyMonitorsOffline(oldNick);
      session.notifyMonitorsOnline(attachment);
    }
  } else if (!attachment.registered) {
    await session.tryCompleteRegistration(ws, attachment);
  }
}

export async function handleUser(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  if (attachment.registered) {
    session.sendNumeric(ws, attachment, Numerics.ERR_ALREADYREGISTRED, ["You may not reregister"]);
    return;
  }
  if (msg.params.length < 4) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "USER",
      "Not enough parameters",
    ]);
    return;
  }

  const rawUser = (msg.params[0] ?? "").trim();
  const realname = msg.params[3] ?? "";

  if (!rawUser || !realname) {
    session.sendNumeric(ws, attachment, Numerics.ERR_NEEDMOREPARAMS, [
      "USER",
      "Not enough parameters",
    ]);
    return;
  }

  const sanitizedUser = isValidUsername(rawUser) ? rawUser : "user";
  attachment.username = sanitizedUser;
  attachment.realname = realname;
  session.saveAttachment(ws, attachment);

  await session.tryCompleteRegistration(ws, attachment);
}

export async function handleQuit(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
): Promise<void> {
  const reason = msg.params[0] ? `Quit: ${msg.params[0]}` : "Client Quit";
  if (attachment.registered && attachment.nickname) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, {
          time: new Date().toISOString(),
        }),
        prefix: session.getUserPrefix(attachment),
        command: "QUIT",
        params: [reason],
      }),
    );
  }
  session.sendLine(
    ws,
    attachment,
    encodeIRCMessage({
      prefix: SERVER_CONFIG.serverName,
      command: "ERROR",
      params: [`Closing Link: ${attachment.hostname} (${reason})`],
    }),
  );
  await session.disconnectSession(ws, attachment, reason);
}
