import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8788);
const wsUrl = `ws://127.0.0.1:${PORT}/irc`;

function connectEcho() {
  const echoBot = new WebSocket(wsUrl, ["text.ircv3.net"]);

  echoBot.on("open", () => {
    console.log(`Echo bot connected to ${wsUrl}`);
    if (!process.env.ECHO_BOT_PASSWORD)
      throw new Error("ECHO_BOT_PASSWORD is required; provision the bot account first");
    ws.send(`PASS Echo:${process.env.ECHO_BOT_PASSWORD}`);
    echoBot.send("NICK Echo");
    echoBot.send("USER echo 0 * :Echo Bot");
  });

  echoBot.on("message", (data) => {
    const raw = String(data).trim();
    if (raw.includes(" 001 ")) {
      echoBot.send("JOIN #general,#dev");
      console.log("Echo joined #general and #dev");
    } else if (raw.startsWith("PING ")) {
      echoBot.send(raw.replace(/^PING/, "PONG"));
    } else if (raw.includes(" PRIVMSG ")) {
      if (raw.startsWith(":Echo!") || raw.startsWith(":CFBot!")) {
        return;
      }
      const bangIdx = raw.indexOf("!");
      const sender = bangIdx > 1 ? raw.slice(1, bangIdx) : "someone";
      const privIdx = raw.indexOf(" PRIVMSG ");
      const afterPriv = raw.slice(privIdx + " PRIVMSG ".length);
      const colonIdx = afterPriv.indexOf(" :");
      if (colonIdx === -1) return;
      const target = afterPriv.slice(0, colonIdx).trim();
      const text = afterPriv.slice(colonIdx + 2);
      const trimmedText = text.trim();
      if (trimmedText.startsWith("\x01")) {
        const inner = trimmedText.replace(/^\x01|\x01$/g, "").trim();
        const sp = inner.indexOf(" ");
        const ctcpCmd = (sp === -1 ? inner : inner.slice(0, sp)).toUpperCase();
        if (ctcpCmd === "VERSION") {
          echoBot.send(
            `NOTICE ${sender} :\x01VERSION Echo (FlaRC Echo Bot v0.2.0) - FlaRC Edge IRCv3\x01\r\n`,
          );
          return;
        }
        if (ctcpCmd === "TIME") {
          echoBot.send(`NOTICE ${sender} :\x01TIME ${new Date().toUTCString()}\x01\r\n`);
          return;
        }
        if (ctcpCmd === "PING") {
          const arg = sp === -1 ? "" : inner.slice(sp + 1);
          echoBot.send(`NOTICE ${sender} :\x01PING ${arg}\x01\r\n`);
          return;
        }
        return;
      }
      const replyTarget = target.startsWith("#") || target.startsWith("&") ? target : sender;
      echoBot.send(`PRIVMSG ${replyTarget} :${text}`);
    }
  });

  echoBot.on("close", () => {
    setTimeout(connectEcho, 2000);
  });

  echoBot.on("error", () => {});
}

connectEcho();
