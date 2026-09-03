import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run only .test.ts files — skip scripts, dist, node_modules
    include: ["src/**/*.test.ts"],
    // Use the Node environment (no DOM needed for pure function tests)
    environment: "node",
    // Produce a clean, readable summary in CI
    reporters: ["verbose"],
  },
});
