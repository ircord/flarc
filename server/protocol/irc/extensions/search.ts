/**
 * IRC Full-Text Search Extension (draft/search, flarc.chat/search)
 *
 * Implements Discord/IRCord style structured message search across IRC and REST.
 *
 * Syntax:
 *   SEARCH <target> <query> [filters...]
 *
 * Supported Filter Tokens:
 *   from:<nick|account>     Filter by sender nickname or registered account
 *   mentions:<nick>         Filter messages mentioning a specific user
 *   in:<channel>            Filter within a specific channel
 *   has:<kind>              Filter by content type: link, image, gif, video, file
 *   before:<date|time>      Messages before date (YYYY-MM-DD or ISO8601)
 *   after:<date|time>       Messages after date (YYYY-MM-DD or ISO8601)
 *   on:<date>               Messages on a specific calendar date (YYYY-MM-DD)
 *   author:<user|bot>       Filter by human users vs bots/webhooks
 *   tag:<key[=value]>       Filter by message tag presence or value
 *   limit:<number>          Maximum results to return (1-100, default 50)
 *
 * Capability:
 *   draft/search
 *   flarc.chat/search
 *
 * Server Replies:
 *   740 RPL_SEARCHSTART  : <client> <target> <query> :Search started
 *   741 RPL_SEARCHRESULT : <client> <target> <msgid> <timestamp> <sender> :<content>
 *   742 RPL_SEARCHEND    : <client> <target> <count> :End of search results
 *   743 ERR_SEARCHFAILED : <client> <target> :<error text>
 */

export const SEARCH_CAP = "draft/search";
export const SEARCH_VENDOR_CAP = "flarc.chat/search";

export const SearchNumerics = {
  RPL_SEARCHSTART: "740",
  RPL_SEARCHRESULT: "741",
  RPL_SEARCHEND: "742",
  ERR_SEARCHFAILED: "743",
} as const;

export type SearchHasKind =
  | "link"
  | "image"
  | "gif"
  | "video"
  | "file"
  | "embed"
  | "reaction"
  | "reply"
  | "code"
  | "quote"
  | "sound"
  | "pinned";

export type SearchAuthorKind = "user" | "bot";

export interface SearchTagFilter {
  key: string;
  value?: string;
}

export interface ParsedSearchFilters {
  target: string;
  query: string;
  from?: string[];
  mentions?: string[];
  in?: string[];
  has?: SearchHasKind[];
  before?: string;
  after?: string;
  on?: string;
  author?: SearchAuthorKind;
  tags?: SearchTagFilter[];
  pinned?: boolean;
  limit: number;
}

/**
 * Normalizes common tag filter aliases to standard IRCv3 / FlaRC tags.
 */
export function normalizeTagFilter(filter: SearchTagFilter): SearchTagFilter {
  const rawKey = filter.key.toLowerCase().trim();
  switch (rawKey) {
    case "reply":
      return { key: "+draft/reply", value: filter.value };
    case "react":
    case "reaction":
      return { key: "+draft/react", value: filter.value };
    case "edit":
    case "edited":
      return { key: "+draft/edit", value: filter.value };
    case "file":
      return { key: "+file", value: filter.value };
    case "embed":
      return { key: "+draft/embed", value: filter.value };
    case "pinned":
    case "pin":
      return { key: "+pinned", value: filter.value };
    case "bot":
      return { key: "+badge", value: "bot" };
    default:
      return { key: filter.key.trim(), value: filter.value?.trim() };
  }
}

/**
 * Token prefix regex supporting from:, mentions:, in:, has:, before:, after:, on:, author:, tag:, pinned:, limit:
 */
const FILTER_TOKEN_REGEX =
  /(?:^|\s)(from|mentions|in|has|before|after|on|author|tag|pinned|sender|limit):(?:"([^"]+)"|(\S+))/gi;

/**
 * Direct IRC message tag prefix: +key[=val]
 */
const DIRECT_TAG_REGEX = /(?:^|\s)\+([a-zA-Z0-9_\-./]+)(?:=(?:"([^"]+)"|(\S+)))?/gi;

/**
 * Parses search query string into full-text query words and structured filter chips.
 */
