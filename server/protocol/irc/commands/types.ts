import type { drizzle } from "drizzle-orm/durable-sqlite";
import type { Env, SessionAttachment } from "~/core/types";
import type { AccountsDO } from "~/durable-objects/accounts";
import type { ChannelDO } from "~/durable-objects/channel";
import type { SessionDO } from "~/durable-objects/session";
import type { IRCMessage } from "~/protocol/irc/types";
import type * as sessionSchema from "~/storage/schemas/session";

export interface PendingMultilineBatch {
  ref: string;
  target: string;
  command: "PRIVMSG" | "NOTICE" | null;
  tags: Record<string, string | true>;
  lines: Array<{ content: string; concat: boolean }>;
  totalBytes: number;
  label?: string;
  invalid?: boolean;
}

export function truncateUtf8(str: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  if (bytes.length <= maxBytes) return str;
  let cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
    cut--;
  }
  const dec = new TextDecoder("utf-8");
  return dec.decode(bytes.subarray(0, cut));
}

export interface ISessionDO {
  featureRequest(
    credential: import("../../../features/session/contracts").SessionCredential,
    operation: string,
    input: any,
  ): Promise<any>;
  storeOfflineDirectMessage(
    sender: SessionAttachment,
    targetName: string,
    command: "PRIVMSG" | "NOTICE" | "TAGMSG",
    content: string,
    tags?: Record<string, string | true>,
  ): Promise<import("~/core/types").StoredChannelMessage | null>;

  storeDirectMessage: SessionDO["storeDirectMessage"];
  sendDirectMessageLine: SessionDO["sendDirectMessageLine"];
  sendChannelLine: SessionDO["sendChannelLine"];
  getSourceHostmask: SessionDO["getSourceHostmask"];
  redactDirectMessage: SessionDO["redactDirectMessage"];
  env: Env;
  sql: SqlStorage;
  db: ReturnType<typeof drizzle<typeof sessionSchema>>;
  sessionsById: Map<string, { ws: WebSocket; attachment: SessionAttachment }>;
  sessionsByNick: Map<string, string>;
  pendingPassBySession: Map<string, string>;
  pendingBatchesBySession: Map<string, Map<string, PendingMultilineBatch>>;
  activeBatchRefBySession: Map<string, string>;
  saslBuffersBySession: Map<string, string>;
  maxLocalUsers: number;
  maxGlobalUsers: number;

  prepareAccountChange(attachment: SessionAttachment, newUserId: string): Promise<void>;
  invalidateAccountPermissions(username: string): Promise<number>;
  saveAttachment(ws: WebSocket, attachment: SessionAttachment): void;
  getChannelStub(channelName: string): DurableObjectStub<ChannelDO>;
  getAccountsStub(): DurableObjectStub<AccountsDO>;
  getSessionChannels(
    sessionId: string,
  ): Array<{ canonicalChannel: string; channelName: string; generation?: string }>;
  getAllSessionsForNick(nickname: string): Array<{
    ws: WebSocket;
    attachment: SessionAttachment;
  }>;
  sendLine(ws: WebSocket, attachment: SessionAttachment, line: string): void;
  sendNumeric(
    ws: WebSocket,
    attachment: SessionAttachment,
    numeric: string,
    params: string[],
    tags?: Record<string, string | true>,
    metadata?: {
      key: string;
      sourceSessionId?: string;
      sourceUserId?: string;
      sourceNick?: string;
      channel?: string;
      channelGeneration?: string;
      requested?: boolean;
    },
  ): void;
  sendAck(
    ws: WebSocket,
    attachment: SessionAttachment,
    labelTags?: Record<string, string | true>,
  ): void;
  hasCap(attachment: SessionAttachment, cap: string): boolean;
  filterOutgoingTags(
    attachment: SessionAttachment,
    tags?: Record<string, string | true>,
  ): Record<string, string | true> | undefined;
  getServiceDefinition(target: string): {
    name: "NickServ" | "ChanServ" | "HostServ" | "HistServ" | "F";
    realname: string;
  } | null;
  getUserPrefix(attachment: SessionAttachment): string;
  getCanonicalDmPair(nick1: string, nick2: string): string;
  getIsupportTokens(): string[][];
  sendLusers(ws: WebSocket, attachment: SessionAttachment): void;
  sendMotd(ws: WebSocket, attachment: SessionAttachment): void;
  tryCompleteRegistration(ws: WebSocket, attachment: SessionAttachment): Promise<void>;
  notifyMonitorsOnline(attachment: SessionAttachment): void;
  notifyMonitorsOffline(nickname: string): void;
  getSharedChannelSessions(sessionId: string): Promise<Set<string>>;
  getSharedAndMonitoredSessions(
    attachment: SessionAttachment,
    requiredCap?: string,
  ): Promise<Set<string>>;
  broadcastAccountChange(attachment: SessionAttachment): Promise<void>;
  disconnectSession(ws: WebSocket, attachment: SessionAttachment, reason: string): Promise<void>;
  cleanupSessionState(attachment: SessionAttachment, reason: string): Promise<void>;
}

export interface SessionCommandContext {
  ws: WebSocket;
  attachment: SessionAttachment;
  msg: IRCMessage;
  labelTags?: Record<string, string | true>;
  session: ISessionDO;
  env: Env;
}

export type CommandHandler = (ctx: SessionCommandContext) => Promise<void> | void;
