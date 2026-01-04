import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const testDir = defineBddConfig({
  featuresRoot: "./features",
  quotes: "double",
  // missingSteps: "skip-scenario",
});

export default defineConfig({
  testDir,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: "http://localhost:3001",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "bun run serve:test",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
  },
});
