# Attack surface inventory

Every file route is listed below, including aliases. All external identifiers select resources; they are not proof of identity. Internal Durable Object bindings are not published RPC endpoints.

| Endpoint | Required authority | Owner | Source |
|---|---|---|---|
| `ALL /admin/[...slug]` | Logged-in network administrator | Worker / coordinator | `server/routes/admin/[...slug].ts` |
| `POST /api/accounts/register` | Signup policy; reserved administrator bootstrap requires secret | AccountsDO | `server/routes/api/accounts/register.post.ts` |
| `GET /api/channels/[channel]/info` | Session + current channel history/visibility policy | ChannelDO | `server/routes/api/channels/[channel]/info.get.ts` |
| `PATCH /api/channels/[channel]/info` | Session + channel founder/operator/custom management/admin | ChannelDO | `server/routes/api/channels/[channel]/info.patch.ts` |
| `GET /api/channels/[channel]/unread` | Session + account owner + current channel read | ChannelDO | `server/routes/api/channels/[channel]/unread.get.ts` |
| `GET /api/health` | Explicitly public non-secret information | Worker / coordinator | `server/routes/api/health.get.ts` |
| `POST /api/media/upload` | Session + quota + owner/channel-generation/DM scope | AccountsDO | `server/routes/api/media/upload.post.ts` |
| `GET /api/profile/[username]` | Session; profile write requires self | AccountsDO | `server/routes/api/profile/[username].get.ts` |
| `PATCH /api/profile/[username]` | Session; profile write requires self | AccountsDO | `server/routes/api/profile/[username].patch.ts` |
| `GET /api/status` | Explicitly public non-secret information | Worker / coordinator | `server/routes/api/status.get.ts` |
| `GET /api/users/[username]/unread` | Session + account owner; filter channel counts by current read | AccountsDO | `server/routes/api/users/[username]/unread.get.ts` |
| `ALL /api/v1/admin/[...slug]` | Logged-in network administrator | Worker / coordinator | `server/routes/api/v1/admin/[...slug].ts` |
| `POST /api/v1/auth/events-ticket` | Session; creates expiring single-use child ticket | AccountsDO | `server/routes/api/v1/auth/events-ticket.post.ts` |
| `POST /api/v1/auth/login` | Credentials + rate limit; issues expiring session | AccountsDO | `server/routes/api/v1/auth/login.post.ts` |
| `POST /api/v1/auth/logout` | Session; revoke this credential and child tickets | AccountsDO | `server/routes/api/v1/auth/logout.post.ts` |
| `POST /api/v1/auth/register` | Signup policy; reserved administrator bootstrap requires secret | AccountsDO | `server/routes/api/v1/auth/register.post.ts` |
| `GET /api/v1/channels/[channel]/info` | Session + current channel history/visibility policy | ChannelDO | `server/routes/api/v1/channels/[channel]/info.get.ts` |
| `PATCH /api/v1/channels/[channel]/info` | Session + channel founder/operator/custom management/admin | ChannelDO | `server/routes/api/v1/channels/[channel]/info.patch.ts` |
| `DELETE /api/v1/channels/[channel]/messages/[id]` | Session + channel read; edit: member/author; redact: author/moderator | ChannelDO | `server/routes/api/v1/channels/[channel]/messages/[id].delete.ts` |
| `PATCH /api/v1/channels/[channel]/messages/[id]` | Session + channel read; edit: member/author; redact: author/moderator | ChannelDO | `server/routes/api/v1/channels/[channel]/messages/[id].patch.ts` |
| `GET /api/v1/channels/[channel]/messages` | Session + current channel history/visibility policy | ChannelDO | `server/routes/api/v1/channels/[channel]/messages/index.get.ts` |
| `POST /api/v1/channels/[channel]/messages` | Session + actual channel membership, moderation and bans | ChannelDO | `server/routes/api/v1/channels/[channel]/messages/index.post.ts` |
| `GET /api/v1/channels/[channel]/messages/search` | Session + current channel history/visibility policy | ChannelDO | `server/routes/api/v1/channels/[channel]/messages/search.get.ts` |
| `DELETE /api/v1/channels/[channel]/outgoing-webhooks/[id]` | Session + channel management; outgoing destinations allowlisted | ChannelDO | `server/routes/api/v1/channels/[channel]/outgoing-webhooks/[id].delete.ts` |
| `GET /api/v1/channels/[channel]/outgoing-webhooks` | Session + channel management; outgoing destinations allowlisted | ChannelDO | `server/routes/api/v1/channels/[channel]/outgoing-webhooks/index.get.ts` |
| `POST /api/v1/channels/[channel]/outgoing-webhooks` | Session + channel management; outgoing destinations allowlisted | ChannelDO | `server/routes/api/v1/channels/[channel]/outgoing-webhooks/index.post.ts` |
| `DELETE /api/v1/channels/[channel]/roles/[id]` | Session + channel read; mutations: persistent founder/admin | ChannelDO | `server/routes/api/v1/channels/[channel]/roles/[id].delete.ts` |
| `PATCH /api/v1/channels/[channel]/roles/[id]` | Session + channel read; mutations: persistent founder/admin | ChannelDO | `server/routes/api/v1/channels/[channel]/roles/[id].patch.ts` |
| `POST /api/v1/channels/[channel]/roles/assign` | Session + channel read; mutations: persistent founder/admin | ChannelDO | `server/routes/api/v1/channels/[channel]/roles/assign.post.ts` |
| `GET /api/v1/channels/[channel]/roles` | Session + channel read; mutations: persistent founder/admin | ChannelDO | `server/routes/api/v1/channels/[channel]/roles/index.get.ts` |
| `POST /api/v1/channels/[channel]/roles` | Session + channel read; mutations: persistent founder/admin | ChannelDO | `server/routes/api/v1/channels/[channel]/roles/index.post.ts` |
| `GET /api/v1/channels/[channel]/unread` | Session + account owner + current channel read | ChannelDO | `server/routes/api/v1/channels/[channel]/unread.get.ts` |
| `DELETE /api/v1/channels/[channel]/webhooks/[id]` | Session + channel management; outgoing destinations allowlisted | ChannelDO | `server/routes/api/v1/channels/[channel]/webhooks/[id].delete.ts` |
| `GET /api/v1/channels/[channel]/webhooks` | Session + channel management; outgoing destinations allowlisted | ChannelDO | `server/routes/api/v1/channels/[channel]/webhooks/index.get.ts` |
| `POST /api/v1/channels/[channel]/webhooks` | Session + channel management; outgoing destinations allowlisted | ChannelDO | `server/routes/api/v1/channels/[channel]/webhooks/index.post.ts` |
| `GET /api/v1/channels` | Session; filter each channel by current read policy | Worker / coordinator | `server/routes/api/v1/channels/index.get.ts` |
| `GET /api/v1/dms/[target]/messages` | Authenticated conversation participant | SessionDO | `server/routes/api/v1/dms/[target]/messages/index.get.ts` |
| `GET /api/v1/embeds` | Session + explicit exact HTTPS provider allowlist | Worker / coordinator | `server/routes/api/v1/embeds.get.ts` |
| `GET /api/v1/events` | Bearer handshake or one-use ticket; current account/channel check per event | SessionDO | `server/routes/api/v1/events.get.ts` |
| `DELETE /api/v1/media/[id]` | Session + stored uploader ID | AccountsDO | `server/routes/api/v1/media/[id].delete.ts` |
| `POST /api/v1/media/upload` | Session + quota + owner/channel-generation/DM scope | AccountsDO | `server/routes/api/v1/media/upload.post.ts` |
| `GET /api/v1/messages/search` | Session; each result must pass channel read policy | Worker / coordinator | `server/routes/api/v1/messages/search.get.ts` |
| `DELETE /api/v1/notifications/subscribe` | Session + account owner; channel preferences check visibility | AccountsDO | `server/routes/api/v1/notifications/subscribe.delete.ts` |
| `POST /api/v1/notifications/subscribe` | Session + account owner; channel preferences check visibility | AccountsDO | `server/routes/api/v1/notifications/subscribe.post.ts` |
| `GET /api/v1/notifications/subscriptions` | Session + account owner; channel preferences check visibility | AccountsDO | `server/routes/api/v1/notifications/subscriptions.get.ts` |
| `GET /api/v1/profiles/[username]` | Session; profile write requires self | AccountsDO | `server/routes/api/v1/profiles/[username].get.ts` |
| `PATCH /api/v1/profiles/[username]` | Session; profile write requires self | AccountsDO | `server/routes/api/v1/profiles/[username].patch.ts` |
| `GET /api/v1/search` | Session; each result must pass channel read policy | Worker / coordinator | `server/routes/api/v1/search.get.ts` |
| `PUT /api/v1/users/[username]/notifications/[channel]` | Session + account owner; channel preferences check visibility | AccountsDO | `server/routes/api/v1/users/[username]/notifications/[channel].put.ts` |
| `GET /api/v1/users/[username]/notifications` | Session + account owner; channel preferences check visibility | AccountsDO | `server/routes/api/v1/users/[username]/notifications/index.get.ts` |
| `GET /api/v1/users/[username]/unread` | Session + account owner; filter channel counts by current read | AccountsDO | `server/routes/api/v1/users/[username]/unread.get.ts` |
| `POST /api/v1/webhooks/[id]/[token]` | Channel-scoped secret capability; optional ID must match | ChannelDO | `server/routes/api/v1/webhooks/[id]/[token].post.ts` |
| `POST /api/v1/webhooks/[token]` | Channel-scoped secret capability; optional ID must match | ChannelDO | `server/routes/api/v1/webhooks/[token].post.ts` |
| `POST /api/webhooks/[id]/[token]` | Channel-scoped secret capability; optional ID must match | ChannelDO | `server/routes/api/webhooks/[id]/[token].post.ts` |
| `DELETE /api/webpush/subscribe` | Session + account owner; channel preferences check visibility | Worker / coordinator | `server/routes/api/webpush/subscribe.delete.ts` |
| `POST /api/webpush/subscribe` | Session + account owner; channel preferences check visibility | Worker / coordinator | `server/routes/api/webpush/subscribe.post.ts` |
| `GET /api/webpush/subscriptions` | Session + account owner; channel preferences check visibility | Worker / coordinator | `server/routes/api/webpush/subscriptions.get.ts` |
| `GET /docs` | Explicitly public non-secret information | Worker / coordinator | `server/routes/docs.get.ts` |
| `GET /health` | Explicitly public non-secret information | Worker / coordinator | `server/routes/health.get.ts` |
| `GET /icon.svg` | Explicitly public non-secret information | Worker / coordinator | `server/routes/icon.svg.get.ts` |
| `ALL /` | Explicitly public non-secret information | Worker / coordinator | `server/routes/index.ts` |
| `ALL /irc` | Pre-auth handshake only; registered account required to participate | SessionDO | `server/routes/irc.ts` |
| `GET /media/[id]` | Session + stored owner/channel generation/DM participant scope | AccountsDO | `server/routes/media/[id].get.ts` |
| `GET /metrics` | Logged-in session; endpoint-specific policy | Worker / coordinator | `server/routes/metrics.get.ts` |
| `GET /openapi.json` | Explicitly public non-secret information | Worker / coordinator | `server/routes/openapi.json.get.ts` |
| `GET /status` | Explicitly public non-secret information | Worker / coordinator | `server/routes/status.get.ts` |

