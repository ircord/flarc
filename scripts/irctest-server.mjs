// Minimal, ephemeral CFCord server for running the irctest conformance suite.
//
// - Fresh in-memory Durable Object state on every start (no persistence between tests)
// - No bots, no seeded accounts
// - Transparent raw TCP <-> WebSocket bridge (tags and all lines untouched)
//
// Env:
//   TCP_PORT   - TCP port irctest connects to (required)
//   HTTP_PORT  - internal Miniflare HTTP port (default: TCP_PORT + 1)
//   BUNDLE     - optional path to a prebuilt worker bundle (skips esbuild)

import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TCP_PORT = Number(process.env.TCP_PORT);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? TCP_PORT + 1);
const HOST = process.env.HOST ?? "127.0.0.1";

if (!TCP_PORT) {
  console.error("TCP_PORT is required");
  process.exit(2);
}

function getScriptPath() {
  if (process.env.BUNDLE && fs.existsSync(process.env.BUNDLE)) {
    return process.env.BUNDLE;
  }
  const nitroBundle = path.join(root, ".output/server/index.mjs");
  if (!fs.existsSync(nitroBundle)) {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
  return nitroBundle;
}

async function start() {
  const mf = new Miniflare({
    host: HOST,
    port: HTTP_PORT,
    modules: true,
    scriptPath: getScriptPath(),
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      SERVER_NAME: process.env.CFCORD_SERVER_NAME ?? "My.Little.Server",
      NETWORK_NAME: process.env.CFCORD_NETWORK_NAME ?? "ErgoTest",
      ...(process.env.CFCORD_SERVER_PASSWORD
        ? { SERVER_PASSWORD: process.env.CFCORD_SERVER_PASSWORD }
        : {}),
      ...(process.env.CFCORD_REG_BEFORE_CONNECT !== undefined
        ? { CFCORD_REG_BEFORE_CONNECT: process.env.CFCORD_REG_BEFORE_CONNECT }
        : {}),
      ...(process.env.CFCORD_REG_REQUIRES_EMAIL !== undefined
        ? { CFCORD_REG_REQUIRES_EMAIL: process.env.CFCORD_REG_REQUIRES_EMAIL }
        : {}),
      ...(process.env.CFCORD_DEFAULT_USER_MODES !== undefined
        ? { CFCORD_DEFAULT_USER_MODES: process.env.CFCORD_DEFAULT_USER_MODES }
        : {}),
      ...(process.env.CFCORD_ALWAYS_ON_DEFAULT !== undefined
        ? { CFCORD_ALWAYS_ON_DEFAULT: process.env.CFCORD_ALWAYS_ON_DEFAULT }
        : {}),
      ...(process.env.CFCORD_CASEMAPPING
        ? { CFCORD_CASEMAPPING: process.env.CFCORD_CASEMAPPING }
        : {}),
    },
    durableObjectsPersist: process.env.DURABLE_OBJECTS_PERSIST || undefined,
    durableObjects: {
      SESSION: { className: "SessionDO", useSQLite: true },
      CHANNELS: { className: "ChannelDO", useSQLite: true },
      ACCOUNTS: { className: "AccountsDO", useSQLite: true },
    },
  });
  await mf.ready;
  const wsUrl = `ws://127.0.0.1:${HTTP_PORT}/irc`;

  const PROXY_V2_SIG = Buffer.from("\r\n\r\n\x00\r\nQUIT\n", "binary");

  function parseProxyHeader(buf) {
    if (buf.length >= 16 && buf.subarray(0, 12).equals(PROXY_V2_SIG)) {
      const len = buf.readUInt16BE(14);
      if (buf.length < 16 + len) return { needMore: true };
      const fam = buf[13];
      let ip = "127.0.0.1";
      if (fam === 0x11 && len >= 12) {
        ip = `${buf[16]}.${buf[17]}.${buf[18]}.${buf[19]}`;
      } else if (fam === 0x21 && len >= 36) {
        const parts = [];
        for (let i = 0; i < 16; i += 2) {
          parts.push(buf.readUInt16BE(16 + i).toString(16));
        }
        ip = parts.join(":");
      }
      return { ip, remaining: buf.subarray(16 + len) };
    }

    if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "PROXY ") {
      const idx = buf.indexOf(0x0a);
      if (idx === -1) return { needMore: true };
      let line = buf.subarray(0, idx).toString("ascii");
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const parts = line.split(" ");
      let ip = "127.0.0.1";
      if ((parts[1] === "TCP4" || parts[1] === "TCP6") && parts[2]) {
        ip = parts[2];
      }
      return { ip, remaining: buf.subarray(idx + 1) };
    }

    return { ip: null, remaining: buf };
  }

  const tcpServer = net.createServer((socket) => {
    socket.setNoDelay(true);
    let ws = null;
    let buffer = Buffer.alloc(0);
    const pending = [];
    let proxyHandled = false;

    const initWs = (ip) => {
      const targetWsUrl = `${wsUrl}?ip=${encodeURIComponent(ip)}&tcp=1`;
      ws = new WebSocket(targetWsUrl, ["text.ircv3.net"]);
      ws.on("open", () => {
        for (const l of pending.splice(0)) ws.send(l);
      });
      ws.on("message", (data) => {
        const line = data.toString().replace(/[\r\n]+$/, "");
        if (!socket.destroyed) socket.write(`${line}\r\n`);
      });
      ws.on("close", () => {
        if (!socket.destroyed) socket.destroy();
      });
      ws.on("error", () => {
        if (!socket.destroyed) socket.destroy();
      });
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!proxyHandled) {
        const parsed = parseProxyHeader(buffer);
        if (parsed.needMore) {
          return;
        }
        if (parsed.ip) {
          proxyHandled = true;
          buffer = parsed.remaining;
          initWs(parsed.ip);
        } else {
          if (process.env.CFCORD_PROXY_REQUIRED === "1") {
            socket.destroy();
            return;
          }
          proxyHandled = true;
          initWs("127.0.0.1");
        }
      }

      let idx;
      while ((idx = buffer.indexOf(0x0a)) !== -1) {
        let lineBuf = buffer.subarray(0, idx);
        buffer = buffer.subarray(idx + 1);
        if (lineBuf.length && lineBuf[lineBuf.length - 1] === 0x0d) {
          lineBuf = lineBuf.subarray(0, lineBuf.length - 1);
        }
        if (lineBuf.length === 0) continue;
        let isValidUtf8 = true;
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(lineBuf);
        } catch {
          isValidUtf8 = false;
        }
        if (!isValidUtf8) {
          // Send as binary buffer so SessionDO can detect raw invalid UTF-8
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(lineBuf);
          } else {
            pending.push(lineBuf);
          }
          continue;
        }
        const line = lineBuf.toString("utf-8");
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(line);
        } else {
          pending.push(line);
        }
      }
    });

    const closeWs = () => {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
    socket.on("close", closeWs);
    socket.on("error", closeWs);
  });

  tcpServer.listen(TCP_PORT, HOST, () => {
    console.log(`irctest CFCord server ready on ${HOST}:${TCP_PORT}`);
  });

  const shutdown = async () => {
    tcpServer.close();
    try {
      await mf.dispose();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
