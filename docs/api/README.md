# API usage and access policy

The runtime specification is served at `/openapi.json`; `/docs` renders Scalar. [client.ts](client.ts) contains generated TypeScript **types**, not an HTTP client implementation. Regenerate with `bun run generate:client`. The specification includes canonical endpoints, legacy aliases and both administrative prefixes.

## Account and session flow

Signup defaults closed. Administrators can create ordinary accounts through `/admin/accounts` or `/api/v1/admin/accounts`, or explicitly enable `open`/`invite` signup. Public registration rejects `roles` and other unknown security fields. Invitation signup uses `X-Signup-Token`. IRC REGISTER obeys signup policy and has no invitation-token mechanism; invite-only provisioning is available through REST/admin.

For initial setup, configure `ADMIN_USERS` and a random `ADMIN_TOKEN`, then provision one reserved name using `POST /api/v1/auth/register` with `X-Bootstrap-Token`. Bootstrap is consumed persistently after administrator provisioning. The bootstrap secret is never accepted as a client/admin bearer token.

```sh
curl -sS "$FLARC_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"username":"Alice","password":"your-account-password"}'
# Response: { ok, account, token, expiresAt }
curl -sS "$FLARC_URL/api/v1/profiles/Alice" \
  -H "Authorization: Bearer $FLARC_SESSION_TOKEN"
```

`token` is a random API credential, expires after 24 hours, and is stored only as a SHA-256 hash server-side. Each account has at most 20 active API sessions. `expiresAt` is Unix milliseconds. Logout (`POST /api/v1/auth/logout`) revokes that token. Password changes, disabling and deletion revoke account sessions. Basic auth, `X-User`, `soju-username`, IRC connection IDs and static administrator tokens do not authenticate an API request. No authentication cookies are set.

IRC uses the same account identity through SASL PLAIN/SCRAM-SHA-256 or `PASS account:password`. NICK/USER alone cannot enter the default network. Registered nickname ownership is enforced after login as well as on initial connection. Service names and aliases cannot be taken by human or ordinary bot sessions. EXTERNAL is unavailable without a certificate authentication implementation. Passwords need the configured minimum length (12 by default). `VERIFY` rejects unsupported verification codes; no email verification or forgot-password flow exists.

## Resource permissions

- Channel names in paths must be URL encoded, for example `%23general`. Authenticated users may read public channel history. Channels with `s`, `p`, `i` or `k` require active/persistent membership or an explicit founder grant; bans deny ordinary reads. A member can read retained history predating their join. A former member loses restricted reads, unless a separate founder grant remains. Administrators have channel administration access.
- Sending via REST requires authenticated channel membership and respects channel moderation. NUL bytes are rejected. The server derives sender identity and role tags; deprecated `senderNick` input is ignored. `Idempotency-Key` prevents duplicate committed messages for the same account/channel/key. Reusing a key with changed content is rejected. Do not infer guaranteed live delivery from a successful commit.
- Edits require the actual author. Channel redaction permits the author or a channel moderator. Redaction scrubs original/edit variants, multiline payloads and search entries. Ordinary authors cannot edit somebody else's message, including by forging an edit tag.
- `GET /api/v1/dms/{target}/messages` uses account names, not transient nicknames. Only actual account participants may read a pair. Administrators get no DM override. Disabled/deleted peers do not remove a surviving participant’s history. Deleted usernames remain reserved, and retained history stays tied to the deleted account ID. Historical nickname-keyed rows are quarantined pending evidence of ownership. Group DMs and a REST DM-send API do not exist.
- Profiles are readable by authenticated users; writes, read markers, subscriptions and notification preferences are self-only. Channel role mutations require founder/admin authority. Webhook management requires channel management permissions. Hook execution uses its separate channel-scoped token; `/webhooks/{id}/{token}` also validates the ID.
- Both `/admin/*` and `/api/v1/admin/*` require a current administrator account session. Channel deletion requires explicit `purgeMessages: true|false`; it reserves the name and makes retained history admin-only. It does not silently recreate a public channel with old history.

History expires after 90 days. Read queries deny expired records even before asynchronous cleanup runs. HTTP history limits cap at 100; IRC history caps at 500. Profile/account enumeration among logged-in users is intentional; restricted-channel discovery is filtered.

## Browser events

Call `POST /api/v1/auth/events-ticket` using the bearer token. Open `/api/v1/events?ticket=...` within 30 seconds; the ticket is single-use and inherits its parent session's lifetime/revocation. Non-browser clients may use an Authorization header on the handshake. Reusable session tokens in query strings do not authenticate. Same-origin sockets are accepted; additional exact origins require `ALLOWED_ORIGINS`.

The stream currently delivers authorized **channel** events and rechecks current session/channel access for each event. There are no arbitrary subscribe-to-ID messages, DM event subscription API, persistent replay cursor or durable delivery guarantee. Recover message state through authorized history reads. At most five event connections are allowed per account.

## Media, previews and notifications

Uploads accept raw bytes (`X-Filename`) or multipart `file`/`media`, with a 10 MiB total request limit and 100 MiB account quota. Files default to uploader-private. `?channel=%23general` requires channel membership; `?dm=Bob` creates a two-account scope. Channel scopes include an immutable resource generation to prevent attachment inheritance when names are reused. Downloads require Authorization at `/media/{id}` and recheck that scope; ordinary public HTML image tags cannot attach this header, so browser clients need an authenticated fetch/blob URL. Private R2 objects must not be exposed through a public bucket/custom domain. `DELETE /api/v1/media/{id}` is uploader-only. Unowned legacy uploads are unavailable.

Active file formats download as attachments with a sandbox CSP, no-sniff and no-store headers. MIME labels do not establish trusted content; no antivirus, transcoding or automatic attachment-retention workflow exists.

Previews and outgoing hooks default disabled and require exact trusted HTTPS hosts in `EMBED_ALLOWED_HOSTS` / `OUTGOING_WEBHOOK_ALLOWED_HOSTS`. Arbitrary URL fetching is unavailable. Hook execution is limited to 60 requests/10 seconds per hook. WebPush stores private HTTPS subscriptions (20/account); encrypted delivery and VAPID signing are not implemented.

## Responses and limits

Missing/expired session: 401; authenticated but unauthorized: 403 (some private media is deliberately 404). Invalid inputs/domain mutations commonly return 400; oversized bodies return 413; account/API throttles return 429. Errors follow Nitro/H3 envelopes; see OpenAPI for endpoint-specific responses. Protected HTTP responses use `Cache-Control: private, no-store`.

JSON request bodies cap at 64 KiB, ordinary API requests at 300/minute/account, authentication at 50 requests/10 seconds/IP plus durable credential/signup budgets. WebSocket frames cap at 64 KiB, with IRC command and registration limits. These limits are local engineering controls, not a substitute for deployment/load verification. See [verified tests and remaining limits](../security/security-test-results.md).

Online IRC channel renames transfer ACLs, role assignments, message/edit state and scoped media, reject existing destinations, and cap snapshots at 5,000 rows/table and 4 MiB. Partial post-commit failures can require operator reconciliation of the persisted rename journal; there is no automatic distributed transaction/recovery guarantee.

Secure IRC delivery rechecks current credentials and channel authorization per output batch. Pending output is bounded at 4,096 frames/8 MiB per socket and 16 MiB across the coordinator; excessive backlog closes the affected connection. This bounds application queues, while actual slow-consumer behavior still requires Cloudflare load testing.
