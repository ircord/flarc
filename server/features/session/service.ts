import { z } from "zod";
import {
  ConversationCreateSchema,
  ConversationEditSchema,
  ConversationReadSchema,
  ConversationRedactSchema,
  ConversationSendSchema,
  EventSubscriptionsSchema,
} from "../../schemas/conversations";
import { FeatureError } from "../operations";
import type {
  EventSubscriptions,
  JournalResource,
  SessionActor,
  SessionCredential,
  SessionFeatureHost,
} from "./contracts";
import type { ConversationStore, MessageIdentity } from "./conversations";
import type { SessionJournal } from "./journal";

export class SessionFeatures {
  constructor(
    private readonly host: SessionFeatureHost,
    readonly conversations: ConversationStore,
    readonly journal: SessionJournal,
  ) {}

  private identity(actor: { id: string; username: string; roles?: string[] }): MessageIdentity {
    return {
      id: actor.id,
      username: actor.username,
      nickname: actor.username,
      user: actor.username,
      host: "api.flarc.local",
      roles: actor.roles ?? [],
    };
  }

  private selectors(actor: SessionActor, id: string, input: any, writing = false) {
    this.conversations.requireMember(id, actor.id);
    const members = this.conversations.members(id);
    for (const field of ["senderId", "recipientId"])
      if (input[field] && !members.includes(input[field]))
        throw new FeatureError(403, "SELECTOR_FORBIDDEN", "Selector is outside this conversation");
    if (writing && input.senderId && input.senderId !== actor.id)
      throw new FeatureError(403, "SENDER_FORBIDDEN", "Sender must be the authenticated actor");
  }

  async subscribe(actor: SessionActor, raw: unknown): Promise<EventSubscriptions> {
    const input = EventSubscriptionsSchema.parse(raw);
    const requested: JournalResource[] = [
      ...(input.channels ?? []).map((c) => ({
        kind: "channel" as const,
        id: c.channel,
        generation: c.generation,
      })),
      ...(input.conversations ?? []).map((id) => ({ kind: "conversation" as const, id })),
      ...(input.profiles ?? []).map((id) => ({ kind: "profile" as const, id })),
    ];
    for (const resource of requested)
      if (!(await this.host.authorizeEvent(actor, resource)))
        throw new FeatureError(403, "SUBSCRIPTION_FORBIDDEN", "Subscription access denied");
    return input;
  }

  matches(subscriptions: EventSubscriptions | undefined, resource: JournalResource) {
    if (!subscriptions) return true; // Existing automatic current-authority filtering.
    if (resource.kind === "conversation")
      return subscriptions.conversations?.includes(resource.id) ?? false;
    if (resource.kind === "profile") return subscriptions.profiles?.includes(resource.id) ?? false;
    if (resource.kind === "account") return true;
    return (
      subscriptions.channels?.some(
        (c) =>
          c.channel.toLowerCase() === resource.id.toLowerCase() &&
          c.generation === resource.generation,
      ) ?? false
    );
  }

