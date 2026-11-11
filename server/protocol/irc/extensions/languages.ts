/**
 * IRCv3 draft/languages Extension
 *
 * Implements client language negotiation per IRCv3 specifications.
 *
 * References:
 * - https://ircv3.net/specs/extensions/languages
 *
 * Syntax:
 *   LANGUAGE [code1,code2,...]
 *
 * Server Replies:
 *   690 RPL_LANGUAGES :<code> <order> :<language name>
 *   691 ERR_NOLANGUAGES :<error text>
 */

export const LANGUAGES_CAP = "draft/languages";

export const LanguageNumerics = {
  RPL_LANGUAGES: "690",
  ERR_NOLANGUAGES: "691",
} as const;

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
  { code: "pl", name: "Polish" },
  { code: "ru", name: "Russian" },
] as const;

export function parseLanguageCommand(params: string[]): {
  action: "list" | "set";
  languages?: string[];
} {
  if (params.length === 0 || !params[0] || params[0].trim() === "") {
    return { action: "list" };
  }

  const requested = params[0]
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  return {
    action: "set",
    languages: requested,
  };
}