## Resource selection, persistence and abuse boundaries

All request account names, nicknames, message/channel/role IDs, sender fields and query parameters are untrusted resource selectors. Bearer verification derives the caller at AccountsDO. Client operations re-verify sessions inside the owning object; administrative RPC facades re-verify the current administrator and dispatch only allowlisted operations. IRC principals come from server-held authenticated attachments and current account/credential state. Raw maintenance methods are internal binding capabilities; no arbitrary internet RPC dispatch exists.

GET operations read state, with lazy Durable Object/schema/channel initialization where applicable. Login/ticket GET-upgrade state is explicitly exceptional: login creates a session, ticket POST creates a child credential, and events GET consumes the ticket/attaches a socket. POST/PATCH/PUT/DELETE operations persist their named resource changes, except read-like administrative controls listed below. Read requests cannot return private messages, metadata, counts, attachments or events merely by guessing IDs. Unowned legacy DM/media data stays inaccessible.

| Surface | Abuse bounds / expensive operations | Cross-interface enforcement |
|---|---|---|
| API JSON and authentication | 64 KiB bodies incl DELETE; 300 authenticated requests/min/account; public auth IP and durable per-account/signup budgets | Accounts session and credential policies also used by IRC |
| IRC + bridges | 64 KiB frames, line/command limits, 64 queued frames/256 KiB per socket; pending output <=4,096 frames/8 MiB/socket and 16 MiB total; loopback TCP listeners, bounded pending buffers; 60s registration deadline, connection caps | Authenticated principal, ChannelDO policies, immutable DM accounts |
| Channel/DM history and search | HTTP history <=100; IRC <=500; 90-day read filter and alarm cleanup; network-wide search still needs load measurement | Channel policy and participant pair checks; no admin DM override |
| Media | <=10 MiB/request, <=100 MiB/account; authenticate before R2 access; private bucket required | Channel resource generation / immutable DM account IDs |
| Event WebSocket | <=5/account; bounded connection/handshake budgets; no arbitrary ID subscriptions/replay cursor | Recheck account session + channel read for every channel event |
| Incoming hooks | Secret capability and matching ID, channel moderation capability, 60 executions/10s/hook | ChannelDO committed append path; hook identity is namespaced |
| Previews/outgoing hooks | Default off; exact HTTPS host allowlists, checked/rejected redirects, 5s timeout and streamed byte limits | Shared egress policy; operator owns trusted DNS/network controls |
| Public health/status/docs/icon/root | Intentionally non-secret output, no account resource access | Explicit public exceptions only |

