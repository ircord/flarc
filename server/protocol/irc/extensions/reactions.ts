/**
 * IRCv3 Reactions Protocol Extension (+draft/react, +draft/unreact)
 *
 * Implements emoji reactions over IRC using TAGMSG:
 *   @+draft/react=👍;+reply=<msgid> TAGMSG <target>
 *   @+draft/unreact=👍;+reply=<msgid> TAGMSG <target>
 *
 * References:
 * - IRCv3 draft/react specification
 * - IRCv3 draft/reply specification
 */

export const REACT_CAP = "draft/react";
export const TAG_REACT = "+draft/react";
export const TAG_UNREACT = "+draft/unreact";
export const TAG_REPLY = "+draft/reply";
export const TAG_FALLBACK_REPLY = "+reply";

export interface ReactionInfo {
  isReaction: boolean;
  isUnreact: boolean;
  emoji: string | null;
  targetMessageId: string | null;
}

export function extractReactionInfo(tags?: Record<string, string | true> | null): ReactionInfo {
  if (!tags) {
    return { isReaction: false, isUnreact: false, emoji: null, targetMessageId: null };
  }

  const reactVal = tags[TAG_REACT];
  const unreactVal = tags[TAG_UNREACT];
  const replyVal = tags[TAG_REPLY] || tags[TAG_FALLBACK_REPLY];

  const targetMessageId = typeof replyVal === "string" ? replyVal.trim() : null;

  if (typeof reactVal === "string" && reactVal.length > 0) {
    return {
      isReaction: true,
      isUnreact: false,
      emoji: reactVal,
      targetMessageId,
    };
  }

  if (typeof unreactVal === "string" && unreactVal.length > 0) {
    return {
      isReaction: true,
      isUnreact: true,
      emoji: unreactVal,
      targetMessageId,
    };
  }

  return { isReaction: false, isUnreact: false, emoji: null, targetMessageId: null };
}
