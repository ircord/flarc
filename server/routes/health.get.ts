import { defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "../core/config";

export default defineEventHandler(() => {
  return {
    ok: true,
    service: "flarc",
    network: SERVER_CONFIG.networkId,
    server: SERVER_CONFIG.serverName,
    version: SERVER_CONFIG.version,
  };
});
