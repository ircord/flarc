/**
 * IRCv3 RelayMsg Protocol Extension (draft/relaymsg)
 *
 * Implements message relaying from authorized services/bots:
 *   RELAYMSG <target> <sender-nick> :<message text>
 *
 * Capabilities:
 *   draft/relaymsg=/
 *
 * References:
 * - https://ircv3.net/specs/extensions/relaymsg
 */

export const RELAYMSG_CAP = "draft/relaymsg";

export interface RelayMsgParams {
  target: string;
  senderNick: string;
  content: string;
}

export function parseRelayMsgCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: RelayMsgParams;
} {
  if (params.length < 3) {
    return {
      ok: false,
      error: "Need more parameters: RELAYMSG <target> <sender-nick> :<text>",
    };
  }

  return {
    ok: true,
    data: {
      target: params[0].trim(),
      senderNick: params[1].trim(),
      content: params.slice(2).join(" ").trim(),
    },
  };
}
