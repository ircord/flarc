import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Miniflare } from "miniflare";
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8788);
const TCP_PORT = Number(process.env.TCP_PORT ?? 6667);

function stripTags(rawLine) {
  if (rawLine.startsWith("@")) {
    const sp = rawLine.indexOf(" ");
    return sp !== -1 ? rawLine.slice(sp + 1).trimStart() : rawLine;
  }
  return rawLine;
}

async function start() {
  execSync("bun run build", { stdio: "inherit" });
  const nitroBundle = path.resolve(process.cwd(), ".output/server/index.mjs");

  const mfOptions = {
    host: "127.0.0.1",
    port: PORT,
    modules: true,
    scriptPath: nitroBundle,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) =>
          value !== undefined &&
          /^(?:SERVER_|NETWORK_|WEBIRC_|WEBPUSH_|ADMIN_|SIGNUP_|MIN_PASSWORD_LENGTH|REQUIRE_ACCOUNTS|AUTO_REGISTER_CHANNELS|DEFAULT_USER_MODES|CASEMAPPING|REG_|ALWAYS_ON_DEFAULT|ALLOWED_ORIGINS|EMBED_ALLOWED_HOSTS|OUTGOING_WEBHOOK_ALLOWED_HOSTS|FILEHOST_|F_BOT_|CFCORD_)/.test(
            key,
          ),
      ),
    ),
    r2Buckets: ["MEDIA_BUCKET"],
    durableObjectsPersist: ".wrangler/state/v3/do",
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

  const mf = new Miniflare(mfOptions);

  const _url = await mf.ready;
  console.log(`\n======================================================`);
  console.log(`🚀 FlaRC (Flare Relay Chat) Nitro 3 Server running:`);
  console.log(`   - HTTP & REST API:        http://127.0.0.1:${PORT}`);
  console.log(`   - Interactive Scalar UI:  http://127.0.0.1:${PORT}/docs`);
  console.log(`   - OpenAPI 3.1 Spec:       http://127.0.0.1:${PORT}/openapi.json`);
  console.log(`   - Real-time Events (WS):  ws://127.0.0.1:${PORT}/api/v1/events`);
  console.log(`   - IRCv3 WebSocket:        ws://127.0.0.1:${PORT}/irc`);
  console.log(`   - Standard TCP IRC:       127.0.0.1:${TCP_PORT}`);
  console.log(`   - Watch & Hot-Reload:     ENABLED (server/, server.ts)`);
  console.log(`======================================================\n`);

  // Watch for code changes and automatically rebuild and hot-reload Miniflare
  let rebuildTimer = null;
  let isRebuilding = false;
  const watchPaths = [
    path.resolve(process.cwd(), "server"),
    path.resolve(process.cwd(), "server.ts"),
    path.resolve(process.cwd(), "nitro.config.ts"),
  ];

  for (const watchPath of watchPaths) {
    if (fs.existsSync(watchPath)) {
      fs.watch(watchPath, { recursive: true }, (_eventType, filename) => {
        if (!filename || filename.startsWith(".") || filename.endsWith("~")) return;
        if (rebuildTimer) clearTimeout(rebuildTimer);

        rebuildTimer = setTimeout(async () => {
          if (isRebuilding) return;
          isRebuilding = true;
          const startMs = Date.now();
          console.log(`\n[Nitro Watcher] Change detected in ${filename}. Rebuilding...`);
          try {
            execSync("bun run build", { stdio: "inherit" });
            await mf.setOptions(mfOptions);
            console.log(`[Nitro Watcher] Hot-reloaded in ${Date.now() - startMs}ms! ✅\n`);
          } catch (err) {
            console.error("[Nitro Watcher] Build error:", err?.message ?? err);
          } finally {
            isRebuilding = false;
          }
        }, 200);
      });
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
  if (process.env.CFBOT_PASSWORD) {
    // Connect CFBot
    const bot = new WebSocket(`ws://127.0.0.1:${PORT}/irc`, ["text.ircv3.net"]);
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

  if (process.env.ECHO_BOT_PASSWORD) {
    // Connect Echo bot in #general, #dev, and DMs
    const echoBot = new WebSocket(`ws://127.0.0.1:${PORT}/irc`, ["text.ircv3.net"]);
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
  const tcpServer = net.createServer((socket) => {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP Bridge] Client connected from ${remoteAddr}`);

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/irc?tcp=1`, ["text.ircv3.net"]);
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
    if (err.code === "EADDRINUSE") {
      console.log(`TCP bridge port ${TCP_PORT} already handled by external bridge process.`);
    } else {
      console.error("TCP bridge error:", err);
    }
  });

  tcpServer.listen(TCP_PORT, "127.0.0.1", () => {
    console.log(
      `TCP-to-WebSocket IRC Bridge listening on 127.0.0.1:${TCP_PORT} -> ws://127.0.0.1:${PORT}/irc`,
    );
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
