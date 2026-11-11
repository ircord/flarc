/**
 * IRCv3 Working Group Draft Capabilities
 *
 * References:
 * - https://ircv3.net/specs/extensions/
 */

export const DRAFT_CAPABILITIES: Record<string, string | null> = {
  "draft/account-registration": "before-connect",
  "draft/auto-join": null,
  "draft/callerid": null,
  "draft/channel-rename": null,
  "draft/chathistory": null,
  "draft/client-batch": null,
  "draft/embed": null,
  "draft/event-playback": null,
  "draft/extended-isupport": null,
  "draft/languages": "1,en",
  "draft/message-redaction": null,
  "draft/metadata-2": "max-subs=200",
  "draft/metadata-3": "before-connect,max-subs=200",
  "draft/metadata-3.2": "before-connect,max-subs=200",
  "draft/metadata-notify-2": null,
  "draft/multiline": "max-bytes=4096,max-lines=32",
  "draft/no-implicit-names": null,
  "draft/oper-tag": null,
  "draft/persistence": null,
  "draft/pre-away": null,
  "draft/read-marker": null,
  "draft/relaymsg": "/",
  "draft/reply": null,
  "draft/roleplay": null,
  "draft/search": null,
  "draft/webpush": null,
  "draft/whoami": null,
};
