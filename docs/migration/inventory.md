# FlaRC Architectural Inventory & Migration Map

Date: 2026-11-11
Author: Antigravity (Pair Programming with User)

## 1. Executive Summary & Baseline Metrics

FlaRC (Flare Relay Chat) is an IRCv3 server built on Cloudflare Workers, WebSocket Hibernation, and SQLite-backed Durable Objects.
- **Vitest Suites**: 6/6 test files, 29/29 tests passed (100% green in 1.83s).
- **TypeScript**: 0 compilation errors with strict configuration.
- **Total Codebase**: ~17,614 lines of TypeScript in `old/src/`.
- **Durable Object Namespaces**:
  - `SESSION` (`SessionDO`): Owning WebSocket hibernation, IRC protocol parsing, state machine, client delivery. ID: `SERVER_CONFIG.networkId` ("FlaRC").
  - `CHANNELS` (`ChannelDO`): Owning channel state, members, modes, permissions, and 90-day SQLite message history. ID: `${SERVER_CONFIG.networkId}:${canonicalChannelName}`.
  - `ACCOUNTS` (`AccountsDO`): Owning accounts, SCRAM-SHA-256 credentials, passwords, metadata, auto-joins, read markers, webpush subscriptions, and media uploads. ID: `SERVER_CONFIG.networkId` ("FlaRC").

---

## 2. Capabilities & Protocols

### 2.1 IRCv3 Capabilities Advertised (`CAP LS 302`)
- `account-notify`, `account-tag`, `away-notify`, `batch`, `bot`, `cap-notify`, `chathistory`
- `chghost`, `echo-message`, `extended-join`, `extended-monitor`, `invite-notify`, `labeled-response`
- `message-tags`, `monitor`, `msgid`, `multi-prefix`, `no-implicit-names`
- `sasl=PLAIN,EXTERNAL,SCRAM-SHA-256`, `server-time`, `setname`, `standard-replies`, `userhost-in-names`
- `znc.in/playback`, `znc.in/self-message`
- `draft/account-registration=before-connect`
- `draft/auto-join`, `draft/channel-rename`, `draft/chathistory`, `draft/client-batch`
- `draft/event-playback`, `draft/extended-isupport`, `draft/languages=1,en`, `draft/message-redaction`
- `draft/metadata-2=max-subs=200`, `draft/metadata-3=before-connect,max-subs=200`, `draft/metadata-3.2=before-connect,max-subs=200`
- `draft/metadata-notify-2`, `draft/multiline=max-bytes=4096,max-lines=32`, `draft/no-implicit-names`
- `draft/oper-tag`, `draft/persistence`, `draft/pre-away`, `draft/read-marker`, `draft/relaymsg=/`
- `draft/reply`, `draft/filehost=/api/media/upload`, `soju.im/filehost=/api/media/upload`, `draft/webpush`, `draft/whoami`
- Canary reject: `ergo.chat/nope` (advertised in LS, rejected in REQ)

### 2.2 ISUPPORT Tokens (`005`)
- `CHANTYPES=#&`, `PREFIX=(qaohv)~&@%+`, `CHANMODES=beIq,k,fl,BCEMRimnpsturuU`, `STATUSMSG=~&@%+`
- `CASEMAPPING=rfc1459`, `UTF8ONLY`, `NICKLEN=32`, `CHANNELLEN=64`, `TOPICLEN=390`
- `AWAYLEN=300`, `KICKLEN=390`, `LINELEN=4096`, `ELIST=MNU`, `MAXTARGETS=4`, `MODES=4`, `EXCEPTS=e`, `INVEX=I`, `EXTBAN=,m`
- `ACCOUNTEXTBAN=a,account`, `WHOX`, `MONITOR=100`, `BOT=B`, `CHATHISTORY=500`, `MSGREFTYPES=msgid,timestamp`, `METADATA=32`
- `draft/ICON=http://127.0.0.1:8788/icon.svg`
- `draft/FILEHOST=/api/media/upload`, `soju.im/FILEHOST=/api/media/upload` (when enabled)

