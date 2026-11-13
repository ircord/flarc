# Security matrix worker evidence

Use [`schema.json`](schema.json) for version 2 worker evidence. Send one compact JSON evidence file per slice with `--worker-evidence <file>`; the reporter accepts that flag more than once and merges rows deterministically. Do not paste generated report or inventory rows into evidence.

For executable evidence, create an execution manifest next to the Vitest JSON:

```json
{
  "version": 1,
  "id": "auth-postfix-02",
  "bundleSha256": "<sha256 of the frozen bundle actually tested>",
  "vitestJson": "./vitest-results.json"
}
```

Pass each manifest with `--execution <manifest.json>` and the current source bundle with `--bundle <bundle>`. Evidence rows must name the manifest `id`, exact bundle hash, test file and full test title. Only a matching current-bundle test can support behavior status. Older-bundle failures remain in `evidenceHistory`; they do not override the selected final source result. Naked Vitest JSON and legacy version 1 worker files are provisional diagnostics only.

Each test row declares all six dimensions as either `required` or `not-applicable` with a reason, and lists the dimensions actually asserted. PASS requires a passed exact test match whose evidence covers every required dimension. A skipped/todo test cannot establish PASS. A negative assertion such as a missing-feature 404 is ordinary test evidence and cannot justify an unsupported-feature disposition.

For route behavior, include `routeBehavior` rows with the exact discovered source template in `route`, its HTTP method, and the concrete request URL path (including its query when sent) in `alias`. `alias` is checked against that source template and its allowed alias prefixes; matching uses the URL path only, so query parameters cannot substitute for route parameters. Dynamic path segments are decoded one segment at a time, while malformed escapes, encoded separators, backslashes and dot segments are rejected. Admin route templates are relative to the shared handler, and `alias` must use the current `/admin` or legacy `/api/v1/admin` prefix. Keep `requestPath` only for compatibility with existing evidence that records a discovered template in `alias`; when present with a template alias, `requestPath` is the concrete request URL and is retained as such in generated route coverage. A concrete `alias` may also include `requestPath` only when the full request strings (including query) are identical. Route coverage preserves both the exact source template and concrete request path, and records positive feature responses, exercised secure denials, and missing-feature 404s as distinct outcomes. For IRC, include `commandBehavior` with the actual command and result. These outcomes remain separate from source discovery. Dispositions use `kind: "disposition"`, `outcome: "BLOCKED" | "NOT APPLICABLE" | "NOT IMPLEMENTED"`, and a concrete rationale/basis; they do not require a fake passing test.

Evidence for the same scenario may come from multiple independent tests. The reporter merges declarations dimension by dimension: `required` wins if any current executed claim requires that dimension; it is not made not-applicable by another claim. Only dimensions listed as asserted by matched current-bundle tests that actually ran count toward coverage. A worker's `PASS` label alone never establishes scenario PASS; the exact test must pass, and the combined asserted dimensions must cover every merged required dimension.

Run, for example:

```sh
bun scripts/security-matrix-report.ts \
  --bundle /tmp/frozen/server/index.mjs \
  --execution /tmp/frozen/run.json \
  --worker-evidence docs/security/matrix-evidence/dispositions.json \
  --worker-evidence /tmp/identity-evidence.json
```
