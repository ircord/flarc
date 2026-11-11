/**
 * IRCv3 Multiline Protocol Extension (draft/multiline)
 *
 * Implements atomic multiline message transmission via client-batches.
 * Allows IRC clients to send large multi-line pastes atomically without flood bans.
 *
 * Capabilities:
 *   draft/multiline=max-bytes=4096,max-lines=32
 *
 * References:
 * - https://ircv3.net/specs/extensions/multiline
 */

export const MULTILINE_CAP = "draft/multiline";
export const MULTILINE_MAX_BYTES = 4096;
export const MULTILINE_MAX_LINES = 32;

export interface MultilineLine {
  content: string;
  concat: boolean;
}

export interface PendingMultilineBatch {
  ref: string;
  target: string;
  command: "PRIVMSG" | "NOTICE" | null;
  tags: Record<string, string | true>;
  lines: MultilineLine[];
  totalBytes: number;
  label?: string;
}

/**
 * Validates whether an incoming line conforms to multiline size limits.
 */
export function validateMultilineLine(
  batch: PendingMultilineBatch,
  lineContent: string,
): { ok: boolean; error?: string } {
  if (batch.lines.length >= MULTILINE_MAX_LINES) {
    return {
      ok: false,
      error: `Multiline message exceeds maximum line limit of ${MULTILINE_MAX_LINES}`,
    };
  }

  const lineBytes = new TextEncoder().encode(lineContent).length;
  if (batch.totalBytes + lineBytes > MULTILINE_MAX_BYTES) {
    return {
      ok: false,
      error: `Multiline message exceeds maximum byte limit of ${MULTILINE_MAX_BYTES}`,
    };
  }

  return { ok: true };
}
