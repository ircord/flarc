import type { RequestSource } from "../../core/request-source";
export type SessionCredential =
  | { token: string; source?: RequestSource }
  | { sessionHash: string; source?: RequestSource }
  | { ircSessionId: string };

export type SessionActor = {
  id: string;
  username: string;
  roles: string[];
  credentialVersion: number;
  credential: SessionCredential;
};

export type ChannelSubscription = { channel: string; generation: string };
export type EventSubscriptions = {
  channels?: ChannelSubscription[];
  conversations?: string[];
  profiles?: string[];
};

export type JournalResource = {
  kind: "channel" | "conversation" | "profile" | "account";
  id: string;
  generation?: string;
  ownerId?: string;
};

export type SessionFeatureHost = {
  sql: SqlStorage;
  storage: DurableObjectStorage;
  actor(credential: SessionCredential, operation: string, resource: string): Promise<SessionActor>;
  authorizeEvent(actor: SessionActor, resource: JournalResource): Promise<boolean>;
  authorizePayload(actor: SessionActor, event: any, resource: JournalResource): Promise<boolean>;
  account(selector: string, active?: boolean): Promise<{ id: string; username: string } | null>;
  notifyJournal(): void;
  deliverMessage(message: any, actorId: string, peerId: string): Promise<void>;
};
