/**
 * IRCv3 Chat History Protocol Extension (chathistory, draft/chathistory)
 *
 * Implements message history retrieval:
 *   CHATHISTORY LATEST <target> <msgid|timestamp> <limit>
 *   CHATHISTORY BEFORE <target> <msgid|timestamp> <limit>
 *   CHATHISTORY AFTER <target> <msgid|timestamp> <limit>
 *   CHATHISTORY BETWEEN <target> <start> <end> <limit>
 *   CHATHISTORY TARGETS <start> <end> <limit>
 *
 * References:
 * - IRCv3 chathistory specification
 */

export const CHATHISTORY_CAP = "chathistory";
export const DRAFT_CHATHISTORY_CAP = "draft/chathistory";

export type ChatHistorySubcommand = "LATEST" | "BEFORE" | "AFTER" | "BETWEEN" | "TARGETS";

export interface ChatHistoryParams {
  subcommand: ChatHistorySubcommand;
  target?: string;
  ref1?: string;
  ref2?: string;
  limit: number;
}

export function parseChatHistoryCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: ChatHistoryParams;
} {
  if (params.length < 2) {
    return { ok: false, error: "Need more parameters for CHATHISTORY" };
  }

  const subcommand = params[0].toUpperCase() as ChatHistorySubcommand;
  const validSubcommands: ChatHistorySubcommand[] = [
    "LATEST",
    "BEFORE",
    "AFTER",
    "BETWEEN",
    "TARGETS",
  ];

  if (!validSubcommands.includes(subcommand)) {
    return { ok: false, error: `Unknown CHATHISTORY subcommand: ${subcommand}` };
  }

  if (subcommand === "TARGETS") {
    const ref1 = params[1];
    const ref2 = params[2];
    const limit = Math.min(Math.max(1, parseInt(params[3] || "50", 10)), 100);
    return {
      ok: true,
      data: { subcommand, ref1, ref2, limit },
    };
  }

  const target = params[1];
  const ref1 = params[2];
  let ref2: string | undefined;
  let limit = 50;

  if (subcommand === "BETWEEN") {
    ref2 = params[3];
    limit = Math.min(Math.max(1, parseInt(params[4] || "50", 10)), 100);
  } else {
    limit = Math.min(Math.max(1, parseInt(params[3] || "50", 10)), 100);
  }

  return {
    ok: true,
    data: {
      subcommand,
      target,
      ref1,
      ref2,
      limit,
    },
  };
}
