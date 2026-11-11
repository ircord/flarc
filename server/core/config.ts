export const SERVER_CONFIG = {
  networkId: "FlaRC",
  serverName: "irc.flarc.local",
  version: "flarc-0.2.0",
  createdAt: "2026-11-10",
  maxMessageLength: 8191,
  maxLineLength: 4096,
  maxNickLength: 32,
  maxChannelLength: 64,
  retentionMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  cleanupBatchSize: 500,
  defaultHistoryLimit: 100,
  maxHistoryLimit: 500,
  zncMaxMessages: 50,
  rateLimitWindowMs: 10_000,
  rateLimitMaxCommands: 150,
  authRateLimitMaxAttempts: 10,
  motd: [
    "Welcome to FlaRC (Flare Relay Chat) - Cloudflare-Native IRCv3 Server",
    "Running on Cloudflare Workers + SQLite Durable Objects + WebSocket Hibernation",
    "Supports full IRCv3 & draft specs: SASL, CHATHISTORY, MULTILINE, REDACT, METADATA, READ-MARKER, TAGMSG, MONITOR, Services (NS/CS).",
  ] as string[],
  /** Optional server-wide connection password (PASS). */
  serverPassword: null as string | null,
  /** Optional shared secret for WEBIRC gateway authentication. */
  webircPassword: null as string | null,
  /** Default user modes set on registration (e.g. "i" for invisible, or empty). */
  defaultUserModes: "" as string,
  /** Case-mapping standard: "rfc1459" or "precis" */
  caseMapping: "rfc1459" as "rfc1459" | "precis" | "ascii",
  /** Whether the file hosting / media upload pipeline is enabled. Defaults to true. */
  filehostEnabled: true as boolean,
  /** Whether file uploads require registered account authentication. */
  filehostRequireRegistration: false as boolean,
  /** Whether the F service bot automatically joins newly registered channels. Defaults to false. */
  fBotAutoJoin: false as boolean,
  /** Comma-separated list of usernames that are always administrators. */
  adminUsers: [] as string[],
  /** Master admin API token / secret. */
  adminToken: null as string | null,
};

/**
 * Apply deployment configuration from Worker/DO env bindings.
 * Safe to call repeatedly (idempotent).
 */
export function applyEnvConfig(env: {
  SERVER_NAME?: string;
  NETWORK_NAME?: string;
  SERVER_PASSWORD?: string;
  WEBIRC_PASSWORD?: string;
  DEFAULT_USER_MODES?: string;
  CASEMAPPING?: string;
  FILEHOST_ENABLED?: string;
  FILEHOST_REQUIRE_REG?: string;
  FLARC_FILEHOST_ENABLED?: string;
  FLARC_FILEHOST_REQUIRE_REG?: string;
  F_BOT_AUTOJOIN?: string;
  FLARC_F_BOT_AUTOJOIN?: string;
  ADMIN_USERS?: string;
  FLARC_ADMIN_USERS?: string;
  ADMIN_TOKEN?: string;
  ADMIN_API_KEY?: string;
  // Legacy aliases
  CFCORD_DEFAULT_USER_MODES?: string;
  CFCORD_CASEMAPPING?: string;
  CFCORD_FILEHOST_ENABLED?: string;
  CFCORD_FILEHOST_REQUIRE_REG?: string;
  CFCORD_F_BOT_AUTOJOIN?: string;
  CFCORD_ADMIN_USERS?: string;
  CFCORD_ADMIN_TOKEN?: string;
}): void {
  if (env.SERVER_NAME) SERVER_CONFIG.serverName = env.SERVER_NAME;
  if (env.NETWORK_NAME) SERVER_CONFIG.networkId = env.NETWORK_NAME;
  if (env.SERVER_PASSWORD) SERVER_CONFIG.serverPassword = env.SERVER_PASSWORD;
  if (env.WEBIRC_PASSWORD) SERVER_CONFIG.webircPassword = env.WEBIRC_PASSWORD;

  const defaultUserModes = env.DEFAULT_USER_MODES ?? env.CFCORD_DEFAULT_USER_MODES;
  if (defaultUserModes !== undefined) {
    SERVER_CONFIG.defaultUserModes = defaultUserModes.replace(/^\+/, "");
  }

  const caseMapping = env.CASEMAPPING ?? env.CFCORD_CASEMAPPING;
  if (caseMapping) {
    SERVER_CONFIG.caseMapping = caseMapping as any;
  }

  const fhEnabled = env.FILEHOST_ENABLED ?? env.FLARC_FILEHOST_ENABLED ?? env.CFCORD_FILEHOST_ENABLED;
  if (fhEnabled !== undefined) {
    SERVER_CONFIG.filehostEnabled = fhEnabled !== "0" && fhEnabled !== "false";
  }

  const fhReqReg = env.FILEHOST_REQUIRE_REG ?? env.FLARC_FILEHOST_REQUIRE_REG ?? env.CFCORD_FILEHOST_REQUIRE_REG;
  if (fhReqReg !== undefined) {
    SERVER_CONFIG.filehostRequireRegistration = fhReqReg === "1" || fhReqReg === "true";
  }

  const fBotAuto = env.F_BOT_AUTOJOIN ?? env.FLARC_F_BOT_AUTOJOIN ?? env.CFCORD_F_BOT_AUTOJOIN;
  if (fBotAuto !== undefined) {
    SERVER_CONFIG.fBotAutoJoin = fBotAuto === "1" || fBotAuto === "true";
  }

  const adminUsersEnv = env.ADMIN_USERS ?? env.FLARC_ADMIN_USERS ?? env.CFCORD_ADMIN_USERS;
  if (adminUsersEnv !== undefined) {
    SERVER_CONFIG.adminUsers = adminUsersEnv
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);
  }

  const adminTokenEnv = env.ADMIN_TOKEN ?? env.ADMIN_API_KEY ?? env.CFCORD_ADMIN_TOKEN;
  if (adminTokenEnv) {
    SERVER_CONFIG.adminToken = adminTokenEnv;
  }
}
