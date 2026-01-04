import { createBdd } from "playwright-bdd";
import type { BluetoothMock } from "../../src/testing/playwright-init";

const { Given, When } = createBdd();

declare global {
  interface Navigator {
    mockBluetooth: BluetoothMock;
  }
}

Given("my browser supports Web Bluetooth", async ({ page }) => {
  await page.addInitScript({ path: "./dist/playwright-init.js" });
});

Given("my browser does not support Web Bluetooth", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", { configurable: true });
  });
});

When("I select a Bluetti device from the Bluetooth picker", async ({ page }) => {
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
});

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
