import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run only .test.ts files — skip scripts, dist, node_modules
    include: ["src/**/*.test.ts"],
    // Use the Node environment (no DOM needed for pure function tests)
    environment: "node",
    // Produce a clean, readable summary in CI
    reporters: ["verbose"],
    // Stub the required env vars so config/index.ts doesn't throw at import
    // time when running pure unit tests that have no real infrastructure.
    // These values are never used by the tests themselves — they only satisfy
    // the Zod schema that runs eagerly when the config module is loaded.
    env: {
      GEMINI_API_KEY: "test-key",
      CLICKHOUSE_HOST: "localhost",
      CLICKHOUSE_PASSWORD: "test-password",
    },
  },
});
