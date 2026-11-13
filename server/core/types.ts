import type { AccountsDO } from "../durable-objects/accounts";
import type { ChannelDO } from "../durable-objects/channel";
import type { SessionDO } from "../durable-objects/session";

export interface Env {
  ALLOWLIST_YAML?: string;
  PUSH_ALLOWED_HOSTS?: string;
  EMBED_ALLOWED_HOSTS?: string;
  OUTGOING_WEBHOOK_ALLOWED_HOSTS?: string;
  ALLOWED_ORIGINS?: string;
  SIGNUP_POLICY?: string;
  SIGNUP_TOKEN?: string;
  MIN_PASSWORD_LENGTH?: string;
  WEBPUSH_VAPID_PUBLIC_KEY?: string;
  WEBPUSH_VAPID_PRIVATE_KEY?: string;
  WEBPUSH_VAPID_SUBJECT?: string;
  REQUIRE_ACCOUNTS?: string;
  AUTO_REGISTER_CHANNELS?: string;
  SESSION: DurableObjectNamespace<SessionDO>;
  CHANNELS: DurableObjectNamespace<ChannelDO>;
  ACCOUNTS: DurableObjectNamespace<AccountsDO>;
  MEDIA_BUCKET?: R2Bucket;
  ADMIN_TOKEN?: string;
  ADMIN_API_KEY?: string;
  AUDIT_LOG_ENABLED?: string;
  EVENT_JOURNAL_MAX_EVENTS?: string;
  EVENT_JOURNAL_RETENTION_MS?: string;
  EVENT_SHARD_COUNT?: string;
  SQLITE_MIGRATION_MAX_BYTES?: string;
  SQLITE_MIGRATION_MAX_ROWS?: string;
  LOCAL_IRC_BRIDGE_SECRET?: string;
  REQUEST_SOURCE?: string;
  SERVER_NAME?: string;
  NETWORK_NAME?: string;
  SERVER_PASSWORD?: string;
  WEBIRC_PASSWORD?: string;
  DEFAULT_USER_MODES?: string;
  CASEMAPPING?: string;
  FILEHOST_ENABLED?: string;
  FILEHOST_MAX_UPLOAD_BYTES?: string;
  FILEHOST_REQUIRE_REG?: string;
  REG_BEFORE_CONNECT?: string;
  REG_REQUIRES_EMAIL?: string;
  ALWAYS_ON_DEFAULT?: string;
  F_BOT_AUTOJOIN?: string;
  ADMIN_USERS?: string;
  FLARC_FILEHOST_ENABLED?: string;
  FLARC_FILEHOST_REQUIRE_REG?: string;
  // Legacy aliases
  CFCORD_DEFAULT_USER_MODES?: string;
  CFCORD_CASEMAPPING?: string;
  CFCORD_FILEHOST_ENABLED?: string;
  CFCORD_FILEHOST_REQUIRE_REG?: string;
  CFCORD_REG_BEFORE_CONNECT?: string;
  CFCORD_REG_REQUIRES_EMAIL?: string;
  CFCORD_ALWAYS_ON_DEFAULT?: string;
  CFCORD_ADMIN_USERS?: string;
  CFCORD_ADMIN_TOKEN?: string;
}

export type Subprotocol = "text.ircv3.net" | "binary.ircv3.net";

export interface SessionAttachment {
  sessionId: string;
  userId: string;
  accountName: string | null;
  credentialVersion?: number;
  credentialSessionHash?: string;
  nickname: string | null;
  requestedNick?: string | null;
  username: string | null;
  realname: string | null;
  hostname: string;
  registered: boolean;
  authenticated: boolean;
  capNegotiating: boolean;
  capabilities: string[];
  subprotocol: Subprotocol;
  connectedAt: number;
  awayMessage: string | null;
  isOper: boolean;
  roles?: string[];
  ip?: string;
  secure?: boolean;
  isBot?: boolean;
  isDirectWebSocket?: boolean;
  userModes?: string;
  metadataSubs?: string[];
  acceptList?: string[];
  languages?: string[];
  lastActiveAt?: number;
  vhost?: string | null;
  activeBatchRef?: string;
  saslMechanism: string | null;
  saslBuffer: string;
  scramState?: {
    step: 1 | 2 | 3;
    username: string;
    authMessagePrefix: string;
    clientNonce: string;
    serverNonce: string;
    salt: string;
    iterations: number;
    credentialVersion: number;
  };
  preRegMetadata?: Record<string, string>;
}

export interface ChannelMemberInfo {
  sessionId: string;
  userId: string;
  accountName: string | null;
  nickname: string;
  username: string;
  hostname: string;
  realname: string;
  modes: string; // e.g. "q", "a", "o", "h", "v", "qo", ""
  joinedAt: number;
  isPersistent?: boolean;
}

export interface StoredChannelMessage {
  id: string;
  sequence: number;
  senderId: string;
  senderAccount: string | null;
  senderNick: string;
  senderUser: string;
  senderHost: string;
  command: "PRIVMSG" | "NOTICE" | "TAGMSG" | "TOPIC" | "MODE" | "JOIN" | "PART" | "KICK";
  content: string;
  tags?: Record<string, string | true>;
  multilineLines?: Array<{ content: string; concat: boolean }>;
  redacted?: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface ChannelStateSummary {
  generation?: string;
  name: string;
  canonicalName: string;
  topic: string | null;
  topicSetBy: string | null;
  topicSetAt: number | null;
  modes: string;
  registered?: boolean;
  founder?: string | null;
  registeredAt?: number | null;
  memberCount: number;
  members: ChannelMemberInfo[];
  createdAt: number;
}

export interface AccountInfo {
  credentialVersion?: number;
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
  createdAt: number;
}

export interface UserProfile {
  username: string;
  displayName: string | null;
  avatar: string | null;
  pronouns: string | null;
  bio: string | null;
  bot: boolean;
  color: string | null;
  customStatus: string | null;
  timezone: string | null;
  roles: string[];
  createdAt: number;
}

export interface UserProfileInput {
  displayName?: string | null;
  avatar?: string | null;
  pronouns?: string | null;
  bio?: string | null;
  bot?: boolean | string | null;
  color?: string | null;
  customStatus?: string | null;
  timezone?: string | null;
}

export interface ChannelInfo {
  generation?: string;
  channel: string;
  canonicalName: string;
  topic: string | null;
  topicSetBy: string | null;
  topicSetAt: number | null;
  modes: string;
  registered: boolean;
  founder: string | null;
  registeredAt: number | null;
  avatar: string | null;
  description: string | null;
  category: string | null;
  color: string | null;
  readOnly: boolean;
  memberCount: number;
  createdAt: number;
  tags?: string[];
  nsfw?: boolean;
}
