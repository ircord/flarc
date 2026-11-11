# FlaRC (Flare Relay Chat) — Modern Communications Platform & Cloudflare-Native IRCv3 Server

FlaRC is an API-first modern communications server and serverless IRCv3 network built on **Nitro 3**, **Cloudflare Workers**, **WebSocket Hibernation**, and **SQLite-backed Durable Objects** managed with **Drizzle ORM**.

It provides three synchronized interfaces to the exact same authoritative underlying application state:
1. **IRC / IRCv3**: IRC protocol support for traditional IRC clients (Halloy, IRCord, WeeChat, etc.) over WebSocket and TCP.
2. **REST API**: Clean, file-based Nitro 3 endpoints validated with Zod, fully documented via OpenAPI 3.1 & Scalar.
3. **Real-time Events API**: Structured WebSocket event stream (`/api/v1/events`) delivering real-time domain events to modern clients.

---

## Architecture Overview

```text
                         FlaRC
                           │
           ┌───────────────┼───────────────┐
           │               │               │
       IRC / IRCv3     REST API       Events API
      (/irc & TCP)    (/api/v1/*)  (/api/v1/events)
           │               │               │
           └───────────────┼───────────────┘
                           │
                    Domain Services
                           │
           ┌───────────────┼───────────────┐
           │               │               │
       Accounts        Channels         Messages
       Identity        Permissions      History
       Profiles        Membership       Presence
       Sessions        Metadata         Notifications
                           │
           └───────────────┼───────────────┘
                           │
                    Durable Objects
                           │
            SQLite (Drizzle ORM) / R2 Storage
```

### 1. Nitro 3 Edge Application (`server/`)
- Pure Nitro 3 application using the `cloudflare_module` preset and `rolldown` bundler.
- File-based API routing (`server/routes/api/v1/...`).
- Interactive **Scalar API Documentation** at `GET /docs` and OpenAPI 3.1 specification at `GET /openapi.json`.
- Automatic Typed Client SDK generated via `openapi-typescript` (`bun run generate:client`).

### 2. Session Durable Object (`SessionDO`)
- Authoritative coordinator for client WebSocket hibernation (`ctx.acceptWebSocket()`, `ctx.getWebSockets()`).
- Dual-mode connection multiplexing:
  - IRCv3 protocol stream on `/irc` (`text.ircv3.net` and `binary.ircv3.net`).
  - Structured Real-time Events WebSocket on `/api/v1/events`.
- Embedded IRC services: F (`FlareServ`), NickServ, ChanServ, HostServ, and HistServ.

### 3. Channel Durable Objects (`ChannelDO`)
- Independent SQLite-backed Durable Object per canonical channel (`#general`, `#dev`, etc.).
- Authoritative message sequencer, message editing (`editMessage`), reactions, and 90-day SQLite retention with auto-pruning alarms.
- Custom role group system (`channel_role_groups` and `channel_user_roles`) with color badges and permission overrides.
- Unread counters and mention indexing (`getUnreadInfo()`).

### 4. Accounts Durable Object (`AccountsDO`)
- Central SQLite store with Drizzle ORM for user accounts, PBKDF2/SCRAM-SHA-256 credentials, and role assignments.
- Canonical user profiles (avatars, bios, custom statuses, pronouns, display names).
- Media storage provider with Cloudflare R2 integration and Durable Object fallback.
- Read marker tracking (`MARKREAD`), notification preferences and private WebPush subscription storage. Encrypted push delivery is not implemented.

---

## API & Documentation

- **Scalar API Docs UI**: `http://127.0.0.1:8788/docs`
- **OpenAPI 3.1 Spec**: `http://127.0.0.1:8788/openapi.json`
- **Generated API types**: [`docs/api/client.ts`](docs/api/client.ts) (generated TypeScript definitions)

See the [API usage and access policies](docs/api/README.md), [findings](docs/security/findings.md) and [verification results](docs/security/security-test-results.md). Local conformance results do not certify production security.

