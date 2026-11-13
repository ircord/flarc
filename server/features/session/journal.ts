import { type RealtimeEvent, RealtimeEventSchema } from "../../schemas/events";
import { FeatureError } from "../operations";
import type { JournalResource, SessionActor, SessionFeatureHost } from "./contracts";

const DAY = 24 * 60 * 60 * 1000;
type Row = {
  journal_sequence: number;
  resource_kind: JournalResource["kind"];
  resource_id: string;
  generation: string | null;
  owner_id: string | null;
  payload_json: string;
  event_id: string;
  audience_required: number;
  live_public: number;
};

export class SessionJournal {
  constructor(
    private readonly host: SessionFeatureHost,
    private readonly maximum = 10_000,
    private readonly retentionMs = DAY,
  ) {}

  /** Called inside the owning mutation transaction for local conversation writes. */
  append(
    event: RealtimeEvent,
    resource: JournalResource,
    audience?: string[],
    restrictToAudience = false,
    livePublic = false,
  ): boolean {
    const parsed = RealtimeEventSchema.parse(event);
    const existing = this.host.sql
      .exec("SELECT 1 FROM event_journal WHERE event_id=?", parsed.eventId)
      .toArray()[0];
    if (existing) return false;
    this.host.sql.exec(
      "INSERT INTO event_journal(event_id,resource_kind,resource_id,generation,owner_id,payload_json,created_at,audience_required,live_public) VALUES (?,?,?,?,?,?,?,?,?)",
      parsed.eventId,
      resource.kind,
      resource.id,
      resource.generation ?? null,
      resource.ownerId ?? null,
      JSON.stringify(parsed),
      Date.now(),
      restrictToAudience ? 1 : 0,
      livePublic ? 1 : 0,
    );
    const recipients =
      audience ??
      (resource.ownerId
        ? [resource.ownerId]
        : resource.kind === "conversation"
          ? this.host.sql
              .exec<{ account_id: string }>(
                "SELECT account_id FROM conversation_members WHERE conversation_id=?",
                resource.id,
              )
              .toArray()
              .map((r) => r.account_id)
          : []);
    for (const accountId of new Set(recipients)) {
      this.host.sql.exec(
        "INSERT OR IGNORE INTO event_audience(event_id,account_id) VALUES (?,?)",
        event.eventId,
        accountId,
      );
      this.host.sql.exec(
        "INSERT OR IGNORE INTO event_push_intents(event_id,account_id) VALUES (?,?)",
        event.eventId,
        accountId,
      );
    }
    this.prune();
    return true;
  }

  prune() {
    const countLimit = Math.max(16, Math.min(this.maximum, 50_000));
    const cutoff =
      this.host.sql
        .exec<{ journal_sequence: number }>(
          "SELECT journal_sequence FROM event_journal ORDER BY journal_sequence DESC LIMIT 1 OFFSET ?",
          countLimit - 1,
        )
        .toArray()[0]?.journal_sequence ?? 0;
    const expired = this.host.sql
      .exec<{ removed: number | null }>(
        "SELECT MAX(journal_sequence) AS removed FROM event_journal WHERE created_at<? OR journal_sequence<?",
        Date.now() - Math.max(1000, Math.min(this.retentionMs, 7 * DAY)),
        cutoff,
      )
      .toArray()[0]?.removed;
    if (expired) {
      this.host.sql.exec("DELETE FROM event_journal WHERE journal_sequence<=?", expired);
      this.host.sql.exec(
        "UPDATE event_journal_state SET value=MAX(value,?) WHERE key='discarded_through'",
        expired,
      );
    }
    this.host.sql.exec("DELETE FROM event_cursors WHERE expires_at<=?", Date.now());
    this.host.sql.exec(
      "DELETE FROM event_push_intents WHERE event_id NOT IN (SELECT event_id FROM event_journal)",
    );
    this.host.sql.exec(
      "DELETE FROM event_audience WHERE event_id NOT IN (SELECT event_id FROM event_journal)",
    );
  }

  highWatermark(): number {
    return Math.max(
      this.host.sql
        .exec<{ value: number }>(
          "SELECT value FROM event_journal_state WHERE key='discarded_through'",
        )
        .toArray()[0].value,
      this.host.sql
        .exec<{ value: number | null }>("SELECT MAX(journal_sequence) AS value FROM event_journal")
        .toArray()[0]?.value ?? 0,
    );
  }

