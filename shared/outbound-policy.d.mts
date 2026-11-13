export type OutboundPurpose = "embeds" | "webhooks" | "push";
export interface OutboundPolicy {
  readonly version: 1;
  readonly embeds: readonly string[];
  readonly webhooks: readonly string[];
  readonly push: readonly string[];
}
export interface OutboundPolicyEnv {
  ALLOWLIST_YAML?: string;
  EMBED_ALLOWED_HOSTS?: string;
  OUTGOING_WEBHOOK_ALLOWED_HOSTS?: string;
  PUSH_ALLOWED_HOSTS?: string;
}
export const EMPTY_OUTBOUND_ALLOWLIST: string;
export function parseOutboundAllowlist(source: string): OutboundPolicy;
export function outboundHosts(env: OutboundPolicyEnv, purpose: OutboundPurpose): string[];
