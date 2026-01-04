import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

When("I click the {string} button", async ({ page }, name: string) => {
  await page.getByRole("button", { name }).click();
});

Then("the {string} button should be disabled", async ({ page }, name: string) => {
  await expect(page.getByRole("button", { name })).toBeDisabled();
});
