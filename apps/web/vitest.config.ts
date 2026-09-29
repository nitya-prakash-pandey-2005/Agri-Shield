import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}` },
      { find: "@agri-shield/types", replacement: fileURLToPath(new URL("../../packages/types/src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Never touch the network or start timers from unit tests unless a test opts in.
    env: {
      AGRI_OFFLINE: "true",
      DISABLE_SCHEDULER: "true",
      NEXT_PUBLIC_DEMO_MODE: "true",
      ML_API_URL: "http://ml.test.local",
    },
    pool: "forks",
    reporters: ["default"],
  },
});
