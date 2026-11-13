import type { z } from "zod";
import { SERVER_CONFIG } from "../../core/config";
import type { Env } from "../../core/types";
import type { ChannelCreateSchema } from "../../schemas/channels";

type BasicResult = { ok: boolean; channelName: string };
interface ChannelFeatureRpc {
  getExistingChannelGeneration(): Promise<string | null>;
  accountCreate(
    token: string,
    name: string,
    settings: z.infer<typeof ChannelCreateSchema>,
  ): Promise<{ ok: boolean; channel?: string; generation?: string; reason?: string }>;
  accountJoin(token: string, name: string, generation: string, key?: string): Promise<BasicResult>;
  accountLeave(token: string, name: string, generation: string): Promise<BasicResult>;
  accountInvite(
    token: string,
    name: string,
    generation: string,
    target: string,
    remove?: boolean,
  ): Promise<BasicResult>;
  accountDestroy(
    token: string,
    name: string,
    generation: string,
    purge?: boolean,
  ): Promise<{ ok: boolean; channel: string; generation: string }>;
  accountMembers(
    token: string,
    name: string,
    generation: string,
  ): Promise<{
    ok: boolean;
    channel: string;
    generation: string;
    members: Array<{ userId: string; username: string; origins: string[]; modes: string }>;
  }>;
}

export function channelFeatureStub(env: Env, canonicalName: string): ChannelFeatureRpc {
  const namespace = env.CHANNELS as unknown as {
    idFromName(name: string): unknown;
    get(id: unknown): ChannelFeatureRpc;
  };
  return namespace.get(namespace.idFromName(`${SERVER_CONFIG.networkId}:${canonicalName}`));
}
