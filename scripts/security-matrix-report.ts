import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { generateOpenAPISpec } from "../server/routes/openapi.json.get";

type Outcome = "PASS" | "FAIL" | "NOT IMPLEMENTED" | "NOT APPLICABLE" | "BLOCKED";
type Dimension =
  | "authorization"
  | "state"
  | "events"
  | "transport"
  | "restart"
  | "unrelatedResources";
const outcomes = new Set<Outcome>(["PASS", "FAIL", "NOT IMPLEMENTED", "NOT APPLICABLE", "BLOCKED"]);
const dimensions: Dimension[] = [
  "authorization",
  "state",
  "events",
  "transport",
  "restart",
  "unrelatedResources",
];
const root = process.cwd();
const catalogPath = "tests/security/matrix-scenarios.json";
const requirementsPath = "docs/security/matrix-requirements.md";
const requirementText = readFileSync(requirementsPath, "utf8");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
  source: string;
  scenarios: { id: string; requirement: string }[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? routeFiles(full) : full.endsWith(".ts") ? [full] : [];
    })
    .sort();
}
function routePath(file: string): string {
  const relative = file.replace(/^server\/routes\//, "");
  if (relative === "index.ts") return "/";
  return `/${relative
    .replace(/\.(get|post|put|patch|delete)\.ts$/, "")
    .replace(/\.ts$/, "")
    .replace(/\/index$/, "")
    .replace(/\[\.\.\.([^\]]+)\]/g, "{$1...}")
    .replace(/\[([^\]]+)\]/g, "{$1}")}`;
}
function routeMethod(file: string): string {
  return file.match(/\.(get|post|put|patch|delete)\.ts$/)?.[1] ?? "any";
}
function read(pathname: string): string {
  return readFileSync(pathname, "utf8");
}
function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
type RouteReference = { route: string; method: string; aliases?: string[] };
function requestPathname(value: string): string | undefined {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return;
  const pathname = value.split("?", 1)[0];
  if (pathname.includes("#")) return;
  const decoded: string[] = [];
  for (const segment of pathname.split("/")) {
    let part: string;
    try {
      part = decodeURIComponent(segment);
    } catch {
      return;
    }
    // A route parameter is one path component. Do not let an encoded slash,
    // backslash, or dot segment turn a template match into traversal.
    if (part.includes("/") || part.includes("\\") || part === "." || part === "..") return;
    decoded.push(part);
  }
  return decoded.join("/") || "/";
}
function templateMatches(template: string, candidate: string): boolean {
  const expected = requestPathname(template);
  const actual = requestPathname(candidate);
  if (!expected || !actual) return false;
  const a = expected.split("/");
  const b = actual.split("/");
  return (
    a.length === b.length &&
    a.every((part, i) => (/^\{[^/{}]+\}$/.test(part) ? b[i].length > 0 : part === b[i]))
  );
}
function routeEvidencePath(row: any, discovered: RouteReference): string | undefined {
  const alias = row.alias as string;
  const requestPath = row.requestPath as string | undefined;
  const sourceAliases = discovered.aliases ?? [discovered.route];
  const aliasIsTemplate =
    (alias === discovered.route || sourceAliases.includes(alias)) && /\{[^}]+\}/.test(alias);
  const actual = requestPath ?? (aliasIsTemplate ? undefined : alias);
  if (!actual || !requestPathname(actual)) return;
  if (requestPath && !aliasIsTemplate && requestPath !== alias) return;
  if (!sourceAliases.some((template) => templateMatches(template, actual))) return;
  return actual;
}
function openapiPathFor(spec: any, route: string, method: string): string | undefined {
  if (spec.paths[route]?.[method]) return route;
  const shape = route.replace(/\{[^}]+\}/g, "{}");
  return Object.keys(spec.paths).find(
    (candidate) =>
      candidate.replace(/\{[^}]+\}/g, "{}") === shape && Boolean(spec.paths[candidate]?.[method]),
  );
}

