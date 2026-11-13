import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { Miniflare } from "miniflare";
import WebSocket from "ws";
import { EMPTY_OUTBOUND_ALLOWLIST } from "../shared/outbound-policy.mjs";
import { loadAllowlistConfig } from "./allowlist-config.mjs";
import { createSafeOutbound } from "./safe-outbound.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const TCP_PORT = Number(process.env.TCP_PORT ?? 6667);
const HOST = process.env.HOST ?? "127.0.0.1";
const TCP_HOST = process.env.TCP_HOST ?? "127.0.0.1";
const STATE_DIR = path.resolve(process.env.STATE_DIR ?? ".wrangler/state/v3");
const PRODUCTION = process.env.NODE_ENV === "production";
const SKIP_BUILD = PRODUCTION || process.env.FLARC_SKIP_BUILD === "1";
const NO_WATCH = PRODUCTION || process.env.FLARC_NO_WATCH === "1";
const INTERNAL_HOST =
  HOST === "0.0.0.0"
    ? "127.0.0.1"
    : HOST === "::"
      ? "[::1]"
      : HOST.includes(":")
        ? `[${HOST}]`
        : HOST;

function stripTags(rawLine) {
  if (rawLine.startsWith("@")) {
    const sp = rawLine.indexOf(" ");
    return sp !== -1 ? rawLine.slice(sp + 1).trimStart() : rawLine;
  }
  return rawLine;
}

