import { hashSessionToken } from "../../core/authentication/tokens";
import { accountSourceMask, type RequestSource } from "../../core/request-source";
import type { SessionDO } from "../../durable-objects/session";
import { encodeIRCMessage } from "../../protocol/irc/encoder";
import { Numerics } from "../../protocol/irc/numerics";
import { canonicalizeIRCName } from "../../protocol/irc/parser";
import {
  ChannelLifecycleInputSchema,
  ChannelMutationInputSchemas,
  EventBootstrapQuerySchema,
  EventCommandSchema,
  MetadataMutationSchema,
} from "../../schemas/conversations";
import { UserProfileInputSchema, UserProfileSchema } from "../../schemas/profiles";
import { FeatureError, isAuthorizationDenial, operationId } from "../operations";
import { BootstrapPages } from "./bootstrap-pages";
import type {
  EventSubscriptions,
  JournalResource,
  SessionActor,
  SessionCredential,
  SessionFeatureHost,
} from "./contracts";
import { ConversationStore } from "./conversations";
import { EVENT_INPUT_LIMITS } from "./event-input-limits";
import { SessionJournal } from "./journal";
import { initializeSessionFeatures } from "./migrations";
import { SessionFeatures } from "./service";

type EventAttachment = {
  eventSessionHash: string;
  eventSource?: RequestSource;
  accountId: string;
  connectionId?: string;
  cursor?: string;
  subscriptions?: EventSubscriptions;
};

export class SessionFeatureBridge {
  readonly journal: SessionJournal;
  readonly bootstrapPages: BootstrapPages;
  readonly conversations: ConversationStore;
  readonly service: SessionFeatures;
  private profileDrain?: Promise<void>;
  private pushDrain?: Promise<void>;
  private deliveries = new WeakMap<WebSocket, Promise<void>>();
  private inputLimits = new WeakMap<WebSocket, { start: number; count: number }>();
  private inputs = new WeakMap<WebSocket, { count: number; bytes: number; tail: Promise<void> }>();

  constructor(
    private readonly session: SessionDO,
    private readonly runtime: {
      storage: DurableObjectStorage;
      sockets: () => WebSocket[];
      waitUntil: (task: Promise<unknown>) => void;
    },
  ) {
    initializeSessionFeatures(session.sql);
    const host: SessionFeatureHost = {
      sql: session.sql,
      storage: runtime.storage,
      actor: (...args) => this.actor(...args),
      authorizeEvent: (...args) => this.authorizeEvent(...args),
      authorizePayload: (...args) => this.authorizePayload(...args),
      account: (...args) => this.account(...args),
      notifyJournal: () => this.notify(),
      deliverMessage: (...args) => this.deliverMessage(...args),
    };
    const env = session.env as unknown as Record<string, unknown>;
    this.journal = new SessionJournal(
      host,
      Number(env.EVENT_JOURNAL_MAX_EVENTS) || 10000,
      Number(env.EVENT_JOURNAL_RETENTION_MS) || 86400000,
    );
    this.bootstrapPages = new BootstrapPages(
      session.sql,
      this.journal,
      Number(env.EVENT_JOURNAL_RETENTION_MS) || 86400000,
    );
    this.conversations = new ConversationStore(host, this.journal);
    this.service = new SessionFeatures(host, this.conversations, this.journal);
  }

  async actor(
    credential: SessionCredential,
    operation: string,
    resource: string,
  ): Promise<SessionActor> {
    const accounts: any = this.session.getAccountsStub();
    let account: any;
    if ("token" in credential) {
      account = await accounts.verifyApiSession(credential.token);
      if (!account) throw new FeatureError(401, "SESSION_EXPIRED", "Authentication required");
      if (operation && !(await accounts.authorizeCredential(credential.token, operation, resource)))
        throw new FeatureError(403, "SCOPE_FORBIDDEN", "Credential scope denied");
    } else if ("sessionHash" in credential) {
      account = await accounts.verifySessionHash(credential.sessionHash);
      if (!account) throw new FeatureError(401, "SESSION_EXPIRED", "Authentication required");
      if (
        operation &&
        !(await accounts.authorizeSessionHash(credential.sessionHash, operation, resource))
      )
        throw new FeatureError(403, "SCOPE_FORBIDDEN", "Credential scope denied");
    } else {
      const current = await this.session.getSessionActor(credential.ircSessionId);
      const attached = this.session.sessionsById.get(credential.ircSessionId)?.attachment;
      if (!current || !attached?.authenticated || !attached.accountName)
        throw new FeatureError(401, "SESSION_EXPIRED", "Authentication required");
      account = await accounts.getAccountByUsername(attached.accountName);
      if (
        !account ||
        account.id !== attached.userId ||
        account.credentialVersion !== attached.credentialVersion
      )
        throw new FeatureError(401, "SESSION_EXPIRED", "Authentication required");
      if (await accounts.isNetworkBanned(account.id, this.session.getSourceHostmask(attached)))
        throw new FeatureError(403, "NETWORK_BANNED", "Network access denied");
      if (
        operation &&
        !((attached as any).credentialSessionHash
          ? await accounts.authorizeSessionHash(
              (attached as any).credentialSessionHash,
              operation,
              resource,
            )
          : await accounts.authorizeAccountActor(
              account.id,
              account.credentialVersion,
              operation,
              resource,
            ))
      )
        throw new FeatureError(403, "SCOPE_FORBIDDEN", "Account scope denied");
    }
    if (
      "source" in credential &&
      credential.source &&
      (await accounts.isNetworkBanned(
        account.id,
        accountSourceMask(account.username, credential.source),
      ))
    )
      throw new FeatureError(403, "NETWORK_BANNED", "Network access denied");
    return {
      id: account.id,
      username: account.username,
      roles: account.roles,
      credentialVersion: account.credentialVersion ?? 0,
      credential,
    };
  }