function discoverAdminDispatch(): { aliases: string[]; routes: any[] } {
  const src = read("server/handlers/admin.ts");
  const ast = ts.createSourceFile("admin.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const patterns: { variable: string; route: string; start: number; end: number }[] = [];
  const literals: { route: string; method: string }[] = [];
  const routeTemplates: Record<string, string> = {
    banMatch: "/bans/{id}",
    profileMatch: "/profile/{username}",
    accountMatch: "/accounts/{username}",
    userMetaMatch: "/metadata/users/{username}",
    chanMetaMatch: "/metadata/channels/{channel}",
    chanMatch: "/channels/{channel}",
  };
  const directTemplates: Record<string, string> = {
    ...routeTemplates,
    sessionMatch: "/accounts/{username}/sessions/{id}",
  };
  const directDynamicRoutes: { variable: string; route: string; method: string }[] = [];
  const dynamicMatchVariables = new Set<string>();
  const isString = (n: ts.Expression): n is ts.StringLiteral => ts.isStringLiteral(n);
  const eqPair = (n: ts.Expression, id: string): string | undefined => {
    if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken)
      return;
    if (ts.isIdentifier(n.left) && n.left.text === id && isString(n.right)) return n.right.text;
    if (ts.isIdentifier(n.right) && n.right.text === id && isString(n.left)) return n.left.text;
  };
  const clauses = (n: ts.Expression): ts.Expression[][] => {
    if (ts.isParenthesizedExpression(n)) return clauses(n.expression);
    if (!ts.isBinaryExpression(n)) return [[n]];
    if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      return [...clauses(n.left), ...clauses(n.right)];
    if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return clauses(n.left).flatMap((left) =>
        clauses(n.right).map((right) => [...left, ...right]),
      );
    return [[n]];
  };
  const walk = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(ast) === "path.match"
    ) {
      const variable = n.name.text;
      if (n.initializer.arguments[0] && ts.isRegularExpressionLiteral(n.initializer.arguments[0])) {
        dynamicMatchVariables.add(variable);
        const route = routeTemplates[variable];
        assert(
          route,
          `new admin dynamic route match variable ${variable} needs an explicit route template in discovery map`,
        );
        const parent = n.parent.parent;
        if (ts.isVariableStatement(parent))
          patterns.push({ variable, route, start: parent.end, end: src.length });
      }
    }
    if (ts.isIfStatement(n)) {
      for (const parts of clauses(n.expression)) {
        const routeCases = parts
          .map((x) => eqPair(x, "path"))
          .filter((x): x is string => x !== undefined);
        const methodCases = parts
          .map((x) => eqPair(x, "method"))
          .filter((x): x is string => x !== undefined);
        // Audit annotations can repeat a handler's path/method condition. They
        // describe the same route, not another dispatch operation.
        for (const route of routeCases)
          for (const method of methodCases)
            if (
              !literals.some(
                (entry) => entry.route === route && entry.method === method.toLowerCase(),
              )
            )
              literals.push({ route, method: method.toLowerCase() });
        for (const part of parts) {
          if (!ts.isIdentifier(part) || !directTemplates[part.text]) continue;
          for (const method of methodCases)
            directDynamicRoutes.push({
              variable: part.text,
              route: directTemplates[part.text],
              method: method.toLowerCase(),
            });
        }
      }
    }
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(ast) === "subpath.match"
    )
      assert(
        ["keyMatch", "sessionMatch"].includes(n.name.text),
        `new nested admin route matcher ${n.name.text} needs explicit discovery`,
      );
    ts.forEachChild(n, walk);
  };
  walk(ast);
  assert(
    [...dynamicMatchVariables].every((variable) => Boolean(routeTemplates[variable])),
    "admin dynamic route template map is out of sync with source matches",
  );
  patterns.sort((a, b) => a.start - b.start);
  for (let i = 0; i < patterns.length; i++) patterns[i].end = patterns[i + 1]?.start ?? src.length;
  const routes: any[] = [];
  for (const item of literals)
    routes.push({
      ...item,
      source: "server/handlers/admin.ts",
      discovery: "TypeScript AST literal path/method condition",
    });
  for (const { variable: _variable, ...item } of directDynamicRoutes)
    routes.push({
      ...item,
      source: "server/handlers/admin.ts",
      discovery: "TypeScript AST dynamic matcher and method in the same condition",
    });
  const discoveredSubroutes: { route: string; method: string }[] = [];
  for (const item of patterns) {
    const region = src.slice(item.start, item.end);
    const subpaths = new Set<string>();
    for (const m of region.matchAll(/subpath\s*===\s*["']([^"']*)["']/g)) subpaths.add(m[1]);
    const methods = new Set(
      [...region.matchAll(/method\s*===\s*["'](GET|POST|PUT|PATCH|DELETE)["']/g)].map((m) =>
        m[1].toLowerCase(),
      ),
    );
    // Derive each actual subpath/method pair from its enclosing if branch.
    const regionAst = ts.createSourceFile("admin-region.ts", region, ts.ScriptTarget.Latest, true);
    const pairs = new Set<string>();
    const scan = (n: ts.Node) => {
      if (ts.isIfStatement(n)) {
        for (const parts of clauses(n.expression)) {
          const sub = parts.map((x) => eqPair(x, "subpath")).find((x) => x !== undefined);
          const method = parts.map((x) => eqPair(x, "method")).find((x) => x !== undefined);
          if (sub !== undefined && method) pairs.add(`${sub}\n${method.toLowerCase()}`);
        }
      }
      ts.forEachChild(n, scan);
    };
    scan(regionAst);
    for (const pair of pairs) {
      const [subpath, method] = pair.split("\n");
      discoveredSubroutes.push({ route: `${item.route}${subpath}`, method });
    }
    if (item.route === "/profile/{username}") {
      for (const method of methods)
        if (!discoveredSubroutes.some((r) => r.route === item.route && r.method === method))
          discoveredSubroutes.push({ route: item.route, method });
    }
    assert(
      subpaths.size === 0 || pairs.size > 0,
      `admin dynamic dispatcher ${item.variable} has subpath branches but no discovered path/method pairs`,
    );
    assert(
      methods.size === 0 ||
        pairs.size > 0 ||
        item.route === "/profile/{username}" ||
        directDynamicRoutes.some((route) => route.variable === item.variable),
      `admin dynamic dispatcher ${item.variable} has method branches but no discovered path/method pairs`,
    );
  }
  // Metadata keys are a second dynamic component inside the matched metadata
  // route. Discover those DELETE operations from their actual enclosing source
  // block; the generic `path.match` table intentionally only describes the
  // primary resource parameter.
  for (const match of src.matchAll(/const keyMatch = subpath\.match\(/g)) {
    const index = match.index ?? 0;
    const precedingUser = src.lastIndexOf("const userMetaMatch =", index);
    const precedingChannel = src.lastIndexOf("const chanMetaMatch =", index);
    const route =
      precedingUser > precedingChannel
        ? "/metadata/users/{username}/{key}"
        : precedingChannel >= 0
          ? "/metadata/channels/{channel}/{key}"
          : undefined;
    assert(route, "metadata key matcher is outside a known metadata dispatcher");
    assert(
      /keyMatch\s*&&\s*method\s*===\s*["']DELETE["']/.test(src.slice(index, index + 2400)),
      `metadata key matcher at ${index} has no recognized DELETE branch`,
    );
    routes.push({
      route,
      method: "delete",
      source: "server/handlers/admin.ts",
      discovery: "TypeScript source dynamic metadata key match plus DELETE method branch",
    });
  }
  routes.push(
    ...discoveredSubroutes.map((r) => ({
      ...r,
      source: "server/handlers/admin.ts",
      discovery: "TypeScript AST dynamic match plus literal subpath/method branches",
    })),
  );
  const present = new Set(routes.map((r) => `${r.route}\n${r.method}`));
  assert(
    discoveredSubroutes.every((r) => present.has(`${r.route}\n${r.method}`)),
    "admin route discovery drifted from parsed dynamic branches",
  );
  const operationKeys = routes.map((r) => `${r.method}\n${r.route}`);
  assert(
    operationKeys.length === 48 && new Set(operationKeys).size === operationKeys.length,
    `admin route discovery drifted from reviewed dispatcher source operations: ${operationKeys.length} rows, ${new Set(operationKeys).size} unique pairs; duplicates: ${operationKeys.filter((key, index) => operationKeys.indexOf(key) !== index).join(", ")}`,
  );
  return { aliases: ["/admin", "/api/v1/admin"], routes };
}

function discoverCommands() {
  const dispatcher = read("server/protocol/irc/commands/dispatcher.ts");
  const irc = unique([...dispatcher.matchAll(/case\s+["']([^"']+)["']\s*:/g)].map((m) => m[1]));
  const services = [
    ["NickServ", "server/protocol/irc/commands/services/nickserv.ts"],
    ["ChanServ", "server/protocol/irc/commands/services/chanserv.ts"],
    ["F", "server/protocol/irc/commands/services/fbot.ts"],
    ["HostServ", "server/protocol/irc/commands/services/hostserv.ts"],
    ["HistServ", "server/protocol/irc/commands/services/histserv.ts"],
    ["Bouncer", "server/protocol/irc/commands/services/bouncer.ts"],
  ].map(([service, file]) => {
    const src = read(file);
    const values = unique(
      [...src.matchAll(/(?:sub|cmd)\s*===\s*["']([A-Z][A-Z0-9_-]*)["']/g)].map((m) => m[1]),
    );
    return {
      service,
      source: file,
      subcommands: values,
      discovery: "static equality branches; nested dynamic branches may be absent",
    };
  });
  return {
    dispatcherSource: "server/protocol/irc/commands/dispatcher.ts",
    commands: irc,
    services,
  };
}

type Run = { id: string; bundleSha256: string; file: string; tests: any[] };
function parseVitest(file: string, id: string, bundleSha256: string): Run {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const tests: any[] = [];
  for (const suite of json.testResults ?? [])
    for (const test of suite.assertionResults ?? []) {
      const status = String(test.status ?? "").toLowerCase();
      tests.push({
        file: suite.name ? path.relative(root, suite.name) : "",
        title:
          test.fullName || [...(test.ancestorTitles ?? []), test.title].filter(Boolean).join(" "),
        status,
        failures: test.failureMessages ?? [],
      });
    }
  return { id, bundleSha256, file, tests };
}
function vitestCounts(runs: Run[]) {
  if (!runs.length)
    return {
      pass: "unknown",
      fail: "unknown",
      skip: "unknown",
      todo: "unknown",
      xfail: "unknown",
      xpass: "unknown",
      deselected: "unknown",
      note: "No Vitest JSON supplied.",
    };
  const tests = runs.flatMap((r) => r.tests);
  const count = (status: string) => tests.filter((t) => t.status === status).length;
  return {
    pass: count("passed"),
    fail: count("failed"),
    skip: count("skipped"),
    todo: count("todo"),
    xfail: tests.some((t) => t.status === "xfail") ? count("xfail") : "unknown",
    xpass: tests.some((t) => t.status === "xpass") ? count("xpass") : "unknown",
    // Vitest v5 JSON reporter counts skipped tests in numPendingTests and emits per-test `skipped` status;
    // numPendingTests is not a deselection count. No deselected field is emitted.
    deselected: "unknown",
    note: "Vitest v5 reporter exposes skipped/todo per assertion; xfail/xpass and deselected are not standard JSON fields.",
  };
}

function normalizeWorkerEvidence(files: string[]) {
  const evidence: any[] = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (data.version !== 2) {
      if (Array.isArray(data.evidence))
        evidence.push(
          ...data.evidence.map((entry: any) => ({
            ...entry,
            provisional: true,
            evidenceFile: file,
          })),
        );
      // Other workers may supply report-shaped diagnostics; retain their scenario-level history without trusting their status vocabulary.
      if (Array.isArray(data.scenarios))
        evidence.push(
          ...data.scenarios
            .filter((row: any) => row.id && (row.evidence?.length || row.disposition || row.status))
            .map((row: any) => ({
              id: row.id,
              outcome: row.status ?? row.disposition ?? null,
              provisional: true,
              evidenceFile: file,
            })),
        );
      if (Array.isArray(data.scenario_dispositions))
        evidence.push(
          ...data.scenario_dispositions
            .filter((row: any) => row.id)
            .map((row: any) => ({
              id: row.id,
              outcome: row.disposition ?? null,
              provisional: true,
              evidenceFile: file,
            })),
        );
      if (Array.isArray(data.tests))
        evidence.push(
          ...data.tests.flatMap((test: any) =>
            (test.scenarios ?? []).map((id: string) => ({
              id,
              outcome: test.outcome ?? null,
              testFile: test.file,
              testTitle: test.title,
              provisional: true,
              evidenceFile: file,
            })),
          ),
        );
      continue;
    }
    assert(
      Array.isArray(data.evidence),
      `worker evidence must use {version:2,evidence:[]} in ${file}`,
    );
    for (const entry of data.evidence) {
      assert(
        catalog.scenarios.some((s) => s.id === entry.id),
        `unknown evidence scenario ${entry.id}`,
      );
      assert(
        outcomes.has(entry.outcome),
        `invalid evidence outcome for ${entry.id}: ${entry.outcome}`,
      );
      assert(
        typeof entry.scenarioScope === "string" && entry.scenarioScope.trim(),
        `missing scenarioScope for ${entry.id}`,
      );
      assert(
        typeof entry.rationale === "string" && entry.rationale.trim(),
        `missing rationale for ${entry.id}`,
      );
      if (entry.kind === "disposition") {
        assert(
          entry.outcome !== "PASS" && entry.outcome !== "FAIL",
          `disposition cannot claim ${entry.outcome} for ${entry.id}`,
        );
        assert(
          typeof entry.basis === "string" && entry.basis.trim(),
          `missing disposition basis for ${entry.id}`,
        );
      } else {
        assert(
          entry.kind === "test" &&
            typeof entry.executionId === "string" &&
            /^[a-f0-9]{64}$/.test(entry.bundleSha256 ?? ""),
          `missing execution/bundle match for ${entry.id}`,
        );
        assert(
          typeof entry.testFile === "string" && typeof entry.testTitle === "string",
          `missing test identity for ${entry.id}`,
        );
        assert(
          Array.isArray(entry.assertionDetails) &&
            entry.assertionDetails.length > 0 &&
            entry.assertionDetails.every((v: unknown) => typeof v === "string" && v.trim()),
          `missing precise assertionDetails for ${entry.id}`,
        );
        assert(
          Array.isArray(entry.transports) && Array.isArray(entry.assertions),
          `missing transport/assertions for ${entry.id}`,
        );
        assert(
          entry.assertions.every((d: string) => dimensions.includes(d as Dimension)),
          `invalid assertion dimension for ${entry.id}`,
        );
        assert(
          entry.dimensionDisposition && typeof entry.dimensionDisposition === "object",
          `missing required-dimensions declaration for ${entry.id}`,
        );
        for (const dim of dimensions) {
          const disposition = entry.dimensionDisposition[dim];
          assert(
            disposition === "required" ||
              (disposition &&
                disposition.status === "not-applicable" &&
                typeof disposition.rationale === "string" &&
                disposition.rationale.trim()),
            `dimension ${dim} must be required or justified not applicable for ${entry.id}`,
          );
        }
        if (entry.routeBehavior !== undefined) {
          assert(
            Array.isArray(entry.routeBehavior),
            `routeBehavior must be an array for ${entry.id}`,
          );
          for (const row of entry.routeBehavior) {
            assert(
              typeof row.route === "string" &&
                typeof row.method === "string" &&
                ["positive", "negative"].includes(row.outcome) &&
                ["feature-response", "secure-denial", "missing-feature-404"].includes(
                  row.responseKind,
                ),
              `route evidence requires route, method, positive/negative outcome for ${entry.id}`,
            );
            assert(
              typeof row.alias === "string" && row.alias.startsWith("/"),
              `route evidence must identify an alias (empty for canonical) for ${entry.id}`,
            );
            if (row.requestPath !== undefined)
              assert(
                typeof row.requestPath === "string" && row.requestPath.startsWith("/"),
                `route evidence requestPath must be an absolute request path for ${entry.id}`,
              );
          }
        }
        if (entry.commandBehavior !== undefined) {
          assert(
            Array.isArray(entry.commandBehavior),
            `commandBehavior must be an array for ${entry.id}`,
          );
          for (const row of entry.commandBehavior)
            assert(
              typeof row.command === "string" &&
                row.command.trim() &&
                ["positive", "negative"].includes(row.outcome),
              `command evidence requires IRC command and positive/negative outcome for ${entry.id}`,
            );
        }
      }
      evidence.push({ ...entry, evidenceFile: file });
    }
  }
  return evidence.sort((a, b) =>
    `${a.id}\n${a.executionId ?? ""}\n${a.testFile ?? ""}\n${a.testTitle ?? ""}\n${a.evidenceFile}`.localeCompare(
      `${b.id}\n${b.executionId ?? ""}\n${b.testFile ?? ""}\n${b.testTitle ?? ""}\n${b.evidenceFile}`,
    ),
  );
}

export function generateReports(
  options: {
    vitestJson?: string;
    workerEvidence?: string;
    executionManifests?: string[];
    workerEvidenceFiles?: string[];
    bundle?: string;
    command?: string;
  } = {},
) {
  assert(
    catalog.source === requirementsPath,
    "catalog source must match exact user requirement document",
  );
  const ids = catalog.scenarios.map((s) => s.id);
  assert(ids.length === 339, `expected 339 catalog cases, found ${ids.length}`);
  assert(new Set(ids).size === ids.length, "catalog contains duplicate scenario IDs");
  assert(
    catalog.scenarios.every((s) => /^[A-Z]+-\d{3}$/.test(s.id) && s.requirement.trim()),
    "catalog scenario shape is invalid",
  );
  const requirementIds = [...requirementText.matchAll(/^-\s+([A-Z]+-\d{3}):/gm)].map((m) => m[1]);
  const missingFromCatalog = unique(requirementIds.filter((id) => !ids.includes(id)));
  const absentFromRequirements = unique(ids.filter((id) => !requirementIds.includes(id)));
  assert(
    missingFromCatalog.length === 0 && absentFromRequirements.length === 0,
    "catalog and requirement IDs differ",
  );

  const spec = generateOpenAPISpec();
  const fileRoutes = routeFiles("server/routes").map((file) => {
    const route = routePath(file);
    const method = routeMethod(file);
    const openapiPath = method === "any" ? undefined : openapiPathFor(spec, route, method);
    const openapi = openapiPath ? spec.paths[openapiPath][method] : undefined;
    return {
      route,
      method,
      source: file,
      discovered: true,
      openapiPath: openapiPath ?? null,
      openapiDocumented: Boolean(openapi),
      publicPolicy:
        openapi?.security?.length === 0
          ? "public (OpenAPI)"
          : openapi
            ? "authenticated by OpenAPI default"
            : "not documented in OpenAPI",
      exercised: false,
      behaviorStatus: "NOT IMPLEMENTED" as Outcome,
    };
  });
  const admin = discoverAdminDispatch();
  const adminRoutes = admin.routes.map((r) => {
    const aliases = admin.aliases.map((prefix) => `${prefix}${r.route}`);
    const openapiPaths = aliases.map((alias) => openapiPathFor(spec, alias, r.method));
    return {
      ...r,
      aliases,
      openapiPaths,
      openapiDocumented: openapiPaths.every(Boolean),
      publicPolicy: "administrator guard in shared handler; behavior not exercised",
      exercised: false,
    };
  });
  const routes = [...fileRoutes, ...adminRoutes];
  const routeOpenApiGaps = routes.flatMap((r) => {
    if (r.method === "any") return [];
    if (r.aliases)
      return r.aliases
        .filter((alias: string) => !openapiPathFor(spec, alias, r.method))
        .map((alias: string) => ({ route: alias, method: r.method, source: r.source }));
    return !openapiPathFor(spec, r.route, r.method)
      ? [{ route: r.route, method: r.method, source: r.source }]
      : [];
  });
  const commands = discoverCommands();
  const bundleSha = options.bundle
    ? createHash("sha256").update(readFileSync(options.bundle)).digest("hex")
    : null;
  const runs: Run[] = [];
  for (const manifestFile of options.executionManifests ?? []) {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    assert(
      manifest.version === 1 &&
        typeof manifest.id === "string" &&
        typeof manifest.bundleSha256 === "string" &&
        typeof manifest.vitestJson === "string",
      `invalid execution manifest ${manifestFile}`,
    );
    assert(/^[a-f0-9]{64}$/.test(manifest.bundleSha256), `invalid bundle SHA in ${manifestFile}`);
    runs.push(
      parseVitest(
        path.resolve(path.dirname(manifestFile), manifest.vitestJson),
        manifest.id,
        manifest.bundleSha256,
      ),
    );
  }
  // A naked Vitest JSON has no source/bundle provenance and remains diagnostic only.
  runs.sort((a, b) =>
    `${a.bundleSha256}\n${a.id}\n${a.file}`.localeCompare(`${b.bundleSha256}\n${b.id}\n${b.file}`),
  );
  const currentRuns = bundleSha ? runs.filter((r) => r.bundleSha256 === bundleSha) : [];
  const runTests = currentRuns.flatMap((r) =>
    r.tests.map((t) => ({ ...t, executionId: r.id, bundleSha256: r.bundleSha256 })),
  );
  const workerEvidenceFiles = [
    "docs/security/matrix-evidence/dispositions.json",
    ...(options.workerEvidenceFiles ?? (options.workerEvidence ? [options.workerEvidence] : [])),
  ];
  const evidence = normalizeWorkerEvidence(workerEvidenceFiles);
  const legacyWorkerDiagnostics = workerEvidenceFiles.flatMap((file) => {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data.version === 2
      ? []
      : [
          {
            source: file,
            baselineBundleSha256: data.baseline_bundle_sha256 ?? data.baselineBundleSha256 ?? null,
            verificationBundleSha256:
              data.verification_bundle_sha256 ?? data.verificationBundleSha256 ?? null,
            preFixEvidence: data.pre_fix_evidence ?? data.preFixEvidence ?? null,
          },
        ].filter(
          (row) =>
            row.preFixEvidence !== null ||
            row.baselineBundleSha256 !== null ||
            row.verificationBundleSha256 !== null,
        );
  });
  const discoveredRouteRefs = routes as RouteReference[];
  const discoveredCommands = new Set(
    commands.commands.map((command: string) => command.toUpperCase()),
  );
  for (const entry of evidence.filter((e) => e.kind === "test" && !e.provisional)) {
    for (const ref of entry.routeBehavior ?? []) {
      const discovered = discoveredRouteRefs.find(
        (candidate) =>
          candidate.route === ref.route && candidate.method === ref.method.toLowerCase(),
      );
      assert(
        discovered && routeEvidencePath(ref, discovered),
        `route evidence is not a discovered route/method/allowed alias: ${ref.method} ${ref.requestPath ?? ref.alias}`,
      );
    }
    for (const ref of entry.commandBehavior ?? [])
      assert(
        discoveredCommands.has(ref.command.toUpperCase()),
        `IRC command evidence is not a discovered command: ${ref.command}`,
      );
  }
  const scenarioRows = catalog.scenarios.map((scenario) => {
    const rows = evidence.filter((e) => e.id === scenario.id);
    const outcomesForEvidence: Outcome[] = [];
    const matched: any[] = [];
    const history: any[] = [];
    const passingEvidence: any[] = [];
    for (const e of rows) {
      if (e.kind === "disposition" && !e.provisional) {
        matched.push(e);
        outcomesForEvidence.push(e.outcome);
        continue;
      }
      if (e.provisional) {
        history.push({
          kind: "provisional-diagnostic",
          source: e.evidenceFile,
          outcome: e.outcome ?? null,
          testFile: e.testFile,
          testTitle: e.testTitle,
          reason: "Legacy evidence shape has no execution/bundle proof.",
        });
        continue;
      }
      if (!currentRuns.some((r) => r.id === e.executionId && r.bundleSha256 === e.bundleSha256)) {
        history.push({
          kind: "historical",
          source: e.evidenceFile,
          executionId: e.executionId,
          bundleSha256: e.bundleSha256,
          outcome: e.outcome,
          reason: "Evidence bundle does not match selected current source bundle.",
        });
        continue;
      }
      const hit = runTests.find(
        (t) =>
          t.executionId === e.executionId &&
          t.bundleSha256 === e.bundleSha256 &&
          t.file.endsWith(e.testFile) &&
          t.title === e.testTitle,
      );
      if (hit) {
        matched.push({ ...e, executionStatus: hit.status });
        if (hit.status === "failed" || e.outcome === "FAIL") outcomesForEvidence.push("FAIL");
        else if (hit.status === "passed" && e.outcome === "PASS") passingEvidence.push(e);
      } else
        history.push({
          kind: "unmatched-test",
          source: e.evidenceFile,
          executionId: e.executionId,
          bundleSha256: e.bundleSha256,
          testFile: e.testFile,
          testTitle: e.testTitle,
          outcome: e.outcome,
          reason: "No exact file/title match in the referenced current execution.",
        });
    }
    const executedEvidence = matched.filter(
      (e) => e.kind === "test" && ["passed", "failed"].includes(e.executionStatus),
    );
    const mergedDisposition = Object.fromEntries(
      dimensions.map((dimension) => [
        dimension,
        executedEvidence.some((e) => e.dimensionDisposition[dimension] === "required")
          ? "required"
          : {
              status: "not-applicable",
              rationale: unique(
                executedEvidence
                  .map((e) => e.dimensionDisposition[dimension])
                  .filter((value: any) => value?.status === "not-applicable")
                  .map((value: any) => value.rationale),
              ).join("; "),
            },
      ]),
    );
    if (passingEvidence.length) {
      const required = dimensions.filter((d) => mergedDisposition[d] === "required");
      const covered = new Set<string>(
        executedEvidence
          .filter((e) => e.executionStatus === "passed" && e.outcome === "PASS")
          .flatMap((e) => e.assertions),
      );
      const hasMissingFeature404 = passingEvidence.some((e) =>
        e.routeBehavior?.some((route: any) => route.responseKind === "missing-feature-404"),
      );
      if (!hasMissingFeature404 && required.length > 0 && required.every((d) => covered.has(d)))
        outcomesForEvidence.push("PASS");
    }
    const status: Outcome = outcomesForEvidence.includes("FAIL")
      ? "FAIL"
      : outcomesForEvidence.includes("BLOCKED")
        ? "BLOCKED"
        : outcomesForEvidence.includes("NOT IMPLEMENTED")
          ? "NOT IMPLEMENTED"
          : outcomesForEvidence.includes("NOT APPLICABLE")
            ? "NOT APPLICABLE"
            : outcomesForEvidence.includes("PASS")
              ? "PASS"
              : "NOT IMPLEMENTED";
    const dims = unique(executedEvidence.flatMap((e) => e.assertions ?? []));
    const partial = status !== "PASS" && matched.some((e) => e.kind === "test");
    const dispositions = matched
      .filter((e) => e.kind === "disposition")
      .map((e) => ({
        outcome: e.outcome,
        scenarioScope: e.scenarioScope,
        rationale: e.rationale,
        basis: e.basis,
        capability: e.capability,
      }));
    return {
      id: scenario.id,
      requirement: scenario.requirement,
      status,
      partialCoverage: Boolean(partial),
      surfaceDisposition: dispositions[0],
      assertionsCovered: dims,
      transports: unique(matched.flatMap((e) => e.transports ?? [])),
      evidence: matched.map((e) =>
        e.kind === "disposition"
          ? {
              kind: "disposition",
              outcome: e.outcome,
              rationale: e.rationale,
              basis: e.basis,
              evidenceFile: e.evidenceFile,
            }
          : {
              kind: "test",
              executionId: e.executionId,
              bundleSha256: e.bundleSha256,
              testFile: e.testFile,
              testTitle: e.testTitle,
              scenarioScope: e.scenarioScope,
              assertionDetails: e.assertionDetails,
              executionStatus: e.executionStatus,
              assertions: e.assertions,
              outcome: e.outcome,
              evidenceFile: e.evidenceFile,
            },
      ),
      evidenceHistory: history,
      limitation:
        status === "NOT IMPLEMENTED" && matched.length === 0
          ? "No current-bundle executed evidence or explicit disposition supplied; legacy evidence files are provisional diagnostics only."
          : undefined,
    };
  });
  const scenarioCounts = Object.fromEntries(
    [...outcomes].map((s) => [s, scenarioRows.filter((r) => r.status === s).length]),
  );
  const baselineSha = options.bundle
    ? createHash("sha256").update(readFileSync(options.bundle)).digest("hex")
    : null;
  const report = {
    version: 1,
    requirements: requirementsPath,
    catalog: catalogPath,
    catalogScenarioCount: ids.length,
    statusVocabulary: [...outcomes],
    status: scenarioRows.some((r) => r.status === "FAIL")
      ? "FAIL"
      : scenarioRows.some((r) => r.status === "BLOCKED")
        ? "BLOCKED"
        : scenarioRows.every((r) => r.status === "PASS" || r.status === "NOT APPLICABLE")
          ? "PASS"
          : "NOT IMPLEMENTED",
    counts: { scenarios: scenarioCounts, vitest: vitestCounts(currentRuns) },
    baselineBundleSha256: baselineSha,
    executedVitestJson: options.vitestJson ?? null,
    executionManifests: options.executionManifests ?? [],
    workerEvidence:
      options.workerEvidenceFiles ?? (options.workerEvidence ? [options.workerEvidence] : []),
    legacyWorkerDiagnostics,
    command: options.command ?? "bun scripts/security-matrix-report.ts --bundle <frozen-bundle>",
    testExecutionEvidence: runTests.map((t) => ({
      executionId: t.executionId,
      bundleSha256: t.bundleSha256,
      testFile: t.file,
      testTitle: t.title,
      outcome: t.status,
      failures: t.failures,
    })),
    toolingVerification: runTests
      .filter((t) => t.file.endsWith("tests/security/matrix-inventory.test.ts"))
      .map((t) => ({
        executionId: t.executionId,
        testFile: t.file,
        testTitle: t.title,
        outcome: t.status,
      })),
    scenarios: scenarioRows,
    coverageGaps: {
      noExecutableEvidence: scenarioRows
        .filter((s) => s.status === "NOT IMPLEMENTED")
        .map((s) => s.id),
      unrepresentedRequirementIds: missingFromCatalog,
      catalogIdsAbsentFromRequirements: absentFromRequirements,
    },
    unsupportedCapabilities: scenarioRows
      .filter((r) => r.surfaceDisposition)
      .map((r) => ({ scenario: r.id, status: r.status, ...r.surfaceDisposition })),
    limitations: [
      "A source route/command inventory is not evidence of behavior exercised.",
      "PASS requires a matching test title and file from an explicit execution manifest whose bundle SHA matches the selected source bundle, plus passing evidence covering every declared required dimension.",
      "A missing-feature 404 is a negative test outcome, not an unsupported-feature disposition; dispositions require explicit rationale and basis.",
    ],
    bugs: [],
  };
  const inventory = {
    version: 1,
    requirements: requirementsPath,
    catalogScenarioCount: ids.length,
    sourceInventoryIsNotBehaviorEvidence: true,
    routes: {
      discoveredFileRouteCount: fileRoutes.length,
      discoveredAdminDispatchRouteCount: adminRoutes.length,
      fileRoutes,
      adminAliases: admin.aliases,
      adminRoutes,
      openApiGaps: routeOpenApiGaps,
      note: "Includes legacy Nitro aliases and concrete admin dispatcher branches plus dynamic account/profile/metadata/channel subroutes.",
    },
    irc: commands,
    coverage: {
      routeBehaviorExercised: evidence
        .filter(
          (e) =>
            e.kind === "test" &&
            !e.provisional &&
            e.routeBehavior &&
            currentRuns.some((r) => r.id === e.executionId && r.bundleSha256 === e.bundleSha256) &&
            runTests.some(
              (t) =>
                t.executionId === e.executionId &&
                t.file.endsWith(e.testFile) &&
                t.title === e.testTitle &&
                ["passed", "failed"].includes(t.status),
            ),
        )
        .flatMap((e) =>
          e.routeBehavior.map((x: any) => {
            const discovered = discoveredRouteRefs.find(
              (candidate) =>
                candidate.route === x.route && candidate.method === x.method.toLowerCase(),
            )!;
            const actualPath = routeEvidencePath(x, discovered)!;
            return {
              ...x,
              alias: actualPath,
              requestPath: actualPath,
              scenario: e.id,
              executionId: e.executionId,
              bundleSha256: e.bundleSha256,
              testFile: e.testFile,
              testTitle: e.testTitle,
            };
          }),
        )
        .sort((a, b) =>
          `${a.route} ${a.method} ${a.outcome}`.localeCompare(
            `${b.route} ${b.method} ${b.outcome}`,
          ),
        ),
      commandBehaviorExercised: evidence
        .filter(
          (e) =>
            e.kind === "test" &&
            !e.provisional &&
            e.commandBehavior &&
            currentRuns.some((r) => r.id === e.executionId && r.bundleSha256 === e.bundleSha256) &&
            runTests.some(
              (t) =>
                t.executionId === e.executionId &&
                t.file.endsWith(e.testFile) &&
                t.title === e.testTitle &&
                ["passed", "failed"].includes(t.status),
            ),
        )
        .flatMap((e) =>
          e.commandBehavior.map((x: any) => ({
            ...x,
            scenario: e.id,
            executionId: e.executionId,
            bundleSha256: e.bundleSha256,
            testFile: e.testFile,
            testTitle: e.testTitle,
          })),
        )
        .sort((a, b) => `${a.command} ${a.outcome}`.localeCompare(`${b.command} ${b.outcome}`)),
      scenarioBehaviorExecuted: scenarioRows
        .filter((r) => r.evidence.some((e: any) => e.kind === "test"))
        .map((r) => r.id),
    },
    unsupportedCapabilities: scenarioRows
      .filter((r) => r.surfaceDisposition)
      .map((r) => ({ scenario: r.id, status: r.status, ...r.surfaceDisposition })),
    openapiComparison: {
      documentedOperationCount: Object.values(spec.paths).reduce(
        (n: number, p: any) => n + Object.keys(p).length,
        0,
      ),
      routeMethodPairs: fileRoutes.filter((r) => r.method !== "any").length + adminRoutes.length,
      unmatchedRouteMethods: routeOpenApiGaps,
    },
    limitations: [
      "TypeScript AST discovery extracts literal admin branches and dynamic match subpaths; inventory is discovery, not behavior evidence.",
      "Admin aliases share one handler and therefore inherit its administrator guard, but every expanded operation still requires matched behavioral execution evidence.",
      "IRC and service subcommand inventories are statically discovered and are not behavioral security coverage.",
    ],
  };
  return { report, inventory };
}

function argsFrom(argv: string[]) {
  const result: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      assert(argv[i + 1], `missing value for ${argv[i]}`);
      (result[argv[i].slice(2)] ??= []).push(argv[++i]);
    }
  }
  return result;
}

if (import.meta.main) {
  const args = argsFrom(process.argv.slice(2));
  const outDir = args.outDir?.[0] ?? "docs/security";
  const { report, inventory } = generateReports({
    vitestJson: args["vitest-json"]?.[0],
    workerEvidenceFiles: args["worker-evidence"],
    executionManifests: args.execution,
    bundle: args.bundle?.[0],
    command: args.command?.[0],
  });
  writeFileSync(path.join(outDir, "matrix-coverage.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    path.join(outDir, "matrix-route-command-coverage.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outDir, "matrix-evidence/inventory.json"),
    `${JSON.stringify({ version: 1, bundleSha256: report.baselineBundleSha256, counts: report.counts, routeBehaviorExercised: inventory.coverage.routeBehaviorExercised, commandBehaviorExercised: inventory.coverage.commandBehaviorExercised, scenarioBehaviorExecuted: inventory.coverage.scenarioBehaviorExecuted }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      status: report.status,
      scenarios: report.catalogScenarioCount,
      counts: report.counts,
      routes: inventory.routes.discoveredFileRouteCount,
      adminRoutes: inventory.routes.discoveredAdminDispatchRouteCount,
      ircCommands: inventory.irc.commands.length,
    }),
  );
}
