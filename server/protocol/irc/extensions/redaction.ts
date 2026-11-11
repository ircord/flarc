/**
 * IRCv3 Message Redaction Protocol Extension (draft/message-redaction)
 *
 * Implements message redaction / deletion over IRC:
 *   REDACT <target> <msgid> [:reason]
 *
 * Server broadcasts redaction notices:
 *   @msgid=<new-msgid>;time=<timestamp> REDACT <target> <target-msgid> [:reason]
 *
 * References:
 * - IRCv3 draft/message-redaction specification
 */

export const REDACTION_CAP = "draft/message-redaction";

export interface RedactCommandParams {
  target: string;
  targetMsgId: string;
  reason?: string;
}

export function parseRedactCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: RedactCommandParams;
} {
  if (params.length < 2) {
    return {
      ok: false,
      error: "Need more parameters: REDACT <target> <msgid> [:reason]",
    };
  }

  const target = params[0].trim();
  const targetMsgId = params[1].trim();
  const reason = params[2]?.trim();

  return {
    ok: true,
    data: {
      target,
      targetMsgId,
      reason,
    },
  };
}