## Concrete administrative operations

Every row exists under **both** `/admin` and `/api/v1/admin`; a current **admin account session** is mandatory at the Worker and owning-object dispatcher. `oper` alone does not authorize REST administration. Body schemas are validated before branches, including DELETE. Metadata and list operations expose privileged information only to administrators.

| Suffix | Methods | Authority / data owner and effect |
|---|---|---|
| `/config` | POST | Accounts runtime policy + Session configuration; persistent |
| `/stats` | GET | Session aggregate statistics |
| `/broadcast` | POST | Session live network broadcast |
| `/sessions` | GET | Session connection metadata |
| `/sessions/disconnect` | POST | Session disconnect and routing cleanup |
| `/accounts` | GET, POST | Accounts filtered listing / controlled provisioning |
| `/accounts/register` | POST | Same controlled provisioning; no GET alias |
| `/accounts/disable` | POST | Accounts disable + session invalidation |
| `/accounts/{username}` | GET, PATCH, DELETE | Account details / roles and display name / deletion+tombstone+revocation |
| `/accounts/{username}/password` | POST | Atomic PBKDF2/SCRAM reset + token/session revocation |
| `/accounts/{username}/disable`, `/enable` | POST | Account status; disable disconnects existing IRC sessions |
| `/accounts/{username}/roles` | GET, POST | Roles listing / grant or revoke; refresh live permissions |
| `/profile/{username}` | GET, PATCH | Accounts profile access / change |
| `/metadata/users/{target}`, `/metadata/channels/{target}` | GET, PUT | Owner object metadata read/update |
| `/metadata/users/{target}/{key}`, `/metadata/channels/{target}/{key}` | DELETE | Owner object metadata delete |
| `/messages/redact` | POST | Channel message-chain redaction; no DM administrator override |
| `/channels` | GET | Session/Channel privileged channel inventory |
| `/channels/{channel}`, `/channels/{channel}/info` | GET | Channel full details / public-shaped details under admin authority |
| `/channels/{channel}/info` | PATCH | Channel metadata/topic update |
| `/channels/{channel}` | DELETE | Atomic archive; explicit purgeMessages boolean; name remains reserved |
| `/channels/{channel}/register`, `/unregister` | POST | Channel registration / removal, existing account founder required |
| `/channels/{channel}/modes`, `/topic`, `/kick` | POST | Channel moderation; Session routing reconciled on kick |
| `/channels/{channel}/bot` | GET, POST | Server F-bot channel configuration |
| `/channels/{channel}/messages` | GET | Channel privileged history read; bounded page |
| `/channels/{channel}/messages/purge` | POST | Channel deletion with explicit all/before boundary |

