import { describe, expect, it } from "vitest";
import {
  formatEmbedToPlainText,
  formatIsupportTokens,
  formatRoleplayNotice,
  isRoleplayCommand,
  normalizeTagFilter,
  parseAcceptCommand,
  parseIsupportToken,
  parseLanguageCommand,
  parseMonitorCommand,
  parseRoleplayCommand,
  parseSearchCommand,
  parseSearchFilterString,
  SUPPORTED_LANGUAGES,
} from "../../server/protocol/irc/extensions";

describe("Modular IRC Extensions & Structured Search", () => {
  describe("Structured Search Token Parser", () => {
    it("parses complex Discord/IRCord search queries with tags, chips, and text", () => {
      const query =
        'deploying workers in:general from:alice mentions:bob has:image has:link before:2026-12-31 tag:reply tag:react=❤️ +file pinned:true limit:25';
      const parsed = parseSearchFilterString(query);

      expect(parsed.query).toBe("deploying workers");
      expect(parsed.in).toEqual(["#general"]);
      expect(parsed.from).toEqual(["alice"]);
      expect(parsed.mentions).toEqual(["bob"]);
      expect(parsed.has).toContain("image");
      expect(parsed.has).toContain("link");
      expect(parsed.before).toBe("2026-12-31");
      expect(parsed.pinned).toBe(true);
      expect(parsed.limit).toBe(25);

      // Verify normalized tags
      expect(parsed.tags).toContainEqual({ key: "+draft/reply", value: undefined });
      expect(parsed.tags).toContainEqual({ key: "+draft/react", value: "❤️" });
      expect(parsed.tags).toContainEqual({ key: "+file", value: undefined });
      expect(parsed.tags).toContainEqual({ key: "+pinned", value: "true" });
    });

    it("parses IRC SEARCH command params", () => {
      const res = parseSearchCommand(["#dev", "auth", "from:dave", "+draft/reply"]);
      expect(res.ok).toBe(true);
      expect(res.data?.target).toBe("#dev");
      expect(res.data?.query).toBe("auth");
      expect(res.data?.from).toEqual(["dave"]);
      expect(res.data?.tags).toContainEqual({ key: "+draft/reply", value: undefined });
    });

    it("normalizes tag aliases accurately", () => {
      expect(normalizeTagFilter({ key: "reply" })).toEqual({
        key: "+draft/reply",
        value: undefined,
      });
      expect(normalizeTagFilter({ key: "edit" })).toEqual({
        key: "+draft/edit",
        value: undefined,
      });
      expect(normalizeTagFilter({ key: "react", value: "👍" })).toEqual({
        key: "+draft/react",
        value: "👍",
      });
      expect(normalizeTagFilter({ key: "embed" })).toEqual({
        key: "+draft/embed",
        value: undefined,
      });
      expect(normalizeTagFilter({ key: "pinned" })).toEqual({
        key: "+pinned",
        value: undefined,
      });
      expect(normalizeTagFilter({ key: "custom_key", value: "custom_val" })).toEqual({
        key: "custom_key",
        value: "custom_val",
      });
    });
  });

  describe("Roleplay Extension (draft/roleplay)", () => {
    it("recognizes and parses NPC, NPCA, SCENE, and AMBIANCE commands", () => {
      expect(isRoleplayCommand("NPC")).toBe(true);
      expect(isRoleplayCommand("npca")).toBe(true);
      expect(isRoleplayCommand("SCENE")).toBe(true);
      expect(isRoleplayCommand("ambiance")).toBe(true);
      expect(isRoleplayCommand("PRIVMSG")).toBe(false);

      const npc = parseRoleplayCommand("NPC", ["#tavern", "Innkeeper", "Welcome traveller!"]);
      expect(npc.ok).toBe(true);
      expect(npc.data?.characterName).toBe("Innkeeper");
      expect(npc.data?.text).toBe("Welcome traveller!");

      const notice = formatRoleplayNotice(npc.data!);
      expect(notice.text).toBe("<Innkeeper> Welcome traveller!");
      expect(notice.tags["+draft/roleplay"]).toBe("npc");

      const scene = parseRoleplayCommand("SCENE", ["#tavern", "Thunder roars in the distance"]);
      expect(scene.ok).toBe(true);
      expect(scene.data?.text).toBe("Thunder roars in the distance");
      const sceneNotice = formatRoleplayNotice(scene.data!);
      expect(sceneNotice.text).toBe("--- [Scene] Thunder roars in the distance ---");
    });
  });

  describe("Languages Extension (draft/languages)", () => {
    it("parses LANGUAGE command and checks supported languages", () => {
      expect(SUPPORTED_LANGUAGES.some((l) => l.code === "en")).toBe(true);
      expect(SUPPORTED_LANGUAGES.some((l) => l.code === "pl")).toBe(true);

      const listReq = parseLanguageCommand([]);
      expect(listReq.action).toBe("list");

      const setReq = parseLanguageCommand(["en,pl,es"]);
      expect(setReq.action).toBe("set");
      expect(setReq.languages).toEqual(["en", "pl", "es"]);
    });
  });

  describe("CALLERID / ACCEPT Extension", () => {
    it("parses ACCEPT list, add, and remove operations", () => {
      const list = parseAcceptCommand(["*"]);
      expect(list.action).toBe("list");

      const add = parseAcceptCommand(["alice,bob"]);
      expect(add.action).toBe("add");
      expect(add.nicks).toEqual(["alice", "bob"]);

      const remove = parseAcceptCommand(["-charlie"]);
      expect(remove.action).toBe("remove");
      expect(remove.nicks).toEqual(["charlie"]);
    });
  });

  describe("MONITOR Extension", () => {
    it("parses MONITOR +, -, C, L, S commands", () => {
      const add = parseMonitorCommand(["+", "alice,bob"]);
      expect(add.ok).toBe(true);
      expect(add.data?.action).toBe("+");
      expect(add.data?.targets).toEqual(["alice", "bob"]);

      const clear = parseMonitorCommand(["C"]);
      expect(clear.ok).toBe(true);
      expect(clear.data?.action).toBe("C");
    });
  });

  describe("ISUPPORT Extension", () => {
    it("parses and formats ISUPPORT token rows", () => {
      const token = parseIsupportToken("NETWORK=FlaRC");
      expect(token.name).toBe("NETWORK");
      expect(token.value).toBe("FlaRC");

      const chunks = formatIsupportTokens({
        NETWORK: "FlaRC",
        CASEMAPPING: "rfc1459",
        CHANMODES: "Ibe,k,fl,imnpstz",
        PREFIX: "(ov)@+",
        MAXTARGETS: "4",
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]).toContain("NETWORK=FlaRC");
    });
  });

  describe("Embeds Extension", () => {
    it("formats rich embed into readable IRC text representation", () => {
      const text = formatEmbedToPlainText({
        author: { name: "GitHub" },
        title: "Pull Request #42",
        url: "https://github.com/flarc/cfcord/pull/42",
        description: "Add modular drafts and search tag filtering",
        fields: [{ name: "Status", value: "Ready for review" }],
        footer: { text: "FlaRC Bot" },
      });

      expect(text).toContain("GitHub");
      expect(text).toContain("**[Pull Request #42](https://github.com/flarc/cfcord/pull/42)**");
      expect(text).toContain("Add modular drafts");
      expect(text).toContain("• Status: Ready for review");
      expect(text).toContain("— FlaRC Bot");
    });
  });
});
