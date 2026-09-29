import { defineConfig } from "@playwright/test";

if (process.env.M5C1_E2E_BASE_URL !== "http://web") {
  throw new Error("M5C1 browser tests require the isolated WEB container");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/m5c1-isolated",
  reporter: "line",
  retries: 0,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://web",
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
