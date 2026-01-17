import { expect } from "@playwright/test";
import { Given, When } from "./baseTest";

Given("my browser supports Web Bluetooth", () => {
  // No-op - we always enable web bluetooth
});

Given("my browser does not support Web Bluetooth", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", { value: undefined, configurable: true });
  });
});

export const connectToDevice = Given(
  "I have successfully connected to a device",
  async ({ page }) => {
    await page.goto("/#/test/connect?protocolVersion=1001&deviceType=TEST");
    await expect(page.getByLabel("Loading")).toBeVisible();
    selectDevice({ page });
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
  }
);

export const selectDevice = When(
  "I select a Bluetti device from the Bluetooth picker",
  async ({ page }) => {
    await page.evaluate(() => {
      const device = navigator.mockBluetooth.buildDevice({
        name: "TEST1234",
        registerData: [
          [10, new Uint8Array([84, 69, 83, 84])],
          [16, new Uint8Array([3, 233])],
        ],
        readableRanges: [
          { start: 0, end: 50 },
          { start: 52, end: 100 },
        ],
        writableRanges: [{ start: 80, end: 100 }],
        encrypted: false,
      });
      navigator.mockBluetooth.resolveDevice(device);
    });
  }
);

When("I cancel the Bluetooth picker", async ({ page }) => {
  await page.evaluate(() => {
    navigator.mockBluetooth.resolveDevice(null);
  });
});

export const connectionFails = When(
  "the connection fails because {}",
  async ({ page }, reason: string) => {
    await page.evaluate(
      ([reason]) => {
        const device = navigator.mockBluetooth.buildDevice({
          name: "TEST1234",
          readableRanges: [{ start: 0, end: 50 }],
          writableRanges: [],
        });

        switch (reason) {
          case "the device never responded":
            device.injectTimeout();
            break;
          case "a MODBUS read error occurred": {
            const response = new Uint8Array([0x01, 0x83, 0x02, 0xc0, 0xf1]);
            device.failureInjector.overrideNextResponse(response);
            break;
          }
          case "the response had invalid checksum":
            device.failureInjector.injectCrcError();
            break;
          default:
            throw new Error(`Unhandled failure reason: ${reason}`);
        }

        navigator.mockBluetooth.resolveDevice(device);
      },
      [reason]
    );
  }
);
