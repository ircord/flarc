import { describe, expect, it } from "vitest";
import { extractUrls } from "~/services/embeds/resolver";

describe("Link Preview & oEmbed Metadata Resolver", () => {
  it("extracts clean URLs from text with punctuation and formatting", () => {
    const text =
      "Check out https://github.com/flarc/cfcord and also https://nitro.build/docs for details! (see https://ergo.chat)";
    const urls = extractUrls(text);
    expect(urls).toEqual([
      "https://github.com/flarc/cfcord",
      "https://nitro.build/docs",
      "https://ergo.chat",
    ]);
  });

  it("deduplicates identical URLs within the same message", () => {
    const text = "https://example.com/test and again https://example.com/test";
    const urls = extractUrls(text);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://example.com/test");
  });

  it("returns an empty array when no URLs are present", () => {
    const text = "Just a regular IRC chat message without any links";
    expect(extractUrls(text)).toEqual([]);
  });
});
