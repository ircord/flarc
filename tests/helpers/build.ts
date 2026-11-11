import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export default function setup() {
  execSync("bun run build", { stdio: "inherit" });
  const snapshot = mkdtempSync(path.join(os.tmpdir(), "flarc-vitest-bundle-"));
  cpSync(path.resolve(".output/server"), path.join(snapshot, "server"), { recursive: true });
  process.env.FLARC_TEST_BUNDLE = path.join(snapshot, "server/index.mjs");
  return () => {
    rmSync(snapshot, { recursive: true, force: true });
  };
}
