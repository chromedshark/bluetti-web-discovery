import { expect } from "@playwright/test";
import { When, Then } from "./baseTest";

When("I click the {string} button", async ({ page }, name: string) => {
  await page.getByRole("button", { name }).click();
});

Then("the {string} button should be disabled", async ({ page }, name: string) => {
  await expect(page.getByRole("button", { name })).toBeDisabled();
});

Then("the {string} button should be enabled", async ({ page }, name: string) => {
  await expect(page.getByRole("button", { name })).toBeEnabled();
});
