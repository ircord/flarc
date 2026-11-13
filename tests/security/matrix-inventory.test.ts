import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateReports } from "../../scripts/security-matrix-report";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(tests: any[], entries: any[], bundleText = "final frozen source") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "flarc-matrix-integrity-"));
  temporary.push(dir);
  const bundle = path.join(dir, "bundle.mjs");
  const hash = createHash("sha256").update(bundleText).digest("hex");
  writeFileSync(bundle, bundleText);
  const vitestPath = path.join(dir, "vitest.json");
  const manifestPath = path.join(dir, "execution.json");
  const evidencePath = path.join(dir, "worker-evidence.json");
  writeFileSync(
    vitestPath,
    JSON.stringify({
      numPendingTests: 1,
      numTodoTests: 1,
      testResults: [
        { name: path.resolve("tests/security/boundaries.test.ts"), assertionResults: tests },
      ],
    }),
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 1,
      id: "final-run",
      bundleSha256: hash,
      vitestJson: "./vitest.json",
    }),
  );
  writeFileSync(
    evidencePath,
    JSON.stringify({
      version: 2,
      evidence: entries.map((entry) => ({
        executionId: "final-run",
        bundleSha256: hash,
        ...entry,
      })),
    }),
  );
  return { bundle, hash, vitestPath, manifestPath, evidencePath, dir };
}

const fullDimensions = {
  authorization: "required",
  state: "required",
  events: "required",
  transport: "required",
  restart: "required",
  unrelatedResources: "required",
};
function testEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: "AUTH-005",
    kind: "test",
    testFile: "tests/security/boundaries.test.ts",
    testTitle: "sample authorized/forbidden test",
    scenarioScope: "Credential rejection and protected identity state.",
    rationale: "The assertion covers the stated requirement dimensions.",
    assertionDetails: ["rejects the credential", "preserves unrelated account state"],
    transports: ["REST"],
    assertions: ["authorization", "state", "events", "transport", "restart", "unrelatedResources"],
    dimensionDisposition: fullDimensions,
    outcome: "PASS",
    ...overrides,
  };
}
const testRow = (status = "passed", fullName = "sample authorized/forbidden test") => ({
  fullName,
  status,
  failureMessages: [],
});
const run = (f: ReturnType<typeof fixture>, evidenceFiles?: string[]) =>
  generateReports({
    bundle: f.bundle,
    executionManifests: [f.manifestPath],
    workerEvidenceFiles: evidenceFiles ?? [f.evidencePath],
  });

