/**
 * IRCv3 draft/persistence Extension
 *
 * Implements client-managed conversation persistence and bouncer sync.
 *
 * References:
 * - https://ircv3.net/specs/extensions/persistence
 *
 * Syntax:
 *   PERSISTENCE [channel] [subcommand]
 */

export const PERSISTENCE_CAP = "draft/persistence";

export interface ParsedPersistenceCommand {
  channel?: string;
  subcommand?: string;
  args: string[];
}

export function parsePersistenceCommand(params: string[]): ParsedPersistenceCommand {
  if (params.length === 0) {
    return { args: [] };
  }

  const first = params[0];
  if (first.startsWith("#") || first.startsWith("&")) {
    return {
      channel: first,
      subcommand: params[1]?.toUpperCase(),
      args: params.slice(2),
    };
  }

  return {
    subcommand: first.toUpperCase(),
    args: params.slice(1),
  };
}
