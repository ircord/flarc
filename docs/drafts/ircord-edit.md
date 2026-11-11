# IRCord Message Editing Protocol Specification

**Status:** Draft / Active Implementation  
**Origin:** IRCord / FlaRC Project  
**Client Tag:** `+ircord/edit` (and `+draft/edit`)  
**ISUPPORT Token:** `CLIENTTAGDENY=*,-ircord/edit,...`  

---

## 1. Overview

Traditional IRC messages are immutable. When users make typos or desire corrections, clients historically sent `s/typo/fix/` or duplicate messages, cluttering channels.

The **IRCord Message Editing Protocol** enables clients to edit previously transmitted messages in-place using client message tags (`+ircord/edit`). The server verifies authorship, updates authoritative persistence and full-text search indexes, assigns a new tracking identifier (`msgid`), and broadcasts the edit to all subscribers across IRC, REST, and WebSocket transports.

---

## 2. Capability & Tag Negotiation

### 2.1 Capability Requirements
Clients MUST negotiate the following IRCv3 capabilities to use and receive edits:
- `message-tags`
- `echo-message`
- `account-tag` (recommended for account-backed verification)

### 2.2 ISUPPORT Advertising
Servers supporting this specification announce permission in the `005` ISUPPORT response via `CLIENTTAGDENY`:

```text
CLIENTTAGDENY=*,-ircord/edit,-draft/channel-context,-draft/react,-draft/unreact,-typing,-reply
```

This instructs compliant clients that `+ircord/edit` is permitted through the server's client tag filtering policy.

---

## 3. Client Edit Request

To edit a previously sent message, the client transmits an ordinary `PRIVMSG` targeted to the same channel or user, tagged with `+ircord/edit=<original-msgid>`:

```irc
@+ircord/edit=f2a33f3a-7339-4702-861d-db1e51b689aa PRIVMSG #tech :Deploying Flare Relay Chat on Cloudflare Workers with SQLite DO
```

### 3.1 Validation Rules
Upon receiving an edit request, the server MUST verify:
1. The message referenced by `+ircord/edit` exists in the target channel/conversation.
2. The actor is the original author of the message (matching account, authenticated session, or IRC operator privilege).
3. The message is not redacted/tombstoned.

If validation fails, the server ignores the edit or returns an appropriate numeric error.

---

## 4. Server Broadcast & Processing

Upon successful verification, the server:
1. Updates the authoritative SQLite record for the original message with the new text.
2. Updates `tags_json` storing `{ "edited_at": "<ISO8601>", "+ircord/edit": "<original-msgid>" }`.
3. Updates the full-text search index (`messages_fts`).
4. Generates a fresh `msgid` for the edit event.
5. Broadcasts the message to all channel members with IRCv3 tags:

```irc
@time=2026-11-11T16:48:12.886Z;msgid=49f43054-9e7a-42b7-84eb-4a0fdf245b05;account=Alice;+ircord/edit=f2a33f3a-7339-4702-861d-db1e51b689aa :Alice!alice@gateway.net PRIVMSG #tech :Deploying Flare Relay Chat on Cloudflare Workers with SQLite DO
```

### 4.1 Client Presentation
Compliant clients (such as IRCord) find the original message with id `f2a33f3a-7339-4702-861d-db1e51b689aa` in their local buffer and update its text in-place, adding an `(edited)` indicator. Clients without edit support display the message as an ordinary IRC message.

---

## 5. Multi-Transport Synchronization
- **REST API**: The updated text is immediately returned on `GET /api/v1/channels/{channel}/messages`.
- **Real-Time Events API**: Emits a `message.updated` event over `/api/v1/events` containing `{ messageId, originalMessageId, channel, content, editedAt }`.
