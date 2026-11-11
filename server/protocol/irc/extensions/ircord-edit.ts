/**
 * IRCord Message Editing Protocol Extension (+ircord/edit)
 *
 * Implements message editing via the +ircord/edit client message tag.
 * Clients request the edit by sending a PRIVMSG tagged with:
 *   @+ircord/edit=<original-msgid> PRIVMSG <target> :<new text>
 *
 * The server verifies ownership, applies the update, assigns a new msgid,
 * and broadcasts the edit tagged with:
 *   @msgid=<new-msgid>;time=<timestamp>;+ircord/edit=<original-msgid>;account=<account>
 *
 * References:
 * - IRCord Message Editing Draft Spec
 * - IRCv3 client-tags & echo-message specifications
 */

export const IRCORD_EDIT_CAP = "ircord/edit";
export const IRCORD_EDIT_TAG = "+ircord/edit";
export const DRAFT_EDIT_TAG = "+draft/edit";
export const FALLBACK_EDIT_TAG = "+edit";

export interface EditTagInfo {
  isEdit: boolean;
  originalMessageId: string | null;
  tagUsed: string | null;
}

/**
 * Extracts and normalizes edit target msgid from incoming message tags.
 */
export function extractEditTag(tags?: Record<string, string | true> | null): EditTagInfo {
  if (!tags) {
    return { isEdit: false, originalMessageId: null, tagUsed: null };
  }

  const editId = tags[IRCORD_EDIT_TAG] || tags[DRAFT_EDIT_TAG] || tags[FALLBACK_EDIT_TAG];
  if (typeof editId === "string" && editId.trim().length > 0) {
    const tagUsed = tags[IRCORD_EDIT_TAG]
      ? IRCORD_EDIT_TAG
      : tags[DRAFT_EDIT_TAG]
        ? DRAFT_EDIT_TAG
        : FALLBACK_EDIT_TAG;
    return {
      isEdit: true,
      originalMessageId: editId.trim(),
      tagUsed,
    };
  }

  return { isEdit: false, originalMessageId: null, tagUsed: null };
}

/**
 * Validates whether a user/session has permission to edit an existing message.
 */
export function canEditMessage(
  originalMessage: {
    senderSessionId?: string | null;
    senderAccount?: string | null;
    senderNick?: string | null;
  },
  actor: {
    sessionId: string;
    accountName: string | null;
    nickname: string;
    isOper?: boolean;
  },
): boolean {
  if (actor.isOper) {
    return true;
  }
  if (actor.accountName && originalMessage.senderAccount) {
    return actor.accountName.toLowerCase() === originalMessage.senderAccount.toLowerCase();
  }
  if (originalMessage.senderSessionId) {
    return originalMessage.senderSessionId === actor.sessionId;
  }
  return false;
}
