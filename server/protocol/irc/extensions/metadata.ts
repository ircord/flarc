/**
 * IRCv3 Metadata Protocol Extension (draft/metadata-2, draft/metadata-3, draft/metadata-3.2)
 *
 * Implements user and channel metadata key-value storage:
 *   METADATA <target> GET <key...>
 *   METADATA <target> SET <key> [:value]
 *   METADATA <target> LIST
 *   METADATA <target> CLEAR
 *   METADATA * SUB <key...>
 *   METADATA * UNSUB <key...>
 *
 * References:
 * - https://ircv3.net/specs/extensions/metadata-3.2
 */

export const METADATA_CAP_2 = "draft/metadata-2";
export const METADATA_CAP_3 = "draft/metadata-3";
export const METADATA_CAP_3_2 = "draft/metadata-3.2";
export const METADATA_NOTIFY_CAP = "draft/metadata-notify-2";

export type MetadataSubcommand = "GET" | "SET" | "LIST" | "CLEAR" | "SUB" | "UNSUB" | "SYNC";

export interface MetadataParams {
  target: string;
  subcommand: MetadataSubcommand;
  key?: string;
  value?: string;
  keys?: string[];
}

export function parseMetadataCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: MetadataParams;
} {
  if (params.length < 2) {
    return { ok: false, error: "Need more parameters: METADATA <target> <subcommand> ..." };
  }

  const target = params[0].trim();
  const subcommand = params[1].toUpperCase() as MetadataSubcommand;

  switch (subcommand) {
    case "GET":
    case "SUB":
    case "UNSUB":
      return {
        ok: true,
        data: {
          target,
          subcommand,
          keys: params.slice(2),
        },
      };
    case "SET":
      return {
        ok: true,
        data: {
          target,
          subcommand,
          key: params[2]?.trim(),
          value: params[3]?.trim(),
        },
      };
    case "LIST":
    case "CLEAR":
    case "SYNC":
      return {
        ok: true,
        data: {
          target,
          subcommand,
        },
      };
    default:
      return { ok: false, error: `Unknown METADATA subcommand: ${subcommand}` };
  }
}