### 2.3 IRC Commands Implemented
- Registration / Auth: `CAP`, `AUTHENTICATE`, `PASS`, `NICK`, `USER`, `WEBIRC`, `REGISTER`, `QUIT`
- Channel: `JOIN`, `PART`, `TOPIC`, `MODE`, `KICK`, `INVITE`, `NAMES`, `LIST`
- Messaging: `PRIVMSG`, `NOTICE`, `TAGMSG` (reactions `+draft/react`, typing `+typing`, persistence `+draft/persist`, replies `+draft/reply` / `+reply`, roles `+role` / `+badge`)
- IRCv3 Extensions: `BATCH` (multiline, labeled-response, chathistory), `CHATHISTORY`, `MARKREAD`, `METADATA`, `REDACT`, `MONITOR`, `SETNAME`
- Oper / Server: `OPER`, `KILL`, `SAJOIN`, `SANICK`, `MOTD`, `LUSERS`, `VERSION`, `INFO`, `TIME`, `ADMIN`, `PING`, `PONG`, `ISON`, `WHOIS`, `WHOWAS`, `WHO`, `AWAY`, `HELP`
- Services:
  - `F` / `FLARESERV` / `Q`: `AUTH`, `REQUESTBOT`, `UNREQUESTBOT`, `OP`, `DEOP`, `VOICE`, `DEVOICE`, `CHANLEV`, `WELCOME`, `STATUS`, `HELP`
  - `NICKSERV` / `NS`: `REGISTER`, `IDENTIFY`, `INFO`, `SET`, `UNREGISTER`, `PASSWD`
  - `CHANSERV` / `CS`: `REGISTER`, `INFO`, `AMODE`, `UNREGISTER`, `CLEAR`, `OP`, `DEOP`
  - `HOSTSERV` / `HS`: `ON`, `OFF`, `STATUS`
  - `HISTSERV`: `PLAY`, `DELETE`, `FORGET`, `EXPORT`
  - `ZNC`: `*playback`

---

## 3. Storage & Schema Inventory

### 3.1 AccountsDO SQLite Schema
1. `users`: `id`, `username`, `display_name`, `password_hash`, `created_at`, `updated_at`, `disabled_at`
2. `registered_nicks`: `nickname`, `user_id`, `registered_at`
3. `account_roles`: `user_id`, `role`
4. `scram_credentials`: `user_id`, `salt`, `iterations`, `stored_key`, `server_key`
5. `user_metadata`: `target_key`, `key`, `value`, `updated_at` (canonical keys: `avatar`, `display-name`, `pronouns`, `bio`, `bot`, `color`, `custom-status`, `timezone`)
6. `read_markers`: `user_key`, `target`, `timestamp`, `updated_at`
7. `account_settings`: `user_id`, `persistence`, `auto_join_json`, `vhost`, `vhost_enabled`, `settings_json`
8. `webpush_subscriptions`: `user_key`, `endpoint`, `keys_json`, `created_at`
9. `media_uploads`: `id`, `filename`, `mime_type`, `size`, `data`, `created_at`

### 3.2 ChannelDO SQLite Schema
1. `channel_metadata`: `key`, `value` (`modes`, `topic`, `topic_set_by`, `topic_set_at`, `created_at`, `registered`, `founder`, `registered_at`, `f_bot_enabled`, `f_bot_welcome`, `next_sequence`, `cleanup_scheduled_at`)
2. `messages`: `id`, `sequence`, `sender_id`, `sender_account`, `sender_nick`, `sender_user`, `sender_host`, `command`, `content`, `tags_json`, `multiline_json`, `redacted`, `created_at`, `expires_at`
3. `channel_members`: `session_id`, `user_id`, `account_name`, `nickname`, `username`, `hostname`, `realname`, `modes`, `joined_at`, `is_persistent`
4. `channel_permissions`: `user_id`, `account_name`, `permission`
5. `channel_bans`: `mask`, `created_by`, `created_at`, `reason`
6. `channel_list_modes`: `mode`, `mask`, `created_by`, `created_at`
7. `channel_invites`: `target_nick`, `invited_by`, `created_at`
8. `channel_kv_metadata`: `key`, `value`, `updated_at` (canonical keys: `avatar`, `description`, `category`, `color`, `read-only`, `nsfw`, `tags`)

