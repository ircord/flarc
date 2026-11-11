import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "nitro/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  preset: "cloudflare_module",
  compatibilityDate: "2025-02-04",
  serverDir: "server",
  serverEntry: "server.ts",
  alias: {
    "~": path.resolve(__dirname, "server"),
    "@": path.resolve(__dirname, "server"),
  },
  typescript: {
    tsConfig: {
      compilerOptions: {
        strict: true,
      },
    },
  },
});
