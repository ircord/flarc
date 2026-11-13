import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { observedAuthFixture } from "./auth-gap-fixture";
import { isReaderControl } from "./event-reader";
import type { MatrixActor } from "./matrix-fixture";
import { TestIRCClient } from "./miniflare-harness";

/** Production worker/logging/authentication; extra inspection is read-only SQLite. */
export async function inputResourceCompletionFixture() {
  const r = await observedAuthFixture();
  const extraSockets: WebSocket[] = [];
  async function files(dir: string): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(dir, { withFileTypes: true })
        ).map((entry) =>
          entry.isDirectory()
            ? files(path.join(dir, entry.name))
            : Promise.resolve(entry.name.endsWith(".sqlite") ? [path.join(dir, entry.name)] : []),
        ),
      )
    ).flat();
  }
  async function state() {
    const result: Record<string, any[]> = {};
    const tables = [
      "users",
      "scram_credentials",
      "account_roles",
      "registered_nicks",
      "api_sessions",
      "event_tickets",
      "user_metadata",
      "webpush_subscriptions",
      "channel_metadata",
      "channel_kv_metadata",
      "channel_permissions",
      "channel_members",
      "channel_role_groups",
      "channel_user_roles",
      "messages",
      "direct_messages",
    ];
    for (const table of tables) result[table] = [];
    for (const file of await files(r.f.directory)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const existing = new Set(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all()
            .map((row: any) => row.name),
        );
        const name = existing.has("channel_metadata")
          ? (db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as any)
          : null;
        for (const table of tables) {
          if (
            !existing.has(table) ||
            (name?.value === "#markers" && (table.startsWith("channel_") || table === "messages"))
          )
            continue;
          let rows = db.prepare(`SELECT * FROM ${table}`).all() as any[];
          // Sessions/join timestamps are ephemeral; stable account membership/modes are protected.
          if (table === "channel_members")
            rows = rows.map(({ user_id, account_name, nickname, modes, is_persistent }) => ({
              user_id,
              account_name,
              nickname,
              modes: [...modes].sort().join(""),
              is_persistent,
            }));
          result[table].push(...rows);
        }
      } finally {
        db.close();
      }
    }
    for (const rows of Object.values(result))
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return result;
  }
  async function openEvents(actor: MatrixActor) {
    const ws = new WebSocket(
      new URL("/api/v1/events", r.f.url).href.replace(/^http/, "ws"),
      ["flarc.events.v2"],
      {
        headers: { Authorization: `Bearer ${actor.token}` },
      },
    );
    extraSockets.push(ws);
    const lines: string[] = [];
    ws.on("message", (data) => {
      if (!isReaderControl(ws, data)) lines.push(data.toString());
    });
    const status = await new Promise<number>((resolve, reject) => {
      ws.once("open", () => resolve(101));
      ws.once("error", reject);
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode!);
      });
    });
    return { ws, lines, status };
  }
  async function closeExtra() {
    await Promise.all(
      extraSockets.splice(0).map(async (ws) => {
        if (ws.readyState === WebSocket.CLOSED) return;
        const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
        ws.terminate();
        await closed;
      }),
    );
  }
  async function eventLeases(accountId: string) {
    let count = 0;
    for (const file of await files(r.f.directory)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='event_connection_leases'").get())
          count += (
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM event_connection_leases WHERE account_id=? AND expires_at>?",
              )
              .get(accountId, Date.now()) as { n: number }
          ).n;
      } finally {
        db.close();
      }
    }
    return count;
  }
  return {
    r,
    state,
    openEvents,
    closeExtra,
    eventLeases,
    async connect(actor: MatrixActor, nickname = actor.username) {
      const client = new TestIRCClient(`ws://${r.f.url.host}/irc`, "binary.ircv3.net");
      await client.connect();
      extraSockets.push(client.ws);
      client.send(`PASS ${actor.username}:${actor.password}`);
      await client.register(nickname);
      return client;
    },
    async resume() {
      await closeExtra();
      await r.resume();
    },
    async dispose() {
      await closeExtra();
      await r.dispose();
    },
  };
}