  async account(selector: string, active = false) {
    const accounts: any = this.session.getAccountsStub();
    const resolved = await accounts.resolveConversationAccount(selector);
    if (!resolved) return null;
    if (active) {
      const current = await accounts.getAccountByUsername(resolved.username);
      if (!current || current.id !== resolved.id) return null;
    }
    return resolved;
  }

  async authorizeEvent(actor: SessionActor, resource: JournalResource): Promise<boolean> {
    try {
      const scope =
        resource.kind === "channel"
          ? "channel.read"
          : resource.kind === "conversation"
            ? "conversation.read"
            : resource.kind === "account"
              ? "events.read"
              : resource.ownerId
                ? "metadata.private.read"
                : "profile.read";
      const fresh = await this.actor(actor.credential, scope, resource.id);
      if (fresh.id !== actor.id || (resource.ownerId && resource.ownerId !== fresh.id))
        return false;
      if (resource.kind === "conversation")
        return this.conversations.hasMember(resource.id, fresh.id);
      if (resource.kind === "account") return resource.id === fresh.id;
      if (resource.kind === "profile") return Boolean(await this.account(resource.id, true));
      const snapshot = await this.session.getChannelStub(resource.id).getAccessSnapshot(fresh);
      return Boolean(snapshot.canRead && snapshot.generation === resource.generation);
    } catch (error) {
      if (isAuthorizationDenial(error)) return false;
      // Retain the caller's cursor on operational failures. Treating them as
      // denied would let replay silently scan past an authorized event.
      throw error;
    }
  }

