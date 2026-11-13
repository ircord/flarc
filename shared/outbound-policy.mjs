import { parseDocument } from "yaml";

const purposes = ["embeds", "webhooks", "push"];
export const EMPTY_OUTBOUND_ALLOWLIST = "version: 1\nembeds: []\nwebhooks: []\npush: []\n";

function hostname(value) {
  if (typeof value !== "string" || value.length > 253 || value !== value.trim()) return null;
  const host = value.toLowerCase();
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)
  )
    return null;
  if (
    /^\d+(?:\.\d+)*$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  )
    return null;
  try {
    // Reject alternative numeric-address spellings normalized by the URL parser.
    return new URL(`https://${host}`).hostname === host ? host : null;
  } catch {
    return null;
  }
}

/** The same bounded YAML parser is used by the Node launcher and Worker bundle. */
export function parseOutboundAllowlist(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).byteLength > 65536)
    throw new Error("Outbound allowlist must be YAML of at most 64 KiB");
  const doc = parseDocument(source, { uniqueKeys: true, stringKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) throw new Error("Invalid outbound allowlist YAML");
  let value;
  try {
    value = doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw new Error("Outbound allowlist aliases are not supported");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1)
    throw new Error("Outbound allowlist requires version: 1");
  if (Object.keys(value).some((key) => !["version", ...purposes].includes(key)))
    throw new Error("Unknown outbound allowlist field");
  const result = { version: 1 };
  for (const purpose of purposes) {
    const hosts = value[purpose] ?? [];
    if (!Array.isArray(hosts) || hosts.length > 1024)
      throw new Error(`Outbound ${purpose} must contain at most 1024 hostnames`);
    const normalized = hosts.map(hostname);
    if (normalized.some((host) => host === null))
      throw new Error(`Outbound ${purpose} contains an invalid exact hostname`);
    result[purpose] = Object.freeze([...new Set(normalized)]);
  }
  return Object.freeze(result);
}

let cachedSource;
let cachedPolicy;

/** Invalid explicit YAML fails closed; it never revives a legacy permission. */
export function outboundHosts(env, purpose) {
  if (!purposes.includes(purpose)) throw new Error("Unknown outbound purpose");
  if (env.ALLOWLIST_YAML !== undefined) {
    if (env.ALLOWLIST_YAML !== cachedSource || !cachedPolicy) {
      cachedSource = env.ALLOWLIST_YAML;
      try {
        cachedPolicy = parseOutboundAllowlist(cachedSource);
      } catch {
        cachedPolicy = { embeds: [], webhooks: [], push: [] };
      }
    }
    return [...cachedPolicy[purpose]];
  }
  const legacy =
    purpose === "embeds"
      ? env.EMBED_ALLOWED_HOSTS
      : purpose === "webhooks"
        ? env.OUTGOING_WEBHOOK_ALLOWED_HOSTS
        : env.PUSH_ALLOWED_HOSTS;
  return [
    ...new Set(
      (legacy ?? "")
        .split(",")
        .map((host) => hostname(host.trim()))
        .filter(Boolean),
    ),
  ];
}
