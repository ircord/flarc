import { SERVER_CONFIG } from "../../../core/config";
import { IRCProtocolError } from "../../../core/errors";
import { Numerics } from "../numerics";
import type { IRCMessage, ParsedPrefix } from "../types";

export function unescapeTagValue(raw: string): string {
  let result = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\") {
      if (i + 1 < raw.length) {
        const next = raw[i + 1];
        switch (next) {
          case ":":
            result += ";";
            break;
          case "s":
            result += " ";
            break;
          case "\\":
            result += "\\";
            break;
          case "r":
            result += "\r";
            break;
          case "n":
            result += "\n";
            break;
          default:
            result += next;
            break;
        }
        i++;
      }
      // Trailing lone backslash is dropped per IRCv3 message-tags spec
    } else {
      result += ch;
    }
  }
  return result;
}

export function decodeWebSocketFrame(data: string | ArrayBuffer | Uint8Array): string[] {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(data);
  } else {
    text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(data);
  }

  // Strip trailing CR/LF and split if a client sent multiple lines in one frame
  const normalized = text.replace(/\r?\n$/, "");
  if (!normalized) {
    return [];
  }
  return normalized.split(/\r?\n/).filter((line) => line.length > 0);
}

export function parseIRCMessage(rawLine: string): IRCMessage {
  // Normalize any trailing CR or LF
  const line = rawLine.replace(/[\r\n]+$/, "");
  if (line.length === 0) {
    throw new IRCProtocolError("Empty IRC message");
  }

  let idx = 0;
  const len = line.length;
  const tags: Record<string, string | true> = {};

  // 1. Parse optional IRCv3 tags: @key=val;key2 ...
  if (line[idx] === "@") {
    const spaceIdx = line.indexOf(" ", idx);
    if (spaceIdx === -1) {
      throw new IRCProtocolError("Malformed IRC message: tags without command");
    }
    // These protocol limits count UTF-8 octets, not UTF-16 code units.
    const utf8 = new TextEncoder();
    if (utf8.encode(line.slice(0, spaceIdx + 1)).byteLength > 4096) {
      throw new IRCProtocolError("Input line was too long", Numerics.ERR_INPUTTOOLONG);
    }
    const remainder = line.slice(spaceIdx + 1);
    if (utf8.encode(remainder).byteLength > 510) {
      throw new IRCProtocolError("Input line was too long", Numerics.ERR_INPUTTOOLONG);
    }
    const tagStr = line.slice(idx + 1, spaceIdx);
    if (tagStr.length > 0) {
      const parts = tagStr.split(";");
      for (const part of parts) {
        if (!part) continue;
        const eqIdx = part.indexOf("=");
        if (eqIdx === -1) {
          tags[part] = true;
        } else {
          const key = part.slice(0, eqIdx);
          const rawVal = part.slice(eqIdx + 1);
          if (key) {
            tags[key] = rawVal === "" ? "" : unescapeTagValue(rawVal);
          }
        }
      }
    }
    idx = spaceIdx + 1;
    while (idx < len && line[idx] === " ") idx++;
  } else {
    // Standard IRC messages allow 510 UTF-8 bytes, plus the two CRLF octets.
    if (new TextEncoder().encode(line).byteLength > 510) {
      throw new IRCProtocolError("Input line was too long", Numerics.ERR_INPUTTOOLONG);
    }
  }

  // 2. Parse optional prefix: :nick!user@host ...
  let prefix: string | null = null;
  if (idx < len && line[idx] === ":") {
    const spaceIdx = line.indexOf(" ", idx);
    if (spaceIdx === -1) {
      throw new IRCProtocolError("Malformed IRC message: prefix without command");
    }
    prefix = line.slice(idx + 1, spaceIdx);
    idx = spaceIdx + 1;
    while (idx < len && line[idx] === " ") idx++;
  }

  if (idx >= len) {
    throw new IRCProtocolError("Malformed IRC message: missing command");
  }

  // 3. Parse command
  let nextSpace = line.indexOf(" ", idx);
  let command: string;
  if (nextSpace === -1) {
    command = line.slice(idx).toUpperCase();
    idx = len;
  } else {
    command = line.slice(idx, nextSpace).toUpperCase();
    idx = nextSpace + 1;
    while (idx < len && line[idx] === " ") idx++;
  }

  // 4. Parse params
  const params: string[] = [];
  while (idx < len) {
    if (line[idx] === ":") {
      params.push(line.slice(idx + 1));
      break;
    }
    nextSpace = line.indexOf(" ", idx);
    if (nextSpace === -1) {
      params.push(line.slice(idx));
      break;
    } else {
      params.push(line.slice(idx, nextSpace));
      idx = nextSpace + 1;
      while (idx < len && line[idx] === " ") idx++;
    }
  }

  return {
    tags,
    prefix,
    command,
    params,
  };
}

export function parsePrefix(prefix: string): ParsedPrefix {
  const bangIdx = prefix.indexOf("!");
  const atIdx = prefix.indexOf("@");
  if (bangIdx !== -1 && atIdx !== -1 && bangIdx < atIdx) {
    return {
      nick: prefix.slice(0, bangIdx),
      user: prefix.slice(bangIdx + 1, atIdx),
      host: prefix.slice(atIdx + 1),
    };
  }
  if (atIdx !== -1) {
    return {
      nick: prefix.slice(0, atIdx),
      host: prefix.slice(atIdx + 1),
    };
  }
  return { nick: prefix };
}

const CONFUSABLE_MAP: Record<string, string> = {
  "\u0430": "a",
  "\u0410": "a", // Cyrillic a
  "\u0435": "e",
  "\u0415": "e", // Cyrillic e
  "\u043e": "o",
  "\u041e": "o", // Cyrillic o
  "\u0440": "p",
  "\u0420": "p", // Cyrillic er (p)
  "\u0441": "c",
  "\u0421": "c", // Cyrillic es (c)
  "\u0443": "y",
  "\u0423": "y", // Cyrillic u (y)
  "\u0445": "x",
  "\u0425": "x", // Cyrillic ha (x)
  "\u0456": "i",
  "\u0406": "i", // Cyrillic i
  "\u0458": "j",
  "\u0408": "j", // Cyrillic je
  "\u03bf": "o",
  "\u039f": "o", // Greek omicron
  "\u04bb": "h", // Cyrillic shha
};

/**
 * Case-mapping: RFC 1459 default, or PRECIS with UTS-39 confusables.
 */
export function canonicalizeIRCName(input: string): string {
  if (SERVER_CONFIG.caseMapping === "ascii") {
    let out = "";
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code >= 65 && code <= 90) {
        out += String.fromCharCode(code + 32);
      } else {
        out += input[i];
      }
    }
    return out;
  }

  if (SERVER_CONFIG.caseMapping === "precis") {
    let mapped = "";
    for (const char of input.normalize("NFC")) {
      mapped += CONFUSABLE_MAP[char] ?? char;
    }
    return mapped.toLowerCase();
  }

  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      // A-Z -> a-z
      out += String.fromCharCode(code + 32);
    } else if (code === 91) {
      // [ -> {
      out += "{";
    } else if (code === 92) {
      // \ -> |
      out += "|";
    } else if (code === 93) {
      // ] -> }
      out += "}";
    } else if (code === 94) {
      // ^ -> ~
      out += "~";
    } else {
      out += input[i];
    }
  }
  return out;
}
