# FlaRC threat model

Current implementation and verification scope: [authorization matrix results](matrix-results.md), [event/recovery policy](event-stream-topology.md), [request-source policy](request-source-policy.md), and [deployment limits](../../deploy/README.md).

Audit started 2026-11-11 against `a9db5e6760603453bed682509b90eff457ed8f23`. This is an engineering audit, not a certification.

## Assets and adversaries

Protect credentials, account identity, administrator privileges, channel access lists, private messages and media, subscriptions, history integrity, and the availability and cost of the Cloudflare deployment. Adversaries include unauthenticated internet clients, registered unrelated accounts, banned or removed members, compromised ordinary bots, malicious webhook callers, and clients replaying stale credentials. Worker deployment credentials and the Cloudflare control plane remain trusted.

## Trust boundaries

1. Internet → Nitro, IRC WebSocket and optional local TCP bridge. Every field and header is untrusted, except Cloudflare's authenticated edge IP in a real deployment.
2. Nitro → AccountsDO: resolve an opaque session to an account; never trust a claimed nickname, role, Basic header or gateway username.
3. Worker/SessionDO → ChannelDO: the channel owns membership, persisted access assignments, history and moderation. Client domain facades resolve account sessions again. Internal RPC is available only through Worker bindings, not an internet RPC endpoint.
4. AccountsDO → SQLite/R2: media bytes are separate from access metadata. Download authorization precedes R2 access. Unowned legacy media is quarantined.
5. Server → outbound HTTP: default disabled; explicit HTTPS hostname allowlists; redirects validated or rejected; bounded reads/timeouts. Operators must allow only trusted provider hostnames and maintain egress policy.

## Access policy

FlaRC requires registered authenticated accounts by default. Signup defaults closed; open and invitation policies are explicit deployment settings. Administrative APIs require an authenticated account with an administrator role. A bootstrap secret only provisions a reserved configured administrator account; it is not an API bearer credential.

Public channel history is readable by authenticated accounts. Secret/private/invite-only/keyed history and related metadata require active/persistent membership or persisted founder access; network administrators can perform channel administration. Bans deny ordinary history access. Authorized members can read the retained history predating their join. Leaving/kicking removes membership; persistent founder access is an explicit independent grant. DMs are keyed by immutable account IDs and readable only by the two participants, including when the caller is an administrator. No group DM feature exists.

Media is private to its uploader by default. An upload can explicitly target a channel or DM; downloads recheck that scope. Arbitrary knowledge of a URL never authorizes a download. Legacy nickname-keyed DM records and unowned media remain stored without being assigned to guessed owners.

Channel media scopes include an immutable channel generation, so reusing a name cannot inherit attachments. Channel deletion archives and reserves its name; a successful rename clears the old generation only after its snapshot commits. Online renames reject existing destinations and use persisted transition state.

## Browser sessions

REST uses Authorization bearer tokens; no authentication cookies are set, so browser ambient-cookie CSRF is not used. Browser event sockets use 30-second single-use tickets obtained over an authenticated POST. Reusable credentials are not accepted in URL queries. Origin is checked for WebSocket connections; additional browser client origins must be explicitly configured. Event attachments retain an internal hashed session reference, not the reusable token. Legacy registered IRC attachments without a credential version are rejected on restore/input/output and must authenticate afresh after upgrade.

## Consistency and verification limits

SQLite transactions are local to one Durable Object. Cross-object requests and R2 writes are not distributed transactions. Authority must recheck current account/channel state, retry writes idempotently where supported, and reconcile missing or failed deliveries. Local workerd tests establish runtime behavior; deployed hibernation, edge IP handling, slow-client pressure and Cloudflare failures require deployment testing.

## Scope and release interpretation

All file routes, IRC dispatch/service command families, bridge scripts, schemas and credential/session/channel/DM/media paths were inventoried. The audit uses OWASP categories to organize adversarial checks; it is not a claim of full ASVS certification. [Findings](findings.md) list fixed defects and remaining work, including deployment, legacy-data and partial-failure limits.

## References

- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x00-header/): object, authentication, property, resource-consumption and SSRF threats.
- [OWASP ASVS 5.0](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en): authentication, session lifecycle, authorization, validation, storage and communications controls.
- [RFC 7677 SCRAM-SHA-256](https://www.rfc-editor.org/rfc/rfc7677) and [RFC 5802](https://www.rfc-editor.org/rfc/rfc5802): cryptographic protocol checks.
