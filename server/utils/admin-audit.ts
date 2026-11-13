import { hashSessionToken } from "../core/authentication/tokens";
import { canonicalizeIRCName } from "../protocol/irc/parser";

/** Only route shape and verb are used: request bodies and query strings are never audited. */
export function adminAuditOperation(path: string, method: string, body?: unknown): string {
  const route = path.split("?")[0].replace(/^\/(?:api\/v1\/)?admin\/?/, "/");
  const verb = method.toUpperCase();
  const roles = /^\/accounts\/[^/]+\/roles$/.test(route) && verb === "POST";
  if (roles) {
    const action = (body as { action?: unknown } | undefined)?.action;
    return action === "grant" ? "role.assign" : action === "revoke" ? "role.revoke" : "role.change";
  }
  const entries: [string, RegExp, string][] = [
    ["POST", /^\/accounts\/(?:disable|[^/]+\/disable)$/, "account.disable"],
    ["POST", /^\/accounts\/[^/]+\/enable$/, "account.enable"],
    ["POST", /^\/accounts\/[^/]+\/password$/, "account.password.reset"],
    ["POST", /^\/accounts(?:\/register)?$/, "account.create"],
    ["DELETE", /^\/accounts\/[^/]+$/, "account.delete"],
    ["PATCH", /^\/accounts\/[^/]+$/, "account.update"],
    ["GET", /^\/accounts$/, "account.list"],
    ["GET", /^\/accounts\/[^/]+$/, "account.read"],
    ["GET", /^\/accounts\/[^/]+\/roles$/, "role.list"],
    ["GET", /^\/accounts\/[^/]+\/sessions$/, "session.list"],
    ["DELETE", /^\/accounts\/[^/]+\/sessions\/[^/]+$/, "session.revoke"],
    ["GET", /^\/accounts\/[^/]+\/scopes$/, "scope.read"],
    ["PUT", /^\/accounts\/[^/]+\/scopes$/, "scope.update"],
    ["GET", /^\/sessions$/, "connection.list"],
    ["POST", /^\/sessions\/disconnect$/, "connection.disconnect"],
    ["GET", /^\/audit$/, "audit.read"],
    ["GET", /^\/bans$/, "ban.list"],
    ["POST", /^\/bans$/, "ban.create"],
    ["DELETE", /^\/bans\/[^/]+$/, "ban.delete"],
    ["POST", /^\/config$/, "config.update"],
    ["GET", /^\/stats$/, "stats.read"],
    ["POST", /^\/broadcast$/, "broadcast.send"],
    ["POST", /^\/messages\/redact$/, "message.redact"],
    ["GET", /^\/profile\/[^/]+$/, "profile.read"],
    ["PATCH", /^\/profile\/[^/]+$/, "profile.update"],
    ["GET", /^\/metadata\/(?:users|channels)\/[^/]+$/, "metadata.read"],
    ["PUT", /^\/metadata\/(?:users|channels)\/[^/]+$/, "metadata.update"],
    ["DELETE", /^\/metadata\/(?:users|channels)\/[^/]+\/[^/]+$/, "metadata.delete"],
    ["GET", /^\/channels$/, "channel.list"],
    ["GET", /^\/channels\/[^/]+$/, "channel.read"],
    ["DELETE", /^\/channels\/[^/]+$/, "channel.delete"],
    ["GET", /^\/channels\/[^/]+\/info$/, "channel.info.read"],
    ["PATCH", /^\/channels\/[^/]+\/info$/, "channel.info.update"],
    ["POST", /^\/channels\/[^/]+\/register$/, "channel.register"],
    ["POST", /^\/channels\/[^/]+\/unregister$/, "channel.unregister"],
    ["POST", /^\/channels\/[^/]+\/modes$/, "channel.mode.update"],
    ["POST", /^\/channels\/[^/]+\/topic$/, "channel.topic.update"],
    ["POST", /^\/channels\/[^/]+\/kick$/, "channel.kick"],
    ["GET", /^\/channels\/[^/]+\/bot$/, "channel.bot.read"],
    ["POST", /^\/channels\/[^/]+\/bot$/, "channel.bot.update"],
    ["GET", /^\/channels\/[^/]+\/messages$/, "channel.messages.read"],
    ["POST", /^\/channels\/[^/]+\/messages\/purge$/, "channel.messages.purge"],
  ];
  return (
    entries.find(([expected, pattern]) => expected === verb && pattern.test(route))?.[2] ??
    "admin.unknown"
  );
}

export function adminAuditOutcome(error: unknown): "denied" | "error" {
  const status = Number(
    (error as { statusCode?: unknown; status?: unknown } | null)?.statusCode ??
      (error as { status?: unknown } | null)?.status ??
      500,
  );
  return status >= 400 && status < 500 ? "denied" : "error";
}

/** Fingerprint the path identity; never retain attacker-supplied path text or query parameters. */
export async function adminAuditTarget(path: string, validatedSubject?: string): Promise<string> {
  const relative = path.split("?")[0].replace(/^\/(?:api\/v1\/)?admin\/?/, "");
  const parts = relative.split("/");
  const category = [
    "accounts",
    "sessions",
    "channels",
    "metadata",
    "profile",
    "bans",
    "audit",
    "config",
    "stats",
    "broadcast",
    "messages",
  ].includes(parts[0])
    ? parts[0]
    : "unknown";
  const subject = validatedSubject ?? (category === "metadata" ? parts[2] : parts[1]);
  if (
    !subject ||
    (!validatedSubject && ["register", "disable", "disconnect", "redact"].includes(subject))
  )
    return category;
  let normalized: string;
  try {
    normalized = canonicalizeIRCName(decodeURIComponent(subject));
  } catch {
    return category;
  }
  return `${category}:${(await hashSessionToken(normalized)).slice(0, 24)}`;
}
