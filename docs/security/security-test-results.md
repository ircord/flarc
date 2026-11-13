# Security test results

> Historical initial-audit record. Current feature-expansion results, superseded limitations, exact test totals and remaining policies are in [the final matrix report](matrix-results.md).

Audit date: 2026-11-11. Original repository revision: `a9db5e6760603453bed682509b90eff457ed8f23`. Results below concern the local hardened source tree. No production deployment or production-user testing occurred.

## Baseline and test integrity

Initial existing Vitest run: **11 files, 50 passed**; typecheck passed. The original harness reused an existing `.output` bundle, so that initial run alone cannot establish source/build consistency. The replacement harness always builds and runs an immutable temporary bundle.

A fresh independent irctest run against a **separate pristine Git snapshot**, using its original dependencies, produced **468 passed, 2 failed, 18 skipped, 3 xpassed** out of 491 selected tests (16 upstream warnings). Failures were `ChathistoryTestCase::testChathistoryEventPlayback[LATEST]` and `ZncPlaybackTestCase::testZncPlayback`. Interrupted attempts involving concurrent bundle rebuilds were excluded. The fresh evidence did not reproduce the reported all-green starting baseline.

The independent suite is unchanged at revision `7d5d761b7b67f9031daf7784e743d630def22a96`. The local controller/launcher was adapted to real authenticated administrator provisioning and frozen bundles. Guest-protocol tests explicitly use `REQUIRE_ACCOUNTS=0`, `AUTO_REGISTER_CHANNELS=0` and open signup. These are isolated protocol fixtures, not deployment defaults. Registered-only security tests run separately with the secure defaults and independent account credentials.

Existing application tests were updated to create/authenticate real users and use their own sessions. Insecure anonymous-success assertions were replaced with authenticated success plus denial coverage. The independent IRC assertions were not edited, skipped or weakened. A race in the original ACCEPT test was fixed by waiting for the list update before another connection sent its DM.

## Final commands and totals

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Passed; Bun lockfile resolves without changes |
| `bun run test` | **15 files, 106 passed**, 0 failed/skipped/xfail/deselected |
| `bun run test:security` | **4 files, 56 passed**, 0 failed/skipped/xfail/deselected; included in the 106 total |
| `bash scripts/run-irctest.sh -n 8 -rA` | **470 passed, 18 skipped, 3 xpassed**, 0 failed/xfail/errors; 491 selected, 47 deselected from 538 collected; 16 upstream warnings |
| `bun run typecheck` | Passed with TypeScript 5.9.3 |
| `bun run lint` | Biome passed: 184 files, no fixes required |
| `bun run generate:client` | Passed; generated API types refreshed |
| `bun run build` | Passed through test setup and conformance runner; Nitro Cloudflare module production build |
| `bunx wrangler deploy --dry-run --config .output/server/wrangler.json --outdir /tmp/flarc-verified-worker` | Passed; Worker packaging includes SessionDO, ChannelDO, AccountsDO and assets; **not deployed** |
| `bun audit --json` | `{}`: no advisories reported by the queried registry at verification time |
| `git diff --check` | Passed |

The final independent sweep took 160.71 seconds. Intermediate sweeps are not substituted for these final totals. An intermediate DM history/playback failure exposed separately sampled live/storage timestamps; delivery now uses storage-returned timestamps and the final sweep passes both paths.

The 18 independent skips are: 2 ASCII-casemapping/controller choices, 6 arbitrary-client-tag policy cases, 2 draft/reply policy cases, 2 unsupported faketime cases, 4 inconsistent optional WHO variants, and 2 optional non-UTF8-message cases. The 3 non-strict unexpected passes are the suite's NUL-in-password cases. They remain reported as xpasses. No new conformance skip was introduced.

Dependencies were updated and package management moved to Bun. TypeScript is held on 5.9 because the current SDK generator declares a TypeScript 5 peer dependency and fails against TypeScript 7's removed compiler API. Other requested platform dependencies remain in use. A zero-advisory result is not a security certification.

## New coverage

The four new security files add **56 tests** to the existing 50:

