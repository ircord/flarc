import { canonicalizeIRCName } from "../../protocol/irc/parser";

export function isMuteExtban(mask: string): boolean {
  return /^[$~]?m:/i.test(mask.trim());
}

/**
 * Matches an IRC hostmask (e.g. `*!*@*.bad.org`, `badnick!*@*`, `$a:account`, or `m:mask`) against `nick!user@host`.
 * Uses RFC 1459 / ASCII case-insensitive matching.
 */
export function matchesBanMask(
  mask: string,
  fullMask: string,
  accountName?: string | null,
): boolean {
  const trimmed = mask.trim();

  // Support mute extban ($m:mask, ~m:mask, m:mask)
  const muteMatch = trimmed.match(/^[$~]?m:(.*)$/i);
  if (muteMatch) {
    const inner = muteMatch[1];
    return matchesWildcard(canonicalizeIRCName(inner), canonicalizeIRCName(fullMask));
  }

  // Support account-extban ($a:account, $account:account, ~a:account, ~account:account, a:account)
  const extMatch = trimmed.match(/^[$~]?(?:a|account):(.*)$/i);
  if (extMatch) {
    const extAcct = extMatch[1];
    if (!accountName) return false;
    if (extAcct === "*" || extAcct === "") return true;
    return matchesWildcard(canonicalizeIRCName(extAcct), canonicalizeIRCName(accountName));
  }

  return matchesWildcard(canonicalizeIRCName(trimmed), canonicalizeIRCName(fullMask));
}

export function matchesWildcard(canonMask: string, canonTarget: string): boolean {
  const escaped = canonMask
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(canonTarget);
}

export function hasChannelOp(modes: string, isServerOper: boolean = false): boolean {
  return (
    isServerOper ||
    modes.includes("q") ||
    modes.includes("a") ||
    modes.includes("o") ||
    modes.includes("h")
  );
}

export function hasChannelFounder(modes: string, isServerOper: boolean = false): boolean {
  return isServerOper || modes.includes("q");
}

export function hasChannelVoiceOrOp(modes: string, isServerOper: boolean = false): boolean {
  return (
    isServerOper ||
    modes.includes("q") ||
    modes.includes("a") ||
    modes.includes("o") ||
    modes.includes("h") ||
    modes.includes("v")
  );
}

const MODE_TO_PREFIX: Array<[string, string]> = [
  ["q", "~"],
  ["a", "&"],
  ["o", "@"],
  ["h", "%"],
  ["v", "+"],
];

export function formatMemberPrefix(modes: string, multiPrefix: boolean): string {
  let out = "";
  for (const [mode, prefix] of MODE_TO_PREFIX) {
    if (modes.includes(mode)) {
      if (!multiPrefix) {
        return prefix;
      }
      out += prefix;
    }
  }
  return out;
}