### Core REST Endpoints:
- `POST /api/v1/auth/register` & `POST /api/v1/auth/login`
- `GET /api/v1/profiles/:username` & `PATCH /api/v1/profiles/:username`
- `GET /api/v1/channels` & `GET /api/v1/channels/:channel/info` & `PATCH /api/v1/channels/:channel/info`
- `GET /api/v1/channels/:channel/messages` & `POST /api/v1/channels/:channel/messages`
- `PATCH /api/v1/channels/:channel/messages/:id` & `DELETE /api/v1/channels/:channel/messages/:id`
- `GET /api/v1/channels/:channel/roles` & `POST /api/v1/channels/:channel/roles`
- `POST /api/v1/channels/:channel/roles/assign`
- `GET /api/v1/channels/:channel/unread` & `GET /api/v1/users/:username/unread`
- `POST /api/v1/media/upload` & `GET /media/:id`
- `POST /api/v1/notifications/subscribe` & `GET /api/v1/notifications/subscriptions`
- `GET /api/v1/events` (WebSocket real-time event stream)
- `/admin/*` & `/api/v1/admin/*` (Comprehensive server administration API)

---

## Development & Verification

Use Bun 1.4.4+ (`bun install --frozen-lockfile`) and Node 22.14+ for the Cloudflare tooling. Runtime validation runs in workerd. Security policy, migration limitations and verified results are in [`docs/security/`](docs/security/threat-model.md).

Signup defaults closed. Provision a reserved `ADMIN_USERS` account through registration with the configured `ADMIN_TOKEN` in `X-Bootstrap-Token`, then log in at `/api/v1/auth/login`. The returned expiring `token` is the API bearer credential. Static administrator secrets, Basic auth and username headers do not authorize client/admin APIs. Browser event connections require a single-use ticket from `POST /api/v1/auth/events-ticket`.

### Build Application
```bash
bun run build
```

### Run Vitest Suites
```bash
bun run test
```

### Typecheck & Lint
```bash
bun run typecheck
bunx biome check server/ tests/ scripts/
```

### Generate TypeScript Client SDK
```bash
bun run generate:client
```

### Run Conformance Test Suite (irctest)
```bash
./scripts/run-irctest.sh irctest/server_tests/cap.py
./scripts/run-irctest.sh irctest/server_tests/connection_registration.py
```

### Run Local Server
```bash
bun run dev
```
Connect via:
- **REST & OpenAPI**: `http://127.0.0.1:8788/docs`
- **Real-Time Events**: `ws://127.0.0.1:8788/api/v1/events`
- **IRCv3 WebSocket**: `ws://127.0.0.1:8788/irc`
- **Standard TCP IRC**: `127.0.0.1:6667`

---

## Supported Specifications & Extensions

### Standard IRC & IRCv3 Specifications
- **RFC 1459 & RFC 2812**: Strict message grammar, command dispatching, numerics, and casemapping (`rfc1459` and `ascii`).
- **Modern IRC**: Standard replies, numerics, ISUPPORT tokens, WHOX format, and redacted LINKS.
- **`account-notify` & `account-tag`**: Real-time account status updates and message tagging.
- **`away-notify`**: Asynchronous notification of client away state changes.
- **`batch`**: Batched events (`chathistory`, `multiline`, `metadata`, `netsplit`).
- **`bot`**: User mode `+B` and `@bot` message tags.
- **`cap-notify`**: Dynamic capability addition and deletion notifications.
- **`chathistory`**: Historical message querying (`BEFORE`, `AFTER`, `AROUND`, `BETWEEN`, `LATEST`, `TARGETS`).
- **`chghost`**: Dynamic client username and hostname updates.
- **`echo-message`**: Outgoing message echoing with server timestamps and `msgid`.
- **`extended-join`**: Extended JOIN syntax containing account name and realname.
- **`extended-monitor`**: Extended target monitoring (`MONITOR ~`, `MONITOR C`).
- **`invite-notify`**: Channel invitation notifications sent to existing channel operators.
- **`labeled-response`**: Correlating client commands and responses via the `@label` tag.
- **`message-tags`**: Client-only tags, server tags, and unescaped message tag handling.
- **`monitor`**: User presence notifications (`+`, `-`, `C`, `L`, `S`).
- **`msgid`**: Unique message identification tags.
- **`multi-prefix`**: Sending all user prefixes in `NAMES` and `WHO`.
- **`no-implicit-names`**: Suppressing automatic `NAMES` lists on channel join.
- **`sasl`**: `PLAIN` and `SCRAM-SHA-256` mechanisms, plus re-authentication.
- **`server-time`**: Microsecond ISO 8601 server timestamps (`@time`).
- **`setname`**: Dynamic realname modifications via `SETNAME`.
- **`standard-replies`**: Structured `FAIL`, `WARN`, `NOTE` messages.
- **`userhost-in-names`**: Including client hostmasks in `353 RPL_NAMREPLY`.
- **`znc.in/playback` & `znc.in/self-message`**: Bouncer history playback compatibility.

