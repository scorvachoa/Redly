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
    // Sin esperas reales en los tests: los reintentos y las pausas del lote
    // se quedan a 0 para que la suite sea instantánea.
    env: {
      RETRY_BACKOFF_SECONDS: "0",
      BATCH_DELAY_SECONDS: "0",
      BATCH_PAGE_DELAY_SECONDS: "0",
    },
  },
});