### 3.3 SessionDO SQLite Schema
1. `session_state`: `session_id`, `attachment_json`, `created_at`, `updated_at`
2. `session_channels`: `session_id`, `canonical_channel`, `channel_name`, `joined_at`
3. `direct_messages`: `id`, `peer_pair`, `sender_id`, `sender_account`, `sender_nick`, `sender_user`, `sender_host`, `target_nick`, `target_account`, `command`, `content`, `tags_json`, `redacted`, `created_at`

---

## 4. Current REST & Media Endpoints Inventory

- `GET /health` -> `{ ok, service, network, server, version }`
- `GET /icon.svg` -> SVG server icon
- `POST /api/accounts/register` -> Public account registration
- `POST /api/media/upload` -> Media upload (multipart or binary stream, authorized)
- `GET /media/:id` -> Media retrieval
- `GET /api/profile/:username` / `PATCH /api/profile/:username` -> Canonical user profiles
- `GET /api/channels/:channel/info` / `PATCH /api/channels/:channel/info` -> Channel categories, rich metadata
- `GET /api/channels/:channel/unread` -> Channel unread & mention counters
- `GET /api/users/:username/unread` -> User multi-channel unread summary
- `POST /api/webpush/subscribe`, `DELETE /api/webpush/subscribe`, `GET /api/webpush/subscriptions` -> WebPush
- `POST /admin/config` -> Live config update (filehostEnabled, filehostRequireRegistration, etc.)
- `GET /admin/stats` -> Server statistics
- `GET /admin/accounts`, `POST /admin/accounts/register`, `POST /admin/accounts/disable`
- `GET /admin/accounts/:username`, `PATCH /admin/accounts/:username`, `DELETE /admin/accounts/:username`
- `POST /admin/accounts/:username/password`, `POST /admin/accounts/:username/disable`, `POST /admin/accounts/:username/enable`
- `GET /admin/accounts/:username/vhost`, `PUT /admin/accounts/:username/vhost`
- `GET /admin/accounts/:username/metadata`, `PUT /admin/accounts/:username/metadata`
- `GET /admin/profile/:username`, `PATCH /admin/profile/:username`
- `POST /admin/messages/redact`
- `GET /admin/sessions`, `POST /admin/sessions/disconnect`, `POST /admin/broadcast`
- `GET /admin/channels`, `GET /admin/channels/:channel`, `DELETE /admin/channels/:channel`
- `GET /admin/channels/:channel/info`, `PATCH /admin/channels/:channel/info`
- `POST /admin/channels/:channel/register`, `POST /admin/channels/:channel/unregister`
- `POST /admin/channels/:channel/modes`, `POST /admin/channels/:channel/topic`, `POST /admin/channels/:channel/kick`
- `GET /admin/channels/:channel/bot`, `POST /admin/channels/:channel/bot`
- `GET /admin/channels/:channel/messages`, `POST /admin/channels/:channel/messages/purge`

---

## 5. Migration Map to Nitro 3 Architecture

