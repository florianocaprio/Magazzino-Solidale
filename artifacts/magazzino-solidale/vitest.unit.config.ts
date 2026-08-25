import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: [
      "src/lib/**/*.test.{ts,tsx}",
      "src/hooks/**/*.test.tsx",
      "src/components/**/*.test.tsx",
    ],
  },
});