describe("security matrix report inventory integrity", () => {
  it("keeps source discovery separate from exercised behavior and finds actual admin branches", () => {
    const { report, inventory } = generateReports();
    expect(report.catalogScenarioCount).toBe(339);
    expect(report.counts.scenarios["NOT IMPLEMENTED"]).toBe(338);
    expect(report.counts.scenarios["NOT APPLICABLE"]).toBe(1);
    expect(report.coverageGaps.unrepresentedRequirementIds).toEqual([]);
    expect(report.coverageGaps.catalogIdsAbsentFromRequirements).toEqual([]);
    expect(report.scenarios.find((s: any) => s.id === "DM-023")?.status).toBe("NOT APPLICABLE");
    expect(inventory.sourceInventoryIsNotBehaviorEvidence).toBe(true);
    expect(
      inventory.routes.fileRoutes.some(
        (r: any) => r.route === "/api/v1/profiles/{username}" && r.method === "patch",
      ),
    ).toBe(true);
    expect(
      inventory.routes.fileRoutes.some(
        (r: any) => r.route === "/" && r.source === "server/routes/index.ts",
      ),
    ).toBe(true);
    expect(inventory.routes.adminAliases).toEqual(["/admin", "/api/v1/admin"]);
    expect(inventory.routes.discoveredAdminDispatchRouteCount).toBe(48);
    expect(
      inventory.routes.adminRoutes.some(
        (r: any) => r.route === "/accounts/{username}/roles" && r.method === "post",
      ),
    ).toBe(true);
    expect(
      inventory.routes.adminRoutes.some(
        (r: any) => r.route === "/channels/{channel}/messages/purge" && r.method === "post",
      ),
    ).toBe(true);
    const adminOperations = new Set(
      inventory.routes.adminRoutes.map((r: any) => `${r.method} ${r.route}`),
    );
    expect([...adminOperations]).toEqual(
      expect.arrayContaining([
        "post /accounts",
        "post /accounts/register",
        "delete /bans/{id}",
        "delete /accounts/{username}/sessions/{id}",
        "put /accounts/{username}/scopes",
        "get /audit",
        "delete /metadata/users/{username}/{key}",
        "delete /metadata/channels/{channel}/{key}",
      ]),
    );
    expect(inventory.irc.commands).toContain("PRIVMSG");
    expect(
      inventory.irc.services.find((s: any) => s.service === "NickServ")?.subcommands,
    ).toContain("IDENTIFY");
    expect(inventory.coverage.routeBehaviorExercised).toEqual([]);
    expect(inventory.coverage.commandBehaviorExercised).toEqual([]);
    const schema = JSON.parse(readFileSync("docs/security/matrix-evidence/schema.json", "utf8"));
    expect(schema.title).toBe("FlaRC security matrix worker evidence");
    expect(schema.$id).toMatch(/flarc\.example/);
    expect(
      inventory.openapiComparison.unmatchedRouteMethods.every(
        (r: any) => !r.route.startsWith("/api/") && !r.route.startsWith("/admin/"),
      ),
    ).toBe(true);
  });

  it("counts skipped and todo separately and reports unavailable Vitest categories as unknown", () => {
    const f = fixture([testRow("skipped"), testRow("todo", "todo test")], []);
    const { report } = run(f);
    expect(report.counts.vitest).toMatchObject({
      pass: 0,
      fail: 0,
      skip: 1,
      todo: 1,
      xfail: "unknown",
      xpass: "unknown",
      deselected: "unknown",
    });
  });

  it("requires every declared required assertion dimension and exact current execution evidence", () => {
    const f = fixture([testRow()], [testEvidence({ assertions: ["authorization", "state"] })]);
    expect(run(f).report.scenarios.find((s: any) => s.id === "AUTH-005")?.status).toBe(
      "NOT IMPLEMENTED",
    );

    const missingTitle = fixture([testRow()], [testEvidence({ testTitle: "not a real test" })]);
    expect(run(missingTitle).report.scenarios.find((s: any) => s.id === "AUTH-005")?.status).toBe(
      "NOT IMPLEMENTED",
    );

    const missingFile = fixture(
      [testRow()],
      [testEvidence({ testFile: "tests/security/unknown.test.ts" })],
    );
    expect(run(missingFile).report.scenarios.find((s: any) => s.id === "AUTH-005")?.status).toBe(
      "NOT IMPLEMENTED",
    );

    const skipped = fixture([testRow("skipped")], [testEvidence()]);
    expect(run(skipped).report.scenarios.find((s: any) => s.id === "AUTH-005")?.status).toBe(
      "NOT IMPLEMENTED",
    );

    const stale = fixture([testRow()], [testEvidence({ bundleSha256: "a".repeat(64) })]);
    const staleRow = run(stale).report.scenarios.find((s: any) => s.id === "AUTH-005");
    expect(staleRow?.status).toBe("NOT IMPLEMENTED");
    expect(staleRow?.evidenceHistory[0].kind).toBe("historical");

    expect(
      run(fixture([testRow()], [testEvidence()])).report.scenarios.find(
        (s: any) => s.id === "AUTH-005",
      )?.status,
    ).toBe("PASS");
  });

  it("preserves required failures and mixed pass/fail cannot be cleared by a passing test", () => {
    const entries = [
      testEvidence(),
      testEvidence({
        outcome: "FAIL",
        testTitle: "known failing security assertion",
        rationale: "A required assertion failed on this source bundle.",
      }),
    ];
    const f = fixture([testRow(), testRow("failed", "known failing security assertion")], entries);
    const { report } = run(f);
    expect(report.scenarios.find((s: any) => s.id === "AUTH-005")?.status).toBe("FAIL");
    expect(report.status).toBe("FAIL");
  });

  it("consumes justified dispositions without fake tests and records route/command outcomes separately", () => {
    const disposition = {
      id: "DM-024",
      kind: "disposition",
      outcome: "BLOCKED",
      scenarioScope: "Group DM channel policy",
      rationale: "Runtime feature flag is unavailable in this deployment.",
      basis: "deployment inventory",
      capability: "group DMs",
    };
    const behavioral = testEvidence({
      id: "AUTH-005",
      routeBehavior: [
        {
          route: "/api/v1/auth/login",
          method: "post",
          alias: "/api/v1/auth/login",
          outcome: "negative",
          responseKind: "secure-denial",
        },
      ],
      commandBehavior: [{ command: "PRIVMSG", outcome: "positive" }],
    });
    const f = fixture([testRow()], [behavioral]);
    const dispositionPath = path.join(f.dir, "dispositions.json");
    writeFileSync(dispositionPath, JSON.stringify({ version: 2, evidence: [disposition] }));
    const { report, inventory } = generateReports({
      bundle: f.bundle,
      executionManifests: [f.manifestPath],
      workerEvidenceFiles: [f.evidencePath, dispositionPath],
    });
    expect(report.scenarios.find((s: any) => s.id === "DM-024")?.status).toBe("BLOCKED");
    expect(inventory.coverage.routeBehaviorExercised[0]).toMatchObject({
      route: "/api/v1/auth/login",
      method: "post",
      alias: "/api/v1/auth/login",
      outcome: "negative",
      responseKind: "secure-denial",
    });
    expect(inventory.coverage.commandBehaviorExercised[0]).toMatchObject({
      command: "PRIVMSG",
      outcome: "positive",
    });
  });

  it("does not treat a missing-feature 404 as a secure success or capability disposition", () => {
    const evidence = testEvidence({
      routeBehavior: [
        {
          route: "/api/v1/auth/login",
          method: "post",
          alias: "/api/v1/auth/login",
          outcome: "negative",
          responseKind: "missing-feature-404",
        },
      ],
    });
    const f = fixture([testRow()], [evidence]);
    const { report, inventory } = run(f);
    const row = report.scenarios.find((s: any) => s.id === "AUTH-005");
    expect(row?.status).toBe("NOT IMPLEMENTED");
    expect(row?.surfaceDisposition).toBeUndefined();
    expect(inventory.coverage.routeBehaviorExercised[0].responseKind).toBe("missing-feature-404");
  });

  it("retains older failure history without poisoning current bundle PASS", () => {
    const old = fixture(
      [testRow("failed")],
      [
        testEvidence({
          outcome: "FAIL",
          rationale: "Pre-fix failure",
          executionId: "old",
          bundleSha256: "b".repeat(64),
        }),
      ],
      "old source",
    );
    const current = fixture([testRow()], [testEvidence()], "new final source");
    const oldManifest = JSON.parse(readFileSync(old.manifestPath, "utf8"));
    oldManifest.id = "old";
    writeFileSync(old.manifestPath, JSON.stringify(oldManifest));
    const oldEvidence = JSON.parse(readFileSync(old.evidencePath, "utf8"));
    oldEvidence.evidence[0].executionId = "old";
    oldEvidence.evidence[0].bundleSha256 = old.hash;
    writeFileSync(old.evidencePath, JSON.stringify(oldEvidence));
    const { report } = generateReports({
      bundle: current.bundle,
      executionManifests: [old.manifestPath, current.manifestPath],
      workerEvidenceFiles: [old.evidencePath, current.evidencePath],
    });
    const row = report.scenarios.find((s: any) => s.id === "AUTH-005");
    expect(row?.status).toBe("PASS");
    expect(
      row?.evidenceHistory.some((h: any) => h.kind === "historical" && h.outcome === "FAIL"),
    ).toBe(true);
  });

  it("keeps report-shaped worker handoffs provisional and preserves their failure diagnostics", () => {
    const f = fixture([], []);
    const reportShaped = path.join(f.dir, "worker-report.json");
    writeFileSync(
      reportShaped,
      JSON.stringify({
        scenario_dispositions: [{ id: "AUTH-005", disposition: "PARTIAL" }],
        tests: [
          {
            file: "tests/security/boundaries.test.ts",
            title: "pre-fix failed assertion",
            scenarios: ["AUTH-005"],
            outcome: "failed",
          },
        ],
        pre_fix_evidence: { search: "Known baseline search failure." },
        baseline_bundle_sha256: "c".repeat(64),
      }),
    );
    const { report } = generateReports({
      bundle: f.bundle,
      executionManifests: [f.manifestPath],
      workerEvidenceFiles: [reportShaped],
    });
    const row = report.scenarios.find((s: any) => s.id === "AUTH-005");
    expect(row?.status).toBe("NOT IMPLEMENTED");
    expect(row?.evidenceHistory.some((h: any) => h.testTitle === "pre-fix failed assertion")).toBe(
      true,
    );
    expect(report.legacyWorkerDiagnostics[0].preFixEvidence.search).toBe(
      "Known baseline search failure.",
    );
  });

  it("accepts concrete route paths, query strings, encoded channel params and admin aliases", () => {
    const routeBehavior = [
      {
        route: "/api/v1/profiles/{username}",
        method: "GET",
        alias: "/api/v1/profiles/alice?username=bob",
        outcome: "negative",
        responseKind: "secure-denial",
      },
      {
        route: "/api/v1/channels/{channel}/info",
        method: "GET",
        alias: "/api/v1/channels/%23secret/info",
        outcome: "positive",
        responseKind: "feature-response",
      },
      {
        route: "/accounts/{username}/roles",
        method: "POST",
        alias: "/admin/accounts/alice/roles",
        outcome: "negative",
        responseKind: "secure-denial",
      },
      {
        route: "/accounts/{username}/roles",
        method: "POST",
        alias: "/api/v1/admin/accounts/alice/roles",
        outcome: "negative",
        responseKind: "secure-denial",
      },
      {
        route: "/api/v1/channels/{channel}/info",
        method: "GET",
        alias: "/api/v1/channels/{channel}/info",
        requestPath: "/api/v1/channels/%23secret/info?channel=%23other",
        outcome: "negative",
        responseKind: "secure-denial",
      },
    ];
    const f = fixture([testRow()], [testEvidence({ routeBehavior })]);
    const { inventory } = run(f);
    const routes = inventory.coverage.routeBehaviorExercised;
    expect(routes).toHaveLength(routeBehavior.length);
    expect(routes.some((r: any) => r.outcome === "positive")).toBe(true);
    expect(routes.some((r: any) => r.outcome === "negative")).toBe(true);
    expect(routes.find((r: any) => r.requestPath?.includes("profiles/alice"))).toMatchObject({
      route: "/api/v1/profiles/{username}",
      alias: "/api/v1/profiles/alice?username=bob",
      requestPath: "/api/v1/profiles/alice?username=bob",
    });
    expect(routes.find((r: any) => r.requestPath?.includes("%23secret/info?"))).toMatchObject({
      route: "/api/v1/channels/{channel}/info",
      alias: "/api/v1/channels/%23secret/info?channel=%23other",
    });
    expect(routes.some((r: any) => r.alias === "/admin/accounts/alice/roles")).toBe(true);
    expect(routes.some((r: any) => r.alias === "/api/v1/admin/accounts/alice/roles")).toBe(true);
  });

  it("rejects mismatched routes, methods, unapproved prefixes and traversal aliases", () => {
    const invalidRows = [
      { route: "/api/v1/profiles/{username}", method: "POST", alias: "/api/v1/profiles/alice" },
      {
        route: "/api/v1/profiles/{username}",
        method: "GET",
        alias: "/api/v1/profiles?username=alice",
      },
      { route: "/api/v1/profiles/{username}", method: "GET", alias: "/unrelated/profiles/alice" },
      {
        route: "/accounts/{username}/roles",
        method: "POST",
        alias: "/unrelated/accounts/alice/roles",
      },
      {
        route: "/api/v1/profiles/{username}",
        method: "GET",
        alias: "/api/v1/profiles/%2e%2e/admin",
      },
      { route: "/api/v1/profiles/{username}", method: "GET", alias: "/api/v1/profiles/%2Fadmin" },
      { route: "/api/v1/profiles/{username}", method: "GET", alias: "/api/v1/profiles/%zz" },
    ].map((row) => ({ ...row, outcome: "negative", responseKind: "secure-denial" }));
    for (const route of invalidRows) {
      const f = fixture([testRow()], [testEvidence({ routeBehavior: [route] })]);
      expect(() => run(f)).toThrow(/discovered route\/method\/allowed alias/);
    }
    for (const requestPath of ["/api/v1/profiles/bob", "/api/v1/profiles/alice?username=other"]) {
      const mismatchedRequestPath = {
        route: "/api/v1/profiles/{username}",
        method: "GET",
        alias: "/api/v1/profiles/alice?username=bob",
        requestPath,
        outcome: "negative",
        responseKind: "secure-denial",
      };
      const f = fixture([testRow()], [testEvidence({ routeBehavior: [mismatchedRequestPath] })]);
      expect(() => run(f)).toThrow(/discovered route\/method\/allowed alias/);
    }
  });

  it("merges independently executed dimensions conservatively across reordered declarations", () => {
    const applicable = (required: string[]) =>
      Object.fromEntries(
        ["authorization", "state", "events", "transport", "restart", "unrelatedResources"].map(
          (dimension) => [
            dimension,
            required.includes(dimension)
              ? "required"
              : { status: "not-applicable", rationale: `Not asserted for ${dimension}.` },
          ],
        ),
      );
    const first = testEvidence({
      assertions: ["authorization", "state"],
      dimensionDisposition: applicable(["authorization", "state"]),
    });
    const second = testEvidence({
      testTitle: "independent complementary test",
      assertions: ["events", "transport"],
      dimensionDisposition: applicable(["transport", "events", "authorization"]),
    });
    const f = fixture(
      [testRow(), testRow("passed", "independent complementary test")],
      [first, second],
    );
    const { report } = run(f);
    expect(report.scenarios.find((s: any) => s.id === "AUTH-005")?.status).toBe("PASS");
    expect(report.scenarios.find((s: any) => s.id === "AUTH-005")?.assertionsCovered).toEqual([
      "authorization",
      "events",
      "state",
      "transport",
    ]);

    const undercovered = fixture(
      [testRow()],
      [
        testEvidence({
          assertions: ["authorization"],
          dimensionDisposition: applicable(["authorization", "state"]),
        }),
      ],
    );
    expect(run(undercovered).report.scenarios.find((s: any) => s.id === "AUTH-005")?.status).toBe(
      "NOT IMPLEMENTED",
    );
  });

  it("validates checked-in media and channel evidence against their execution manifests without editing them", () => {
    const root = process.cwd();
    const evidenceFiles = [
      path.resolve(root, "docs/security/matrix-evidence/media.json"),
      path.resolve(root, "docs/security/matrix-evidence/channels.json"),
    ];
    const before = evidenceFiles.map((file) =>
      createHash("sha256").update(readFileSync(file)).digest("hex"),
    );
    const media = JSON.parse(readFileSync(evidenceFiles[0], "utf8"));
    const channels = JSON.parse(readFileSync(evidenceFiles[1], "utf8"));
    const manifests = [...media.executionManifests, path.resolve(channels.executionManifest)];
    const bundle = "/tmp/flarc-matrix-run_01d0e4aeb274/server-04/index.mjs";
    const { report, inventory } = generateReports({
      bundle,
      executionManifests: manifests,
      workerEvidenceFiles: evidenceFiles,
    });
    expect(report.baselineBundleSha256).toBe(media.bundleSha256);
    expect(report.scenarios.some((s: any) => s.status === "FAIL")).toBe(false);
    expect(
      report.scenarios
        .find((s: any) => s.id === "ABUSE-003")
        ?.evidenceHistory.some(
          (entry: any) => entry.kind === "historical" && entry.outcome === "FAIL",
        ),
    ).toBe(true);
    const channelRow = report.scenarios.find((s: any) => s.id === "CHAN-001");
    if (channels.version === 2) {
      expect(channelRow?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            executionId:
              channels.executionManifest &&
              JSON.parse(readFileSync(channels.executionManifest, "utf8")).id,
          }),
        ]),
      );
    } else {
      expect(channelRow?.evidenceHistory).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "provisional-diagnostic" })]),
      );
    }
    expect(inventory.coverage.routeBehaviorExercised.length).toBeGreaterThan(0);
    expect(
      evidenceFiles.map((file) => createHash("sha256").update(readFileSync(file)).digest("hex")),
    ).toEqual(before);
  });
});
