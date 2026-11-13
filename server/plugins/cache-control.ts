import { definePlugin } from "nitro";

// H3 creates a new error response and drops ordinary event response headers.
// Apply the same policy to the final response without consuming its body.
export default definePlugin((nitro) => {
  nitro.hooks?.hook("response", (response, event) => {
    if (response.status === 101) return; // Preserve workerd WebSocket upgrades.
    const path = new URL(event.req.url).pathname.replace(/\/+$/, "");
    if (
      path === "/api" ||
      path.startsWith("/api/") ||
      path === "/admin" ||
      path.startsWith("/admin/") ||
      path === "/media" ||
      path.startsWith("/media/") ||
      path === "/metrics"
    )
      response.headers.set("Cache-Control", "private, no-store");
  });
});