  cursor(actorId: string, sequence = this.highWatermark()): string {
    this.prune();
    // A cursor grants no authority and is still account-bound; bounded rotation
    // explicitly expires older cursors instead of retaining an unbounded map.
    this.host.sql.exec(
      "DELETE FROM event_cursors WHERE account_id=? AND token IN (SELECT token FROM event_cursors WHERE account_id=? ORDER BY expires_at DESC LIMIT -1 OFFSET 127)",
      actorId,
      actorId,
    );
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    this.host.sql.exec(
      "INSERT INTO event_cursors(token,account_id,journal_sequence,expires_at) VALUES (?,?,?,?)",
      token,
      actorId,
      sequence,
      Date.now() + Math.min(this.retentionMs, DAY),
    );
    return token;
  }

  position(actorId: string, token: string): number {
    if (!/^[0-9a-f]{64}$/.test(token))
      throw new FeatureError(400, "INVALID_CURSOR", "Invalid event cursor");
    const row = this.host.sql
      .exec<{ account_id: string; journal_sequence: number; expires_at: number }>(
        "SELECT * FROM event_cursors WHERE token=?",
        token,
      )
      .toArray()[0];
    if (row && row.account_id !== actorId)
      throw new FeatureError(403, "CURSOR_FORBIDDEN", "Cursor belongs to another account");
    this.prune();
    const discarded = this.host.sql
      .exec<{ value: number }>(
        "SELECT value FROM event_journal_state WHERE key='discarded_through'",
      )
      .toArray()[0].value;
    if (!row || row.expires_at <= Date.now() || row.journal_sequence < discarded)
      throw new FeatureError(
        410,
        "CURSOR_EXPIRED",
        "Resync required: obtain a new bootstrap snapshot",
      );
    return row.journal_sequence;
  }

  resource(row: Row): JournalResource {
    return {
      kind: row.resource_kind,
      id: row.resource_id,
      generation: row.generation ?? undefined,
      ownerId: row.owner_id ?? undefined,
    };
  }

  async replay(
    actor: SessionActor,
    token: string,
    limit = 100,
    filter?: (resource: JournalResource) => boolean,
    livePublic = false,
  ) {
    const position = this.position(actor.id, token);
    const high = this.highWatermark();
    const events: Array<RealtimeEvent & { cursor: string }> = [];
    let scanned = position;
    const rows = this.host.sql
      .exec<Row>(
        "SELECT * FROM event_journal WHERE journal_sequence>? AND journal_sequence<=? ORDER BY journal_sequence LIMIT 1000",
        position,
        high,
      )
      .toArray();
    const cap = Math.max(1, Math.min(limit, 100));
    for (const row of rows) {
      if (events.length === cap) break;
      scanned = row.journal_sequence;
      const resource = this.resource(row);
      if (filter && !filter(resource)) continue;
      if (
        row.audience_required &&
        !(livePublic && row.live_public && row.resource_kind === "channel") &&
        !this.host.sql
          .exec(
            "SELECT 1 FROM event_audience WHERE event_id=? AND account_id=?",
            row.event_id,
            actor.id,
          )
          .toArray().length
      )
        continue;
      if (
        (await this.host.authorizeEvent(actor, resource)) &&
        (await this.host.authorizePayload(actor, JSON.parse(row.payload_json), resource))
      )
        events.push({ ...JSON.parse(row.payload_json), cursor: this.cursor(actor.id, scanned) });
    }
    await this.host.actor(actor.credential, "events.replay", "*");
    return {
      events,
      cursor: this.cursor(actor.id, scanned),
      caughtUp: scanned === high,
      readOnly: true,
    };
  }

  async event(actor: SessionActor, id: string, livePublic = false) {
    this.prune();
    const row = this.host.sql
      .exec<Row>("SELECT * FROM event_journal WHERE event_id=?", id)
      .toArray()[0];
    if (
      !row ||
      (row.audience_required &&
        !(livePublic && row.live_public && row.resource_kind === "channel") &&
        !this.host.sql
          .exec(
            "SELECT 1 FROM event_audience WHERE event_id=? AND account_id=?",
            row.event_id,
            actor.id,
          )
          .toArray().length) ||
      !(await this.host.authorizeEvent(actor, this.resource(row))) ||
      !(await this.host.authorizePayload(actor, JSON.parse(row.payload_json), this.resource(row)))
    )
      return null;
    const event = JSON.parse(row.payload_json) as RealtimeEvent;
    if (
      livePublic &&
      row.live_public &&
      row.audience_required &&
      !this.host.sql
        .exec(
          "SELECT 1 FROM event_audience WHERE event_id=? AND account_id=?",
          row.event_id,
          actor.id,
        )
        .toArray().length
    )
      return { ...event, transient: true };
    return event;
  }
}
