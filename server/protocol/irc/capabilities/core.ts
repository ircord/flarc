/**
 * Standard & Stable IRCv3 Core Capabilities
 *
 * References:
 * - https://ircv3.net/irc/
 */

export const CORE_CAPABILITIES: Record<string, string | null> = {
  "account-notify": null,
  "account-tag": null,
  "away-notify": null,
  batch: null,
  bot: null,
  "cap-notify": null,
  chathistory: null,
  chghost: null,
  "echo-message": null,
  "extended-join": null,
  "extended-monitor": null,
  "invite-notify": null,
  "labeled-response": null,
  "message-tags": null,
  monitor: null,
  msgid: null,
  "multi-prefix": null,
  "no-implicit-names": null,
  sasl: "PLAIN,SCRAM-SHA-256",
  "server-time": null,
  setname: null,
  "standard-replies": null,
  "userhost-in-names": null,
};
