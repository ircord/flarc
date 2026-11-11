import { createError, defineEventHandler, getQuery, getRouterParam } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import { normalizeTagFilter, parseSearchFilterString } from "~/protocol/irc/extensions/search";
import { canAccessChannelHistory, clientRequest, getEnv, parseChannelParam } from "~/utils/auth";

const searchSchema = z.object({
  q: z.string().optional(),
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
  const channel = getRouterParam(event, "channel", { decode: true });
  if (!channel) {
    throw createError({ statusCode: 400, statusMessage: "Channel required" });
  }

  // Check channel access permissions (private/secret/invite-only channels require membership or admin)
  const access = await canAccessChannelHistory(event, channel);
  if (!access.allowed) {
    throw createError({
      statusCode: 403,
      statusMessage: access.reason || "Forbidden: Cannot search messages in this channel",
    });
  }

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
    pinned === undefined
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Search query or at least one filter parameter is required",
    });
  }

  const { name, canon } = parseChannelParam(channel);
  const env = getEnv(event);
  const stub = env.CHANNELS.get(env.CHANNELS.idFromName(`${SERVER_CONFIG.networkId}:${canon}`));

  const rawMessages = await clientRequest(event, stub, "search", {
    query,
    options: {
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
    },
  });

  const hasMore = rawMessages.length > limit;
  const messages = rawMessages.slice(0, limit);

  const items = messages.map((m: any) => ({
    message: {
      id: m.id,
      conversationId: name,
      senderId: m.senderId,
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
      id: name,
      name: name.replace(/^[#&]/, ""),
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
    channel: name,
    query,
    filters: {
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
    count: messages.length,
    items,
    nextCursor,
    messages,
  };
});
