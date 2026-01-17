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
  ctx: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  autoInitScript: void;
};

export const test = base.extend<CustomFixtures>({
  /** Create a context to make data passing between steps possible */
  ctx: async ({}, use) => {
    await use({});
  },

  /** Automatically load code into page that we need to make testing possible */
  autoInitScript: [
    async ({ page }, use) => {
      await page.addInitScript({ path: "./dist/playwright-init.js" });
      await use();
    },
    { auto: true },
  ],
});

export const { Given, When, Then } = createBdd(test);
