import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import WebSocket from "ws";
import { isReaderControl } from "./event-reader";
import type { MatrixActor } from "./matrix-fixture";
import { ensureNitroBuilt, TestIRCClient } from "./miniflare-harness";

export async function createMediaRoleGapFixture(provider: "sqlite" | "r2") {
  const dir = await mkdtemp(path.join(tmpdir(), "flarc-media-role-"));
  await cp(path.dirname(await ensureNitroBuilt()), path.join(dir, "production"), {
    recursive: true,
  });
  // Inspection and provider scheduling exist only in this temporary worker.
  await writeFile(
    path.join(dir, "wrapper.mjs"),
    `
import app, {AccountsDO as Accounts,ChannelDO as Channel} from './production/index.mjs';
import {DurableObject} from 'cloudflare:workers';
export {SessionDO} from './production/index.mjs';
export class Gate extends DurableObject {
  reached=false; listeners=[]; release=null;
  async hold(){this.reached=true;const promise=new Promise(resolve=>this.release=resolve);for(const resolve of this.listeners.splice(0))resolve(true);await promise;}
  async waitReached(){return this.reached?true:new Promise(resolve=>this.listeners.push(resolve));}
  async resume(){this.release?.();}
}
export class AccountsDO extends Accounts {
  async roleGapSnapshot(){return JSON.stringify({
    rows:this.ctx.storage.sql.exec('SELECT id,owner_id,filename,mime_type,size,scope_kind,scope_target,scope_generation,storage_kind,data_layout,data_sha256,upload_state,object_key,length(data) AS inline_bytes FROM media_uploads ORDER BY id').toArray(),
    chunks:this.ctx.storage.sql.exec('SELECT media_id,chunk_index,length(data) AS bytes FROM media_upload_chunks ORDER BY media_id,chunk_index').toArray(),
    quota:this.ctx.storage.sql.exec('SELECT owner_id,SUM(size) AS bytes FROM media_uploads GROUP BY owner_id ORDER BY owner_id').toArray()
  });}
}
export class ChannelDO extends Channel {
  async roleGapSnapshot(){const result={};for(const table of ['channel_metadata','channel_kv_metadata','channel_role_groups','channel_user_roles','channel_permissions','channel_list_modes','channel_bans','messages'])result[table]=this.ctx.storage.sql.exec('SELECT * FROM '+table+' ORDER BY rowid').toArray();return JSON.stringify(result);}
}
export default {async fetch(request,env,ctx){
  if(!request.headers.has('X-Test-Hold-Put'))return app.fetch(request,env,ctx);
  const bucket=new Proxy(env.MEDIA_BUCKET,{get(target,key){
    if(key==='put')return async(...args)=>{const result=await target.put(...args);await env.GATE.get(env.GATE.idFromName('put')).hold();return result;};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  return app.fetch(request,{...env,MEDIA_BUCKET:bucket},ctx);
}};
`,
  );
  const config = {
    modules: true as const,
    scriptPath: path.join(dir, "wrapper.mjs"),
    modulesRoot: dir,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SIGNUP_POLICY: "open" },
    durableObjectsPersist: path.join(dir, "do"),
    ...(provider === "r2" ? { r2Buckets: ["MEDIA_BUCKET"], r2Persist: path.join(dir, "r2") } : {}),
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
      GATE: { className: "Gate", useSQLite: true },
    },
  };
  let mf = new Miniflare(config),
    url = await mf.ready;
  const clients: TestIRCClient[] = [],
    sockets: WebSocket[] = [];
  const request = (route: string, actor?: MatrixActor, method = "GET", body?: unknown) =>
    fetch(new URL(route, url), {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function actor(username: string): Promise<MatrixActor> {
    const password = `Role-${username}-${randomUUID()}!`;
    const registered = await request("/api/v1/auth/register", undefined, "POST", {
      username,
      password,
    });
    if (registered.status !== 201) throw new Error(`register: ${registered.status}`);
    const response = await request("/api/v1/auth/login", undefined, "POST", { username, password });
    if (response.status !== 200) throw new Error(`login: ${response.status}`);
    const data = (await response.json()) as any;
    return { username, password, token: data.token, account: data.account };
  }
  async function connect(who: MatrixActor) {
    const c = new TestIRCClient(`ws://${url.host}/irc`);
    clients.push(c);
    await c.connect();
    c.send(`PASS ${who.username}:${who.password}`);
    await c.register(who.username);
    return c;
  }
  async function events(who: MatrixActor) {
    const response = await request("/api/v1/auth/events-ticket", who, "POST", {});
    if (response.status !== 200) throw new Error(`ticket: ${response.status}`);
    const { ticket } = (await response.json()) as any;
    const ws = new WebSocket(`ws://${url.host}/api/v1/events?ticket=${ticket}`, [
      "flarc.events.v2",
    ]);
    sockets.push(ws);
    const lines: string[] = [];
    ws.on("message", (data) => {
      if (!isReaderControl(ws, data)) lines.push(data.toString());
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return {
      lines,
      async until(marker: string) {
        for (let i = 0; i < 500; i++) {
          if (lines.some((line) => line.includes(marker))) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Missing event ${marker}`);
      },
    };
  }
  const upload = (
    who: MatrixActor,
    channel: string,
    body: string | Uint8Array,
    alias = "/api/v1/media/upload",
    hold = false,
  ) =>
    fetch(new URL(`${alias}?channel=${encodeURIComponent(channel)}`, url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${who.token}`,
        "Content-Type": "application/octet-stream",
        "X-Filename": "role.bin",
        ...(hold ? { "X-Test-Hold-Put": "1" } : {}),
      },
      body: body as any,
    });
  async function accounts() {
    const ns = await mf.getDurableObjectNamespace("ACCOUNTS");
    return ns.get(ns.idFromName("FlaRC")) as any;
  }
  async function channel(name: string) {
    const ns = await mf.getDurableObjectNamespace("CHANNELS");
    return ns.get(ns.idFromName(`FlaRC:${name}`)) as any;
  }
  async function objects() {
    return provider === "r2"
      ? (await (await mf.getR2Bucket("MEDIA_BUCKET")).list()).objects
          .map(({ key, size }) => ({ key, size }))
          .sort((a, b) => a.key.localeCompare(b.key))
      : [];
  }
  async function state() {
    return {
      ...JSON.parse(await (await accounts()).roleGapSnapshot()),
      objects: await objects(),
      channel: JSON.parse(await (await channel("#attachments")).roleGapSnapshot()),
      other: JSON.parse(await (await channel("#other")).roleGapSnapshot()),
    };
  }
  async function gate() {
    const ns = await mf.getDurableObjectNamespace("GATE");
    return ns.get(ns.idFromName("put")) as any;
  }
  async function stop() {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const c of clients.splice(0)) c.close();
    await mf.dispose();
  }
  return {
    actor,
    connect,
    events,
    request,
    upload,
    state,
    gate,
    async restart() {
      await stop();
      mf = new Miniflare(config);
      url = await mf.ready;
    },
    async dispose() {
      await stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
