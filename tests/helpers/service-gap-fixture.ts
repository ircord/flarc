import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Read persistent grants for exactly one channel through a read-only SQLite connection. */
export async function channelGrants(directory: string, channel: string): Promise<unknown[]> {
  async function files(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
          e.isDirectory()
            ? files(path.join(dir, e.name))
            : Promise.resolve(e.name.endsWith(".sqlite") ? [path.join(dir, e.name)] : []),
        ),
      )
    ).flat();
  }
  for (const file of await files(directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (
        !db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_metadata'")
          .get()
      )
        continue;
      if (
        (db.prepare("SELECT value FROM channel_metadata WHERE key='name'").get() as any)?.value !==
        channel
      )
        continue;
      return db
        .prepare(
          "SELECT user_id, account_name, permission FROM channel_permissions ORDER BY user_id, account_name, permission",
        )
        .all();
    } finally {
      db.close();
    }
  }
  throw new Error(`Missing channel database ${channel}`);
}
