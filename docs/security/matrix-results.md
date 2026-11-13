# FlaRC authorization matrix and feature expansion

**336 PASS, 3 NOT APPLICABLE, 0 FAIL, 0 NOT IMPLEMENTED and 0 BLOCKED across all 339 scenario IDs. All 44 formerly incomplete scenarios now have passing evidence within their declared scope.**

| Verification | Pass | Fail | Skip | XFAIL | XPASS | Deselected | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| One unfiltered application run, 89 files | 632 | 0 | 0 | 0 | 0 | 0 | 0 |
| Unchanged IRC conformance, 538 collected / 491 selected | 470 | 0 | 18 | 0 | 3 | 47 | 0 |

Application duration: 187.06 seconds; IRC conformance: 166.90 seconds, with 16 upstream warnings. No focused or historical run is added to these totals. Typecheck, Biome (372 files) and diff checks passed. The actual local container smoke, schema and restart checks passed.

The final test source is snapshot34; its 243 runtime/build inputs match frozen32 exactly. All 490 frozen source/test/config inputs and 139 module files retained their hashes. The separate test-run configuration is recorded. Bundle SHA256: `85e3f2460200b0d7c2f8848fe5e9f7d210a9a4c73a9b7d3f2a0880b118d86006`.

[Machine matrix](matrix-coverage.json), [route/command report](matrix-route-command-coverage.json), [scenario catalog](../../tests/security/matrix-scenarios.json), [exact application execution](matrix-evidence/current-execution-34.json), [matched scenario assertions](matrix-evidence/current-evidence-34.json), [operation-specific proof](matrix-evidence/operation-evidence-34.json), [unchanged conformance](matrix-evidence/conformance-35.json), [container proof](matrix-evidence/container32.json), and [all 44 transitions and reconciliation](matrix-evidence/reconciliation-34.json).

Verification was performed locally before committing this checkpoint. Its test results do not claim a registry publication, GitHub release or Kubernetes deployment.

## Evidence and scope

The audit runs actual independent accounts and credentials through the Nitro application in local workerd, with persisted Durable Object SQLite and local/R2 storage. Tests cover IRC commands/services, REST aliases, WebSocket ticket redemption, live delivery and authorized replay. Each matrix row states its tested scope and required assertions; missing or unsupported behavior is not counted as a passing feature.

The final container is built with Bun and runs the prebuilt worker through Node/Miniflare. Its smoke proof covers real REST signup/login, secret-channel isolation, TCP IRC, WebSocket events, stopped-volume schema/model comparison and persisted state after restarting the same volume. These are local container results; Kubernetes manifests and GitHub workflows are authored but have not been applied or run remotely.

## Changes completed

- Added scoped and individually revocable credentials and sessions, administrator scope checks, global bans, cookie/CSRF enforcement and default-off administrative/service auditing.
- Added shared channel operations for REST and IRC, atomic initial privacy/founder creation, invitation revocation, generation-safe archive/re-registration, bulk redaction and bounded channel role inheritance.
- Added immutable-account DM conversations, selectors, sending/editing/redaction, history/read/unread/attachment enumeration, offline persistence, metadata revisions/private fields and cross-transport events.
- Added durable account-bound event cursors, replay/bootstrap recovery, explicit resync, idempotent client operations, event shards, subscription revocation and bounded reader flow control.
- Added private media lifecycle recovery and quota reconciliation, encrypted WebPush delivery/preferences/revocation with bounded provider retries, editable outbound allowlists with resolved-address enforcement in the local launcher, and strict SQLite migration/schema verification.
- Added a Bun container build, persistent single-replica Kubernetes example and version-tag release gates. Ordinary branch pushes trigger nothing; pull requests run static checks; version tags run application/matrix and unchanged irctest plus image smoke checks before publishing the already-built image.

## Defects fixed during integration

The final regression mapping identifies each exact passing test. Historical failures are retained rather than replaced by final results.

- Event authorization treated ordinary channel revision changes and real database failures as permanent denial, advancing replay past authorized messages. The fix takes a coherent permission snapshot, distinguishes explicit denials from operational errors and preserves the recovery cursor when an edge must close.
- Concurrent REST channel delivery could reorder messages; a lost RPC acknowledgement could duplicate delivery or prevent hibernation. Ordered persisted delivery intents, generation fences, durable sequence receipts and explicit RPC resource disposal preserve delivery ordering and recovery.
- Channel role operations before first JOIN could bind the wrong initial channel identity; rejected requests could still mutate metadata. Object-address identity checks and authorization before mutation prevent the rebind and rejected-write side effects.
- Archived channel history used the wrong generation after retirement. Explicit bounded archive reads preserve the retired generation without leaking it into a newly registered room.
- Expected DM authorization failures surfaced as internal IRC errors. Safe protocol-specific denials now preserve message state and recipient isolation.
- Administrative guest metadata did not honor the explicit open-network behavior, and disabled profile reads lost revision state. Corrected account/guest resolution and persistent revision reads retain authorization and metadata consistency.
- IRC flow-control challenges could split protocol response batches; PART/KICK comment behavior and per-device cleanup needed correction. Final conformance uses the unchanged upstream selection.

