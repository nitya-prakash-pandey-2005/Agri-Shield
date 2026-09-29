import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite (spec §14). Boots an isolated dev server on :3199 with its own
 * dist dir so it never collides with other local servers.
 *   pnpm --filter @agri-shield/web test:e2e
 *   npx playwright install chromium   # first run only
 */
const PORT = Number(process.env.E2E_PORT ?? 3199);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(pwa|landing)\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `${baseURL}/api/v1/health?deep=0`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          NEXT_DIST_DIR: ".next-e2e",
          DISABLE_SCHEDULER: "true",
          NEXT_PUBLIC_DEMO_MODE: "true",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});
