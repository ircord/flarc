import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { ensureNitroBuilt, TestIRCClient } from "./miniflare-harness";

export async function createMediaRecoveryFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "flarc-media-recovery-"));
  await cp(path.dirname(await ensureNitroBuilt()), path.join(dir, "production"), {
    recursive: true,
  });
  await writeFile(
    path.join(dir, "wrapper.mjs"),
    `
import app, {AccountsDO as Accounts} from './production/index.mjs';
import { DurableObject } from 'cloudflare:workers';
export {SessionDO,ChannelDO} from './production/index.mjs';
export class RecoveryGate extends DurableObject {
  blocked = false; reached = false; listeners=[]; release=null;
  lastReservation = null;
  rememberReservation(value) { this.lastReservation=value; }
  reservation() { return this.lastReservation; }
  setDeleteFailure(value) { this.blocked=value; }
  shouldFailDelete() { return this.blocked; }
  async hold() { this.reached=true;const wait=new Promise(resolve=>this.release=resolve);for(const resolve of this.listeners.splice(0))resolve(true);await wait; }
  waitReached() { return this.reached ? true : new Promise(resolve=>this.listeners.push(resolve)); }
  releaseGate() { this.release?.(); }
}
export class AccountsDO extends Accounts {
  constructor(ctx,env) {
    const source=env.MEDIA_BUCKET;
    const bucket=new Proxy(source,{get(target,key){
      if(key==='delete')return async (...args)=>{
        const gate=env.RECOVERY_GATE.get(env.RECOVERY_GATE.idFromName('faults'));
        if(await gate.shouldFailDelete())throw new Error('test provider delete failure');
        return target.delete(...args);
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    super(ctx,{...env,MEDIA_BUCKET:bucket});
  }
  recoveryRows() {return this.ctx.storage.sql.exec('SELECT id,owner_id,filename,size,upload_state,storage_kind,object_key,lease_until FROM media_uploads ORDER BY id').toArray();}
  recoveryAlarm() {return this.ctx.storage.getAlarm();}
  recoveryExpire(id) {this.ctx.storage.sql.exec("UPDATE media_uploads SET lease_until=0 WHERE id=? AND upload_state='pending'",id);}
  recoveryRun() {return this.alarm();}
  recoveryQuota(ownerId) {return this.ctx.storage.sql.exec('SELECT COALESCE(SUM(size),0) AS bytes FROM media_uploads WHERE owner_id=?',ownerId).toArray()[0].bytes;}
}
export default {async fetch(request,env,ctx){
  const mode=request.headers.get('X-Recovery-Put');
  if(!mode)return app.fetch(request,env,ctx);
  const source=env.MEDIA_BUCKET;
  const bucket=new Proxy(source,{get(target,key){
    if(key==='put')return async (...args)=>{
      const rows=await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('FlaRC')).recoveryRows();
      await env.RECOVERY_GATE.get(env.RECOVERY_GATE.idFromName('faults')).rememberReservation(rows.find(row=>row.object_key===args[0])??null);
      if(mode==='hold-before-write'){const gate=env.RECOVERY_GATE.get(env.RECOVERY_GATE.idFromName('faults'));await gate.hold();}
      const result=await target.put(...args);
      if(mode==='write-fail')throw new Error('test put failed after write');
      if(mode==='write-hold'){const gate=env.RECOVERY_GATE.get(env.RECOVERY_GATE.idFromName('faults'));await gate.hold();}
      return result;
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  return app.fetch(request,{...env,MEDIA_BUCKET:bucket},ctx);
}};
`,
  );
  async function start() {
    const mf = new Miniflare({
      modules: true,
      scriptPath: path.join(dir, "wrapper.mjs"),
      modulesRoot: dir,
      compatibilityDate: "2025-02-04",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { SIGNUP_POLICY: "open" },
      durableObjectsPersist: path.join(dir, "do"),
      r2Buckets: ["MEDIA_BUCKET"],
      r2Persist: path.join(dir, "r2"),
      durableObjects: {
        SESSION: { className: "SessionDO", useSQLite: true },
        CHANNELS: { className: "ChannelDO", useSQLite: true },
        ACCOUNTS: { className: "AccountsDO", useSQLite: true },
        RECOVERY_GATE: { className: "RecoveryGate", useSQLite: true },
      },
    });
    const url = await mf.ready;
    const accountsNS = await mf.getDurableObjectNamespace("ACCOUNTS"),
      gateNS = await mf.getDurableObjectNamespace("RECOVERY_GATE");
    return {
      mf,
      url,
      accounts: accountsNS.get(accountsNS.idFromName("FlaRC")) as any,
      gate: gateNS.get(gateNS.idFromName("faults")) as any,
    };
  }
  let runtime = await start();
  const clients: TestIRCClient[] = [];
  let stopped = false;
  const request = (route: string, token?: string, method = "GET", body?: unknown) =>
    fetch(new URL(route, runtime.url), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const actor = async (username: string) => {
    const password = `Pw-${username}-${randomUUID()}!`;
    const signup = await request("/api/v1/auth/register", undefined, "POST", {
      username,
      password,
    });
    if (signup.status !== 201) throw new Error(`signup ${signup.status}`);
    const login = await request("/api/v1/auth/login", undefined, "POST", { username, password });
    if (login.status !== 200) throw new Error(`login ${login.status}`);
    const data = (await login.json()) as any;
    return { username, password, token: data.token, id: data.account.id };
  };
  const upload = (token: string, body: string, filename: string, mode?: string) =>
    fetch(new URL("/api/v1/media/upload", runtime.url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
        "X-Filename": filename,
        ...(mode ? { "X-Recovery-Put": mode } : {}),
      },
      body,
    });
  const connect = async (user: Awaited<ReturnType<typeof actor>>) => {
    const c = new TestIRCClient(`ws://${runtime.url.host}/irc`);
    clients.push(c);
    await c.connect();
    c.send(`PASS ${user.username}:${user.password}`);
    await c.register(user.username);
    return c;
  };
  async function stop() {
    if (!stopped) {
      for (const client of clients.splice(0)) client.close();
      await runtime.mf.dispose();
      stopped = true;
    }
  }
  return {
    get runtime() {
      return runtime;
    },
    request,
    actor,
    upload,
    connect,
    async restart() {
      await stop();
      runtime = await start();
      stopped = false;
    },
    stop,
    async dispose() {
      await stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
