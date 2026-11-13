import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compareDomainSchema, schemaDomains as domains } from "./schema/domains";

async function files(directory: string, depth = 0): Promise<string[]> {
  if (depth > 16) throw new Error("State directory exceeds maximum depth");
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(file, depth + 1)));
    else if (entry.isFile() && entry.name.endsWith(".sqlite")) found.push(file);
    if (found.length > 10000) throw new Error("State directory exceeds maximum database count");
  }
  return found.sort();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) {
    process.stderr.write(
      "Usage: node .output/tools/verify-schema.mjs <SQLite file or persistent state directory>\nInspect a stopped deployment or a consistent SQLite backup. Read-only; reports schema metadata, never account/message contents.\n",
    );
    process.exitCode = args[0] === "--help" ? 0 : 2;
    return;
  }
  const target = path.resolve(args[0]);
  const directory = (await stat(target)).isDirectory();
  const candidates = directory ? await files(target) : [target];
  const databases = [];
  for (const file of candidates) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec("BEGIN");
      const tables = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((r) => String(r.name));
      const domain = domains.filter((item) => tables.includes(item.sentinel));
      if (domain.length !== 1) {
        databases.push({
          file,
          status: "NOT APPLICABLE",
          reason: "Not exactly one recognized FlaRC domain database",
        });
        continue;
      }
      databases.push({
        file,
        domain: domain[0].domain,
        ...compareDomainSchema(db, domain[0].domain),
      });
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
      db.close();
    }
  }
  const recognized = databases.filter((item) => "domain" in item);
  const missingDomains = (directory ? domains : [])
    .map((item) => item.domain)
    .filter((domain) => !recognized.some((item) => item.domain === domain));
  const status =
    !recognized.length || missingDomains.length || recognized.some((item) => item.status !== "PASS")
      ? "FAIL"
      : "PASS";
  process.stdout.write(
    `${JSON.stringify({ formatVersion: 1, status, readOnly: true, missingDomains, databases }, null, 2)}\n`,
  );
  process.exitCode = status === "PASS" ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(
    `Schema verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 2;
});
