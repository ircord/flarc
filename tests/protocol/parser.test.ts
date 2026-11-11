import { describe, expect, it } from "vitest";
import { encodeIRCMessage, escapeTagValue } from "../../server/protocol/irc/encoder";
import {
  canonicalizeIRCName,
  decodeWebSocketFrame,
  parseIRCMessage,
  parsePrefix,
  unescapeTagValue,
} from "../../server/protocol/irc/parser";

describe("IRC Protocol Parser & Encoder", () => {
  it("parses standard IRC messages with prefix and trailing parameter", () => {
    const msg = parseIRCMessage(":alice!alice@irc.client PRIVMSG #general :Hello world!");
    expect(msg.prefix).toBe("alice!alice@irc.client");
    expect(msg.command).toBe("PRIVMSG");
    expect(msg.params).toEqual(["#general", "Hello world!"]);
    expect(msg.tags).toEqual({});
  });

  it("parses and encodes IRCv3 message tags with escaping", () => {
    const raw =
      "@msgid=1234;time=2026-11-10T21:00:00.000Z;+custom=hello\\sworld\\:test\\\\slash;flag :nick!user@host NOTICE #dev :Testing tags";
    const parsed = parseIRCMessage(raw);
    expect(parsed.tags).toEqual({
      msgid: "1234",
      time: "2026-11-10T21:00:00.000Z",
      "+custom": "hello world;test\\slash",
      flag: true,
    });
    expect(parsed.command).toBe("NOTICE");
    expect(parsed.params).toEqual(["#dev", "Testing tags"]);

    const reencoded = encodeIRCMessage(parsed);
    expect(reencoded).toBe(raw);
    expect(reencoded.endsWith("\r\n")).toBe(false);
  });

  it("canonicalizes IRC names according to RFC 1459 case mapping", () => {
    expect(canonicalizeIRCName("Alice[Away]\\^~")).toBe("alice{away}|~~");
    expect(canonicalizeIRCName("#General-{Chat}")).toBe("#general-{chat}");
  });

  it("normalizes WebSocket text and binary frames without trailing CRLF", () => {
    const lines = decodeWebSocketFrame("NICK alice\r\n");
    expect(lines).toEqual(["NICK alice"]);

    const binary = new TextEncoder().encode("PING :12345\n");
    expect(decodeWebSocketFrame(binary)).toEqual(["PING :12345"]);
  });

  it("escapes and unescapes reserved tag values properly", () => {
    const rawVal = "semi;colon space and \\ backslash \r\n newline";
    const escaped = escapeTagValue(rawVal);
    expect(escaped).toBe("semi\\:colon\\sspace\\sand\\s\\\\\\sbackslash\\s\\r\\n\\snewline");
    expect(unescapeTagValue(escaped)).toBe(rawVal);
  });

  it("parses userhost masks into nick, user, host prefix components", () => {
    const prefix = parsePrefix("bob!robert@staff.example.org");
    expect(prefix?.nick).toBe("bob");
    expect(prefix?.user).toBe("robert");
    expect(prefix?.host).toBe("staff.example.org");
  });
});
