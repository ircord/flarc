import net from "node:net";
import WebSocket from "ws";

const WS_PORT = Number(process.env.PORT ?? 8788);
const TCP_PORT = Number(process.env.TCP_PORT ?? 6667);
const wsUrl = `ws://127.0.0.1:${WS_PORT}/irc?tcp=1`;

const server = net.createServer((socket) => {
  const ws = new WebSocket(wsUrl, ["text.ircv3.net"]);
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
    if (!socket.destroyed) {
      socket.end();
    }
  });

  ws.on("error", () => {
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

server.listen(TCP_PORT, "127.0.0.1", "127.0.0.1", () => {
  console.log(`TCP-to-WebSocket IRC Bridge listening on 127.0.0.1:${TCP_PORT} -> ${wsUrl}`);
});
