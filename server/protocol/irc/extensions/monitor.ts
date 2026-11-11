/**
 * IRCv3 MONITOR Command Extension
 *
 * Implements real-time presence notifications for monitored nicknames.
 *
 * References:
 * - https://ircv3.net/specs/core/monitor-3.2
 *
 * Syntax:
 *   MONITOR + <nick1,nick2,...>
 *   MONITOR - <nick1,nick2,...>
 *   MONITOR C
 *   MONITOR L
 *   MONITOR S
 *
 * Server Replies:
 *   730 RPL_MONONLINE   :<client> :nick1!ident@host,nick2!ident@host...
 *   731 RPL_MONOFFLINE  :<client> :nick1,nick2...
 *   732 RPL_MONLIST     :<client> :nick1,nick2...
 *   733 RPL_ENDOFMONLIST:<client> :End of MONITOR list
 *   734 ERR_MONLISTFULL :<client> <limit> <targets> :Monitor list is full
 */

export const MonitorNumerics = {
  RPL_MONONLINE: "730",
  RPL_MONOFFLINE: "731",
  RPL_MONLIST: "732",
  RPL_ENDOFMONLIST: "733",
  ERR_MONLISTFULL: "734",
} as const;

export type MonitorAction = "+" | "-" | "C" | "L" | "S";

export interface ParsedMonitorCommand {
  action: MonitorAction;
  targets: string[];
}

export function parseMonitorCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: ParsedMonitorCommand;
} {
  if (params.length === 0) {
    return { ok: false, error: "MONITOR requires a subcommand (+, -, C, L, S)" };
  }

  const sub = params[0].toUpperCase();
  if (sub === "+" || sub === "-") {
    if (params.length < 2) {
      return { ok: false, error: `MONITOR ${sub} requires a target nickname list` };
    }
    const targets = params[1]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      ok: true,
      data: {
        action: sub as "+" | "-",
        targets,
      },
    };
  }

  if (sub === "C" || sub === "L" || sub === "S") {
    return {
      ok: true,
      data: {
        action: sub as "C" | "L" | "S",
        targets: [],
      },
    };
  }

  return { ok: false, error: `Unknown MONITOR subcommand: ${sub}` };
}
