import { createBdd, test as base } from "playwright-bdd";
import type { BluetoothMock } from "../../src/testing/playwright-init";
import type { BluettiDatabase } from "../../src/database/db";

declare global {
  interface Navigator {
    mockBluetooth: BluetoothMock;
  }

  interface Window {
    appDb: BluettiDatabase;
  }
}

type CustomFixtures = {
  autoInitScript: void;
};

export const test = base.extend<CustomFixtures>({
  autoInitScript: [
    async ({ page }, use) => {
      await page.addInitScript({ path: "./dist/playwright-init.js" });
      await use();
    },
    { auto: true },
  ],
});

export const { Given, When, Then } = createBdd(test);
