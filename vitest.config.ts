import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    // Sin esperas reales en los tests: el retroceso entre intentos se deja en
    // 0 s para que la suite sea instantánea (el número de intentos no cambia).
    env: {
      RETRY_BACKOFF_SECONDS: "0",
    },
  },
});
