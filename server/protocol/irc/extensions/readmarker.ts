/**
 * IRCv3 Read Marker Protocol Extension (draft/read-marker)
 *
 * Implements read position tracking across devices:
 *   MARKREAD <target> [timestamp=<ISO8601> | msgid=<id>]
 *
 * References:
 * - IRCv3 draft/read-marker specification
 */

export const READMARKER_CAP = "draft/read-marker";

export interface MarkReadParams {
  target: string;
  timestamp?: string;
  msgid?: string;
}

export function parseMarkReadCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: MarkReadParams;
} {
  if (params.length < 1) {
    return { ok: false, error: "Need more parameters: MARKREAD <target> [timestamp=...]" };
  }

  const target = params[0].trim();
  let timestamp: string | undefined;
  let msgid: string | undefined;

  for (let i = 1; i < params.length; i++) {
    const p = params[i];
    if (p.startsWith("timestamp=")) {
      timestamp = p.slice(10);
    } else if (p.startsWith("msgid=")) {
      msgid = p.slice(6);
    } else if (p.startsWith("before=")) {
      timestamp = p.slice(7);
    } else if (!timestamp && !msgid) {
      timestamp = p;
    }
  }

  return {
    ok: true,
    data: {
      target,
      timestamp,
      msgid,
    },
  };
}
