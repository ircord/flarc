import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["old/**", "node_modules/**", ".output/**", ".nitro/**"],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "server"),
      "@": path.resolve(__dirname, "server"),
    },
  },
});
