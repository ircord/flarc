/**
 * Vendor, Bouncer & Client Extensions
 *
 * References:
 * - https://soju.im/specs/bouncer-networks.html
 * - https://wiki.znc.in/Playback
 * - IRCord Message Editing Specification
 * - FlaRC Full-Text Search Specification
 */

export const EXTENSION_CAPABILITIES: Record<string, string | null> = {
  "znc.in/playback": null,
  "znc.in/self-message": null,
  "soju.im/bouncer-networks": null,
  "flarc.chat/search": null,
  "flarc.chat/embed": null,
  "flarc.chat/roleplay": null,
  "ergo.chat/nope": null, // Advertised in CAP LS as canary per Ergo spec, rejected in REQ
};