Earlier F01–F43 and matrix fixes are preserved in the historical findings and reconciliation records, including identity spoofing, cross-account access, invite/role escalation, stale access, attachment permissions, multi-target flood budgets, UTF-8 limits and sensitive close-reason logging.

## Route and command coverage

| Surface | Discovered | Positive proof | Negative or protected filtering proof |
| --- | ---: | ---: | ---: |
| Concrete method/protocol entry shapes | 205 | 205 | 198 |
| IRC roots in application acceptance | 79 | 30 | 74 |

Every concrete route has an exact operation-specific test identity and frozen source/helper hash matched to the final passing run. The seven public read endpoints have explicit denial-not-applicable dispositions. Native IRC upgrades are tested as GET upgrades plus protected command denials; this does not imply every HTTP method is supported. The 207-row source ledger includes two administrative catchall containers, separately classified as delegation rather than successful features. All 48 logical administrative branches have independent mappings for both actual prefixes.

Application evidence exercises 78 of 79 IRC roots; 26 have both positive and negative evidence. The remaining PONG root has a separate passing unchanged conformance proof: `LabeledResponsesTestCase::testEmptyBatchForNoResponse` requires one ACK for the actual labeled inbound PONG. Protocol control evidence is distinct from multi-user authorization proof. Subcommand inventory alone is not behavioral coverage.

Negative proof includes real cross-account substitutions, matched IRC/REST forbidden edits, revoked credentials and permissions, unchanged SQLite state, unrelated resource controls and barrier-bounded event silence. Successful operations also prove canonical identities, correct recipients, persisted state and recreation where applicable. Read-only/system-invariant dimensions have narrowly documented applicability decisions; missing features do not earn PASS.

## Execution history and reproducibility

Snapshot17's 292/44/3 matrix and 510-test result are preserved in [the historical report](matrix-evidence/matrix-results-17.md). Full29, full30 and full31 remain failed historical executions. In particular, full31's missing private event led to the deterministic authorization-snapshot and operational-failure regressions now passing in the final run.

Two conformance34 executions overlapped after a stale Orca dispatch message was routed to a later worker assignment. They shared output paths; the earlier run had one connection-refused startup failure before account registration, and the later run had no failures. [Those artifacts remain diagnostic](matrix-evidence/conformance34-overlap-diagnostic.json), not the accepted final conformance record. The startup failure's exact cause is unestablished. Root then ran conformance35 alone with unique paths: all selected identities matched the inventory, and upstream/controller/harness/module hashes were unchanged. No test, marker, timeout, skip or expected-failure change was used.

Normal application reproduction: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, then `bun run test`. The recorded immutable-bundle command and configuration are in the execution manifest; the exact unchanged upstream command, marker and pinned revision are in the conformance manifest. Data-only matrix regeneration uses `scripts/security-matrix-report.ts` with the stored execution and evidence files; operation and count reconciliation inputs and helper sources are retained in the reconciliation record. It does not require rerunning tests.

## Explicit limits and design decisions

- USER-008 (email/recovery credentials), DM-023 (group DMs) and MEDIA-007 (signed media links) remain unsupported conditional capabilities and are classified NOT APPLICABLE, not PASS.
- Private DM access is participant-only; network administrator status does not confer access. Explicit `private:` metadata is owner-only. Existing ordinary custom IRC metadata remains public.
- Audit logging defaults off and is best-effort when enabled. Audit storage failure is not a distributed rollback guarantee. Review audit retention and operational policy before enabling it.
- Bootstrap and replay recheck current authority; they do not promise an atomic snapshot spanning independent Durable Objects. Cross-object revocation is enforced at the documented authorization boundaries.
- Per-channel ordered delivery can wait behind a permanently failing authority dependency. Actual alarms retry at a bounded pace; there is no lifetime cap for this durable channel work. WebPush delivery separately stops at eight provider attempts.
- Media reconciliation is eventual and bounded per alarm. A recovering provider can complete an earlier write; subsequent reconciliation removes an unpublished object. This is not a universal provider deletion deadline or physical storage ceiling.
- Output limits and acknowledged-reader tests prove the application's bounded queues and actual local socket behavior. They do not establish Cloudflare's native/provider memory ceiling or every production network failure mode.
- Schema comparison covers initialized/migrated workerd databases and the actual local container volume. No production Cloudflare deployment was inspected. Migration resource bounds and backups remain an operator decision.
- The Kubernetes example uses one replica, Recreate and persistent storage; it is not a multi-pod shared-SQLite design. No cluster apply, registry publication or release is claimed by this verification.
