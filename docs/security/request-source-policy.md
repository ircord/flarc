# Request source and hostmask bans

FlaRC derives the network address from the configured ingress. Account identity always comes from authentication.

- The local Node/Miniflare launcher strips caller-supplied forwarding, Cloudflare and internal ingress headers, then adds the actual socket peer and a per-process ingress secret. The Worker verifies that secret before accepting the address. Its separately authenticated TCP bridge can supply the original TCP peer.
- Generated native Cloudflare deployments bind `REQUEST_SOURCE=cloudflare` and accept a valid numeric `CF-Connecting-IP`. Missing or malformed addresses fail source validation. This trusts the Cloudflare ingress and same-zone Workers in the operator's deployment boundary. Cloudflare documents different address behavior for Worker subrequests; a source address is not an immutable account identity. See [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
- Direct development/test runtimes without either configuration ignore all caller-supplied source headers and use one loopback source (`127.0.0.1`). This supports local testing without pretending an unauthenticated forwarded header identifies a peer. Public deployments must use a configured ingress. `Request.cf` is not used as proof of production placement because Miniflare can populate it; see [Miniflare configuration](https://developers.cloudflare.com/workers/testing/miniflare/get-started/).

IPv4-mapped IPv6 addresses normalize to IPv4; ordinary IPv6 addresses use a canonical numeric spelling. Hostnames, address lists, ports, zone identifiers and ambiguous IPv4 forms are rejected. The local Kubernetes path observes the immediate socket peer; it does not automatically trust an external reverse proxy's forwarded client address.

REST and event sockets use `accountName!accountName@sourceAddress` for hostmask matching. IRC uses its actual authenticated session's nickname, username and trusted address. Account-ID bans remain the stable cross-transport control when a rule must follow an account regardless of nicknames or network paths. Removing a hostmask ban restores access permitted by otherwise-valid credentials; it does not undo password-reset or account-disable session revocation.

Tests distinguish pure extraction checks, real local launcher/socket checks, and authenticated REST/IRC/event enforcement. No local test is reported as a production Cloudflare network verification. The source extraction and new REST enforcement require the post-snapshot-18 build.