Unknown methods/subpaths are not privileged RPC dispatch capabilities.

## Other entrypoints

- `scripts/tcp-bridge.mjs`, the development bridge and conformance bridge forward raw IRC; bound listener, input buffers, pending queues and gateway authentication must be constrained.
- `SessionDO.webSocketMessage`, close/error handlers and attachment reconstruction coordinate IRC. Event sockets are a separate tagged socket class.
- `ChannelDO.alarm` removes expired messages in bounded batches and must reschedule when retained messages are not expired yet.
- Session retention/registration cleanup, WebPush registration, domain event dispatch, outgoing hooks and media R2 writes are additional asynchronous boundaries.
- AccountsDO owns accounts, credentials, sessions, nick ownership, account settings, profiles, read markers, subscriptions and media access metadata.
- ChannelDO owns memberships, persistent access, roles, moderation, topic/metadata, history/FTS, incoming/outgoing hooks and retention.
- SessionDO owns live connections, channel routing, known channel discovery and direct messages.

## Audit method

Trace input → verified principal → domain policy → database/R2 → response/events. Test independent users, all legacy aliases, negative access paths, malformed/oversized input, lifecycle changes, and runtime reconstruction. Local-only adversarial traffic and disposable fixtures are used throughout.

## Internal RPC and asynchronous inventory

