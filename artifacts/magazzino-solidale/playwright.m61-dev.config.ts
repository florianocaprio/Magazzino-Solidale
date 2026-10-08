import { defineConfig } from "@playwright/test";

const url = new URL(process.env.E2E_DATABASE_URL ?? "");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "58461" ||
  url.pathname !== "/m61_e2e"
)
  throw new Error(
    "M6.1 E2E richiede esclusivamente il PostgreSQL effimero dedicato",
  );

export default defineConfig({
  testDir: "./e2e",
  testMatch: "mensa-workflows.spec.ts",
  outputDir:
    process.env.M61_E2E_OUTPUT ?? "/private/tmp/magazzino-m61-e2e-output",
  reporter: "line",
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:19463",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-1440x900",
      use: { viewport: { width: 1440, height: 900 } },
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
      name: "mobile-390x844",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
});
