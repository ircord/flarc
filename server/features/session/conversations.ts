import { createHash } from "node:crypto";
import { SERVER_CONFIG } from "../../core/config";
import { FeatureError, OPERATION_WINDOW_MS, operationId, operationValue } from "../operations";
import type { SessionActor, SessionFeatureHost } from "./contracts";
import type { SessionJournal } from "./journal";

export type MessageIdentity = {
  id: string;
  username: string;
  nickname: string;
  user: string;
  host: string;
  roles: string[];
};

export class ConversationStore {
  private operationContext?: string;
  constructor(
    private readonly host: SessionFeatureHost,
    private readonly journal: SessionJournal,
  ) {}

  hasMember(conversationId: string, accountId: string): boolean {
    return (
      this.host.sql
        .exec(
          "SELECT 1 FROM conversation_members WHERE conversation_id=? AND account_id=?",
          conversationId,
          accountId,
        )
        .toArray().length > 0
    );
  }

  requireMember(conversationId: string, accountId: string) {
    if (!this.hasMember(conversationId, accountId))
      throw new FeatureError(403, "CONVERSATION_FORBIDDEN", "Conversation access denied");
  }

  ensure(first: string, second: string): string {
    const pair = [first, second].sort().join("<->");
    const found = this.host.sql
      .exec<{ id: string }>("SELECT id FROM conversations WHERE pair_key=?", pair)
      .toArray()[0];
    if (found) return found.id;
    const id = crypto.randomUUID();
    this.host.sql.exec(
      "INSERT INTO conversations(id,pair_key,created_at) VALUES (?,?,?)",
      id,
      pair,
      Date.now(),
    );
    for (const account of new Set([first, second]))
      this.host.sql.exec(
        "INSERT INTO conversation_members(conversation_id,account_id) VALUES (?,?)",
        id,
        account,
      );
    this.journal.append(
      {
        type: "conversation.created",
        operationId: this.operationContext,
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        conversationId: id,
        data: { id, kind: "direct", participantIds: this.members(id), revision: 0 },
      },
      { kind: "conversation", id },
    );
    return id;
  }

  describe(id: string, actorId: string) {
    this.requireMember(id, actorId);
    const row = this.host.sql
      .exec<{ id: string; kind: string; revision: number; created_at: number }>(
        "SELECT * FROM conversations WHERE id=?",
        id,
      )
      .toArray()[0];
    return {
      id: row.id,
      kind: row.kind,
      participantIds: this.members(id),
      revision: row.revision,
      createdAt: row.created_at,
      unread: this.unread(id, actorId),
    };
  }
  members(id: string): string[] {
    return this.host.sql
      .exec<{ account_id: string }>(
        "SELECT account_id FROM conversation_members WHERE conversation_id=? ORDER BY account_id",
        id,
      )
      .toArray()
      .map((r) => r.account_id);
  }

  page(actor: SessionActor, limit = 50, after?: string) {
    const cap = Math.max(1, Math.min(Number.isInteger(limit) ? limit : 50, 100));
    let query =
      "SELECT c.*,m.read_sequence FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.account_id=?";
    const args: (string | number)[] = [actor.id];
    if (after) {
      this.requireMember(after, actor.id);
      const cursor = this.host.sql
        .exec<{ created_at: number }>("SELECT created_at FROM conversations WHERE id=?", after)
        .toArray()[0];
      query += " AND (c.created_at<? OR (c.created_at=? AND c.id<?))";
      args.push(cursor.created_at, cursor.created_at, after);
    }
    const rows = this.host.sql
      .exec<{ id: string; created_at: number; revision: number; read_sequence: number }>(
        `${query} ORDER BY c.created_at DESC,c.id DESC LIMIT ?`,
        ...args,
        cap + 1,
      )
      .toArray();
    const values = rows.slice(0, cap).map((row) => ({
      id: row.id,
      kind: "direct",
      participantIds: this.members(row.id),
      revision: row.revision,
      createdAt: row.created_at,
      unread: this.unread(row.id, actor.id),
    }));
    return {
      conversations: values,
      nextConversationId: rows.length > cap ? values.at(-1)?.id : null,
    };
  }
  list(actor: SessionActor) {
    return this.page(actor, 100).conversations;
  }

