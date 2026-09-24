import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests run in the zone production runs in. A suite that passes only on the
// author's clock is how a zone bug in `map.ts` shipped: it read Lagos locally
// and UTC everywhere that mattered.
process.env.TZ = "UTC";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
