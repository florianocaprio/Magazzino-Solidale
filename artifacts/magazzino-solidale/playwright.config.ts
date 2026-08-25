import { defineConfig } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required");

const apiPort = 18181;
const webPort = 4173;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/playwright",
  reporter: process.env.CI ? "github" : "line",
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `env DATABASE_URL=${databaseUrl} SESSION_SECRET=e2e-session-secret-only COOKIE_SECURE=false COOKIE_SAMESITE=lax PORT=${apiPort} pnpm --filter @workspace/api-server exec tsx src/index.ts`,
      url: `http://127.0.0.1:${apiPort}/api/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `env E2E_MODE=true PORT=${webPort} BASE_PATH=/ API_PROXY_TARGET=http://127.0.0.1:${apiPort} pnpm --filter @workspace/magazzino-solidale dev`,
      url: `http://127.0.0.1:${webPort}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "mobile-390x844", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet-portrait-768x1024", use: { viewport: { width: 768, height: 1024 } } },
    { name: "tablet-landscape-1024x768", use: { viewport: { width: 1024, height: 768 } } },
    { name: "tablet-820x1180", use: { viewport: { width: 820, height: 1180 } } },
    { name: "desktop-1440x900", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
