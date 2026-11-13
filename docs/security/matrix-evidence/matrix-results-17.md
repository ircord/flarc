# Final local security matrix — snapshot 17

**292 PASS, 44 NOT IMPLEMENTED, 3 NOT APPLICABLE, 0 FAIL, 0 BLOCKED: all 339 scenario IDs retained.** The existing local surfaces have completed the reviewed implementation and test phase; overall audit acceptance remains incomplete because the remaining capabilities, policy decisions and platform guarantees below are unresolved. PASS means the exact reviewed scope, not an unbounded guarantee.

One final unfiltered application run passed **510/510 tests in 62 files**, with **0 fail/skip/todo/xfail/xpass/deselected**. All prior 503 identities and seven added cases are present and passed; focused/historical runs are not added to that total. Global typecheck, lint and diff checks each exited 0. All 259 source/test/config inputs (including untracked files), 85 frozen module files and 166 build-source matches stayed unchanged. The only documentation inventory addition was the separately assigned conformance 17 artifact; existing evidence files stayed unchanged.

Frozen 17 SHA256: `e3832d4b48c1e9678a961fed5514922682b86c1e004f46b8ee9ba0cd6f031f76`. [Portable exact execution](matrix-evidence/current-execution-17.json) retains every file/fullName and all input/module/build-source hashes. **Changes remain uncommitted; all runtime evidence is local Miniflare/workerd/SQLite/R2, with no deployment, commit, push or publishing claim.**

Independent unchanged-selection [conformance 17](matrix-evidence/conformance-17.json): **470 pass, 18 skip, 3 XPASS, 47 deselected, 0 fail, 0 xfail, 0 error, 16 warnings; 538 collected/491 selected**. Its open-network fixture is distinct from account-required security acceptance, and its skips/XPASS are not application passes.

## Fixed defects and reached evidence

| Defect | Reached before-fix evidence | Current 510 after-fix proof |
| --- | --- | --- |
| UTF-8 octet limits counted UTF-16 units | Frozen 14 PONG accepted both 510-byte and 512-byte multibyte base lines; expected 417 timed out. Later tag/frame phases in that old invocation were unreached. | Exact 510/512-byte and 4096/4098-byte tag boundaries, 64 KiB frame boundary, peer/state isolation and recreation pass. |
| Raw client close reason entered logs | Revised frozen 14 probe reached actual secret-exclusion assertion: a synthetic stored subscription auth value appeared in genuine runtime close log. The earlier close-timeout-only probe remains explicitly unproved. | Actual clean close, real log marker, exclusion of passwords/tokens/PBKDF2/SCRAM/subscription material and bounded 4096-byte log delta pass. |
| Missing reciprocal WebSocket close | Original full 15 event and log cases timed out waiting for actual close. | Explicit close reply completes genuine peer handshake; exact 1000 code/reason, event capacity release/replacement and recreation pass. |
| Per-socket budget bypass across devices/reconnect | Frozen 15 both competing 6-target batches completed after 140 creations, plus five reconnect creations; over-budget PART performed all 3 operations. | One durable account 150-target/10 second budget admits exactly one competing batch(count 146), denies whole reconnect batch without partial state/events, survives recreation, and admits 3 targets only after real expiry. |
| Disconnect removed another nickname's memberships | Frozen 16 cleanup used account-wide ChannelDO.part deletion; surviving same-account device got 442 on JOIN 0. | Session-only cleanup retains canonical surviving-device NOTICE, then actual 3 PART JOIN 0 cleanup; exact last-device/monitor/revocation controls pass. |
| Raw-line JOIN/PART fanout amplification | Preserved frozen 13 failures observed 160 JOINs/159 persistent creations from 8 lines and 3 over-budget PARTs. | Whole-batch target reservation preserves 120 affordable creations, zero denied PARTs, labeled batches, empty entries and legitimate cleanup. |
| Ignored attach_files permission | Preserved four frozen 12 attachment failures in reconciliation 13. | Additive scoped uploads, no membership/ban/quiet/mute/read-only bypass, read/write separation and exact SQLite/R2 quota/metadata/chunk/object effects pass; successful pending-R2 rollback now also survives recreation. |

The precise historical identities, original failure/diagnostic references, source fixes and current exact test links are in [reconciliation 17](matrix-evidence/reconciliation-17.json). Original full 15 remains **FAILED 500/503**; intermediate 16 and fixture diagnostics remain preserved, not relabeled as passing evidence. Earlier fixes **F01–F43** remain referenced through [findings](findings.md), and the invitation/role/admin/DM/atomic-storage/cache/media repairs retain their original before/after records through reconciliation 09/12/13/14. No historical baseline is silently replaced by the current result.

## Scope resolved since 14

All 59 previously incomplete IDs have an individual old/new status, exact execution references and remaining reason in `priorIncompleteScenarioReview`. **15 transition to PASS:** USER-020, API-017, API-018, PUSH-005, PUSH-012, DB-026, ABUSE-001, ABUSE-002, ABUSE-004, ABUSE-005, ABUSE-006, ABUSE-009, ABUSE-010, ABUSE-011, ABUSE-018.

