import { defineConfig } from "@playwright/test";

// Only the disposable M5B network alias is accepted. Servers are started and
// identified separately; never reuse an already-running host Vite server.
const baseURL = process.env.M5B_E2E_BASE_URL;
if (baseURL !== "http://web")
  throw new Error("M5B_E2E_BASE_URL must target the isolated WEB container");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/m5b-isolated",
  reporter: "line",
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-390x844",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: "tablet-portrait-768x1024",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: "tablet-landscape-1024x768",
      use: { viewport: { width: 1024, height: 768 }, hasTouch: true },
    },
    {
      name: "tablet-820x1180",
      use: { viewport: { width: 820, height: 1180 }, hasTouch: true },
    },
    {
      name: "desktop-1440x900",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