| Old Location | New Location | Description |
|---|---|---|
| `src/durable-objects/session.ts` | `server/durable-objects/session.ts` | SessionDO with native WebSocket hibernation, state recovery, and IRC commands |
| `src/durable-objects/channel.ts` | `server/durable-objects/channel.ts` | ChannelDO with Drizzle ORM, roles, history, unread counters, and F bot |
| `src/durable-objects/accounts.ts` | `server/durable-objects/accounts.ts` | AccountsDO with Drizzle ORM, SCRAM-SHA-256, profiles, and media storage |
| `src/storage/*-schema.ts` | `server/storage/schemas/` & `server/storage/migrations/` | Drizzle ORM schemas using `drizzle-orm/durable-sqlite` |
| `src/protocol/*` | `server/protocol/irc/` | Parser, encoder, numerics, capabilities, types |
| `src/services/*` | `server/core/authentication/` | Authentication & SCRAM services |
| `src/security/*` | `server/core/permissions/` | Security, rate limiting, permissions |
| `src/worker/routes.ts` | `server/routes/api/v1/...` | Thin Nitro 3 file-based routes delegating to domain services |
| `src/worker/websocket.ts` | `server/routes/irc.get.ts` & `server/routes/index.get.ts` | WebSocket upgrade routing to SessionDO |
| - (New) | `server/core/events/` | Typed domain event emitter for real-time WebSocket events |
| - (New) | `server/routes/api/v1/events.get.ts` | WebSocket real-time structured events endpoint |
| - (New) | `server/routes/openapi.json.get.ts` & `server/routes/docs.get.ts` | OpenAPI 3.1 & Scalar API documentation UI |
| - (New) | `server/schemas/` | Zod validation schemas for all requests, responses & events |
| - (New) | `server/providers/media/` | Storage provider abstraction (Cloudflare R2 + Local DO fallback) |
| - (New) | `server/providers/notifications/` | WebPush delivery provider |
| `tests/*` | `tests/*` | Migrated and expanded Vitest test suite |

---

## 6. Migration Verification & Outcomes

The full migration to Nitro 3, Drizzle ORM, Zod, and OpenAPI 3.1 has been completed and fully verified:

1. **Vitest Test Suite**:
   - `tests/protocol/parser.test.ts` (6 tests) - **PASS**
   - `tests/durability/persistence.test.ts` (3 tests) - **PASS**
   - `tests/integration/irc-server.test.ts` (4 tests) - **PASS**
   - `tests/integration/admin-api.test.ts` (5 tests) - **PASS**
   - `tests/integration/ergo-ircv3-specs.test.ts` (6 tests) - **PASS**
   - `tests/integration/modern-chat-features.test.ts` (5 tests) - **PASS**
   - `tests/integration/realtime-events-and-roles.test.ts` (2 tests) - **PASS**
   - `tests/integration/ircord-edit-fts-webhooks.test.ts` (3 tests) - **PASS**
   - **Total**: 8/8 test suites passed, 34/34 tests passed (100% green).

2. **IRCord Message Editing, FTS5 Search & Incoming Webhooks**:
   - Supported `+ircord/edit`, `+draft/edit`, `+edit` client message tag with `ISUPPORT CLIENTTAGDENY=*,-ircord/edit,...`.
   - SQLite FTS5 full-text search indexing on channel messages, queried via IRC `SEARCH <channel> <query>` command and REST `GET /api/v1/channels/{channel}/messages/search?q=...`.
   - Discord/Slack compatible incoming webhooks (`POST /api/v1/channels/{channel}/webhooks`, `GET /api/v1/channels/{channel}/webhooks`, and execution at `POST /api/v1/webhooks/{token}`) with bot badges and webhook roles on relayed IRC messages.

3. **irctest IRC/IRCv3 Protocol Conformance**:
   - `irctest/server_tests/cap.py` (13/13 passed) - **PASS**
   - `irctest/server_tests/connection_registration.py` (12/12 passed) - **PASS**
   - Seamless TCP-to-WebSocket bridging through Miniflare using the compiled Nitro 3 bundle (`.output/server/index.mjs`).

4. **Type Checking & Code Quality**:
   - TypeScript: `npm run typecheck` (`tsc --noEmit`) - **0 errors**.
   - Biome: `npx biome check server/ tests/ scripts/` - **0 errors**.

5. **API & Client SDK**:
   - OpenAPI 3.1 schema served at `GET /openapi.json`.
   - Interactive Scalar API documentation UI served at `GET /docs`.
   - Typed TypeScript client generated at `docs/api/client.ts` via `npm run generate:client` using `openapi-typescript`.

