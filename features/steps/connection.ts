import { expect } from "@playwright/test";
import { Given, Then } from "./baseTest";
import { connectionFails } from "./bluetooth";

Given("I am on the connection page", async ({ page }) => {
  await page.goto("/");
});

Given("a previous connection attempt failed", async ({ page }) => {
  await page.getByRole("button", { name: "Connect" }).click();
  await connectionFails({ page }, "the device never responded");
});

Then("I should see the device name", async ({ page }) => {
  await expect(page.locator('dt:has-text("Name") + dd')).toHaveText("TEST1234");
});

Then("I should see the protocol version", async ({ page }) => {
  await expect(page.locator('dt:has-text("Protocol Version") + dd')).toHaveText("1001");
});

Then("I should see the device type", async ({ page }) => {
  await expect(page.locator('dt:has-text("Device Type") + dd')).toHaveText("TEST");
});

Then(
  "I should see an error message indicating Web Bluetooth is not supported",
  async ({ page }) => {
    await expect(page.locator(".warning")).toHaveText(
      /Your browser does not support Web Bluetooth/
    );
  }
);

Then("I should remain on the connection page with no device connected", async ({ page }) => {
  await expect(page.getByText("Connect to your Bluetti power station")).toBeVisible();
});

Then('the "Connect" button should still be available', async ({ page }) => {
  await expect(page.getByRole("button", { name: "Connect" })).toBeEnabled();
});

Then("I should see an error message indicating {string}", async ({ page }, error: string) => {
  await expect(page.locator(".error-message")).toHaveText(new RegExp(error), { timeout: 7000 });
});