| Owner | Reachable RPC families | Authenticated calling path / trust boundary |
|---|---|---|
| AccountsDO | register/verify credentials, SCRAM challenge data, API sessions/tickets, revocation and request budgets | Login/REGISTER/SASL verified against persisted account state; SCRAM secrets never sent to clients/attachments |
| AccountsDO | clientRequest profiles/push/preferences, private media/read markers | Token-derived principal and self/scope checks; ordinary targets never authorize themselves |
| AccountsDO | adminRequest account/status/roles/metadata/runtime configuration | Current admin token, explicit operation allowlist; internal lifecycle calls follow verified service commands |
| ChannelDO | clientRequest history/search/info/unread/messages/roles/hooks | Re-verify account token, current channel state, author/founder/manager checks |
| ChannelDO | IRC join/part/moderation/metadata/history/ChanServ/F RPCs | Server-resolved session/account; channel owns modes, bans, roles and persistent grants |
| ChannelDO | rename export/import/finalization | Source validates live session/operator; bounded SQLite snapshot, collision check and transition nonce; no public snapshot/import API |
| ChannelDO | executeWebhook and outbound hooks | Channel-scoped secret and quota / channel-management grant + trusted egress capability |
| ChannelDO | adminRequest maintenance/history/purge/bot operations | Current administrator token and explicit allowlist |
| SessionDO | fetch, webSocketMessage, close/error, getSessionActor, live sessions, routing | Upgrade policy, validated account/credential version, server-owned attachments; no reusable secrets stored |
| SessionDO | clientDirectMessages and history/playback | Actual participant identity and immutable pair; expired/redacted filtering |
| SessionDO | broadcastRealtimeEvent/deliverApiMessage/live IRC delivery | Trusted committed domain events and current event ACLs; secure IRC batches recheck current account/version and channel read; transient delivery is not a distributed transaction |
| SessionDO | adminRequest broadcast/disconnect/config/metadata/routing | Current administrator token and explicit allowlist |
| Alarms | Channel retention; Session pre-auth timeout + DM retention | Internal scheduled work, bounded deletion batches, no caller IDs; does not require permanent timers |
| Callbacks/events | Domain emitter, outgoing HTTP hooks, R2 put/delete compensation, socket errors | Server-issued work, bounded payloads, protected storage metadata; no public job/callback endpoint |

There is no HTTP group-DM membership API, REST DM-send/edit/delete API, individual-message GET route, arbitrary real-time subscription/replay API, email verification backend, voice backend, or working encrypted WebPush sender. Those must not be inferred from placeholder advertising or generated documentation. `old/` is absent.
