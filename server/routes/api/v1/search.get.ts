import { createError, defineEventHandler, getQuery } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { normalizeTagFilter, parseSearchFilterString } from "~/protocol/irc/extensions/search";
import { canAccessChannelHistory, getEnv, parseChannelParam } from "~/utils/auth";

const searchSchema = z.object({
  q: z.string().optional(),
  in: z.union([z.string(), z.array(z.string())]).optional(),
  conversationId: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  sender: z.string().optional(),
  from: z.union([z.string(), z.array(z.string())]).optional(),
  mentions: z.union([z.string(), z.array(z.string())]).optional(),
  has: z.union([z.string(), z.array(z.string())]).optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  on: z.string().optional(),
  author: z.enum(["user", "bot"]).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  pinned: z.union([z.boolean(), z.string()]).optional(),
  cursor: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const queryParams = getQuery(event);
  const parsed = searchSchema.safeParse(queryParams);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Validation error",
      data: parsed.error.issues,
    });
  }

  // Parse inline filters from q string (Discord/IRCord style)
  const inline = parsed.data.q ? parseSearchFilterString(parsed.data.q) : null;
  const toArray = (val?: string | string[]) => (Array.isArray(val) ? val : val ? [val] : []);

  const rawIn = [...toArray(parsed.data.in), ...toArray(parsed.data.conversationId)];
  const targetChannels = Array.from(
    new Set([
      ...(inline?.in ?? []),
      ...rawIn.map((c) => (c.startsWith("#") || c.startsWith("&") ? c : `#${c}`)),
    ]),
  );

  const fromFilters = Array.from(
    new Set([
      ...(inline?.from ?? []),
      ...toArray(parsed.data.from),
      ...(parsed.data.sender ? [parsed.data.sender] : []),
    ]),
  );

  const mentionsFilters = Array.from(
    new Set([...(inline?.mentions ?? []), ...toArray(parsed.data.mentions)]),
  );

  const hasFilters = Array.from(
    new Set([...(inline?.has ?? []), ...(toArray(parsed.data.has) as any[])]),
  );

  const rawTags = toArray(parsed.data.tag);
  const tagFilters = [
    ...(inline?.tags ?? []),
    ...rawTags.map((t) => {
      const idx = t.indexOf("=");
      return idx !== -1
        ? normalizeTagFilter({ key: t.slice(0, idx), value: t.slice(idx + 1) })
        : normalizeTagFilter({ key: t });
    }),
  ];

  const query = inline?.query ?? parsed.data.q ?? "";
  const before = parsed.data.before ?? inline?.before;
  const after = parsed.data.after ?? inline?.after;
  const on = parsed.data.on ?? inline?.on;
  const author = parsed.data.author ?? inline?.author;
  const limit = parsed.data.limit ?? inline?.limit ?? 50;

  const pinnedParam = parsed.data.pinned;
  const pinned =
    inline?.pinned !== undefined
      ? inline.pinned
      : typeof pinnedParam === "boolean"
        ? pinnedParam
        : typeof pinnedParam === "string"
          ? ["true", "1", "yes"].includes(pinnedParam.toLowerCase())
          : undefined;

  // Parse pagination cursor (base64url { at: string, id: string })
  let cursor: { at: string; id: string } | undefined;
  if (parsed.data.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(parsed.data.cursor, "base64url").toString());
      if (decoded && typeof decoded.at === "string" && typeof decoded.id === "string") {
        cursor = decoded;
      }
    } catch {}
  }

  if (
    !query &&
    fromFilters.length === 0 &&
    mentionsFilters.length === 0 &&
    hasFilters.length === 0 &&
    !before &&
    !after &&
    !on &&
    !author &&
    tagFilters.length === 0 &&
    targetChannels.length === 0 &&
    pinned === undefined
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Search query or at least one filter parameter is required",
    });
  }

  const env = getEnv(event);
  const sessionStub = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));

  let channelsToSearch = targetChannels;
  if (channelsToSearch.length === 0) {
    try {
      const activeChannels = await sessionStub.adminListChannels();
      channelsToSearch =
        activeChannels && activeChannels.length > 0
          ? activeChannels.map((c: any) => c.channelName || c.name)
          : ["#general"];
    } catch {
      channelsToSearch = ["#general"];
    }
  }

  const allResults: any[] = [];

  for (const chan of channelsToSearch) {
    const access = await canAccessChannelHistory(event, chan);
    if (!access.allowed) {
      if (targetChannels.length > 0) {
        throw createError({
          statusCode: 403,
          statusMessage: access.reason || `Forbidden: Cannot search messages in channel ${chan}`,
        });
      }
      // In broad global search, skip private/secret channels the user cannot access
      continue;
    }

    const { name, canon } = parseChannelParam(chan);
    const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));
    try {
      const messages = await (stub as any).searchMessages(query, {
        limit: limit + 1,
        from: fromFilters,
        mentions: mentionsFilters,
        has: hasFilters,
        before,
        after,
        on,
        author,
        tags: tagFilters,
        pinned,
        cursor,
      });
      for (const m of messages) {
        allResults.push({ ...m, channel: name });
      }
    } catch {
      // Channel DO might not exist yet
    }
  }

  allResults.sort((a, b) => b.createdAt - a.createdAt || (b.id < a.id ? -1 : 1));
  const hasMore = allResults.length > limit;
  const sliced = allResults.slice(0, limit);

  // IRCord frontend compatible items structure
  const items = sliced.map((m) => ({
    message: {
      id: m.id,
      conversationId: m.channel,
      senderId: m.senderNick,
      senderNick: m.senderNick,
      senderUser: m.senderUser,
      senderHost: m.senderHost,
      senderAccount: m.senderAccount,
      text: m.content,
      content: m.content,
      tags: m.tags ?? {},
      createdAt: new Date(m.createdAt).toISOString(),
    },
    conversation: {
      id: m.channel,
      name: m.channel.replace(/^[#&]/, ""),
      networkId: SERVER_CONFIG.networkId,
      kind: "channel",
    },
  }));

  const lastItem = items.at(-1)?.message;
  const nextCursor =
    hasMore && lastItem
      ? Buffer.from(JSON.stringify({ at: lastItem.createdAt, id: lastItem.id })).toString(
          "base64url",
        )
      : null;

  return {
    ok: true,
    channels: channelsToSearch,
    query,
    filters: {
      in: targetChannels.length ? targetChannels : undefined,
      from: fromFilters.length ? fromFilters : undefined,
      mentions: mentionsFilters.length ? mentionsFilters : undefined,
      has: hasFilters.length ? hasFilters : undefined,
      before,
      after,
      on,
      author,
      tags: tagFilters.length ? tagFilters : undefined,
      pinned,
    },
    count: sliced.length,
    items,
    nextCursor,
    messages: sliced,
  };
});
