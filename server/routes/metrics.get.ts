import { defineEventHandler, setResponseHeader } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const env = getEnv(event);
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));
  const accountsStub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(SERVER_CONFIG.networkId));

  let activeConnections = 0;
  let registeredSessions = 0;
  let activeChannels = 0;
  let totalUsers = 0;

  try {
    const stats = await sessionStub.getStats();
    activeConnections = stats.activeConnections;
    registeredSessions = stats.registeredSessions;
    activeChannels = stats.activeChannels;
  } catch {}

  try {
    const accounts = await accountsStub.listAccounts();
    totalUsers = accounts.length;
  } catch {}

  const lines = [
    "# HELP flarc_up Whether the FlaRC instance is responding",
    "# TYPE flarc_up gauge",
    "flarc_up 1",
    "",
    "# HELP flarc_build_info Information about FlaRC build and version",
    "# TYPE flarc_build_info gauge",
    `flarc_build_info{version="${SERVER_CONFIG.version}",server="${SERVER_CONFIG.serverName}",network="${SERVER_CONFIG.networkId}"} 1`,
    "",
    "# HELP flarc_active_connections Number of currently connected TCP/WebSocket sessions",
    "# TYPE flarc_active_connections gauge",
    `flarc_active_connections ${activeConnections}`,
    "",
    "# HELP flarc_registered_sessions Number of registered IRCv3 sessions",
    "# TYPE flarc_registered_sessions gauge",
    `flarc_registered_sessions ${registeredSessions}`,
    "",
    "# HELP flarc_active_channels Number of active channels with connected members",
    "# TYPE flarc_active_channels gauge",
    `flarc_active_channels ${activeChannels}`,
    "",
    "# HELP flarc_registered_users_total Total number of registered user accounts",
    "# TYPE flarc_registered_users_total counter",
    `flarc_registered_users_total ${totalUsers}`,
    "",
  ];

  setResponseHeader(event, "Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return lines.join("\n");
});
