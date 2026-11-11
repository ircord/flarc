import { SERVER_CONFIG } from "../../../core/config";
import { CORE_CAPABILITIES } from "./core";
import { DRAFT_CAPABILITIES } from "./drafts";
import { EXTENSION_CAPABILITIES } from "./extensions";

export const SUPPORTED_CAPABILITIES: Record<string, string | null> = {
  ...CORE_CAPABILITIES,
  ...DRAFT_CAPABILITIES,
  ...EXTENSION_CAPABILITIES,
};

export function getSupportedCapabilities(env?: Record<string, any>): Record<string, string | null> {
  const caps = { ...SUPPORTED_CAPABILITIES };
  const regBeforeConnect =
    env?.REG_BEFORE_CONNECT ??
    env?.CFCORD_REG_BEFORE_CONNECT ??
    (typeof process !== "undefined"
      ? process?.env?.REG_BEFORE_CONNECT ?? process?.env?.CFCORD_REG_BEFORE_CONNECT
      : undefined);
  const regEmailReq =
    env?.REG_REQUIRES_EMAIL ??
    env?.CFCORD_REG_REQUIRES_EMAIL ??
    (typeof process !== "undefined"
      ? process?.env?.REG_REQUIRES_EMAIL ?? process?.env?.CFCORD_REG_REQUIRES_EMAIL
      : undefined);

  const regFeatures: string[] = [];
  if (regEmailReq === "1") {
    regFeatures.push("email-required");
  }
  if (regBeforeConnect !== "0") {
    regFeatures.push("before-connect");
  }
  caps["draft/account-registration"] = regFeatures.length > 0 ? regFeatures.join(",") : null;

  if (SERVER_CONFIG.filehostEnabled) {
    caps["draft/filehost"] = "/api/media/upload";
    caps["soju.im/filehost"] = "/api/media/upload";
  }

  return caps;
}

export function formatCapabilitiesList(includeValues: boolean, env?: Record<string, any>): string {
  return Object.entries(getSupportedCapabilities(env))
    .map(([name, val]) => (includeValues && val ? `${name}=${val}` : name))
    .join(" ");
}

export function isSupportedCapability(capName: string): boolean {
  const normalized = capName.toLowerCase();
  // ergo.chat/nope is advertised in CAP LS as a canary and MUST be rejected on CAP REQ per https://ergo.chat/specs/
  if (normalized === "ergo.chat/nope") {
    return false;
  }
  return Object.hasOwn(SUPPORTED_CAPABILITIES, normalized);
}
