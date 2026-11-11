/**
 * IRCv3 CALLERID / ACCEPT Extension
 *
 * Implements user message filtering (whitelisting private message senders).
 *
 * References:
 * - https://ircv3.net/specs/extensions/callerid
 * - RFC 2812 Section 3.4.3
 *
 * Syntax:
 *   ACCEPT <nick1,nick2,...>
 *   ACCEPT -<nick1,nick2,...>
 *   ACCEPT *
 *
 * Server Replies:
 *   281 RPL_ACCEPTLIST :<client> <nick>
 *   282 RPL_ENDOFACCEPT :<client> :End of ACCEPT list
 *   456 ERR_ACCEPTFULL :<client> :Accept list is full
 *   457 ERR_ACCEPTEXIST :<client> <nick> :is already on your accept list
 *   458 ERR_ACCEPTNOT :<client> <nick> :is not on your accept list
 *   716 RPL_TARGUMODEG :<client> <nick> :is in +g mode (callerid)
 *   717 RPL_TARGNOTIFY :<client> <nick> :has been informed that you messaged them
 *   718 RPL_UMODEGMSG  :<client> <nick> <user> <host> :is messaging you, and you have callerid enabled
 */

export const CALLERID_CAP = "draft/callerid";

export const AcceptNumerics = {
  RPL_ACCEPTLIST: "281",
  RPL_ENDOFACCEPT: "282",
  ERR_ACCEPTFULL: "456",
  ERR_ACCEPTEXIST: "457",
  ERR_ACCEPTNOT: "458",
  RPL_TARGUMODEG: "716",
  RPL_TARGNOTIFY: "717",
  RPL_UMODEGMSG: "718",
} as const;

export type AcceptAction = "list" | "add" | "remove";

export interface ParsedAcceptCommand {
  action: AcceptAction;
  nicks: string[];
}

export function parseAcceptCommand(params: string[]): ParsedAcceptCommand {
  if (params.length === 0 || params[0] === "*") {
    return { action: "list", nicks: [] };
  }

  const raw = params[0];
  const isRemove = raw.startsWith("-");
  const cleaned = isRemove ? raw.slice(1) : raw;
  const nicks = cleaned
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  return {
    action: isRemove ? "remove" : "add",
    nicks,
  };
}