### Draft Specifications & Ergo Extensions
- **`draft/account-registration`**: In-band user registration before and after connect, password updates, and unregistration. Email challenge verification is unavailable; `VERIFY` fails explicitly.
- **`draft/auto-join`**: Persisted channel auto-joins burst upon client connection.
- **`draft/channel-rename`**: Live channel renaming without disrupting active members.
- **`draft/event-playback`**: Historical event replaying for reconnecting clients.
- **`draft/extended-isupport`**: Dynamic ISUPPORT token updates via numeric `005`.
- **`draft/languages`**: Multi-language support advertisement via `draft/languages`.
- **`draft/message-redaction`**: In-place message redaction via `REDACT` and `@draft/react` tags.
- **`draft/metadata-3` & `draft/metadata-3.2`**: Distributed key-value metadata subscriptions, bursts, and pre-registration set/get.
- **`draft/metadata-notify-2`**: Asynchronous metadata modification broadcasts.
- **`draft/multiline`**: Batched multiline PRIVMSG/NOTICE with line concatenation.
- **`draft/persistence`**: Channel and account persistence modes (`+P`).
- **`draft/pre-away`**: Setting away status during pre-registration.
- **`draft/read-marker`**: Synchronized cross-device channel read markers via `MARKREAD`.
- **`draft/relaymsg`**: Message relaying subject to channel operator authorization.
- **`draft/webpush`**: Private WebPush subscription management. Notification encryption/delivery and VAPID signing are not implemented.
- **`draft/whoami`**: `WHOAMI` command for current connection inspection.
- **`ergo.chat/nope`**: Rate limit feedback.
- **`soju.im/bouncer-networks`**: Multi-network bouncer enumeration.
- **WebSocket Transport**: Native `text.ircv3.net` and `binary.ircv3.net` subprotocols.

---

## Local Development & Testing

### Unit & Durability Tests (Vitest)
Run the internal unit, integration, and Durable Object persistence test suite:

```bash
bun run test
```

### TypeScript Validation
Ensure type safety across all Workers and Durable Objects:

```bash
bun run typecheck
```

### Conformance Test Suite (irctest)
FlaRC is tested against the independent Python IRC conformance suite (`irctest`). The runner uses an explicitly permissive IRC protocol fixture so tests that require guest clients remain meaningful; separate security suites test the default registered-only policy.

Run a single suite:
```bash
./scripts/run-irctest.sh irctest/server_tests/sasl.py
```

Run the full parallel conformance test sweep across 8 workers:
```bash
./scripts/run-irctest.sh irctest/server_tests/ -n 8
```

### Starting the Server Locally
To run the server with a built-in TCP bridge on `127.0.0.1:6667` and HTTP/WebSocket on `127.0.0.1:8788`:

```bash
bun run dev
```

Connect using any IRC client:
- **WebSocket IRCv3**: `ws://127.0.0.1:8788/irc`
- **Standard TCP IRC**: `127.0.0.1:6667`
