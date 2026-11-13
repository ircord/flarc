import fs from "node:fs";
import path from "node:path";
import { parseOutboundAllowlist } from "../shared/outbound-policy.mjs";

/** Read at startup and on file replacement, including Kubernetes ConfigMap symlinks. */
export function loadAllowlistConfig(env = process.env, cwd = process.cwd()) {
  const explicitFile = env.ALLOWLIST_FILE;
  if (!explicitFile && env.ALLOWLIST_YAML !== undefined) {
    parseOutboundAllowlist(env.ALLOWLIST_YAML);
    return { bindings: { ALLOWLIST_YAML: env.ALLOWLIST_YAML }, file: null };
  }
  const file = path.resolve(cwd, explicitFile || "allowlist.yaml");
  const legacyConfigured = [
    env.EMBED_ALLOWED_HOSTS,
    env.OUTGOING_WEBHOOK_ALLOWED_HOSTS,
    env.PUSH_ALLOWED_HOSTS,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
  if (!explicitFile && (legacyConfigured || !fs.existsSync(file)))
    return { bindings: {}, file: null };
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 65536)
    throw new Error("Outbound allowlist file must be at most 64 KiB");
  const source = fs.readFileSync(file, "utf8");
  parseOutboundAllowlist(source);
  return { bindings: { ALLOWLIST_YAML: source }, file };
}
