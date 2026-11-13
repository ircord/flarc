import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import WebSocket from "ws";
import type { MatrixActor } from "../../helpers/matrix-fixture";
import { type Fixture, json } from "./session-features";

/** Read committed real SQLite rows without changing the shared stopped-only helper. */
export async function liveRows(f: Fixture, table: string): Promise<any[][]> {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid table name");
  async function files(directory: string): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(directory, { withFileTypes: true })
        ).map((entry) =>
          entry.isDirectory()
            ? files(path.join(directory, entry.name))
            : entry.name.endsWith(".sqlite")
              ? [path.join(directory, entry.name)]
              : [],
        ),
      )
    ).flat();
  }
  const result: any[][] = [];
  for (const file of await files(f.directory)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        result.push(db.prepare(`SELECT * FROM ${table}`).all());
    } finally {
      db.close();
    }
  }
  return result;
}

export async function eventually(predicate: () => boolean | Promise<boolean>, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Observable shard/transport condition not reached");
}
export async function shardStream(
  f: Fixture,
  actor: MatrixActor,
  options: { avoidShard?: number; ack?: boolean; v1?: boolean; legacy?: boolean } = {},
) {
  let ticket = "",
    shard = -1;
  for (let attempt = 0; attempt < 20; attempt++) {
    ticket = (await json(f, "/api/v1/auth/events-ticket", actor, "POST")).ticket;
    shard = createHash("sha256").update(ticket).digest().readUInt32BE(0) % 4;
    if (shard !== options.avoidShard) break;
  }
  if (shard === options.avoidShard)
    throw new Error("Independent issued tickets did not reach a second bounded shard");
  const ws = new WebSocket(
    `ws://${f.server.url.host}${options.legacy ? "/api/events" : "/api/v1/events"}?ticket=${ticket}`,
    options.v1 ? undefined : ["flarc.events.v2"],
  );
  const frames: any[] = [],
    challenges: string[] = [];
  let acknowledgement = options.ack !== false,
    closeCode: number | undefined,
    closeReason = "";
  let receivedClose: number | undefined;
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    if (frame.type === "reader.challenge") {
      challenges.push(frame.token);
      if (acknowledgement) ws.send(JSON.stringify({ type: "reader.ack", token: frame.token }));
    }
  });
  ws.on("close", (code, reason) => {
    closeCode = code;
    closeReason = reason.toString();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  (
    ws as unknown as { _receiver: { on(event: string, callback: (code: number) => void): void } }
  )._receiver.on("conclude", (code) => {
    receivedClose = code;
  });
  const diagnostic = () => ({
    shard,
    readyState: ws.readyState,
    closeCode,
    receivedClose,
    transport: (() => {
      const socket = (ws as any)._socket;
      return {
        frameSent: (ws as any)._closeFrameSent,
        frameReceived: (ws as any)._closeFrameReceived,
        paused: socket?.isPaused(),
        readable: socket?.readable,
        readableEnded: socket?.readableEnded,
        writableEnded: socket?.writableEnded,
        destroyed: socket?.destroyed,
      };
    })(),
    frames: frames.length,
    challenges: challenges.length,
    types: frames.slice(-10).map((e) => e.type),
    lastMessageIds: frames
      .filter((e) => e.messageId)
      .slice(-3)
      .map((e) => e.messageId),
  });
  if (!options.v1)
    await eventually(() => frames.some((e) => e.type === "hello" && e.protocol === 2));
  async function until(predicate: (frame: any) => boolean, timeout = 7000) {
    try {
      await eventually(() => frames.some(predicate), timeout);
    } catch {
      throw new Error(`Observable event condition not reached: ${JSON.stringify(diagnostic())}`);
    }
    return frames.find(predicate);
  }
  async function command(input: Record<string, unknown>) {
    const requestId = randomUUID();
    ws.send(JSON.stringify({ ...input, requestId }));
    return until((e) => e.requestId === requestId);
  }
  return {
    ws,
    ticket,
    shard,
    frames,
    challenges,
    diagnostic,
    until,
    command,
    acknowledge: (value: boolean) => {
      acknowledgement = value;
    },
    pause: () => ws.pause(),
    resume: () => ws.resume(),
    get closeCode() {
      return closeCode;
    },
    get closeReason() {
      return closeReason;
    },
    close: () => ws.terminate(),
  };
}
export async function deniedUpgrade(f: Fixture, actor: MatrixActor, query: string, status: number) {
  const ticket = (await json(f, "/api/v1/auth/events-ticket", actor, "POST")).ticket;
  const ws = new WebSocket(`ws://${f.server.url.host}/api/v1/events?ticket=${ticket}&${query}`);
  const observed = await new Promise<number>((resolve, reject) => {
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
    });
    ws.once("open", () => reject(new Error("Forged event selector upgraded")));
    ws.once("error", () => {});
  });
  expect(observed).toBe(status);
  ws.terminate();
}

