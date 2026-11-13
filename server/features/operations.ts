/** Shared mutation retry contract. Legacy operations may omit an ID; new command
 * transports require one. Expired IDs are rejected even after cache pruning. */
export const OPERATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OPERATION_FUTURE_SKEW_MS = 5 * 60 * 1000;

export class FeatureError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(`F3:${statusCode}:${code}:${message}`);
  }
}

/** Explicit authority denials survive Durable Object RPC as an Error message.
 * An unavailable authority or unexpected storage error is not a denial. */
export function isAuthorizationDenial(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^F3:(?:401:SESSION_EXPIRED|403:(?:SCOPE_FORBIDDEN|NETWORK_BANNED)):/.test(error.message)
  );
}

export function operationId(value: unknown, required = true, now = Date.now()): string {
  if (value === undefined && !required) return `${now}.${crypto.randomUUID()}`;
  if (
    typeof value !== "string" ||
    !/^\d{13}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new FeatureError(400, "INVALID_OPERATION_ID", "Use epochMilliseconds.UUID");
  const issued = Number(value.slice(0, 13));
  if (issued < now - OPERATION_WINDOW_MS)
    throw new FeatureError(410, "OPERATION_EXPIRED", "Operation retry window expired");
  if (issued > now + OPERATION_FUTURE_SKEW_MS)
    throw new FeatureError(400, "INVALID_OPERATION_ID", "Operation time is in the future");
  return value.toLowerCase();
}

export function operationValue(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(operationValue).join(",")}]`;
  if (input && typeof input === "object")
    return `{${Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${JSON.stringify(key)}:${operationValue(value)}`)
      .join(",")}}`;
  return JSON.stringify(input) ?? "null";
}
