import { defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "../core/config";

export default defineEventHandler(() => {
  return {
    ok: true,
    status: "healthy",
    service: "flarc",
    network: SERVER_CONFIG.networkId,
    server: SERVER_CONFIG.serverName,
    version: SERVER_CONFIG.version,
    time: new Date().toISOString(),
  };
});