async function start() {
  const allowlist = loadAllowlistConfig();
  const bridgeSecret = randomBytes(32).toString("hex");
  if (!SKIP_BUILD) execSync("bun run build", { stdio: "inherit" });
  const nitroBundle = path.resolve(process.cwd(), ".output/server/index.mjs");

  const mfOptions = {
    // Only the ingress proxy and the in-process IRC bridge reach workerd.
    host: "127.0.0.1",
    port: 0,
    modules: true,
    scriptPath: nitroBundle,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) =>
            value !== undefined &&
            /^(?:SERVER_|NETWORK_|WEBIRC_|WEBPUSH_|EVENT_JOURNAL_|EVENT_SHARD_COUNT$|SQLITE_MIGRATION_|ADMIN_|AUDIT_|SIGNUP_|MIN_PASSWORD_LENGTH|REQUIRE_ACCOUNTS|AUTO_REGISTER_CHANNELS|DEFAULT_USER_MODES|CASEMAPPING|REG_|ALWAYS_ON_DEFAULT|ALLOWED_ORIGINS|ALLOWLIST_YAML$|PUSH_ALLOWED_HOSTS$|EMBED_ALLOWED_HOSTS|OUTGOING_WEBHOOK_ALLOWED_HOSTS|FILEHOST_|F_BOT_|CFCORD_)/.test(
              key,
            ),
        ),
      ),
      ...allowlist.bindings,
      LOCAL_IRC_BRIDGE_SECRET: bridgeSecret,
    },
    r2Buckets: ["MEDIA_BUCKET"],
    durableObjectsPersist: path.join(STATE_DIR, "do"),
    r2Persist: path.join(STATE_DIR, "r2"),
    durableObjects: {
      SESSION: {
        className: "SessionDO",
        useSQLite: true,
      },
      CHANNELS: {
        className: "ChannelDO",
        useSQLite: true,
      },
      ACCOUNTS: {
        className: "AccountsDO",
        useSQLite: true,
      },
    },
  };

  // Every local outgoing fetch passes the current operator allowlist and pinned DNS policy.
  mfOptions.outboundService = createSafeOutbound({ getEnv: () => mfOptions.bindings });
  const mf = new Miniflare(mfOptions);
  let reconfigure = Promise.resolve();
  const applyRuntimeOptions = () => {
    reconfigure = reconfigure.then(() => mf.setOptions(mfOptions));
    return reconfigure;
  };

  const internalUrl = await mf.ready;
  const ingressSockets = new Set();
  const ingress = http.createServer((request, response) => {
    const headers = ingressHeaders(request);
    const upstream = http.request(
      internalUrl,
      {
        method: request.method,
        path: request.url,
        headers,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  function ingressHeaders(request) {
    const headers = { ...request.headers };
    for (const name of Object.keys(headers)) {
      if (
        name.startsWith("cf-") ||
        name.startsWith("x-forwarded-") ||
        name.startsWith("x-local-") ||
        ["forwarded", "x-gateway-token", "x-real-ip", "true-client-ip"].includes(name)
      )
        delete headers[name];
    }
    headers["cf-connecting-ip"] = request.socket.remoteAddress ?? "unknown";
    headers["x-local-ingress"] = bridgeSecret;
    return headers;
  }
  ingress.on("connection", (socket) => {
    ingressSockets.add(socket);
    socket.once("close", () => ingressSockets.delete(socket));
  });
  ingress.on("upgrade", (request, socket, head) => {
    const upstream = http.request(internalUrl, {
      method: request.method,
      path: request.url,
      headers: ingressHeaders(request),
    });
    upstream.on("upgrade", (response, peer, peerHead) => {
      peer.on("error", () => socket.destroy());
      socket.on("error", () => peer.destroy());
      socket.write(
        `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`,
      );
      for (let i = 0; i < response.rawHeaders.length; i += 2)
        socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
      socket.write("\r\n");
      if (peerHead.length) socket.write(peerHead);
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
    });
    upstream.on("response", (response) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`,
      );
      response.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.end();
  });
  await new Promise((resolve, reject) => {
    ingress.once("error", reject);
    ingress.listen(PORT, HOST, resolve);
  });
  if (allowlist.file) {
    // Poll the file target so an atomic ConfigMap symlink replacement is seen.
    // Serialize refreshes so older content cannot overwrite a newer policy.
    let refresh = Promise.resolve();
    fs.watchFile(allowlist.file, { interval: 1000, persistent: false }, () => {
      refresh = refresh
        .then(async () => {
          try {
            const current = loadAllowlistConfig({ ...process.env, ALLOWLIST_FILE: allowlist.file });
            Object.assign(mfOptions.bindings, current.bindings);
          } catch {
            mfOptions.bindings.ALLOWLIST_YAML = EMPTY_OUTBOUND_ALLOWLIST;
            console.error(
              "[Allowlist] Invalid or unavailable configuration; outbound access disabled.",
            );
          }
          await applyRuntimeOptions();
        })
        .catch(() => {
          console.error("[Allowlist] Runtime could not apply the policy; shutting down.");
          process.exit(1);
        });
    });
  }
  console.log(`\n======================================================`);
  console.log(`🚀 FlaRC (Flare Relay Chat) Nitro 3 Server running:`);
  console.log(`   - HTTP & REST API:        http://${HOST}:${PORT}`);
  console.log(`   - Interactive Scalar UI:  http://${HOST}:${PORT}/docs`);
  console.log(`   - OpenAPI 3.1 Spec:       http://${HOST}:${PORT}/openapi.json`);
  console.log(`   - Real-time Events (WS):  ws://${HOST}:${PORT}/api/v1/events`);
  console.log(`   - IRCv3 WebSocket:        ws://${HOST}:${PORT}/irc`);
  console.log(`   - Standard TCP IRC:       ${TCP_HOST}:${TCP_PORT}`);
  console.log(
    `   - Watch & Hot-Reload:     ${NO_WATCH ? "DISABLED" : "ENABLED (server/, server.ts)"}`,
  );
  console.log(`======================================================\n`);

  // Watch for code changes and automatically rebuild and hot-reload Miniflare
  let rebuildTimer = null;
  let isRebuilding = false;
  const watchPaths = [
    path.resolve(process.cwd(), "server"),
    path.resolve(process.cwd(), "server.ts"),
    path.resolve(process.cwd(), "nitro.config.ts"),
  ];

  const codeWatchers = [];
  if (!NO_WATCH)
    for (const watchPath of watchPaths) {
      if (fs.existsSync(watchPath)) {
        const watcher = fs.watch(watchPath, { recursive: true }, (_eventType, filename) => {
          if (!filename || filename.startsWith(".") || filename.endsWith("~")) return;
          if (rebuildTimer) clearTimeout(rebuildTimer);

          rebuildTimer = setTimeout(async () => {
            if (isRebuilding) return;
            isRebuilding = true;
            const startMs = Date.now();
            console.log(`\n[Nitro Watcher] Change detected in ${filename}. Rebuilding...`);
            try {
              execSync("bun run build", { stdio: "inherit" });
              await applyRuntimeOptions();
              console.log(`[Nitro Watcher] Hot-reloaded in ${Date.now() - startMs}ms! ✅\n`);
            } catch (err) {
              console.error("[Nitro Watcher] Build error:", err?.message ?? err);
            } finally {
              isRebuilding = false;
            }
          }, 200);
        });
        codeWatchers.push(watcher);
      }
    }

  function handleBotCtcp(ws, botName, botDesc, rawLine) {
    const raw = String(rawLine).trim();
    const line = stripTags(raw);
    if (!line.includes(" PRIVMSG ")) return false;
    const bangIdx = line.indexOf("!");
    const sender = bangIdx > 1 ? line.slice(1, bangIdx) : null;
    if (!sender || sender === "CFBot" || sender === "Echo") return false;

    const privIdx = line.indexOf(" PRIVMSG ");
    const afterPriv = line.slice(privIdx + " PRIVMSG ".length);
    let target = "";
    let text = "";
    const colonIdx = afterPriv.indexOf(" :");
    if (colonIdx !== -1) {
      target = afterPriv.slice(0, colonIdx).trim();
      text = afterPriv.slice(colonIdx + 2);
    } else {
      const spIdx = afterPriv.indexOf(" ");
      if (spIdx === -1) return false;
      target = afterPriv.slice(0, spIdx).trim();
      text = afterPriv.slice(spIdx + 1);
    }

    const trimmedText = text.trim();
    if (!trimmedText.startsWith("\x01")) return false;
    const inner = trimmedText.replace(/^\x01|\x01$/g, "").trim();
    const sp = inner.indexOf(" ");
    const ctcpCmd = (sp === -1 ? inner : inner.slice(0, sp)).toUpperCase();
    const ctcpArg = sp === -1 ? "" : inner.slice(sp + 1);

    // Only reply to direct CTCP or channel CTCP
    if (
      target.toLowerCase() !== botName.toLowerCase() &&
      !target.startsWith("#") &&
      !target.startsWith("&")
    ) {
      return false;
    }

    if (ctcpCmd === "VERSION") {
      ws.send(
        `NOTICE ${sender} :\x01VERSION ${botName} (${botDesc}) - FlaRC Edge IRCv3 on Cloudflare Workers\x01\r\n`,
      );
      return true;
    }
    if (ctcpCmd === "TIME") {
      ws.send(`NOTICE ${sender} :\x01TIME ${new Date().toUTCString()}\x01\r\n`);
      return true;
    }
    if (ctcpCmd === "PING") {
      ws.send(`NOTICE ${sender} :\x01PING ${ctcpArg}\x01\r\n`);
      return true;
    }
    if (ctcpCmd === "SOURCE") {
      ws.send(`NOTICE ${sender} :\x01SOURCE https://ircv3.net/\x01\r\n`);
      return true;
    }
    if (ctcpCmd === "CLIENTINFO") {
      ws.send(
        `NOTICE ${sender} :\x01CLIENTINFO ACTION CLIENTINFO PING SOURCE TIME VERSION\x01\r\n`,
      );
      return true;
    }
    return ctcpCmd !== "ACTION";
  }

  // Bots are opt-in and authenticate as explicitly provisioned ordinary accounts.
  if (!PRODUCTION && process.env.CFBOT_PASSWORD) {
    // Connect CFBot
    const bot = new WebSocket(`ws://${INTERNAL_HOST}:${PORT}/irc`, ["text.ircv3.net"]);
    bot.on("open", () => {
      bot.send(`PASS CFBot:${process.env.CFBOT_PASSWORD}`);
      bot.send("NICK CFBot");
      bot.send("USER cfbot 0 * :Cloudflare Edge Bot");
    });
    bot.on("message", (data) => {
      const raw = data.toString();
      if (handleBotCtcp(bot, "CFBot", "Cloudflare Edge Bot v0.2.0", raw)) {
        return;
      }
      const line = stripTags(raw);
      if (line.includes(" 001 ")) {
        bot.send("MODE CFBot +B");
        bot.send("JOIN #general,#dev");
        setTimeout(() => {
          bot.send(
            "TOPIC #general :Welcome to FlaRC (Flare Relay Chat) running locally on Cloudflare Miniflare!",
          );
        }, 250);
      } else if (line.startsWith("PING ")) {
        bot.send(line.replace(/^PING/, "PONG"));
      } else if (
        line.includes("PRIVMSG #general :") &&
        !line.startsWith(":CFBot!") &&
        !line.startsWith(":Echo!")
      ) {
        const sender = line.slice(1, line.indexOf("!"));
        const text = line.split("PRIVMSG #general :")[1] ?? "";
        bot.send(
          `PRIVMSG #general :Hey ${sender}! Received your message on Cloudflare DO: "${text}"`,
        );
      }
    });
  }

  if (!PRODUCTION && process.env.ECHO_BOT_PASSWORD) {
    // Connect Echo bot in #general, #dev, and DMs
    const echoBot = new WebSocket(`ws://${INTERNAL_HOST}:${PORT}/irc`, ["text.ircv3.net"]);
    echoBot.on("open", () => {
      echoBot.send(`PASS Echo:${process.env.ECHO_BOT_PASSWORD}`);
      echoBot.send("NICK Echo");
      echoBot.send("USER echo 0 * :Echo Bot");
    });
    echoBot.on("message", (data) => {
      const raw = data.toString();
      if (handleBotCtcp(echoBot, "Echo", "FlaRC Echo Bot v0.2.0", raw)) {
        return;
      }
      const line = stripTags(raw);
      if (line.includes(" 001 ")) {
        echoBot.send("MODE Echo +B");
        echoBot.send("JOIN #general,#dev");
      } else if (line.startsWith("PING ")) {
        echoBot.send(line.replace(/^PING/, "PONG"));
      } else if (line.includes(" PRIVMSG ")) {
        if (line.startsWith(":Echo!") || line.startsWith(":CFBot!")) {
          return;
        }
        const bangIdx = line.indexOf("!");
        const sender = bangIdx > 1 ? line.slice(1, bangIdx) : "someone";
        const privIdx = line.indexOf(" PRIVMSG ");
        const afterPriv = line.slice(privIdx + " PRIVMSG ".length);
        const colonIdx = afterPriv.indexOf(" :");
        if (colonIdx === -1) return;
        const target = afterPriv.slice(0, colonIdx).trim();
        const text = afterPriv.slice(colonIdx + 2);
        const replyTarget = target.startsWith("#") || target.startsWith("&") ? target : sender;
        echoBot.send(`PRIVMSG ${replyTarget} :${text}`);
      }
    });
  }

  // Start local TCP-to-WebSocket IRC Bridge so traditional TCP IRC clients (like IRCord) can connect
  const tcpSockets = new Set();
  const tcpServer = net.createServer((socket) => {
    tcpSockets.add(socket);
    socket.once("close", () => tcpSockets.delete(socket));
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP Bridge] Client connected from ${remoteAddr}`);

    const bridgeUrl = new URL("/irc", internalUrl);
    bridgeUrl.protocol = "ws:";
    bridgeUrl.searchParams.set("tcp", "1");
    bridgeUrl.searchParams.set("ip", socket.remoteAddress ?? "unknown");
    const ws = new WebSocket(bridgeUrl, ["text.ircv3.net"], {
      headers: { "x-local-irc-bridge": bridgeSecret, "x-local-ingress": bridgeSecret },
    });
    let buffer = "";
    const pendingLines = [];
    let wsOpen = false;

    ws.on("open", () => {
      wsOpen = true;
      for (const line of pendingLines.splice(0, pendingLines.length)) {
        ws.send(line);
      }
    });

    ws.on("message", (data) => {
      const line = data.toString().replace(/[\r\n]+$/, "");
      if (!socket.destroyed) {
        socket.write(`${line}\r\n`);
      }
    });

    ws.on("close", () => {
      console.log(`[TCP Bridge] Client disconnected from ${remoteAddr}`);
      if (!socket.destroyed) {
        socket.end();
      }
    });

    ws.on("error", (err) => {
      console.log(`[TCP Bridge] Socket error from ${remoteAddr}:`, err?.message ?? err);
      if (!socket.destroyed) {
        socket.destroy();
      }
    });

    socket.on("data", (chunk) => {
      if (buffer.length + chunk.length > 65536 || pendingLines.length > 128) {
        socket.destroy();
        return;
      }
      buffer += chunk.toString("utf-8");
      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;
        if (wsOpen && ws.readyState === WebSocket.OPEN) {
          ws.send(line);
        } else {
          pendingLines.push(line);
        }
      }
    });

    socket.on("close", () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    });

    socket.on("error", () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    });
  });

  tcpServer.on("error", (err) => {
    if (PRODUCTION) {
      console.error("TCP bridge failed:", err);
      process.exitCode = 1;
      void shutdown().catch((error) => console.error("Shutdown failed:", error));
      return;
    }
    if (err.code === "EADDRINUSE") {
      console.log(`TCP bridge port ${TCP_PORT} already handled by external bridge process.`);
    } else {
      console.error("TCP bridge error:", err);
    }
  });

  tcpServer.listen(TCP_PORT, TCP_HOST, () => {
    console.log(
      `TCP-to-WebSocket IRC Bridge listening on ${TCP_HOST}:${TCP_PORT} -> ws://${INTERNAL_HOST}:${PORT}/irc`,
    );
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    for (const watcher of codeWatchers) watcher.close();
    if (allowlist.file) fs.unwatchFile(allowlist.file);
    for (const socket of tcpSockets) socket.destroy();
    for (const socket of ingressSockets) socket.destroy();
    await new Promise((resolve) => ingress.close(() => resolve()));
    await new Promise((resolve) => tcpServer.close(() => resolve()));
    await reconfigure.catch(() => {});
    await mf.dispose();
  };
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      shutdown().catch((error) => {
        console.error("Shutdown failed:", error);
        process.exitCode = 1;
      });
    });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
