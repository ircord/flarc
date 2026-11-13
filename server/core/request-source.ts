export type RequestSource = {
  ip: string;
  kind: "local-ingress" | "cloudflare" | "development";
};

export function normalizePeerAddress(value: string | null): string | null {
  if (!value || value.length > 64 || !/^[0-9a-f:.]+$/i.test(value)) return null;
  if (!value.includes(":")) {
    const parts = value.split(".");
    return parts.length === 4 &&
      parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
      ? parts.join(".")
      : null;
  }
  try {
    const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16),
        low = Number.parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join(".");
    }
    return normalized;
  } catch {
    return null;
  }
}

/** Select trust from server bindings, never forwarding headers or Request.cf. */
export function requestSource(
  request: { headers: Headers },
  env: { LOCAL_IRC_BRIDGE_SECRET?: string; REQUEST_SOURCE?: string },
): RequestSource | null {
  if (env.LOCAL_IRC_BRIDGE_SECRET) {
    if (request.headers.get("x-local-ingress") !== env.LOCAL_IRC_BRIDGE_SECRET) return null;
    const ip = normalizePeerAddress(request.headers.get("cf-connecting-ip"));
    return ip ? { ip, kind: "local-ingress" } : null;
  }
  if (env.REQUEST_SOURCE === "cloudflare") {
    const ip = normalizePeerAddress(request.headers.get("cf-connecting-ip"));
    return ip ? { ip, kind: "cloudflare" } : null;
  }
  if (env.REQUEST_SOURCE && env.REQUEST_SOURCE !== "development") return null;
  // Direct development/test workerd has no authenticated ingress. Treat it as
  // one loopback source: caller-controlled headers cannot rotate a budget or
  // change the host used for bans. Public deployments must select an ingress.
  return { ip: "127.0.0.1", kind: "development" };
}

/** REST/events use the persisted account name; IRC uses its actual nick/user. */
export function accountSourceMask(username: string, source: RequestSource): string {
  return `${username}!${username}@${source.ip}`;
}