  unread(id: string, actorId: string) {
    this.requireMember(id, actorId);
    return this.host.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM direct_messages d JOIN conversation_members m ON m.conversation_id=d.conversation_id AND m.account_id=? WHERE d.conversation_id=? AND d.sender_id<>? AND d.sequence>m.read_sequence AND d.redacted=0 AND COALESCE(d.expires_at,d.created_at+?)>? AND NOT EXISTS (SELECT 1 FROM direct_message_edits e WHERE e.message_id=d.id)`,
        actorId,
        id,
        actorId,
        SERVER_CONFIG.retentionMs,
        Date.now(),
      )
      .toArray()[0].count;
  }

  run<T>(actorId: string, id: unknown, intent: unknown, fn: () => T, required = true): T {
    const op = operationId(id, required);
    const fingerprint = createHash("sha256").update(operationValue(intent)).digest("hex");
    return this.host.storage.transactionSync(() => {
      const previous = this.host.sql
        .exec<{ fingerprint: string; result_json: string }>(
          "SELECT * FROM feature_operations WHERE actor_id=? AND operation_id=?",
          actorId,
          op,
        )
        .toArray()[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new FeatureError(
            409,
            "OPERATION_CONFLICT",
            "Operation ID was used with different input",
          );
        return JSON.parse(previous.result_json) as T;
      }
      this.host.sql.exec("DELETE FROM feature_operations WHERE expires_at<=?", Date.now());
      if (
        this.host.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM feature_operations WHERE actor_id=?",
            actorId,
          )
          .toArray()[0].count >= 10000
      )
        throw new FeatureError(429, "OPERATION_LIMIT", "Too many retained operation results");
      const previousContext = this.operationContext;
      this.operationContext = op;
      let result: T;
      try {
        result = fn();
      } finally {
        this.operationContext = previousContext;
      }
      this.host.sql.exec(
        "INSERT INTO feature_operations(actor_id,operation_id,fingerprint,result_json,expires_at) VALUES (?,?,?,?,?)",
        actorId,
        op,
        fingerprint,
        JSON.stringify(result),
        Number(op.slice(0, 13)) + OPERATION_WINDOW_MS,
      );
      return result;
    });
  }

  private row(id: string) {
    return this.host.sql
      .exec<any>(
        "SELECT * FROM direct_messages WHERE id=? AND COALESCE(expires_at,created_at+?)>?",
        id,
        SERVER_CONFIG.retentionMs,
        Date.now(),
      )
      .toArray()[0];
  }

  message(actorId: string, id: string, conversationId?: string) {
    const row = this.row(id);
    if (
      !row?.conversation_id ||
      !this.hasMember(row.conversation_id, actorId) ||
      (conversationId && row.conversation_id !== conversationId)
    )
      throw new FeatureError(404, "MESSAGE_NOT_FOUND", "Message not found");
    const root =
      this.host.sql
        .exec<{ root_id: string }>(
          "SELECT root_id FROM direct_message_edits WHERE message_id=?",
          id,
        )
        .toArray()[0]?.root_id ?? id;
    const original = this.row(root);
    const edits = this.host.sql
      .exec<any>(
        "SELECT d.* FROM direct_messages d JOIN direct_message_edits e ON e.message_id=d.id WHERE e.root_id=? ORDER BY d.sequence",
        root,
      )
      .toArray();
    const latest = edits.at(-1) ?? original;
    return {
      id: root,
      conversationId: row.conversation_id,
      senderId: original.sender_id,
      senderAccount: original.sender_account,
      senderNick: original.sender_nick,
      recipientId: original.target_id,
      content: original.redacted ? null : latest.content,
      redacted: Boolean(original.redacted),
      tags: original.redacted ? {} : JSON.parse(latest.tags_json),
      revision: edits.length + (original.redacted ? 1 : 0),
      sequence: original.sequence,
      createdAt: original.created_at,
      updatedAt: latest.created_at,
    };
  }

  history(
    actorId: string,
    id: string,
    limit = 50,
    before?: string,
    after?: string,
    senderId?: string,
    recipientId?: string,
  ) {
    this.requireMember(id, actorId);
    const cap = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 100));
    let query =
      "SELECT d.id FROM direct_messages d WHERE d.conversation_id=? AND COALESCE(d.expires_at,d.created_at+?)>? AND NOT EXISTS (SELECT 1 FROM direct_message_edits e WHERE e.message_id=d.id)";
    const args: (string | number)[] = [id, SERVER_CONFIG.retentionMs, Date.now()];
    if (senderId) {
      query += " AND d.sender_id=?";
      args.push(senderId);
    }
    if (recipientId) {
      query += " AND d.target_id=?";
      args.push(recipientId);
    }
    for (const [cursor, operator] of [
      [before, "<"],
      [after, ">"],
    ] as const)
      if (cursor) {
        const msg = this.message(actorId, cursor, id);
        query += ` AND d.sequence${operator}?`;
        args.push(msg.sequence);
      }
    const rows = this.host.sql
      .exec<{ id: string }>(`${query} ORDER BY d.sequence DESC LIMIT ?`, ...args, cap + 1)
      .toArray();
    return {
      messages: rows
        .slice(0, cap)
        .reverse()
        .map((r) => this.message(actorId, r.id, id)),
      hasMore: rows.length > cap,
    };
  }

  append(
    sender: MessageIdentity,
    target: MessageIdentity,
    input: {
      id: string;
      command: "PRIVMSG" | "NOTICE" | "TAGMSG";
      content: string;
      tags?: Record<string, string | true>;
      multilineLines?: Array<{ content: string; concat: boolean }>;
      displayNick?: string;
    },
  ) {
    const conversationId = this.ensure(sender.id, target.id),
      now = Date.now();
    const tags = { ...input.tags };
    delete tags.account;
    delete tags.msgid;
    delete tags.time;
    delete tags["+role"];
    delete tags["+badge"];
    tags["+role"] = sender.roles.some((r) => r === "admin" || r === "oper")
      ? "admin"
      : (sender.roles[0] ?? "member");
    tags["+badge"] = tags["+role"];
    const editId = tags["+ircord/edit"] ?? tags["+draft/edit"] ?? tags["+edit"];
    let root: string | null = null,
      expiresAt = now + SERVER_CONFIG.retentionMs,
      originalTags: Record<string, string | true> = {};
    if (typeof editId === "string") {
      const prior = this.row(editId);
      if (
        !prior ||
        prior.sender_id !== sender.id ||
        prior.conversation_id !== conversationId ||
        prior.redacted
      )
        throw new FeatureError(
          403,
          "MESSAGE_FORBIDDEN",
          "Only the author may edit this conversation message",
        );
      root =
        this.host.sql
          .exec<{ root_id: string }>(
            "SELECT root_id FROM direct_message_edits WHERE message_id=?",
            editId,
          )
          .toArray()[0]?.root_id ?? editId;
      const original = this.row(root);
      if (!original || original.redacted)
        throw new FeatureError(409, "MESSAGE_REDACTED", "Message is redacted");
      expiresAt = original.expires_at ?? original.created_at + SERVER_CONFIG.retentionMs;
      originalTags = JSON.parse(prior.tags_json);
    }
    this.host.sql.exec(
      `INSERT INTO direct_messages(id,peer_pair,conversation_id,sender_id,sender_account,sender_nick,sender_user,sender_host,target_nick,target_account,target_id,command,content,tags_json,multiline_json,redacted,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      input.id,
      [sender.id, target.id].sort().join("<->"),
      conversationId,
      sender.id,
      sender.username,
      input.displayNick ?? sender.nickname,
      sender.user,
      sender.host,
      target.nickname,
      target.username,
      target.id,
      input.command,
      input.content,
      JSON.stringify(tags),
      input.multilineLines ? JSON.stringify(input.multilineLines) : null,
      now,
      expiresAt,
    );
    if (root && typeof editId === "string") {
      this.host.sql.exec(
        "INSERT INTO direct_message_edits(message_id,root_id) VALUES (?,?)",
        input.id,
        root,
      );
      this.host.sql.exec(
        "UPDATE direct_messages SET content=?,tags_json=?,multiline_json=NULL WHERE id=?",
        input.content,
        JSON.stringify({ ...originalTags, ...tags, edited_at: new Date(now).toISOString() }),
        editId,
      );
    }
    this.host.sql.exec("UPDATE conversations SET revision=revision+1 WHERE id=?", conversationId);
    this.journal.append(
      {
        type: root ? "conversation.message_updated" : "conversation.message_created",
        operationId: this.operationContext,
        eventId: crypto.randomUUID(),
        timestamp: new Date(now).toISOString(),
        senderId: sender.id,
        messageId: root ?? input.id,
        conversationId,
        data: this.message(sender.id, root ?? input.id, conversationId),
      },
      { kind: "conversation", id: conversationId },
    );
    return {
      id: input.id,
      sequence: this.row(input.id).sequence,
      senderId: sender.id,
      senderAccount: sender.username,
      senderNick: input.displayNick ?? sender.nickname,
      senderUser: sender.user,
      senderHost: sender.host,
      command: input.command,
      content: input.content,
      tags,
      multilineLines: input.multilineLines,
      createdAt: now,
      expiresAt,
      conversationId,
    };
  }

