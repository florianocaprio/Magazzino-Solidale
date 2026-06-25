import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // These tests share a single real database, so they must not run in
    // parallel across files or workers.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