  async execute(credential: SessionCredential, operation: string, input: any): Promise<any> {
    const allowed = new Set([
      "conversations.list",
      "conversations.create",
      "conversation.get",
      "conversation.history",
      "conversation.message",
      "messages.get",
      "conversation.send",
      "conversation.edit",
      "conversation.redact",
      "conversation.read",
      "conversation.unread",
      "events.replay",
      "events.bootstrap",
    ]);
    if (!allowed.has(operation))
      throw new FeatureError(400, "UNKNOWN_OPERATION", "Unknown conversation/event operation");
    const resource = typeof input?.conversationId === "string" ? input.conversationId : "*";
    const mutating = [
      "conversations.create",
      "conversation.send",
      "conversation.edit",
      "conversation.redact",
      "conversation.read",
    ].includes(operation);
    const scope = operation.startsWith("events.")
      ? operation
      : mutating
        ? "conversation.write"
        : "conversation.read";
    const actor = await this.host.actor(credential, scope, resource);
    if (operation === "conversations.list")
      return this.conversations.page(
        actor,
        z.coerce.number().int().min(1).max(100).optional().parse(input?.limit),
        z.string().uuid().optional().parse(input?.after),
      );
    if (operation === "events.bootstrap")
      return {
        cursor: this.journal.cursor(actor.id),
        conversations: this.conversations.list(actor),
        recovery: {
          mode: "cursor-before-snapshot",
          deduplicateBy: ["eventId", "resource revision"],
          readOnlyReplay: true,
        },
      };
    if (operation === "events.replay")
      return this.journal.replay(
        actor,
        z.string().max(128).parse(input?.cursor),
        z.coerce.number().int().min(1).max(100).optional().parse(input?.limit),
      );
    if (operation === "conversations.create") {
      const args = ConversationCreateSchema.parse(input);
      const target = await this.host.account(args.peer, true);
      if (!target) throw new FeatureError(404, "PEER_NOT_FOUND", "Peer account not found");
      await this.host.actor(credential, scope, resource);
      const result = this.conversations.run(
        actor.id,
        args.clientOperationId,
        { operation, peerId: target.id },
        () => {
          const id = this.conversations.ensure(actor.id, target.id);
          return {
            conversation: this.conversations.describe(id, actor.id),
          };
        },
      );
      this.host.notifyJournal();
      return result;
    }
    if (operation === "messages.get")
      return {
        message: this.conversations.message(
          actor.id,
          z.string().min(1).max(128).parse(input?.messageId),
        ),
      };
    const id = z.string().uuid().parse(input?.conversationId);
    this.selectors(actor, id, input);
    if (operation === "conversation.get")
      return {
        conversation: this.conversations.describe(id, actor.id),
        unread: this.conversations.unread(id, actor.id),
      };
    if (operation === "conversation.unread")
      return { conversationId: id, unread: this.conversations.unread(id, actor.id) };
    if (operation === "conversation.message") {
      const message = this.conversations.message(
        actor.id,
        z.string().max(128).parse(input.messageId),
        id,
      );
      if (
        (input.senderId && input.senderId !== message.senderId) ||
        (input.recipientId && input.recipientId !== message.recipientId)
      )
        throw new FeatureError(404, "MESSAGE_NOT_FOUND", "Message does not match selectors");
      return { message };
    }
    if (operation === "conversation.history") {
      const result = this.conversations.history(
        actor.id,
        id,
        input.limit,
        input.before,
        input.after,
        input.senderId,
        input.recipientId,
      );
      if (input.senderId)
        result.messages = result.messages.filter((m) => m.senderId === input.senderId);
      if (input.recipientId)
        result.messages = result.messages.filter((m) => m.recipientId === input.recipientId);
      return result;
    }
    if (operation === "conversation.read") {
      const args = ConversationReadSchema.parse(input);
      const result = this.conversations.run(
        actor.id,
        args.clientOperationId,
        { operation, ...args },
        () => this.conversations.markRead(actor.id, id, args.messageId),
      );
      this.host.notifyJournal();
      return result;
    }
    if (operation === "conversation.send") {
      const args = ConversationSendSchema.parse(input);
      this.selectors(actor, id, args, true);
      const peerId = this.conversations.members(id).find((value) => value !== actor.id) ?? actor.id;
      if (args.recipientId && args.recipientId !== peerId)
        throw new FeatureError(403, "RECIPIENT_FORBIDDEN", "Recipient selector mismatch");
      const peer = await this.host.account(peerId, true);
      if (!peer) throw new FeatureError(404, "PEER_NOT_FOUND", "Peer account is unavailable");
      // The actor is checked again after the external target lookup.
      await this.host.actor(credential, "conversation.write", id);
      let created = false;
      const message = this.conversations.run(
        actor.id,
        args.clientOperationId,
        { operation, ...args },
        () => {
          created = true;
          const tags = Object.fromEntries(
            Object.entries(args.tags ?? {}).filter(
              ([key]) =>
                key.startsWith("+") && !["+ircord/edit", "+draft/edit", "+edit"].includes(key),
            ),
          );
          if (Object.keys(tags).length > 32)
            throw new FeatureError(400, "TOO_MANY_TAGS", "Too many message tags");
          const stored = this.conversations.append(this.identity(actor), this.identity(peer), {
            id: crypto.randomUUID(),
            command: "PRIVMSG",
            content: args.content,
            tags,
          });
          return this.conversations.message(actor.id, stored.id, id);
        },
      );
      if (created) await this.host.deliverMessage(message, actor.id, peerId);
      this.host.notifyJournal();
      return { message };
    }
    const args = (
      operation === "conversation.edit" ? ConversationEditSchema : ConversationRedactSchema
    ).parse(input);
    const peerId = this.conversations.members(id).find((value) => value !== actor.id) ?? actor.id;
    const peer = await this.host.account(peerId, false);
    if (!peer) throw new FeatureError(404, "PEER_NOT_FOUND", "Retained peer identity unavailable");
    await this.host.actor(credential, "conversation.write", id);
    let changed = false;
    const message = this.conversations.run(
      actor.id,
      args.clientOperationId,
      { operation, ...args },
      () => {
        const current = this.conversations.message(actor.id, args.messageId, id);
        if (current.senderId !== actor.id)
          throw new FeatureError(
            403,
            "MESSAGE_FORBIDDEN",
            "Only the author may change this message",
          );
        if (current.revision !== args.expectedRevision)
          throw new FeatureError(409, "REVISION_CONFLICT", "Message revision changed");
        if (current.redacted)
          throw new FeatureError(409, "MESSAGE_REDACTED", "Message is redacted");
        changed = true;
        if (operation === "conversation.redact")
          this.conversations.redact(actor.id, args.messageId);
        else {
          this.conversations.append(this.identity(actor), this.identity(peer), {
            id: crypto.randomUUID(),
            command: "PRIVMSG",
            content: (args as z.infer<typeof ConversationEditSchema>).content,
            tags: { "+ircord/edit": args.messageId },
          });
        }
        return this.conversations.message(actor.id, args.messageId, id);
      },
    );
    if (changed)
      await this.host.deliverMessage(
        message,
        actor.id,
        this.conversations.members(id).find((value) => value !== actor.id) ?? actor.id,
      );
    this.host.notifyJournal();
    return { message };
  }
}