export async function deniedAnonymousUpgrade(f: Fixture, path: string, status: number) {
  const ws = new WebSocket(`ws://${f.server.url.host}${path}`, ["flarc.events.v2"]);
  const observed = await new Promise<number>((resolve, reject) => {
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
    });
    ws.once("open", () => reject(new Error("Unauthenticated/forged event upgrade accepted")));
    ws.once("error", () => {});
  });
  expect(observed).toBe(status);
  ws.terminate();
}

/** A transport-only failure/hold around the real authority RPC; auth/state stay production. */
export async function relayFixture() {
  const { cp, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { ensureNitroBuilt } = await import("../../helpers/miniflare-harness");
  const { createMatrixFixture } = await import("./session-features");
  const original = process.env.FLARC_TEST_BUNDLE,
    bundle = await ensureNitroBuilt();
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-shard-relay-"));
  await cp(path.dirname(bundle), path.join(directory, "production"), { recursive: true });
  const wrapper = path.join(directory, "wrapper.mjs");
  await writeFile(
    wrapper,
    `
export {default,AccountsDO,ChannelDO} from './production/index.mjs';
import {SessionDO as Session} from './production/index.mjs';
export class SessionDO extends Session {
  relayMode='open'; relayHeld=0; relayWaiters=[]; alarmCalls=0; closeStarted=0; closeEnded=0; inputs=new Map();
  async alarm(){this.alarmCalls++;return super.alarm();}
  async webSocketMessage(ws,message){const lease=ws.deserializeAttachment()?.edgeLease;if(lease){const input=this.inputs.get(lease)??{frames:0,maxBytes:0};input.frames++;input.maxBytes=Math.max(input.maxBytes,typeof message==='string'?new TextEncoder().encode(message).byteLength:message.byteLength);this.inputs.set(lease,input);}return super.webSocketMessage(ws,message);}
  async webSocketClose(...args){this.closeStarted++;try{return await super.webSocketClose(...args);}finally{this.closeEnded++;}}
  setRelayMode(mode){this.relayMode=mode;if(mode==='open'){for(const release of this.relayWaiters)release();this.relayWaiters=[];}}
  getRelayHeld(){return this.relayHeld;}
  async getRelaySchedule(){const alarm=await this.ctx.storage.getAlarm();return {alarm,remaining:alarm===null?null:alarm-Date.now(),alarmCalls:this.alarmCalls,closeStarted:this.closeStarted,closeEnded:this.closeEnded,inputs:Object.fromEntries(this.inputs),sockets:this.ctx.getWebSockets().map(ws=>{const r=ws.deserializeAttachment()?.readerWindow;return {readyState:ws.readyState,reader:r?{b:r.b,f:r.f,t:r.t,n:r.n,x:r.x,pending:r.p?{deadline:r.p.d}:null}:null};})};}
  async pollEventShard(...args){
    const result=await super.pollEventShard(...args);
    if(result.events.length&&this.relayMode==='fail-once'){this.relayMode='open';throw new Error('fixture: actual relay unavailable');}
    if(result.events.length&&this.relayMode==='hold'){this.relayHeld++;await new Promise(resolve=>this.relayWaiters.push(resolve));}
    return result;
  }
}
`,
  );
  process.env.FLARC_TEST_BUNDLE = wrapper;
  try {
    const fixture = await createMatrixFixture();
    const namespace = await fixture.server.mf.getDurableObjectNamespace("SESSION");
    const authority = namespace.get(namespace.idFromName("FlaRC")) as any;
    return {
      fixture,
      authority,
      shardState: async (shard: number) =>
        (namespace.get(namespace.idFromName(`FlaRC:events:${shard}`)) as any).getRelaySchedule(),
      async dispose() {
        try {
          await authority.setRelayMode("open");
        } catch {
          /* Runtime may already be stopped for independent SQLite assertions. */
        }
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
