/**
 * IRCv3 ISUPPORT & draft/extended-isupport Extension
 *
 * Implements server feature advertisement and dynamic isupport queries.
 *
 * References:
 * - https://ircv3.net/specs/extensions/extended-isupport
 * - Modern IRC Numeric RPL_ISUPPORT (005)
 *
 * Syntax:
 *   ISUPPORT [token1 token2...]
 */

export const EXTENDED_ISUPPORT_CAP = "draft/extended-isupport";

export interface IsupportToken {
  name: string;
  value?: string;
  negated?: boolean;
}

export function parseIsupportToken(raw: string): IsupportToken {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) {
    return { name: trimmed.slice(1), negated: true };
  }

  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    return {
      name: trimmed.slice(0, eqIdx),
      value: trimmed.slice(eqIdx + 1),
    };
  }

  return { name: trimmed };
}

export function formatIsupportTokens(tokens: Record<string, string | true>): string[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const [key, val] of Object.entries(tokens)) {
    const formatted = val === true ? key : `${key}=${val}`;
    if (currentChunk.length >= 13 || currentLength + formatted.length + 1 > 350) {
      chunks.push(currentChunk.join(" "));
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(formatted);
    currentLength += formatted.length + 1;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
}
