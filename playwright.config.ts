import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { OWNER_STORAGE_STATE } from "./tests/e2e/helpers";

// Playwright, like Vitest, does not auto-load .env — globalSetup needs
// DATABASE_URL to reset the database between runs. See the same note in
// vitest.config.ts about why this uses the Node built-in rather than a
// dependency.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  // The suite drives one household through first-run setup; running files
  // in parallel against a single shared database would have them fight
  // over the same `isSetupComplete()` gate (ADR-012 allows exactly one
  // bootstrap). Revisit with per-worker databases if the suite grows
  // enough for serial execution to hurt.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Runs first and once: performs the real first-run bootstrap journey
    // and saves the owner session the browser projects reuse. See
    // tests/e2e/auth.setup.ts for why sharing one session matters (the
    // suite otherwise trips the app's own sign-in rate limit).
    { name: "setup", testMatch: /.*\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: OWNER_STORAGE_STATE },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: OWNER_STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Runs the standalone bundle — the same artifact the Dockerfile runs —
    // rather than `next start`, which Next.js warns is incompatible with
    // `output: "standalone"`. See scripts/serve-standalone.mjs for why
    // testing the real artifact matters here.
    command: "node scripts/serve-standalone.mjs",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
