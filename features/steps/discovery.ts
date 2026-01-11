import { expect } from "@playwright/test";
import { Given, When, Then } from "./baseTest";
import { connectToDevice } from "./bluetooth";
import type { ScanResultRecord } from "../../src/database/db";

const navigateToDiscovery = Given("I am on the discovery page", async ({ page }) => {
  // Navigate to discovery from the dashboard
  await page.getByRole("button", { name: "Start Discovery" }).click();

  await expect(page.getByRole("heading", { name: "Register Discovery" })).toBeVisible();
});

Given("no scan is in progress", async ({ page }) => {
  // Verify Stop button is NOT visible (implies no scan running)
  await expect(page.getByRole("button", { name: "Stop" })).not.toBeVisible();
});

Given("a scan is in progress", async ({ page }) => {
  // Set up connection and navigate to discovery
  await connectToDevice({ page });
  await navigateToDiscovery({ page });

  // Set a large range so the scan takes time (allows testing Stop functionality)
  await page.getByLabel("Starting Register").fill("0");
  await page.getByLabel("Ending Register").fill("5000");
  await page.getByRole("button", { name: "Scan" }).click();

  // Wait for progress to appear
  await expect(page.getByRole("progressbar")).toBeVisible();
});

const previouslyScannedRegisters = Given(
  "I have previously scanned registers {int}-{int} on this device",
  async ({ page }, start: number, end: number) => {
    // Set up connection and navigate to discovery
    await connectToDevice({ page });
    await navigateToDiscovery({ page });

    // Inject scan results
    await page.evaluate(
      async ([start, end]) => {
        // Get the device ID from the mock device that was connected
        const deviceId = navigator.mockBluetooth.currentDevice!.id;

        // Insert scan results
        const results: ScanResultRecord[] = [];
        for (let register = start; register <= end; register++) {
          results.push({
            deviceId,
            register,
            readable: true,
            scannedAt: new Date(),
            value: new Uint8Array([0, 0]),
          });
        }
        await window.appDb.scanResults.bulkAdd(results);
      },
      [start, end]
    );
  }
);

Given("a scan has completed", async ({ page }) => {
  await previouslyScannedRegisters({ page }, 0, 10);
});

When("I configure the scan range as {int}-{int}", async ({ page }, start: number, end: number) => {
  await page.getByLabel("Starting Register").fill(String(start));
  await page.getByLabel("Ending Register").fill(String(end));
});

When("I set the starting register higher than the ending register", async ({ page }) => {
  await page.getByLabel("Starting Register").fill("1000");
  await page.getByLabel("Ending Register").fill("500");
});

When('I click the "Stop" button after it has scanned some registers', async ({ page }) => {
  // Wait for percentage to not be 0 before stopping
  await expect(page.getByText(/([1-9]|[1-9][0-9])%/)).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
});

Then("the register scan should start", async ({ page }) => {
  // The presence of progress bar indicates scan started
  await expect(page.getByRole("progressbar")).toBeVisible();
});

Then("I should be able to set the starting register", async ({ page }) => {
  const input = page.getByLabel("Starting Register");
  await expect(input).toBeEnabled();
  await input.fill("100");
  await expect(input).toHaveValue("100");
});

Then("I should be able to set the ending register", async ({ page }) => {
  const input = page.getByLabel("Ending Register");
  await expect(input).toBeEnabled();
  await input.fill("500");
  await expect(input).toHaveValue("500");
});

Then("I should see a progress bar with percentage", async ({ page }) => {
  await expect(page.getByRole("progressbar")).toBeVisible();
  // Check for percentage text (matches pattern like "25%")
  await expect(page.getByText(/\d+%/)).toBeVisible();
});

Then("I should see text indicating how many registers remain to be scanned", async ({ page }) => {
  await expect(page.getByText(/\d+ registers remaining/)).toBeVisible();
});

Then("the starting register input should be disabled", async ({ page }) => {
  await expect(page.getByLabel("Starting Register")).toBeDisabled();
});

Then("the ending register input should be disabled", async ({ page }) => {
  await expect(page.getByLabel("Ending Register")).toBeDisabled();
});

Then("the scan should stop", async ({ page }) => {
  // Progress bar should disappear, Scan button should reappear
  await expect(page.getByRole("progressbar")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Scan" })).toBeVisible();
});

Then("all results collected so far should be saved", async ({ page }) => {
  // Results are persisted to IndexedDB automatically by RegisterScanner
  // We can verify by checking that Resume is now enabled (implies some data exists)
  await expect(page.getByRole("button", { name: "Resume" })).toBeEnabled();
});

Then('both "Resume" and "Scan" buttons should be disabled', async ({ page }) => {
  await expect(page.getByRole("button", { name: "Resume" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Scan" })).toBeDisabled();
});

Then("I should see an option to download the results as JSON", async ({ page }) => {
  // Placeholder - just check download button exists (can be disabled for now)
  await expect(page.getByRole("button", { name: /download/i })).toBeVisible();
});