  async authorizePayload(
    actor: SessionActor,
    event: any,
    resource: JournalResource,
  ): Promise<boolean> {
    if (
      !event.messageId ||
      ![
        "message.created",
        "message.updated",
        "conversation.message_created",
        "conversation.message_updated",
      ].includes(event.type)
    )
      return true;
    if (resource.kind === "conversation") {
      try {
        return !this.conversations.message(actor.id, event.messageId, resource.id).redacted;
      } catch (error) {
        if (error instanceof FeatureError && error.code === "MESSAGE_NOT_FOUND") return false;
        throw error;
      }
    }
    if (resource.kind === "channel") {
      const stub: any = this.session.getChannelStub(resource.id);
      return stub.validateJournalMessage({
        accountId: actor.id,
        credentialVersion: actor.credentialVersion,
        generation: resource.generation,
        messageId: event.messageId,
      });
    }
    return false;
  }
  private async registerChannelInterest(actor: SessionActor, channel: string, generation: string) {
    const canon = canonicalizeIRCName(channel),
      now = Date.now();
    this.session.sql.exec("DELETE FROM event_subscriptions WHERE expires_at<=?", now);
    const prior = this.session.sql
      .exec<{ subscription_id: string }>(
        "SELECT subscription_id FROM event_subscriptions WHERE account_id=? AND resource_id=? AND generation=?",
        actor.id,
        canon,
        generation,
      )
      .toArray()[0];
    if (
      !prior &&
      this.session.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM event_subscriptions WHERE account_id=?",
          actor.id,
        )
        .toArray()[0].count >= 100
    )
      throw new FeatureError(429, "SUBSCRIPTION_LIMIT", "Too many durable channel subscriptions");
    const id = prior?.subscription_id ?? crypto.randomUUID();
    this.session.sql.exec(
      "INSERT INTO event_subscriptions(account_id,subscription_id,resource_id,generation,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(account_id,resource_id,generation) DO UPDATE SET expires_at=excluded.expires_at,registered=0",
      actor.id,
      id,
      canon,
      generation,
      now + 900000,
    );
    const hash =
      "token" in actor.credential
        ? await hashSessionToken(actor.credential.token)
        : "sessionHash" in actor.credential
          ? actor.credential.sessionHash
          : this.session.sessionsById.get(actor.credential.ircSessionId)?.attachment
              .credentialSessionHash;
    const stub: any = this.session.getChannelStub(channel);
    const boundary = await stub.registerEventObserver({
      accountId: actor.id,
      credentialVersion: actor.credentialVersion,
      sessionHash: hash,
      channel,
      generation,
      subscriptionId: id,
      leaseMs: 900000,
    });
    await this.actor(actor.credential, "channel.read", canon);
    this.session.sql.exec(
      "UPDATE event_subscriptions SET registered=1,expires_at=?,revision=? WHERE account_id=? AND resource_id=? AND generation=? AND subscription_id=?",
      boundary.expiresAt,
      boundary.revision,
      actor.id,
      canon,
      generation,
      id,
    );
    return boundary;
  }
  private async channelSnapshot(actor: SessionActor, name: string, generation: string) {
    const channel: any = this.session.getChannelStub(name);
    if (!(await this.authorizeEvent(actor, { kind: "channel", id: name, generation })))
      throw new FeatureError(403, "CHANNEL_FORBIDDEN", "Channel access denied");
    const hash =
      "token" in actor.credential
        ? await hashSessionToken(actor.credential.token)
        : "sessionHash" in actor.credential
          ? actor.credential.sessionHash
          : this.session.sessionsById.get(actor.credential.ircSessionId)?.attachment
              .credentialSessionHash;
    const info = await channel.getChannelInfo(name);
    let history: any = null;
    if (hash)
      history = await channel.clientRequestWithHash(hash, "history", {
        channelName: name,
        expectedGeneration: generation,
        limit: 50,
      });
    const access = await channel.getAccessSnapshot(actor);
    if (access.generation !== generation || !access.canRead)
      throw new FeatureError(409, "SNAPSHOT_CHANGED", "Channel changed; resync required");
    const readMarker = await this.session.getAccountsStub().getReadMarker(actor.username, name);
    return { ...access, info, history, readMarker };
  }
  async legacyObservation(event: any, audience: string[], restrict: boolean) {
    if (restrict) return;
    for (const ws of this.runtime.sockets()) {
      const attachment = ws.deserializeAttachment() as EventAttachment;
      if (attachment.subscriptions || !attachment.eventSessionHash) continue;
      const actor = await this.actor(
        { sessionHash: attachment.eventSessionHash, source: attachment.eventSource },
        "channel.read",
        canonicalizeIRCName(event.channelId),
      ).catch(() => null);
      if (!actor || audience.includes(actor.id)) continue;
      if (
        (await this.authorizeEvent(actor, {
          kind: "channel",
          id: event.channelId,
          generation: event.channelGeneration,
        })) &&
        (await this.authorizePayload(actor, event, {
          kind: "channel",
          id: event.channelId,
          generation: event.channelGeneration,
        }))
      )
        this.session.sendEventFrame(ws, JSON.stringify({ ...event, transient: true }));
    }
  }
  async execute(credential: SessionCredential, operation: string, input: any): Promise<any> {
    try {
      return await this.executeDomain(credential, operation, input);
    } catch (error) {
      if (error instanceof FeatureError) throw error;
      if (error && typeof error === "object" && "name" in error && error.name === "ZodError")
        throw new FeatureError(400, "INVALID_INPUT", "Invalid request input");
      const text = error instanceof Error ? error.message : "";
      if (
        /generation changed|revision conflict|operation id conflict|client operation id conflict/i.test(
          text,
        )
      )
        throw new FeatureError(409, "CONFLICT", "Resource revision or operation changed");
      if (
        /access denied|management denied|membership required|authorization required|Only.*founder|scope denied/i.test(
          text,
        )
      )
        throw new FeatureError(403, "FORBIDDEN", "Permission denied");
      if (/Authentication required/i.test(text))
        throw new FeatureError(401, "SESSION_EXPIRED", "Authentication required");
      if (/capacity|ledger full|budget exceeded/i.test(text))
        throw new FeatureError(429, "CAPACITY_REACHED", "Resource limit reached");
      if (/Invalid operation ID|Invalid client operation|Invalid metadata|Invalid role/i.test(text))
        throw new FeatureError(400, "INVALID_INPUT", "Invalid request input");
      throw error;
    }
  }
  private async executeDomain(credential: SessionCredential, operation: string, input: any) {
    if (operation === "legacy.history") {
      const actor = await this.actor(credential, "conversation.read", "*");
      const user = input?.user ?? actor.username,
        target = input?.target;
      const [first, second] = await Promise.all([this.account(user), this.account(target)]);
      if (![first?.id, second?.id].includes(actor.id))
        throw new FeatureError(403, "CONVERSATION_FORBIDDEN", "Conversation access denied");
      return this.session.getPaginatedDirectMessages(
        first?.id ?? "missing",
        second?.id ?? "missing",
        input.limit,
        input.before,
        input.after,
      );
    }
    if (operation === "profile.update") return this.updateProfile(credential, input);
    if (operation === "metadata.update") return this.updateMetadata(credential, input);
    if (operation === "metadata.get") {
      const actor = await this.actor(credential, "metadata.read", input?.target ?? "*");
      const visible = await this.session
        .getAccountsStub()
        .getVisibleMetadata(
          actor.id,
          actor.credentialVersion,
          input?.target ?? actor.username,
          input?.keys,
        );
      const privateRead = await this.actor(
        credential,
        "metadata.private.read",
        input?.target ?? actor.username,
      ).then(
        () => true,
        () => false,
      );
      if (!privateRead)
        visible.metadata = Object.fromEntries(
          Object.entries(visible.metadata).filter(([key]) => !key.startsWith("private:")),
        );
      return visible;
    }
    if (
      [
        "channel.create",
        "channel.join",
        "channel.leave",
        "channel.invite",
        "channel.uninvite",
        "channel.delete",
      ].includes(operation)
    ) {
      const schema = ChannelLifecycleInputSchema;
      const args = schema.parse(input);
      operationId(args.clientOperationId);
      const _actor = await this.actor(credential, "", args.channel);
      const hash =
        "token" in credential
          ? await hashSessionToken(credential.token)
          : "sessionHash" in credential
            ? credential.sessionHash
            : this.session.sessionsById.get(credential.ircSessionId)?.attachment
                .credentialSessionHash;
      if (!hash)
        throw new FeatureError(
          400,
          "TRANSPORT_UNSUPPORTED",
          "Use native IRC channel commands for password-authenticated clients",
        );
      const channel: any = this.session.getChannelStub(args.channel);
      if (operation === "channel.create")
        return channel.accountCreateWithHash(
          hash,
          args.channel,
          { name: args.channel, ...args.settings },
          args.clientOperationId,
        );
      if (!args.generation)
        throw new FeatureError(400, "GENERATION_REQUIRED", "Channel generation required");
      if (operation === "channel.join")
        return channel.accountJoinWithHash(
          hash,
          args.channel,
          args.generation,
          args.key,
          args.clientOperationId,
        );
      if (operation === "channel.leave")
        return channel.accountLeaveWithHash(
          hash,
          args.channel,
          args.generation,
          args.clientOperationId,
        );
      if (operation === "channel.delete")
        return channel.accountDestroyWithHash(
          hash,
          args.channel,
          args.generation,
          args.purge ?? false,
          args.clientOperationId,
        );
      if (!args.target)
        throw new FeatureError(400, "TARGET_REQUIRED", "Invitation target required");
      return channel.accountInviteWithHash(
        hash,
        args.channel,
        args.generation,
        args.target,
        operation === "channel.uninvite",
        args.clientOperationId,
      );
    }
    const channelOperations: Record<string, string> = {
      "channel.send": "send",
      "channel.edit": "edit",
      "channel.redact": "redact",
      "channel.bulk.redact": "bulk.redact",
      "channel.topic": "info.update",
      "channel.role.create": "role.create",
      "channel.role.update": "role.update",
      "channel.role.delete": "role.delete",
      "channel.role.assign": "role.assign",
      "channel.role.remove": "role.remove",
    };
    if (Object.hasOwn(channelOperations, operation)) {
      input = ChannelMutationInputSchemas[operation].parse(input);
      operationId(input.clientOperationId);
      const identity = await this.actor(credential, "", input.channel);
      const hash =
        "token" in credential
          ? await hashSessionToken(credential.token)
          : "sessionHash" in credential
            ? credential.sessionHash
            : this.session.sessionsById.get(credential.ircSessionId)?.attachment
                .credentialSessionHash;
      if (!hash)
        throw new FeatureError(
          400,
          "TRANSPORT_UNSUPPORTED",
          "Use native IRC commands for password-authenticated channel mutations",
        );
      const stub: any = this.session.getChannelStub(input.channel);
      if ((await stub.getExistingChannelGeneration()) !== input.generation)
        throw new FeatureError(409, "STALE_GENERATION", "Channel generation changed");
      const args = {
        ...input,
        channelName: input.channel,
        expectedGeneration: input.generation,
        ...(operation === "channel.topic" ? { updates: { topic: input.topic } } : {}),
        ...(operation === "channel.bulk.redact" ? { operationId: input.clientOperationId } : {}),
      };
      // The explicit facade revalidates hash, current actor, generation and all domain permissions.
      const result = await stub.clientRequestWithHash(hash, channelOperations[operation], args);
      if (operation === "channel.redact" && result.ok && !result.replayed) {
        const line = encodeIRCMessage({
          prefix: `${identity.username}!api@api.flarc.local`,
          command: "REDACT",
          params: [input.channel, input.id],
        });
        for (const id of new Set<string>(result.recipientSessionIds ?? [])) {
          const client = this.session.sessionsById.get(id);
          if (
            !client ||
            !this.session
              .getSessionChannels(id)
              .some(
                (c) =>
                  c.canonicalChannel === canonicalizeIRCName(input.channel) &&
                  c.generation === result.generation,
              )
          )
            continue;
          this.session.sendChannelLine(
            client.ws,
            client.attachment,
            line,
            input.channel,
            result.generation,
            true,
          );
        }
      }
      if (result && typeof result === "object") {
        const { recipientSessionIds, ...publicResult } = result;
        return publicResult;
      }
      return result;
    }
    if (operation === "conversation.attachments") {
      const actor = await this.actor(credential, "conversation.read", input?.conversationId ?? "*");
      this.conversations.requireMember(input.conversationId, actor.id);
      const peer =
        this.conversations.members(input.conversationId).find((id) => id !== actor.id) ?? actor.id;
      const hash =
        "token" in credential
          ? await hashSessionToken(credential.token)
          : "sessionHash" in credential
            ? credential.sessionHash
            : this.session.sessionsById.get(credential.ircSessionId)?.attachment
                .credentialSessionHash;
      const accounts: any = this.session.getAccountsStub();
      if (!hash)
        throw new FeatureError(
          400,
          "TRANSPORT_UNSUPPORTED",
          "Use an authenticated REST or event session for attachment metadata",
        );
      const files = await accounts.listPrivateMediaWithHash(hash, { kind: "dm", target: peer });
      if (!files)
        throw new FeatureError(403, "MEDIA_FORBIDDEN", "Attachment metadata access denied");
      return { attachments: files };
    }
    if (operation === "events.bootstrap") {
      const args = EventBootstrapQuerySchema.parse(input ?? {});
      const actor = await this.actor(credential, "events.bootstrap", "*");
      const { scanAfter, cursor } = this.bootstrapPages.begin(actor.id, args.pageToken);
      await this.recoverProfiles();
      const candidates = this.session.sql
        .exec<{ canonical_channel: string; channel_name: string }>(
          "SELECT canonical_channel,channel_name FROM known_channels WHERE canonical_channel>? ORDER BY canonical_channel LIMIT 101",
          scanAfter,
        )
        .toArray();
      const channels = [];
      for (const row of candidates.slice(0, 100)) {
        const channel: any = this.session.getChannelStub(row.channel_name);
        const access = await channel.getAccessSnapshot(actor);
        if (!access.isMember || !access.canRead) continue;
        if (
          !(await this.authorizeEvent(actor, {
            kind: "channel",
            id: row.channel_name,
            generation: access.generation,
          }))
        )
          continue;
        // Membership is already in the owning Channel transaction's audience;
        // bootstrap consumes no observer slots. Pending committed events are
        // drained before the state snapshot, with overlap from the earlier cursor.
        await channel.flushPendingEvents();
        const snapshot = await this.channelSnapshot(actor, row.channel_name, access.generation);
        channels.push({
          ...snapshot,
          eventBoundary: {
            kind: "membership",
            generation: access.generation,
            revision: snapshot.revision,
          },
        });
      }
      const profileAllowed = await this.actor(credential, "profile.read", actor.id).then(
        () => true,
        () => false,
      );
      return {
        cursor,
        ...this.conversations.page(actor, 100),
        channels,
        channelsComplete: candidates.length <= 100,
        nextPageToken:
          candidates.length > 100
            ? this.bootstrapPages.next(actor.id, candidates[99].canonical_channel, cursor)
            : null,
        profile: profileAllowed
          ? await this.session.getAccountsStub().getUserProfile(actor.username)
          : null,
        recovery: {
          mode: "cursor-before-snapshot",
          interestBoundary:
            "existing owner-side membership; explicit public subscriptions register before their returned snapshot",
          replayFrom: cursor,
          deduplicateBy: ["eventId", "resource revision", "message id"],
          crossObjectAtomic: false,
        },
      };
    }

    return this.service.execute(credential, operation, input);
  }

  async updateProfile(credential: SessionCredential, input: any) {
    const identity = await this.actor(credential, "", "");
    const actor = await this.actor(credential, "profile.update", identity.id);
    if (
      input?.username &&
      canonicalizeIRCName(input.username) !== canonicalizeIRCName(actor.username)
    )
      throw new FeatureError(403, "PROFILE_FORBIDDEN", "Account access denied");
    const updates = UserProfileInputSchema.strict().parse(input?.updates ?? {});
    if (input.clientOperationId !== undefined) operationId(input.clientOperationId);
    const hash =
      "token" in credential
        ? await hashSessionToken(credential.token)
        : "sessionHash" in credential
          ? credential.sessionHash
          : this.session.sessionsById.get(credential.ircSessionId)?.attachment
              .credentialSessionHash;
    const result = await this.session
      .getAccountsStub()
      .updateProfileForActor(
        actor.id,
        actor.credentialVersion,
        updates,
        input.expectedRevision,
        input.clientOperationId,
        hash,
      );
    await this.recoverProfiles();
    return { ...result.result, revision: result.revision };
  }

  async updateMetadata(credential: SessionCredential, input: any) {
    input = MetadataMutationSchema.parse(input);
    input.key = input.key.toLowerCase();
    const actor = await this.actor(
      credential,
      typeof input?.key === "string" && input.key.startsWith("private:")
        ? "metadata.private.write"
        : "metadata.write",
      input?.target ?? "*",
    );
    if (typeof input?.key !== "string" || (input.value !== null && typeof input.value !== "string"))
      throw new FeatureError(400, "INVALID_METADATA", "Invalid metadata mutation");
    if (input.clientOperationId !== undefined) operationId(input.clientOperationId);
    const target = input.target ?? actor.username;
    const hash =
      "token" in credential
        ? await hashSessionToken(credential.token)
        : "sessionHash" in credential
          ? credential.sessionHash
          : this.session.sessionsById.get(credential.ircSessionId)?.attachment
              .credentialSessionHash;
    const attachment =
      "ircSessionId" in credential
        ? this.session.sessionsById.get(credential.ircSessionId)?.attachment
        : undefined;
    const result = attachment?.isOper
      ? await this.session
          .getAccountsStub()
          .mutateUserMetadataAsOperator(
            actor.id,
            actor.credentialVersion,
            (attachment as any).credentialSessionHash ?? null,
            target,
            input.key,
            input.value,
            input.expectedRevision,
            input.clientOperationId,
          )
      : await this.session
          .getAccountsStub()
          .mutateUserMetadata(
            actor.id,
            actor.credentialVersion,
            target,
            input.key,
            input.value,
            input.expectedRevision,
            input.clientOperationId,
            hash,
          );
    await this.recoverProfiles();
    return result;
  }

  async recoverProfiles() {
    if (this.profileDrain) return this.profileDrain;
    this.profileDrain = (async () => {
      const accounts: any = this.session.getAccountsStub();
      for (let page = 0; page < 100; page++) {
        const pending = await accounts.getPendingProfileEvents(100);
        if (!pending.length) break;
        for (const event of pending) {
          await this.publishProfileRevision(event);
          await accounts.ackProfileEvent(event.eventId);
        }
      }
    })().finally(() => {
      this.profileDrain = undefined;
    });
    return this.profileDrain;
  }

  async publishProfileRevision(input: any) {
    const account = await this.account(input.accountId, true);
    if (!account || account.id !== input.accountId) return;
    const latest = await this.session.getAccountsStub().getUserProfile(account.username);
    if (!latest || latest.revision < input.revision)
      throw new FeatureError(409, "PROFILE_REVISION_INVALID", "Uncommitted profile revision");
    const privateEvent = input.visibility === "private";
    const profileKeys: Record<string, string> = {
      displayName: "display-name",
      avatar: "avatar",
      pronouns: "pronouns",
      bio: "bio",
      bot: "bot",
      color: "color",
      customStatus: "custom-status",
      timezone: "timezone",
    };
    // Profile mutations carry the committed profile and changed field names, while
    // direct metadata mutations carry an explicit metadata delta.  Project only
    // the changed committed fields; never reconstruct them from a later revision.
    const delta =
      input.metadata ??
      Object.fromEntries(
        (input.changedKeys ?? [])
          .filter(
            (field: unknown): field is string =>
              typeof field === "string" && Object.hasOwn(profileKeys, field),
          )
          .map((field: string) => {
            const value = input.profile?.[field];
            return [
              profileKeys[field],
              field === "bot" ? (value ? "true" : null) : (value ?? null),
            ];
          }),
      );
    const metadata = Object.fromEntries(
      Object.entries(delta).filter(([key]) =>
        privateEvent ? key.startsWith("private:") : !key.startsWith("private:"),
      ),
    );
    const profile = UserProfileSchema.parse({ ...input.profile, revision: input.revision });
    const event = {
      type: privateEvent ? ("user.metadata_updated" as const) : ("user.profile_updated" as const),
      eventId: input.eventId,
      timestamp: new Date().toISOString(),
      profileAccountId: account.id,
      ownerId: privateEvent ? account.id : undefined,
      operationId: input.operationId ?? undefined,
      data: privateEvent
        ? { accountId: account.id, username: account.username, revision: input.revision, metadata }
        : { accountId: account.id, profile, revision: input.revision, metadata },
    };
    const fresh = this.runtime.storage.transactionSync(() =>
      this.journal.append(event, {
        kind: "profile",
        id: account.id,
        ownerId: privateEvent ? account.id : undefined,
      }),
    );
    if (!fresh) return;
    for (const { ws, attachment } of [...this.session.sessionsById.values()]) {
      if (
        !attachment.registered ||
        !attachment.authenticated ||
        (privateEvent && attachment.userId !== account.id)
      )
        continue;
      if (
        !this.session.hasCap(attachment, "draft/metadata-3") &&
        !this.session.hasCap(attachment, "draft/metadata-2")
      )
        continue;
      if (!(await this.session.getSessionActor(attachment.sessionId))) continue;
      for (const [key, value] of Object.entries(metadata)) {
        const subs = attachment.metadataSubs ?? [];
        if (!subs.includes("*") && !subs.includes(key)) continue;
        const names = new Set([
          account.username,
          ...this.session
            .getLiveAccountSessions(account.id)
            .map((id) => this.session.sessionsById.get(id)?.attachment.nickname)
            .filter((name): name is string => Boolean(name)),
        ]);
        for (const name of names)
          this.session.sendNumeric(
            ws,
            attachment,
            value === null ? Numerics.RPL_KEYNOTSET : Numerics.RPL_KEYVALUE,
            value === null ? [name, key, "Key is not set"] : [name, key, "*", String(value)],
            { "+draft/profile-revision": String(input.revision) },
            { key, sourceUserId: account.id, sourceNick: name },
          );
      }
    }
    this.notify();
  }

  async drainPush() {
    if (this.pushDrain) return this.pushDrain;
    this.pushDrain = (async () => {
      const accounts: any = this.session.getAccountsStub();
      for (let page = 0; page < 100; page++) {
        const rows = this.session.sql
          .exec<{ event_id: string; account_id: string }>(
            "SELECT event_id,account_id FROM event_push_intents WHERE accepted=0 LIMIT 100",
          )
          .toArray();
        if (!rows.length) break;
        for (const row of rows) {
          await accounts.enqueuePushEvent(row.event_id, row.account_id);
          this.session.sql.exec(
            "UPDATE event_push_intents SET accepted=1 WHERE event_id=? AND account_id=?",
            row.event_id,
            row.account_id,
          );
        }
      }
    })().finally(() => {
      this.pushDrain = undefined;
    });
    return this.pushDrain;
  }
  notify() {
    this.session.eventAuthority?.hint();
    if (this.session.eventAuthority)
      this.runtime.waitUntil(this.session.eventAuthority.wakeEdges());
    this.runtime.waitUntil(
      this.drainPush().catch(() => this.session.scheduleAlarm(Date.now() + 5000)),
    );
    for (const ws of this.runtime.sockets()) {
      const previous = this.deliveries.get(ws) ?? Promise.resolve();
      const next = previous
        .then(() => this.flush(ws))
        .catch(() => {
          try {
            ws.close(1008, "Event authorization failed");
          } catch {}
        });
      this.deliveries.set(ws, next);
      this.runtime.waitUntil(next);
    }
  }

  async openEventSocket(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as EventAttachment;
    const actor = await this.actor(
      { sessionHash: attachment.eventSessionHash, source: attachment.eventSource },
      "events.connect",
      "*",
    );
    attachment.connectionId = crypto.randomUUID();
    attachment.cursor = this.journal.cursor(actor.id);
    const saved = this.session.sql
      .exec<{ subscriptions_json: string }>(
        "SELECT subscriptions_json FROM event_subscription_preferences WHERE account_id=?",
        actor.id,
      )
      .toArray()[0];
    if (saved) attachment.subscriptions = JSON.parse(saved.subscriptions_json);
    ws.serializeAttachment({
      ...attachment,
      readerWindow: ws.deserializeAttachment()?.readerWindow,
      readerClosed: ws.deserializeAttachment()?.readerClosed,
    });
    await this.recoverProfiles();
  }

  async flush(ws: WebSocket) {
    if (ws.readyState !== 1) return;
    const attachment = ws.deserializeAttachment() as EventAttachment;
    if (!attachment?.eventSessionHash) return;
    if (!attachment.eventSource)
      throw new FeatureError(401, "SOURCE_REQUIRED", "Reconnect to establish peer source");
    const actor = await this.actor(
      { sessionHash: attachment.eventSessionHash, source: attachment.eventSource },
      "events.replay",
      "*",
    );
    if (!attachment.cursor) attachment.cursor = this.journal.cursor(actor.id);
    for (let page = 0; page < 10; page++) {
      let result: Awaited<ReturnType<SessionJournal["replay"]>>;
      try {
        result = await this.journal.replay(actor, attachment.cursor, 100, (r) =>
          this.service.matches(attachment.subscriptions, r),
        );
      } catch (error) {
        if (error instanceof FeatureError && error.code === "CURSOR_EXPIRED") {
          this.session.sendEventFrame(
            ws,
            JSON.stringify({ type: "resync.required", code: error.code }),
          );
          return;
        }
        throw error;
      }
      for (const event of result.events) {
        if (await this.journal.event(actor, event.eventId))
          this.session.sendEventFrame(ws, JSON.stringify(event));
      }
      await this.actor(
        { sessionHash: attachment.eventSessionHash, source: attachment.eventSource },
        "events.replay",
        "*",
      );
      attachment.cursor = result.cursor;
      ws.serializeAttachment({
        ...attachment,
        readerWindow: ws.deserializeAttachment()?.readerWindow,
        readerClosed: ws.deserializeAttachment()?.readerClosed,
      });
      if (result.caughtUp) break;
    }
  }

  async eventCommand(
    credential: SessionCredential,
    attachment: { cursor?: string; subscriptions?: EventSubscriptions },
    command: Exclude<import("zod").infer<typeof EventCommandSchema>, { type: "reader.ack" }>,
  ) {
    const actor = await this.actor(credential, "events.replay", "*");
    let result: any;
    if (command.type === "subscribe") {
      if (command.cursor) this.journal.position(actor.id, command.cursor);
      const cursor = command.cursor ?? this.journal.cursor(actor.id);
      const subscriptions = await this.service.subscribe(actor, command.resources);
      const boundaries = [];
      for (const channel of subscriptions.channels ?? []) {
        const boundary = await this.registerChannelInterest(
          actor,
          channel.channel,
          channel.generation,
        );
        const snapshot = await this.channelSnapshot(actor, channel.channel, channel.generation);
        boundaries.push({ ...boundary, snapshot });
      }
      attachment.subscriptions = subscriptions;
      attachment.cursor = cursor;
      this.session.sql.exec(
        "INSERT INTO event_subscription_preferences(account_id,subscriptions_json) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET subscriptions_json=excluded.subscriptions_json",
        actor.id,
        JSON.stringify(subscriptions),
      );
      result = {
        subscribed: subscriptions,
        cursor: attachment.cursor,
        boundaries,
        recovery: {
          mode: "cursor-before-registration",
          deduplicateBy: "eventId",
          crossObjectAtomic: false,
        },
      };
    } else if (command.type === "replay")
      result = await this.journal.replay(actor, command.cursor, command.limit, (r) =>
        this.service.matches(attachment.subscriptions, r),
      );
    else if (command.type === "bootstrap")
      result = await this.execute(credential, "events.bootstrap", {
        pageToken: command.pageToken,
      });
    else {
      operationId(command.input.clientOperationId);
      result = await this.execute(credential, command.operation, command.input);
    }
    return result;
  }

  async eventMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const now = Date.now(),
      window = this.inputLimits.get(ws);
    const budget =
      window && now - window.start < EVENT_INPUT_LIMITS.windowMs
        ? window
        : { start: now, count: 0 };
    if (++budget.count > EVENT_INPUT_LIMITS.maxFramesPerWindow) {
      ws.close(1008, "Event command rate exceeded");
      return;
    }
    this.inputLimits.set(ws, budget);
    const bytes =
      typeof message === "string" ? new TextEncoder().encode(message).length : message.byteLength;
    const queued = this.inputs.get(ws) ?? { count: 0, bytes: 0, tail: Promise.resolve() };
    if (
      bytes > EVENT_INPUT_LIMITS.maxFrameBytes ||
      queued.count >= 16 ||
      queued.bytes + bytes > 262144
    ) {
      ws.close(1008, "Event input queue limit reached");
      return;
    }
    queued.count++;
    queued.bytes += bytes;
    let requestId: string | undefined;
    const next = queued.tail
      .then(async () => {
        const attachment = ws.deserializeAttachment() as EventAttachment;
        if (!attachment?.eventSessionHash) {
          ws.close(1008, "Event session required");
          return;
        }
        const parsed = EventCommandSchema.safeParse(
          JSON.parse(
            typeof message === "string"
              ? message
              : new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(message),
          ),
        );
        if (!parsed.success) {
          ws.close(1008, "Invalid event command");
          return;
        }
        const command = parsed.data;
        requestId = command.requestId;
        const credential = {
          sessionHash: attachment.eventSessionHash,
          source: attachment.eventSource,
        };
        const result = await this.eventCommand(credential, attachment, command);
        ws.serializeAttachment({
          ...attachment,
          readerWindow: ws.deserializeAttachment()?.readerWindow,
          readerClosed: ws.deserializeAttachment()?.readerClosed,
        });
        this.session.sendEventFrame(
          ws,
          JSON.stringify({ type: "result", requestId: command.requestId, result }),
        );
        if (command.type === "subscribe") await this.flush(ws);
      })
      .catch((error) => {
        if (error instanceof FeatureError)
          this.session.sendEventFrame(
            ws,
            JSON.stringify({
              type: "error",
              requestId,
              status: error.statusCode,
              code: error.code,
              message: error.message.split(":").slice(3).join(":"),
              resync: error.code === "CURSOR_EXPIRED" || error.code === "BOOTSTRAP_PAGE_EXPIRED",
            }),
          );
        else ws.close(1008, "Invalid event command");
      })
      .finally(() => {
        queued.count--;
        queued.bytes -= bytes;
      });
    queued.tail = next;
    this.inputs.set(ws, queued);
    await next;
  }

  async deliverMessage(message: any, actorId: string, peerId: string) {
    for (const id of new Set([
      ...this.session.getLiveAccountSessions(actorId),
      ...this.session.getLiveAccountSessions(peerId),
    ])) {
      const client = this.session.sessionsById.get(id);
      if (!client) continue;
      const actor = await this.actor(
        { ircSessionId: id },
        "conversation.read",
        message.conversationId,
      ).catch(() => null);
      if (!actor || !this.conversations.hasMember(message.conversationId, actor.id)) continue;
      const target =
        actor.id === actorId ? (await this.account(peerId))?.username : client.attachment.nickname;
      const tags = {
        msgid: message.id,
        time: new Date(message.createdAt).toISOString(),
        account: message.senderAccount,
        ...(message.revision ? { "+ircord/edit": message.id } : {}),
      };
      await this.session.sendDirectMessageLine(
        client.ws,
        client.attachment,
        encodeIRCMessage({
          tags: this.session.filterOutgoingTags(client.attachment, tags),
          prefix: `${message.senderNick}!${message.senderAccount}@api.flarc.local`,
          command: message.redacted ? "REDACT" : "PRIVMSG",
          params: message.redacted
            ? [target ?? peerId, message.id, "Message redacted"]
            : [target ?? peerId, message.content],
        }),
        message.id,
      );
    }
  }
}
