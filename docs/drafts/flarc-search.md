# IRC Full-Text Search Protocol Specification (draft/search)

**Status:** Draft / Active Implementation  
**Origin:** FlaRC (Flare Relay Chat)  
**Capability:** `draft/search`, `flarc.chat/search`  
**Commands:** `SEARCH`  
**Numerics:** `740` (RPL_SEARCHSTART), `741` (RPL_SEARCHRESULT), `742` (RPL_SEARCHEND), `743` (ERR_SEARCHFAILED)  

---

## 1. Overview

While IRCv3 `chathistory` enables scrolling through chronological window buffers, searching for past discussions by keyword or metadata filters historically required external bouncers, logging bots, or web scrapers.

The **IRC Full-Text Search Protocol (`draft/search`)** allows clients to perform fast, structured full-text message search directly against the server's authoritative SQLite FTS5 index with Discord- and IRCord-style filter chips.

---

## 2. Capability Negotiation

Clients announce search capability during registration:

```irc
CAP REQ :draft/search
```

Or query server capability in `CAP LS 302`:
```irc
CAP * LS :... draft/search flarc.chat/search ...
```

---

## 3. Command Syntax & Filter Tokens

```irc
SEARCH <target> <query> [filters...]
```

### 3.1 Target
- `<target>`: Target channel (e.g. `#tech`) or `*` for searching across accessible channels.

### 3.2 Filter Tokens
Clients and users can embed filter tokens anywhere in the query string, matching Discord and IRCord semantics:

| Filter Token | Description | Examples |
| :--- | :--- | :--- |
| `from:<nick\|account>` | Match sender nickname or registered account name | `from:alice`, `from:"Bob Smith"` |
| `mentions:<nick>` | Messages mentioning a specific nickname (`@nick` or `nick:`) | `mentions:carol` |
| `in:<channel>` | Filter messages to a specific channel | `in:#general`, `in:#alerts` |
| `has:<kind>` | Filter by content type: `link`, `image`, `gif`, `video`, `file` | `has:link`, `has:image`, `has:file` |
| `before:<date>` | Messages sent before date (`YYYY-MM-DD` or ISO8601) | `before:2026-11-12` |
| `after:<date>` | Messages sent after date (`YYYY-MM-DD` or ISO8601) | `after:2026-11-01` |
| `on:<date>` | Messages sent on a specific calendar day (`YYYY-MM-DD`) | `on:2026-11-10` |
| `author:<user\|bot>` | Filter between human users and bots/webhooks | `author:bot`, `author:user` |
| `tag:<key[=value]>` | Match specific IRC message tags | `tag:+role=webhook`, `tag:+badge=bot` |
| `limit:<number>` | Maximum number of results to return (1-100, default: 50) | `limit:20` |

---

## 4. Server Replies

### 4.1 Numeric Replies
1. **740 RPL_SEARCHSTART**
   ```irc
   :irc.flarc.local 740 <client> <target> <query> :Search started
   ```
2. **741 RPL_SEARCHRESULT**
   ```irc
   :irc.flarc.local 741 <client> <target> <msgid> <timestamp> <sender> :<content>
   ```
3. **742 RPL_SEARCHEND**
   ```irc
   :irc.flarc.local 742 <client> <target> <count> :End of search results
   ```
4. **743 ERR_SEARCHFAILED**
   ```irc
   :irc.flarc.local 743 <client> <target> :<error message>
   ```

### 4.2 Labeled-Response & Batch Mode
When negotiated with `batch` and `labeled-response`, results are grouped inside an atomic batch:

```irc
@label=search-req-1 :irc.flarc.local BATCH +batch_1 draft/search #tech Cloudflare
@batch=batch_1;time=2026-11-11T16:50:00Z;msgid=msg-1 :Engineer!eng@cf PRIVMSG #tech :Deploying Flare Relay Chat on Cloudflare Workers
@batch=batch_1 :irc.flarc.local BATCH -batch_1
```

---

## 5. Examples

### 5.1 Simple Full-Text Search
```irc
SEARCH #tech Cloudflare
:irc.flarc.local 740 Alice #tech Cloudflare :Search started
:irc.flarc.local 741 Alice #tech 49f43054-9e7a 2026-11-11T16:48:12Z Engineer :Deploying Flare Relay Chat on Cloudflare Workers with SQLite DO
:irc.flarc.local 742 Alice #tech 1 :End of search results
```

### 5.2 Filtered Search with from: and has:
```irc
SEARCH #tech from:DocWriter has:link
:irc.flarc.local 740 Alice #tech from:DocWriter has:link :Search started
:irc.flarc.local 741 Alice #tech c728b19a-3101 2026-11-11T18:00:00Z DocWriter :Check out https://github.com/flarc/cfcord for source code
:irc.flarc.local 742 Alice #tech 1 :End of search results
```

### 5.3 Filtered Search by Bot Author and Date Range
```irc
SEARCH #alerts author:bot after:2026-11-01 limit:10
:irc.flarc.local 740 Alice #alerts author:bot after:2026-11-01 :Search started
:irc.flarc.local 741 Alice #alerts b63be57e-bfff 2026-11-11T16:50:57Z CI/CD_Bot :Build #42 passed on branch main!
:irc.flarc.local 742 Alice #alerts 1 :End of search results
```

---

## 6. REST API Multi-Transport Parity

The same full-text and tag filter capabilities are accessible over HTTP REST:

### Channel-Scoped Search
```http
GET /api/v1/channels/{channel}/messages/search?q=from:DocWriter+has:link&limit=20
```

### Multi-Channel / Global Search
```http
GET /api/v1/messages/search?q=deploy&in=%23tech&from=Engineer&has=link
```
