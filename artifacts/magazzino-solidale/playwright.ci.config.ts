import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "./playwright.config";

const file = process.env.QUALITY_E2E_FILE;
if (!file || !/^[a-z0-9-]+\.spec\.ts$/.test(file))
  throw new Error("An inventoried CI spec is required");
if (!process.env.QUALITY_TEST_IDENTITY || !process.env.QUALITY_E2E_JSON)
  throw new Error("Verified CI environment and evidence paths are required");
const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  ...base,
  testMatch: file,
  outputDir: process.env.QUALITY_E2E_OUTPUT,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: process.env.QUALITY_E2E_JSON }]],
  use: { ...base.use, baseURL: "http://127.0.0.1:19672" },
  webServer: [
    {
      command: "pnpm --filter @workspace/api-server exec tsx src/index.ts",
      cwd: root,
      env: { PORT: "19671" },
      url: "http://127.0.0.1:19671/api/healthz",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --filter @workspace/magazzino-solidale dev --host 127.0.0.1",
      cwd: root,
      env: {
        E2E_MODE: "true",
        PORT: "19672",
        BASE_PATH: "/",
        API_PROXY_TARGET: "http://127.0.0.1:19671",
      },
      url: "http://127.0.0.1:19672/login",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