- [boundaries.test.ts](../../tests/security/boundaries.test.ts): independent Alice/Bob/Charlie/admin accounts, separate device nicknames, an explicitly assigned bot, pre-auth and registered-but-unauthenticated sockets, current/expired/revoked/disabled identities, and channel founder/operator/halfop/voice roles. Tests cover forged roles/headers/senders, admin isolation, reserved service names, offline registered-nick takeover, all `s/p/i/k` visibility variants, private history/discovery/search/unread, account/DM ownership, edits/redactions, private media, event tickets/replay and revocation, scoped bots/services, role ranks and multi-device revocation, invitation theft, reauthentication, idempotent retries, simultaneous signup, malformed admin deletion, archive privacy, bounded frames/command floods, and channel renames. Passive private IRC delivery is denied while banned and resumes after unban.
- [storage.test.ts](../../tests/security/storage.test.ts): three tests using actual persisted workerd SQLite, direct inspection only while the runtime is stopped, and a separately recreated runtime. Verifies credentials/session hashes, profiles, account settings, channel metadata/topic/membership/roles, real FK rejection/cascade, messages/edits/redactions/FTS, read markers, notification preferences, push subscriptions, private SQLite-backed media, deletion and expiry. A real SQL trigger aborts a password reset and preserves old credentials/session state; another aborts destination rename INSERTs and proves rollback plus source recovery.
- [crypto-and-egress.test.ts](../../tests/security/crypto-and-egress.test.ts): RFC 7677 SCRAM-SHA-256 exchange using independent Node PBKDF2, password/salt/verifier behavior, malformed SCRAM, ten rejected destination forms, private redirect refusal, streamed byte bounds and removal of executable oEmbed HTML. HTTP response bodies are controlled test doubles; this does not test real DNS rebinding or production egress.
- [api-contract.test.ts](../../tests/security/api-contract.test.ts): every client file route/method including aliases appears in OpenAPI; session/ticket/login/registration security contracts and exported NUL validation match the implementation.

Cross-transport tests create through IRC and inspect through REST; create/edit through REST and observe IRC/events; then repeat unauthorized actions using unrelated account credentials. Nested DM edits redact as one chain. A surviving participant retains DM history when the peer is disabled/deleted. Dangerous multipart filename extensions still upload and download through an independent authenticated request using a safe generated ID.

## What these results establish

Authentication and authorization denials execute in a Cloudflare-compatible workerd runtime, rather than only mocked repositories. Persistence tests inspect real bytes/rows, restart the runtime, verify subsequent requests, delete where authorized, and inspect constraints and rollback. Channel rename tests exercise authorization, collision denial, copied roles/history/media, old-name reuse isolation and real destination write failure. The current account/version and channel read rules are checked again for secure IRC delivery in bounded ordered batches, rather than relying solely on successful revocation callbacks.

Expiry tests use persisted past timestamps to verify that expired sessions and messages cannot be read, searched or counted. They do not advance a live deployment through 90 actual days. Alarm deletion/rescheduling was code-reviewed; a deployed alarm/faketime test and physical long-term retention measurement remain outstanding.

## Not established by local verification

- Real Cloudflare hibernation, attachment reactivation and upgrading live pre-hardening sockets. Code rejects legacy registered attachments without a credential version; production reconstruction still needs a deployment test.
- Actual edge IP/Origin/header guarantees, public-vs-private R2 bucket configuration, R2 upload/delete faults and orphan cleanup. Persistence roundtrips use the SQLite fallback; R2 production behavior is not inferred from them.
- Sustained distributed connection/auth/channel-creation abuse, per-plan CPU/memory/cost, large network-wide search cost, network-level slow-consumer pressure or delivery guarantees beyond bounded application queues.
- DNS rebinding/private-address guarantees for operator-allowlisted providers, or an external egress firewall/policy.
- All possible distributed timeout-after-commit cases. Rename leaves a persisted protected transition after uncertain post-commit failure; automatic recovery/outboxes are not implemented.
- A full ASVS certification, exhaustive protocol/spec coverage, every historical database shape, full password normalization/work-factor migration, encrypted WebPush delivery, VAPID signing, email verification or password recovery.

See [findings.md](findings.md) for the remaining P2/P3 work, exact migration precautions and the distinction between implemented fixes and deployment verification.

## Independent follow-up test priorities

A separate reviewer should challenge the implemented policies and the findings using new test files, not accept this report as an oracle. Highest-value extensions are real Cloudflare hibernation/legacy attachment upgrades, revocation during passive delivery, concurrent bans/role changes/reauthentication, scheduled cleanup after no-op alarms, timeout-after-commit retries, rename recovery after destination commit, and R2 compensation failures. Exercise legitimate access alongside unrelated-account denial and inspect real persistent state. Keep independent irctest assertions intact and report skips/deselections explicitly.

Create follow-up worktrees from the audit commit so they include the fixes. Coordinate shared core/harness edits and initial builds. Running tests use immutable snapshots, but two simultaneous build-and-snapshot startup phases can still contend for `.output`.
