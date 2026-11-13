import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { ensureNitroBuilt, TestIRCClient } from "./miniflare-harness";

export async function createMediaRaceFixture(r2: boolean) {
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-media-race-"));
  const bundle = await ensureNitroBuilt();
  const bootstrap = `bootstrap-${randomUUID()}`;
  await cp(path.dirname(bundle), path.join(directory, "production"), { recursive: true });
  await writeFile(
    path.join(directory, "wrapper.mjs"),
    `
import app, {AccountsDO as Accounts, ChannelDO as Channel} from './production/index.mjs';
import { DurableObject } from 'cloudflare:workers';
export {SessionDO} from './production/index.mjs';
export class AccountsDO extends Accounts {
  matrixRows() { return this.ctx.storage.sql.exec('SELECT id, owner_id, filename, size, storage_kind, object_key FROM media_uploads ORDER BY id').toArray(); }
  matrixChunks() { return this.ctx.storage.sql.exec('SELECT media_id, chunk_index, length(data) AS size FROM media_upload_chunks ORDER BY media_id, chunk_index').toArray(); }
  matrixStates() { return this.ctx.storage.sql.exec('SELECT id, owner_id, upload_state FROM media_uploads ORDER BY id').toArray(); }
}
export class ChannelDO extends Channel {
  armed = false; reached = false; entered = []; release = null;
  matrixArm() { this.armed = true; this.reached = false; }
  matrixReached() { return this.reached ? true : new Promise(resolve => this.entered.push(resolve)); }
  matrixRelease() { this.release?.(); }
  async getMediaScope(actor) {
    const result = await super.getMediaScope(actor);
    if (this.armed) {
      this.armed = false; this.reached = true;
      const paused = new Promise(resolve => this.release = resolve);
      for (const resolve of this.entered.splice(0)) resolve(true);
      await paused;
    }
    return result;
  }
}
export class RaceGate extends DurableObject {
  reached = false; entered = []; release = null;
  async hold() { this.reached = true; const paused = new Promise(resolve => this.release = resolve); for(const resolve of this.entered.splice(0)) resolve(true); await paused; }
  waitReached() { return this.reached ? true : new Promise(resolve => this.entered.push(resolve)); }
  releaseGate() { this.release?.(); }
}
export default { async fetch(request, env, ctx) {
  const mode = request.headers.get('X-Matrix-Put');
  if (!mode || !env.MEDIA_BUCKET) return app.fetch(request, env, ctx);
  const original = env.MEDIA_BUCKET;
  const bucket = new Proxy(original, {get(target, key) {
    if (key === 'put') return async (...args) => {
      if (mode === 'hold-success') {
        const result = await target.put(...args);
        const gate = env.RACE_GATE.get(env.RACE_GATE.idFromName('put'));
        await gate.hold();
        return result;
      }
      if (mode === 'hold-fail') {
        const gate = env.RACE_GATE.get(env.RACE_GATE.idFromName('put'));
        await gate.hold();
      }
      throw new Error('matrix injected put failure');
    };
    const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  return app.fetch(request, {...env, MEDIA_BUCKET: bucket}, ctx);
} };
`,
  );
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(directory, "wrapper.mjs"),
    modulesRoot: directory,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SIGNUP_POLICY: "open", ADMIN_USERS: "rootadmin", ADMIN_TOKEN: bootstrap },
    durableObjectsPersist: path.join(directory, "do"),
    ...(r2 ? { r2Buckets: ["MEDIA_BUCKET"], r2Persist: path.join(directory, "r2") } : {}),
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
      RACE_GATE: { className: "RaceGate", useSQLite: true },
    },
  });
  const url = await mf.ready;
  const clients: TestIRCClient[] = [];
  const request = (route: string, token?: string, method = "GET", body?: unknown) =>
    fetch(new URL(route, url), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const actor = async (username: string, root = false) => {
    const password = `Pw-${username}-${randomUUID()}!`;
    const signup = await fetch(new URL("/api/v1/auth/register", url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(root ? { "x-bootstrap-token": bootstrap } : {}),
      },
      body: JSON.stringify({ username, password }),
    });
    if (signup.status !== 201) throw new Error(`register ${signup.status} ${await signup.text()}`);
    const login = await request("/api/v1/auth/login", undefined, "POST", { username, password });
    if (login.status !== 200) throw new Error(`login ${login.status}`);
    const data = (await login.json()) as any;
    return { username, password, token: data.token, id: data.account.id };
  };
  const connect = async (user: Awaited<ReturnType<typeof actor>>) => {
    const c = new TestIRCClient(`ws://${url.host}/irc`);
    clients.push(c);
    await c.connect();
    c.send(`PASS ${user.username}:${user.password}`);
    await c.register(user.username);
    return c;
  };
  const upload = (token: string, body: string, filename: string, query = "", mode?: string) =>
    fetch(new URL(`/api/v1/media/upload${query}`, url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
        "X-Filename": filename,
        ...(mode ? { "X-Matrix-Put": mode } : {}),
      },
      body,
    });
  const namespace = await mf.getDurableObjectNamespace("ACCOUNTS");
  const accounts = namespace.get(namespace.idFromName("FlaRC")) as any;
  const putNamespace = await mf.getDurableObjectNamespace("RACE_GATE");
  const putGate = putNamespace.get(putNamespace.idFromName("put")) as any;
  return {
    mf,
    putGate,
    url,
    request,
    actor,
    connect,
    upload,
    accounts,
    async dispose() {
      for (const c of clients) c.close();
      await mf.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
