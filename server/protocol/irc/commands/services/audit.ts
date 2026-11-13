import { hashSessionToken } from "~/core/authentication/tokens";
import type { SessionAttachment } from "~/core/types";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import type { ISessionDO } from "../types";

type ServiceAction =
  | "service.chanserv.register"
  | "service.chanserv.op"
  | "service.chanserv.deop"
  | "service.chanserv.amode"
  | "service.chanserv.unregister"
  | "service.chanserv.drop"
  | "service.chanserv.purge"
  | "service.chanserv.clear"
  | "service.chanserv.set"
  | "service.chanserv.transfer"
  | "service.f.requestbot"
  | "service.f.unrequestbot"
  | "service.f.op"
  | "service.f.deop"
  | "service.f.voice"
  | "service.f.devoice"
  | "service.f.chanlev"
  | "service.f.welcome"
  | "service.nickserv.register"
  | "service.nickserv.saregister"
  | "service.nickserv.group"
  | "service.nickserv.drop"
  | "service.nickserv.unregister"
  | "service.nickserv.erase"
  | "service.nickserv.sadrop"
  | "service.nickserv.passwd"
  | "service.nickserv.password"
  | "service.nickserv.ghost"
  | "service.nickserv.set"
  | "service.hostserv.on"
  | "service.hostserv.off"
  | "service.hostserv.set"
  | "service.hostserv.del"
  | "service.histserv.delete"
  | "service.histserv.forget";

/** Capture the live immutable actor before a mutation can invalidate or delete it. */
export async function serviceAuditActor(
  session: ISessionDO,
  attachment: SessionAttachment,
): Promise<string | null> {
  if (!attachment.authenticated || !attachment.accountName) return null;
  try {
    const account = await session.getAccountsStub().getAccountByUsername(attachment.accountName);
    return account &&
      account.id === attachment.userId &&
      account.credentialVersion === (attachment.credentialVersion ?? 0)
      ? account.id
      : null;
  } catch {
    console.error("Service audit actor lookup failed");
    return null;
  }
}

/** Fixed action plus hashed identity only; never persist arguments, secrets or notices. */
export async function serviceAudit(
  session: ISessionDO,
  actor: string | null,
  action: ServiceAction,
  kind: "channel" | "account" | "message",
  target: string,
  outcome: "allowed" | "denied" | "error",
): Promise<void> {
  const normalized = canonicalizeIRCName(target);
  const fingerprint = normalized
    ? `${kind}:${(await hashSessionToken(normalized)).slice(0, 24)}`
    : kind;
  try {
    await session.getAccountsStub().appendAudit(actor, action, fingerprint, outcome, "service");
  } catch {
    // Audit and the service mutation are separate durable-object operations.
    console.error("Service audit write failed");
  }
}

export async function serviceAudited<T>(
  session: ISessionDO,
  actor: string | null,
  action: ServiceAction,
  kind: "channel" | "account" | "message",
  target: string,
  invoke: () => Promise<T>,
  allowed: (result: T) => boolean,
): Promise<T> {
  let result: T;
  try {
    result = await invoke();
  } catch (error) {
    await serviceAudit(session, actor, action, kind, target, "error");
    throw error;
  }
  await serviceAudit(session, actor, action, kind, target, allowed(result) ? "allowed" : "denied");
  return result;
}
