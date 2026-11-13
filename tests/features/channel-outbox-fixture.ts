import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMatrixFixture } from "../helpers/matrix-fixture";
import { ensureNitroBuilt } from "../helpers/miniflare-harness";

/** Wrap only journal transport and queue inspection; worker auth and mutations stay real. */
export async function channelOutboxFixture() {
  const original = process.env.FLARC_TEST_BUNDLE;
  const bundle = await ensureNitroBuilt();
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-outbox-order-"));
  await cp(path.dirname(bundle), path.join(directory, "production"), { recursive: true });
  const wrapper = path.join(directory, "wrapper.mjs");
  await writeFile(
    wrapper,
    `
export { default, AccountsDO } from './production/index.mjs';
import { SessionDO as Session, ChannelDO as Channel } from './production/index.mjs';
export class SessionDO extends Session {
  async setJournalBlocked(blocked) { await this.ctx.storage.put('test_journal_blocked', blocked); }
  async broadcastRealtimeEvent(...args) {
    if (await this.ctx.storage.get('test_journal_blocked')) throw new Error('test journal unavailable');
    return super.broadcastRealtimeEvent(...args);
  }
}
export class ChannelDO extends Channel {
  queuedEventRows() {
    const modern=this.sql.exec('PRAGMA table_info(channel_feature_outbox)').toArray().some(column=>column.name==='sequence');
    return this.sql.exec(modern ? "SELECT rowid,id,sequence,created_at,payload FROM channel_feature_outbox WHERE kind='event' ORDER BY sequence" : "SELECT rowid,id,rowid AS sequence,created_at,payload FROM channel_feature_outbox WHERE kind='event' ORDER BY rowid").toArray();
  }
  setAdversarialTimes(sameClock) {
    const modern=this.sql.exec('PRAGMA table_info(channel_feature_outbox)').toArray().some(column=>column.name==='sequence');
    const rows=this.sql.exec(modern ? "SELECT rowid FROM channel_feature_outbox WHERE kind='event' ORDER BY sequence" : "SELECT rowid FROM channel_feature_outbox WHERE kind='event' ORDER BY rowid").toArray();
    if(rows.length!==2) throw new Error('expected two real queued events');
    if(sameClock) {
      this.sql.exec('UPDATE channel_feature_outbox SET created_at=?,id=? WHERE rowid=?',100,'1700000000000.ffffffff-ffff-4fff-8fff-ffffffffffff',rows[0].rowid);
      this.sql.exec('UPDATE channel_feature_outbox SET created_at=?,id=? WHERE rowid=?',100,'1700000000000.00000000-0000-4000-8000-000000000000',rows[1].rowid);
    } else {
      this.sql.exec('UPDATE channel_feature_outbox SET created_at=? WHERE rowid=?',200,rows[0].rowid);
      this.sql.exec('UPDATE channel_feature_outbox SET created_at=? WHERE rowid=?',100,rows[1].rowid);
    }
  }
}
`,
  );
  process.env.FLARC_TEST_BUNDLE = wrapper;
  try {
    const fixture = await createMatrixFixture();
    return {
      fixture,
      async session() {
        const ns = await fixture.server.mf.getDurableObjectNamespace("SESSION");
        return ns.get(ns.idFromName("FlaRC")) as any;
      },
      async channel(name: string) {
        const ns = await fixture.server.mf.getDurableObjectNamespace("CHANNELS");
        return ns.get(ns.idFromName(`FlaRC:${name}`)) as any;
      },
      async dispose() {
        await fixture.dispose();
        if (original === undefined) delete process.env.FLARC_TEST_BUNDLE;
        else process.env.FLARC_TEST_BUNDLE = original;
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (original === undefined) delete process.env.FLARC_TEST_BUNDLE;
    else process.env.FLARC_TEST_BUNDLE = original;
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