export function parseSearchFilterString(rawText: string): {
  query: string;
  from: string[];
  mentions: string[];
  in: string[];
  has: SearchHasKind[];
  before?: string;
  after?: string;
  on?: string;
  author?: SearchAuthorKind;
  tags: SearchTagFilter[];
  pinned?: boolean;
  limit: number;
} {
  const from: string[] = [];
  const mentions: string[] = [];
  const inChannels: string[] = [];
  const has: SearchHasKind[] = [];
  const tags: SearchTagFilter[] = [];
  let before: string | undefined;
  let after: string | undefined;
  let on: string | undefined;
  let author: SearchAuthorKind | undefined;
  let pinned: boolean | undefined;
  let limit = 50;

  // 1. Replace recognized filter tokens and collect their values
  let text = rawText.replace(
    FILTER_TOKEN_REGEX,
    (_match, key: string, quotedVal?: string, bareVal?: string) => {
      const val = (quotedVal ?? bareVal ?? "").trim();
      if (!val) return "";

      const lowerKey = key.toLowerCase();
      switch (lowerKey) {
        case "from":
        case "sender":
          from.push(val);
          break;
        case "mentions":
          mentions.push(val.replace(/^@/, ""));
          break;
        case "in":
          inChannels.push(val.startsWith("#") ? val : `#${val}`);
          break;
        case "has": {
          const lowerVal = val.toLowerCase();
          const validKinds: SearchHasKind[] = [
            "link",
            "image",
            "gif",
            "video",
            "file",
            "embed",
            "reaction",
            "reply",
            "code",
            "quote",
            "sound",
            "pinned",
          ];
          if (validKinds.includes(lowerVal as SearchHasKind)) {
            has.push(lowerVal as SearchHasKind);
          }
          break;
        }
        case "before":
          before = val;
          break;
        case "after":
          after = val;
          break;
        case "on":
          on = val;
          break;
        case "author": {
          const lowerVal = val.toLowerCase();
          if (lowerVal === "bot" || lowerVal === "user") {
            author = lowerVal;
          }
          break;
        }
        case "pinned": {
          const lowerVal = val.toLowerCase();
          pinned = lowerVal === "true" || lowerVal === "yes" || lowerVal === "1";
          if (pinned) {
            tags.push({ key: "+pinned", value: "true" });
          }
          break;
        }
        case "tag": {
          const eqIdx = val.indexOf("=");
          if (eqIdx !== -1) {
            tags.push(
              normalizeTagFilter({
                key: val.slice(0, eqIdx).trim(),
                value: val.slice(eqIdx + 1).trim(),
              }),
            );
          } else {
            tags.push(normalizeTagFilter({ key: val.trim() }));
          }
          break;
        }
        case "limit": {
          const parsedLimit = parseInt(val, 10);
          if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
            limit = Math.min(parsedLimit, 100);
          }
          break;
        }
      }
      return "";
    },
  );

  // 2. Parse direct IRC style tags starting with + (e.g. +draft/reply, +file, +react=❤️)
  text = text.replace(
    DIRECT_TAG_REGEX,
    (_match, rawKey: string, quotedVal?: string, bareVal?: string) => {
      const val = (quotedVal ?? bareVal ?? "").trim();
      tags.push(
        normalizeTagFilter({
          key: `+${rawKey}`,
          value: val || undefined,
        }),
      );
      return "";
    },
  );

  const cleanQuery = text.replace(/\s+/g, " ").trim();

  return {
    query: cleanQuery,
    from,
    mentions,
    in: inChannels,
    has,
    before,
    after,
    on,
    author,
    tags,
    pinned,
    limit,
  };
}

/**
 * Parses IRC SEARCH command arguments.
 * Syntax:
 *   SEARCH <target> <query and/or filter tokens...>
 */
export function parseSearchCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: ParsedSearchFilters;
} {
  if (params.length < 2) {
    return {
      ok: false,
      error:
        "Need more parameters: SEARCH <target> <query> [from:NICK] [has:KIND] [before:DATE] [tag:TAG]",
    };
  }

  const target = params[0].trim();
  const rest = params.slice(1).join(" ");
  const parsed = parseSearchFilterString(rest);

  if (
    !parsed.query &&
    parsed.from.length === 0 &&
    parsed.has.length === 0 &&
    !parsed.before &&
    !parsed.after &&
    !parsed.on &&
    parsed.tags.length === 0 &&
    parsed.mentions.length === 0 &&
    parsed.pinned === undefined
  ) {
    return { ok: false, error: "Search query string or at least one filter is required" };
  }

  return {
    ok: true,
    data: {
      target,
      query: parsed.query,
      from: parsed.from.length ? parsed.from : undefined,
      mentions: parsed.mentions.length ? parsed.mentions : undefined,
      in: parsed.in.length ? parsed.in : undefined,
      has: parsed.has.length ? parsed.has : undefined,
      before: parsed.before,
      after: parsed.after,
      on: parsed.on,
      author: parsed.author,
      tags: parsed.tags.length ? parsed.tags : undefined,
      pinned: parsed.pinned,
      limit: parsed.limit,
    },
  };
}
