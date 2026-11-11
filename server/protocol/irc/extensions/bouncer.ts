/**
 * IRC Bouncer Networks Extension (soju.im/bouncer-networks)
 *
 * Implements bouncer network listing and control:
 *   BOUNCER LISTNETWORKS
 *   BOUNCER BINDNETWORK <network>
 *
 * References:
 * - soju.im/bouncer-networks specification
 */

export const BOUNCER_NETWORKS_CAP = "soju.im/bouncer-networks";

export interface BouncerNetworkInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  connected: boolean;
}

export function formatBouncerNetworkReply(
  serverName: string,
  clientNick: string,
  network: BouncerNetworkInfo,
): string {
  // Format: :<server> BOUNCER NETWORK <id> <name> <host> <port> <status>
  const status = network.connected ? "connected" : "disconnected";
  return `:${serverName} BOUNCER NETWORK ${network.id} ${network.name} ${network.host} ${network.port} ${status}`;
}
