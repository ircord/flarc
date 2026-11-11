import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Miniflare } from "miniflare";
import WebSocket from "ws";

export async function ensureNitroBuilt(): Promise<string> {
  const scriptPath = path.resolve(process.cwd(), ".output/server/index.mjs");
  if (!fs.existsSync(scriptPath)) {
    execSync("npm run build", { stdio: "inherit" });
  }
  return scriptPath;
}

export async function createMiniflareServer(options?: {
  bindings?: Record<string, string>;
  r2Buckets?: Record<string, string> | string[];
}): Promise<{
  mf: Miniflare;
  url: URL;
  wsUrl: string;
  dispose: () => Promise<void>;
}> {
  const scriptPath = await ensureNitroBuilt();
  const mf = new Miniflare({
    modules: true,
    scriptPath,
    compatibilityDate: "2025-02-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: options?.bindings,
    r2Buckets: options?.r2Buckets,
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
  });

  const url = await mf.ready;
  const wsUrl = `ws://${url.host}/irc`;

  return {
    mf,
    url,
    wsUrl,
    dispose: async () => {
      await mf.dispose();
    },
  };
}

export class TestIRCClient {
  public ws!: WebSocket;
  public lines: string[] = [];
  private waiters: Array<{
    predicate: (line: string) => boolean;
    resolve: (line: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    private readonly wsUrl: string,
    private readonly subprotocol: "text.ircv3.net" | "binary.ircv3.net" = "text.ircv3.net",
  ) {}

  public async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, [this.subprotocol]);
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
      this.ws.on("message", (data, isBinary) => {
        const text = isBinary
          ? Buffer.from(data as ArrayBuffer).toString("utf-8")
          : data.toString();
        this.lines.push(text);
        for (let i = this.waiters.length - 1; i >= 0; i--) {
          const w = this.waiters[i];
          if (w.predicate(text)) {
            clearTimeout(w.timer);
            this.waiters.splice(i, 1);
            w.resolve(text);
          }
        }
      });
    });
  }

  public send(line: string): void {
    const payload = line.endsWith("\r\n") ? line : `${line}\r\n`;
    if (this.subprotocol === "binary.ircv3.net") {
      this.ws.send(Buffer.from(payload, "utf-8"));
    } else {
      this.ws.send(payload);
    }
  }

  public waitForLine(predicate: (line: string) => boolean, timeoutMs = 4000): Promise<string> {
    for (const existing of this.lines) {
      if (predicate(existing)) {
        return Promise.resolve(existing);
      }
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for IRC line. Received so far:\n${this.lines.join("\n")}`),
        );
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public waitForNewLine(predicate: (line: string) => boolean, timeoutMs = 4000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for new IRC line. Received so far:\n${this.lines.join("\n")}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public async waitForNumeric(numeric: string | number, timeoutMs = 4000): Promise<string> {
    const numStr = String(numeric).padStart(3, "0");
    return this.waitForLine((line) => {
      const parts = line.split(" ");
      return parts.length > 1 && parts[1] === numStr;
    }, timeoutMs);
  }

  public async register(nick: string, user = nick, realname = `${nick} User`): Promise<void> {
    this.send(`NICK ${nick}`);
    this.send(`USER ${user} 0 * :${realname}`);
    await this.waitForLine((l) => l.includes(" 001 ") && l.includes(nick));
    await this.waitForLine((l) => l.includes(" 376 "));
  }

  public close(): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("Client closed before predicate matched"));
    }
    this.waiters = [];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}