  redact(actorId: string, messageId: string) {
    const row = this.row(messageId);
    if (
      !row ||
      row.sender_id !== actorId ||
      !row.conversation_id ||
      !this.hasMember(row.conversation_id, actorId)
    )
      return false;
    const root =
      this.host.sql
        .exec<{ root_id: string }>(
          "SELECT root_id FROM direct_message_edits WHERE message_id=?",
          messageId,
        )
        .toArray()[0]?.root_id ?? messageId;
    this.host.sql.exec(
      "UPDATE direct_messages SET redacted=1,content='',tags_json='{}',multiline_json=NULL WHERE id=? OR id IN (SELECT message_id FROM direct_message_edits WHERE root_id=?)",
      root,
      root,
    );
    this.host.sql.exec(
      "UPDATE conversations SET revision=revision+1 WHERE id=?",
      row.conversation_id,
    );
    const canonical = this.message(actorId, root, row.conversation_id);
    for (const event of this.host.sql
      .exec<{ event_id: string; payload_json: string }>(
        "SELECT event_id,payload_json FROM event_journal WHERE resource_kind='conversation' AND resource_id=?",
        row.conversation_id,
      )
      .toArray()) {
      const payload = JSON.parse(event.payload_json);
      if (payload.messageId === root) {
        payload.data = canonical;
        this.host.sql.exec(
          "UPDATE event_journal SET payload_json=? WHERE event_id=?",
          JSON.stringify(payload),
          event.event_id,
        );
      }
    }
    for (const op of this.host.sql
      .exec<{ operation_id: string; result_json: string }>(
        "SELECT operation_id,result_json FROM feature_operations WHERE actor_id=?",
        actorId,
      )
      .toArray()) {
      const value = JSON.parse(op.result_json);
      if (value?.id === root && value?.conversationId === row.conversation_id)
        this.host.sql.exec(
          "UPDATE feature_operations SET result_json=? WHERE actor_id=? AND operation_id=?",
          JSON.stringify(canonical),
          actorId,
          op.operation_id,
        );
    }

    this.journal.append(
      {
        type: "conversation.message_redacted",
        operationId: this.operationContext,
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        messageId: root,
        conversationId: row.conversation_id,
        data: this.message(actorId, root, row.conversation_id),
      },
      { kind: "conversation", id: row.conversation_id },
    );
    return true;
  }

  markRead(actorId: string, id: string, messageId: string) {
    const message = this.message(actorId, messageId, id);
    this.host.sql.exec(
      "UPDATE conversation_members SET read_sequence=MAX(read_sequence,?) WHERE conversation_id=? AND account_id=?",
      message.sequence,
      id,
      actorId,
    );
    const result = { conversationId: id, messageId: message.id, unread: this.unread(id, actorId) };
    this.journal.append(
      {
        type: "conversation.read",
        operationId: this.operationContext,
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        conversationId: id,
        data: result,
      },
      { kind: "conversation", id, ownerId: actorId },
    );
    return result;
  }
}
