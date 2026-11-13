import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ensureNitroBuilt } from "../helpers/miniflare-harness";
import { createMatrixFixture, json, wire } from "./helpers/session-features";
import { eventually, liveRows, shardStream } from "./helpers/shards-backpressure";

async function trace(name: string, value: unknown) {
  const file = process.env.FLARC_EVENT_SNAPSHOT_TRACE;
  if (!file) return;
  const prior = await readFile(file, "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  prior[name] = value;
  await writeFile(file, JSON.stringify(prior, null, 2));
}

/** Gates the result of one genuine liveness RPC; all authentication and local
 * channel decisions remain in the production worker. */
async function snapshotFixture() {
  const original = process.env.FLARC_TEST_BUNDLE;
  const bundle = await ensureNitroBuilt();
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-event-snapshot-"));
  await cp(path.dirname(bundle), path.join(directory, "production"), { recursive: true });
  const wrapper = path.join(directory, "wrapper.mjs");
  await writeFile(
    wrapper,
    `
export {default,AccountsDO} from './production/index.mjs';
import {ChannelDO as Channel,SessionDO as Session} from './production/index.mjs';
export class SessionDO extends Session {
  gateId=null; gateMode='hold'; gateReached=false; gateRelease=null; closedEvents=[];
  snapshotHold(id,mode){this.gateId=id;this.gateMode=mode;this.gateReached=false;}
  snapshotReached(){return this.gateReached;}
  snapshotRelease(){this.gateId=null;this.gateRelease?.();this.gateRelease=null;}
  getLiveAccountSessions(id){
    const actual=super.getLiveAccountSessions(id);
    if(id===this.gateId){
      this.gateId=null;this.gateReached=true;
      return new Promise(resolve=>{this.gateRelease=resolve;}).then(()=>{
        if(this.gateMode==='sql-failure')this.sql.exec('SELECT * FROM snapshot_deliberately_missing_table').toArray();
        return actual;
      });
    }
    return actual;
  }
  async webSocketClose(ws,code,reason,...args){
    const a=ws.deserializeAttachment();
    if(a?.edgeLease)this.closedEvents.push({cursor:a.ackCursor,code,reason});
    return super.webSocketClose(ws,code,reason,...args);
  }
  snapshotEdgeJSON(){return JSON.stringify({closed:this.closedEvents,sockets:this.ctx.getWebSockets('edge-events').map(ws=>({cursor:ws.deserializeAttachment()?.ackCursor,readyState:ws.readyState}))});}
}
export class ChannelDO extends Channel {
  target=null; remaining=0; gateMode='hold'; observations=[];
  snapshotArm(id,nth=1,mode='hold'){this.target=id;this.remaining=nth;this.gateMode=mode;this.observations=[];}
  snapshotObservationsJSON(){return JSON.stringify(this.observations);}
  async getAccessSnapshot(actor){
    const watched=actor.id===this.target;
    const row={revisionBefore:this.featureRevision(),accountId:actor.id};
    if(watched&&--this.remaining===0)
      await this.env.SESSION.get(this.env.SESSION.idFromName('FlaRC')).snapshotHold(actor.id,this.gateMode);
    try{const value=await super.getAccessSnapshot(actor);if(watched)row.canRead=value.canRead;return value;}
    catch(error){if(watched)row.error=String(error?.message??error);throw error;}
    finally{if(watched){row.revisionAfter=this.featureRevision();this.observations.push(row);}}
  }
}
`,
  );
  process.env.FLARC_TEST_BUNDLE = wrapper;
  let f: Awaited<ReturnType<typeof createMatrixFixture>> | undefined;
  const streams: Awaited<ReturnType<typeof shardStream>>[] = [];
  try {
    f = await createMatrixFixture();
    const namespace = await f.server.mf.getDurableObjectNamespace("SESSION");
    const central = namespace.get(namespace.idFromName("FlaRC")) as any;
    const channels = await f.server.mf.getDurableObjectNamespace("CHANNELS");
    const room = "#snapshot-race",
      route = `/api/v1/channels/${encodeURIComponent(room)}`;
    const channel = channels.get(channels.idFromName(`FlaRC:${room}`)) as any;
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      outsider = await f.createActor("outsider");
    const a = await f.connect(alice),
      c = await f.connect(outsider);
    await wire(a, `JOIN ${room}`, / 366 .* #snapshot-race /);
    await json(f, `${route}/join`, bob, "POST", {});
    await wire(a, `MODE ${room} +s`, / MODE #snapshot-race \+s/);
    for (const client of [a, c])
      await wire(client, "JOIN #snapshot-public", / 366 .* #snapshot-public /);
    await json(f, "/api/v1/channels/%23snapshot-public/join", bob, "POST", {});
    const inside = await shardStream(f, bob),
      outside = await shardStream(f, outsider, { avoidShard: inside.shard });
    streams.push(inside, outside);
    async function publicBarrier(label: string) {
      const message = (
        await json(
          f!,
          "/api/v1/channels/%23snapshot-public/messages",
          outsider,
          "POST",
          { content: `public-${label}` },
          201,
        )
      ).message;
      await inside.until((event) => event.messageId === message.id);
      await outside.until((event) => event.messageId === message.id);
      return inside.frames.find((event) => event.messageId === message.id).cursor as string;
    }
    const beforeCursor = await publicBarrier("before");
    return {
      f,
      alice,
      bob,
      outsider,
      a,
      room,
      route,
      channel,
      central,
      inside,
      outside,
      beforeCursor,
      publicBarrier,
      edge: namespace.get(namespace.idFromName(`FlaRC:events:${inside.shard}`)) as any,
      async arm(nth = 1, mode = "hold") {
        await channel.snapshotArm(bob.account.id, nth, mode);
      },
      async reached() {
        await eventually(async () => central.snapshotReached());
      },
      async release() {
        await central.snapshotRelease();
      },
      async publish(content: string) {
        return (await json(f!, `${route}/messages`, alice, "POST", { content }, 201)).message;
      },
      async observations() {
        return JSON.parse(await channel.snapshotObservationsJSON());
      },
      async cursorPosition(cursor: string) {
        const row = (await liveRows(f!, "event_cursors"))
          .flat()
          .find((row) => row.token === cursor && row.account_id === bob.account.id);
        expect(row, "actual Bob-bound stored cursor").toBeDefined();
        return row.journal_sequence as number;
      },
      async dispose() {
        try {
          await central.snapshotRelease();
        } finally {
          for (const stream of streams) stream.close();
          await f!.dispose();
          if (original === undefined) delete process.env.FLARC_TEST_BUNDLE;
          else process.env.FLARC_TEST_BUNDLE = original;
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    for (const stream of streams) stream.close();
    await f?.dispose();
    if (original === undefined) delete process.env.FLARC_TEST_BUNDLE;
    else process.env.FLARC_TEST_BUNDLE = original;
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

it("a message committed while channel snapshot liveness is pending preserves both ordered private events", async () => {
  const g = await snapshotFixture();
  try {
    await g.arm();
    const first = await g.publish("snapshot-first");
    await g.reached();
    const second = await g.publish("snapshot-during-liveness");
    await g.release();
    await g.inside.until((event) => event.messageId === second.id);
    await g.publicBarrier("after-race");
    const ids = g.inside.frames
      .filter((event) => [first.id, second.id].includes(event.messageId))
      .map((event) => event.messageId);
    const journal = (await liveRows(g.f, "event_journal"))
      .flat()
      .filter((row) => [first.id, second.id].includes(JSON.parse(row.payload_json).messageId));
    await trace("revisionRace", {
      ids,
      expected: [first.id, second.id],
      journal,
      observations: await g.observations(),
    });
    expect(journal).toHaveLength(2);
    expect(g.outside.frames.some((event) => [first.id, second.id].includes(event.messageId))).toBe(
      false,
    );
    expect(ids).toEqual([first.id, second.id]);
  } finally {
    await g.dispose();
  }
}, 30000);

it("a real channel ban while snapshot liveness is pending denies private events until the ban is removed", async () => {
  const g = await snapshotFixture();
  try {
    await g.arm();
    const first = await g.publish("snapshot-revoked-first");
    await g.reached();
    await wire(g.a, `MODE ${g.room} +b bob!*@*`, / MODE #snapshot-race \+b bob!\*@\*/);
    const second = await g.publish("snapshot-revoked-next");
    await g.release();
    await g.publicBarrier("after-ban");
    await json(g.f, `${g.route}/messages`, g.bob, "GET", undefined, 403);
    for (const stream of [g.inside, g.outside])
      expect(stream.frames.some((event) => [first.id, second.id].includes(event.messageId))).toBe(
        false,
      );
    await wire(g.a, `MODE ${g.room} -b bob!*@*`, / MODE #snapshot-race -b bob!\*@\*/);
    const restored = await g.publish("snapshot-real-ban-removed");
    await g.inside.until((event) => event.messageId === restored.id);
    expect(g.outside.frames.some((event) => event.messageId === restored.id)).toBe(false);
    await trace("revocation", {
      denied: [first.id, second.id],
      restored: restored.id,
      observations: await g.observations(),
    });
  } finally {
    await g.dispose();
  }
}, 30000);

for (const [stage, snapshotCall] of [
  ["resource", 1],
  ["payload", 2],
] as const) {
  it(`an operational ${stage} authorization RPC failure retains the cursor and permits explicit replay recovery`, async () => {
    const g = await snapshotFixture();
    let recovered: Awaited<ReturnType<typeof shardStream>> | undefined;
    try {
      const beforeSequence = await g.cursorPosition(g.beforeCursor);
      await eventually(
        async () =>
          (await g.cursorPosition(
            JSON.parse(await g.edge.snapshotEdgeJSON()).sockets[0].cursor,
          )) === beforeSequence,
      );
      const edgeBefore = JSON.parse(await g.edge.snapshotEdgeJSON());
      await g.arm(snapshotCall, "sql-failure");
      const first = await g.publish(`snapshot-${stage}-failure-first`);
      await g.reached();
      const second = await g.publish(`snapshot-${stage}-failure-second`);
      await g.release();
      await eventually(
        () =>
          g.inside.closeCode !== undefined ||
          g.inside.frames.some((event) => event.messageId === second.id),
      );
      const journal = (await liveRows(g.f, "event_journal"))
        .flat()
        .filter((row) => [first.id, second.id].includes(JSON.parse(row.payload_json).messageId));
      await trace(`operational-${stage}`, {
        phase: "failure",
        close: g.inside.diagnostic(),
        edgeBefore,
        edgeAfter: JSON.parse(await g.edge.snapshotEdgeJSON()),
        journal,
        observations: await g.observations(),
      });
      expect(journal).toHaveLength(2);
      expect(g.inside.closeCode).toBe(1008);
      expect(g.inside.closeReason).toContain("recovery required");
      expect(g.inside.frames.some((event) => [first.id, second.id].includes(event.messageId))).toBe(
        false,
      );
      await eventually(async () => JSON.parse(await g.edge.snapshotEdgeJSON()).closed.length > 0);
      const edgeAfter = JSON.parse(await g.edge.snapshotEdgeJSON());
      // Event cursors and poll-result cursors have distinct opaque tokens at
      // the same position. Compare authoritative positions, preserving both
      // actual tokens in the diagnostic rather than assuming token identity.
      expect(await g.cursorPosition(edgeAfter.closed.at(-1).cursor)).toBe(beforeSequence);
      const publicMessage = (
        await json(
          g.f,
          "/api/v1/channels/%23snapshot-public/messages",
          g.outsider,
          "POST",
          { content: `public-${stage}-failure-control` },
          201,
        )
      ).message;
      await g.outside.until((event) => event.messageId === publicMessage.id);
      expect(
        g.outside.frames.some((event) => [first.id, second.id].includes(event.messageId)),
      ).toBe(false);
      recovered = await shardStream(g.f, g.bob);
      const replay = await recovered.command({
        type: "replay",
        cursor: g.beforeCursor,
        limit: 100,
      });
      const ids = replay.result.events
        .filter((event: any) => [first.id, second.id].includes(event.messageId))
        .map((event: any) => event.messageId);
      expect(ids).toEqual([first.id, second.id]);
      expect((await g.outside.command({ type: "replay", cursor: g.beforeCursor })).status).toBe(
        403,
      );
      const fresh = await g.publish(`snapshot-${stage}-after-recovery`);
      await recovered.until((event) => event.messageId === fresh.id);
      expect(g.outside.frames.some((event) => event.messageId === fresh.id)).toBe(false);
      await trace(`operational-${stage}`, {
        phase: "recovered",
        edgeBefore,
        edgeAfter,
        beforeSequence,
        replayedIds: ids,
        journal,
        observations: await g.observations(),
      });
    } finally {
      recovered?.close();
      await g.dispose();
    }
  }, 30000);
}
