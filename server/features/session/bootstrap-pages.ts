import { FeatureError } from "../operations";
import type { SessionJournal } from "./journal";

type PageRow = {
  account_id: string;
  scan_after: string;
  recovery_cursor: string;
  expires_at: number;
};
/** Server-side scan state never exposes private sort keys in a client token. */
export class BootstrapPages {
  constructor(
    private readonly sql: SqlStorage,
    private readonly journal: SessionJournal,
    private readonly retentionMs: number,
  ) {}
  begin(accountId: string, token?: string) {
    if (!token) return { scanAfter: "", cursor: this.journal.cursor(accountId) };
    const page = this.sql
      .exec<PageRow>("SELECT * FROM bootstrap_pages WHERE token=?", token)
      .toArray()[0];
    if (page && page.account_id !== accountId)
      throw new FeatureError(
        403,
        "BOOTSTRAP_PAGE_FORBIDDEN",
        "Bootstrap page belongs to another account",
      );
    if (!page || page.expires_at <= Date.now())
      throw new FeatureError(
        410,
        "BOOTSTRAP_PAGE_EXPIRED",
        "Resync required: obtain a new bootstrap snapshot",
      );
    this.journal.position(accountId, page.recovery_cursor);
    return { scanAfter: page.scan_after, cursor: page.recovery_cursor };
  }
  next(accountId: string, scanAfter: string, cursor: string) {
    const now = Date.now();
    this.journal.position(accountId, cursor);
    this.sql.exec("DELETE FROM bootstrap_pages WHERE expires_at<=?", now);
    if (
      this.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM bootstrap_pages WHERE account_id=?",
          accountId,
        )
        .toArray()[0].count >= 64
    )
      throw new FeatureError(429, "BOOTSTRAP_PAGE_LIMIT", "Too many retained bootstrap pages");
    const recovery = this.sql
      .exec<{ expires_at: number }>(
        "SELECT expires_at FROM event_cursors WHERE token=? AND account_id=?",
        cursor,
        accountId,
      )
      .toArray()[0];
    const expiresAt = Math.min(
      now + Math.max(1000, Math.min(this.retentionMs, 900000)),
      recovery.expires_at,
    );
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    this.sql.exec(
      "INSERT INTO bootstrap_pages(token,account_id,scan_after,recovery_cursor,expires_at) VALUES (?,?,?,?,?)",
      token,
      accountId,
      scanAfter,
      cursor,
      expiresAt,
    );
    return token;
  }
}