New proofs include independent account/recipient identity, exact negative HTTP/IRC behavior, live authorized/unrelated event windows, unchanged denied state, real SQLite reconstruction, retained channel and peer-DM history after deletion, isolated ChannelDO identity, management/log confidentiality and all existing application output-queue branches. OpenAPI/route inventory guards remain tooling evidence; actual requests with created IDs/capabilities supply operation coverage. Local Drizzle comparisons explicitly retain legacy nullable-primary-key differences and do not claim deployed equivalence.

| Surface | Discovered | Executed | Positive | Negative | Both |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unique concrete method/protocol-entry shapes | 144 | 144 | 144 | 135 | 135 |
| IRC roots | 78 | 77 | 29 | 73 | 25 |

Application command coverage is 77 of 78 roots. PONG is separately proved by the passed conformance case `LabeledResponsesTestCase::testEmptyBatchForNoResponse`, which sends labeled inbound PONG and requires exactly one matching ACK; it is not an application multi-user authorization/state proof. QUIT and configured WEBIRC positive mappings use explicit open-network application protocol cases and retain that fixture limitation.

Route accounting starts with 66 Nitro files and 40 logical admin branches, expands the latter into 80 actual prefixes, and normalizes method-specific parameter shapes. 62 explicit-method files plus 80 admin aliases plus 2 public GET upgrade/discovery entries give 144 concrete shapes; the two delegated catchall containers are separate, yielding 146 inventory entries without counting catchalls as successful features. Dynamic resource paths cite the actual executed source expression and created-resource identity; no helper trace, UUID or token URL is guessed. Unknown administrator GET 404 is a guarded negative control, never a missing-feature positive. Claim rows are not unique requests.

## Remaining work and decisions

The 44 remaining NOT IMPLEMENTED IDs comprise 38 absent/on-hold capabilities, 2 policy/design decisions and 4 platform/deployment limits, classified individually; **no genuinely missing test for an existing defined local surface was found in this 59-ID review**. This does not imply exhaustive security proof or authorize new features.

- **On hold:** targeted administrative bearer revocation, global bans/auditing/scoped administrators/bot credential facility; structured profile event producer; REST JOIN/create parity and archived-name re-registration; role inheritance; unsupported DM lookup/UUID/conversation/subscription/unread/attachment-enumeration/offline/REST-producer/legacy surfaces; bulk API; cookie-auth mutations; explicit topic subscriptions, replay/cursors/client mutations, multi-SessionDO sharding; service audit records/private upload enumeration; encrypted WebPush dispatch/provider-expiry/delivery/retry guarantees. Existing push storage/preferences/management alone do not prove delivery.
- **Policy/design:** USER-018 arbitrary metadata key visibility and GET/SUB/SYNC/admin-publication audiences remain unresolved. DB-016 successful rollback is verified, but automatic/discoverable crash/provider-delete recovery and cross-store crash expectations remain undefined; last ChannelDO check and AccountsDO commit are not atomically revoked across objects.
- **Platform/deployment:** WS-021/ABUSE-012 prove application 8 MiB/4096/16 MiB branches, not native/provider slow-reader buffers or a hard memory ceiling. DB-022 compares local initialized models with explicit legacy differences, not deployed schema equivalence. ABUSE-017 now proves actual timeout/streaming/cancel/abort, but DNS rebinding/resolved provider-IP enforcement and deployed network/provider cleanup remain unproved.
- **Selected for human review:** [additive attachment policy](../api/README.md) retains normal member uploads, requires voice/op or attach_files under +m, grants no unrelated powers and separates read authority; [durable account target policy](resource-limit-policy.md) uses 150 requested JOIN/PART targets per 10 seconds across devices/reconnect/recreation, with whole-batch reservation and JOIN 0 cleanup exemption. Neither is a global channel-capacity, retention/reclamation, automatic recovery or provider-buffer guarantee.

[Complete machine matrix](matrix-coverage.json), [actual route/command coverage](matrix-route-command-coverage.json), [matched claims](matrix-evidence/current-evidence-17.json), [exact execution](matrix-evidence/current-execution-17.json), [all 339 IDs/59 reviews/fixes/remaining work](matrix-evidence/reconciliation-17.json).

Reproduce data reconciliation without tests/builds or original raw temporary files, using the matching source tree and frozen 17 graph:

```sh
python3 - <<'PYREPLAY'
import json
from pathlib import Path
record = json.loads(Path("docs/security/matrix-evidence/reconciliation-17.json").read_text())
Path("/tmp/flarc-final17-replay.py").write_text(record["regeneration"]["helperSource"])
PYREPLAY
python3 /tmp/flarc-final17-replay.py --bundle /tmp/flarc-matrix-run_01d0e4aeb274/server-17/index.mjs
```

The matching bundle graph may be copied elsewhere. Regeneration stages reporter inventory outside preserved evidence and uses only portable repository execution/mapping/reconciliation data; it does not execute Vitest or irctest.
