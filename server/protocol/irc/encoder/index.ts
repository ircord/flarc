import { SERVER_CONFIG } from "../../../core/config";
import type { Subprotocol } from "../../../core/types";

export function escapeTagValue(val: string): string {
  let out = "";
  for (let i = 0; i < val.length; i++) {
    const ch = val[i];
    switch (ch) {
      case "\x00":
        break;
      case ";":
        out += "\\:";
        break;
      case " ":
        out += "\\s";
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\n":
        out += "\\n";
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

export function encodeIRCMessage(msg: {
  tags?: Record<string, string | true>;
  prefix?: string | null;
  command: string;
  params?: string[];
  forceTrailing?: boolean;
}): string {
  const parts: string[] = [];

  if (msg.tags && Object.keys(msg.tags).length > 0) {
    const tagPairs: string[] = [];
    for (const [k, v] of Object.entries(msg.tags)) {
      if (v === true || v === "") {
        tagPairs.push(k);
      } else {
        tagPairs.push(`${k}=${escapeTagValue(v)}`);
      }
    }
    if (tagPairs.length > 0) {
      parts.push(`@${tagPairs.join(";")}`);
    }
  }

  if (msg.prefix) {
    parts.push(`:${msg.prefix}`);
  }

  const upperCmd = msg.command.toUpperCase();
  parts.push(upperCmd);

  const alwaysTrailingCommands = new Set([
    "CAP",
    "PRIVMSG",
    "NOTICE",
    "TOPIC",
    "KICK",
    "PART",
    "QUIT",
    "AWAY",
    "SETNAME",
    "REDACT",
    "RENAME",
    "ERROR",
  ]);

  const params = msg.params ?? [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i].replace(/[\x00\r\n]/g, " ");
    const isLast = i === params.length - 1;
    const shouldForceTrailing =
      msg.forceTrailing ||
      (alwaysTrailingCommands.has(upperCmd) &&
        ((upperCmd === "PART" && params.length >= 2) ||
          (upperCmd === "REDACT" && params.length >= 3) ||
          (upperCmd === "RENAME" && params.length >= 3) ||
          (upperCmd !== "PART" &&
            upperCmd !== "REDACT" &&
            upperCmd !== "RENAME" &&
            params.length >= 1)));

    if (isLast && (shouldForceTrailing || p.length === 0 || p.includes(" ") || p.startsWith(":"))) {
      parts.push(`:${p}`);
    } else {
      parts.push(p);
    }
  }

  // IRCv3 WebSocket transport spec: one IRC message per WebSocket frame, NO trailing CRLF!
  return parts.join(" ");
}

export function encodeNumeric(
  numeric: string,
  target: string,
  params: string[],
  tags?: Record<string, string | true>,
): string {
  return encodeIRCMessage({
    tags,
    prefix: SERVER_CONFIG.serverName,
    command: numeric,
    params: [target || "*", ...params],
  });
}

export function encodeWebSocketFrame(line: string, subprotocol: Subprotocol): string | Uint8Array {
  if (subprotocol === "binary.ircv3.net") {
    return new TextEncoder().encode(line);
  }
  return line;
}
