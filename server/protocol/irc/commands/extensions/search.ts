import { SERVER_CONFIG } from "~/core/config";
import type { SessionAttachment } from "~/core/types";
import { encodeIRCMessage } from "~/protocol/irc/encoder";
import { parseSearchCommand } from "~/protocol/irc/extensions/search";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { IRCMessage } from "~/protocol/irc/types";
import type { ISessionDO } from "../types";

export async function handleSearch(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  msg: IRCMessage,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parsed = parseSearchCommand(msg.params);
  if (!parsed.ok || !parsed.data) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NEEDMOREPARAMS,
      ["SEARCH", parsed.error || "Not enough parameters"],
      labelTags,
    );
    return;
  }
  const { target, query, limit, from, mentions, has, before, after, on, author, tags } =
    parsed.data;
  const canon = canonicalizeIRCName(target);
  const channelStub = session.env.CHANNELS.get(
    session.env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`),
  );
  if (
    !attachment.accountName ||
    !(await channelStub.canReadAccount({
      id: attachment.userId,
      username: attachment.accountName,
      isAdmin: attachment.isOper,
    }))
  ) {
    session.sendNumeric(
      ws,
      attachment,
      Numerics.ERR_NOTONCHANNEL,
      [target, "Channel access denied"],
      labelTags,
    );
    return;
  }
  const results = (await (channelStub as any).searchMessages(query, {
    limit,
    from,
    mentions,
    has,
    before,
    after,
    on,
    author,
    tags,
  })) as any[];

  const batchId = crypto.randomUUID().slice(0, 8);
  const hasBatch = session.hasCap(attachment, "batch");
  if (hasBatch) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, labelTags),
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`+${batchId}`, "draft/search", target],
      }),
    );
  }

  for (const m of results) {
    const msgTags: Record<string, string | true> = {
      ...(hasBatch ? { batch: batchId } : {}),
      msgid: m.id,
      time: new Date(m.createdAt).toISOString(),
      ...(m.senderAccount ? { account: m.senderAccount } : {}),
      ...(m.tags ?? {}),
    };
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        tags: session.filterOutgoingTags(attachment, msgTags),
        prefix: `${m.senderNick}!${m.senderUser}@${m.senderHost}`,
        command: m.command,
        params: [target, m.content],
      }),
    );
  }

  if (hasBatch) {
    session.sendLine(
      ws,
      attachment,
      encodeIRCMessage({
        prefix: SERVER_CONFIG.serverName,
        command: "BATCH",
        params: [`-${batchId}`],
      }),
    );
  } else {
    session.sendNumeric(
      ws,
      attachment,
      "709",
      [target, `Found ${results.length} matches`],
      labelTags,
    );
  }
}
