import { createError, defineEventHandler, getHeader, toRequest } from "nitro/h3";
import { SERVER_CONFIG } from "~/core/config";
import { requestSource } from "~/core/request-source";
import { shardName } from "~/features/session/event-shards";
import { relayEventUpgrade } from "~/features/session/upgrade-transport";
import { getEnv } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  if (getHeader(event, "upgrade")?.toLowerCase() !== "websocket")
    throw createError({ statusCode: 426, statusMessage: "Expected WebSocket upgrade" });
  const env = getEnv(event),
    source = requestSource(event.req, env);
  if (!source) throw createError({ statusCode: 403, statusMessage: "Unverified request source" });
  const request = toRequest((event as any).req);
  const authority = env.SESSION.get(env.SESSION.idFromName(SERVER_CONFIG.networkId));
  const result = await authority.admitEventConnection({
    url: request.url,
    authorization: request.headers.get("Authorization"),
    protocol: request.headers.get("Sec-WebSocket-Protocol"),
    origin: request.headers.get("Origin"),
    source,
  });
  if (!result.ok)
    return new Response(result.text, {
      status: result.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  const { admission, networkId } = result;
  try {
    const shard = env.SESSION.get(env.SESSION.idFromName(shardName(networkId, admission.shard)));
    const response = await shard.fetch(
      new Request(new URL("/_internal/events-shard", request.url), {
        headers: { Upgrade: "websocket", "x-flarc-event-admission": JSON.stringify(admission) },
      }),
    );
    if (response.status !== 101)
      await authority.releaseEventShard(admission.lease, admission.shard);
    return response.status === 101 ? relayEventUpgrade(response) : response;
  } catch (error) {
    await authority.releaseEventShard(admission.lease, admission.shard).catch(() => {});
    throw error;
  }
});
