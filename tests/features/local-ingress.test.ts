import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { createMiniflareServer } from "../helpers/miniflare-harness";

it("rejects direct internal requests when local ingress authentication is configured", async () => {
  const secret = "test-only-unique-local-ingress-secret";
  const server = await createMiniflareServer({ bindings: { LOCAL_IRC_BRIDGE_SECRET: secret } });
  try {
    const request = (headers: Record<string, string>) =>
      fetch(new URL("/api/health", server.url), { headers });
    expect((await request({})).status).toBe(403);
    expect(
      (await request({ "cf-connecting-ip": "203.0.113.10", "x-local-irc-bridge": "forged" }))
        .status,
    ).toBe(403);
    expect((await request({ "x-local-ingress": "incorrect" })).status).toBe(403);
    expect((await request({ "x-local-ingress": secret })).status).toBe(200);
  } finally {
    await server.dispose();
  }
});

it("uses real local socket peers rather than forged HTTP or IRC gateway headers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flarc-ingress-live-"));
  const bundle = process.env.FLARC_TEST_BUNDLE;
  if (!bundle) throw new Error("Frozen feature bundle required");
  await mkdir(path.join(directory, ".output"));
  await symlink(path.dirname(bundle), path.join(directory, ".output", "server"));
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });
  const httpPort = await freePort(),
    tcpPort = await freePort();
  const script = fileURLToPath(new URL("../../scripts/start-miniflare.mjs", import.meta.url).href);
  const child = spawn(process.execPath, [script], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      TCP_HOST: "127.0.0.1",
      PORT: String(httpPort),
      TCP_PORT: String(tcpPort),
      STATE_DIR: path.join(directory, "state"),
      SIGNUP_POLICY: "open",
    },
    stdio: "ignore",
  });
  let socket: WebSocket | undefined;
  let tcp: net.Socket | undefined;
  try {
    const base = `http://127.0.0.1:${httpPort}`;
    const deadline = Date.now() + 10000;
    let healthy = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        healthy = (await fetch(`${base}/api/health`)).ok;
      } catch {
        /* waiting for listener */
      }
      if (healthy) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(healthy).toBe(true);
    const headers = {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.44",
      "X-Forwarded-For": "198.51.100.44",
      "X-Local-Ingress": "forged",
    };
    const username = "alice",
      password = "Ingress-Independent-Password-42!";
    expect(
      (
        await fetch(`${base}/api/v1/auth/register`, {
          method: "POST",
          headers,
          body: JSON.stringify({ username, password }),
        })
      ).status,
    ).toBe(201);
    const outcome = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("IRC WHOIS was not received")), 6000);
      socket = new WebSocket(
        `ws://127.0.0.1:${httpPort}/irc?tcp=1&ip=198.51.100.44`,
        ["text.ircv3.net"],
        {
          headers: {
            "CF-Connecting-IP": "198.51.100.44",
            "X-Forwarded-For": "198.51.100.44",
            "X-Local-Irc-Bridge": "forged",
            "X-Local-Ingress": "forged",
          },
        },
      );
      socket.once("open", () => {
        socket!.send(`PASS ${username}:${password}`);
        socket!.send("NICK alice");
        socket!.send("USER alice 0 * :Alice");
      });
      socket.on("message", (data) => {
        const line = data.toString();
        if (line.includes(" 001 ")) socket!.send("WHOIS alice");
        if (line.includes(" 311 ")) {
          clearTimeout(timer);
          resolve(line);
        }
      });
      socket.once("error", reject);
    });
    const whois = await outcome;
    expect(whois).toContain("127.0.0.1");
    expect(whois).not.toContain("198.51.100.44");
    const tcpWhois = new Promise<string>((resolve, reject) => {
      let data = "";
      const timer = setTimeout(() => reject(new Error("TCP WHOIS was not received")), 6000);
      tcp = net.connect(tcpPort, "127.0.0.1", () =>
        tcp!.write(
          `PASS ${username}:${password}\r\nNICK aliceTCP\r\nUSER alicetcp 0 * :Alice TCP\r\n`,
        ),
      );
      tcp.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes(" 001 ") && !data.includes(" 311 ")) tcp!.write("WHOIS aliceTCP\r\n");
        const line = data.split("\n").find((item) => item.includes(" 311 "));
        if (line) {
          clearTimeout(timer);
          resolve(line);
        }
      });
      tcp.once("error", reject);
    });
    expect(await tcpWhois).toContain("127.0.0.1");
  } finally {
    socket?.terminate();
    tcp?.destroy();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000).unref();
      });
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
