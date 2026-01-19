import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import {
  MockBluetoothDevice,
  createMockBluetooth,
  createRange,
} from "../../src/testing/mock-bluetooth-device.ts";

import { BluetoothClient } from "../../src/bluetooth/client.ts";
import { DeviceRecognizer } from "../../src/tools/recognizer.ts";
import { db } from "../../src/database";

async function connectedClient() {
  const client = await BluetoothClient.request();
  await client.connect();
  return client;
}

describe("DeviceRecognizer", () => {
  let mockDevice: MockBluetoothDevice;
  let originalBluetooth: Bluetooth | undefined;
  const options = { timeout: 100, retryLimit: 3, retryDelay: 50 };

  beforeEach(async () => {
    // Save original navigator.bluetooth
    originalBluetooth = navigator.bluetooth;

    // Clear database
    await db.devices.clear();
  });

  afterEach(() => {
    // Restore original navigator.bluetooth
    if (originalBluetooth !== undefined) {
      Object.defineProperty(navigator, "bluetooth", {
        value: originalBluetooth,
        configurable: true,
      });
    }
  });

  describe("protocol version 1", () => {
    beforeEach(() => {
      // Create mock device with test data
      mockDevice = new MockBluetoothDevice({
        name: "AC300Test",
        readableRanges: [createRange(10, 7)],
        writableRanges: [],
        registerData: [[10, Uint8Array.fromHex("41433330300000000000000003fa")]],
      });

      // Install mock
      Object.defineProperty(navigator, "bluetooth", {
        value: createMockBluetooth(mockDevice),
        configurable: true,
      });
    });

    test("it loads the protocol version and device type", async () => {
      const client = await connectedClient();
      const recognizer = new DeviceRecognizer(client);
      const record = await recognizer.recognize(options);
      expect(record.protocolVersion).toEqual(1018);
      expect(record.deviceType).toEqual("AC300");

      const saved = await db.devices.get(client.id);
      expect(saved).toEqual(record);
    });

    test("it loads the record from the database", async () => {
      const client = await connectedClient();

      const saved = {
        id: client.id,
        name: "NAME",
        protocolVersion: 1234,
        deviceType: "CHANGED",
      };
      await db.devices.put(saved);

      const recognizer = new DeviceRecognizer(client);
      const record = await recognizer.recognize();
      expect(record).toEqual(saved);
    });

    test("it automatically retries timeouts", async () => {
      const client = await connectedClient();
      mockDevice.injectTimeout(1);

      const recognizer = new DeviceRecognizer(client);
      await recognizer.recognize(options);
    });

    test("it automatically retries checksum errors", async () => {
      const client = await connectedClient();
      mockDevice.injectCrcError(1);

      const recognizer = new DeviceRecognizer(client);
      await recognizer.recognize(options);
    });

    test("it fails if it hits the retry limit", async () => {
      const client = await connectedClient();
      mockDevice.injectCrcError(4);

      const recognizer = new DeviceRecognizer(client);
      await expect(recognizer.recognize(options)).rejects.toThrow(/Retries exhausted/);
    });

    test("it fails immediately if hits a MODBUS error", async () => {
      const client = await connectedClient();
      const response = new Uint8Array([0x01, 0x83, 0x02, 0xc0, 0xf1]);
      mockDevice.failureInjector.overrideNextResponse(response);

      const recognizer = new DeviceRecognizer(client);
      await expect(recognizer.recognize(options)).rejects.toThrow(/MODBUS exception/);
    });
  });

  describe("protocol version 2", () => {
    beforeEach(() => {
      // Create mock device with test data
      mockDevice = new MockBluetoothDevice({
        name: "AP300Test",
        readableRanges: [createRange(16, 1), createRange(110, 6)],
        writableRanges: [],
        registerData: [
          [16, Uint8Array.fromHex("07df")],
          [110, Uint8Array.fromHex("504130330030000000000000")],
        ],
      });

      // Install mock
      Object.defineProperty(navigator, "bluetooth", {
        value: createMockBluetooth(mockDevice),
        configurable: true,
      });
    });

    test("it loads the protocol version and device type", async () => {
      const client = await connectedClient();
      const recognizer = new DeviceRecognizer(client);
      const record = await recognizer.recognize({ retryDelay: 100 });
      expect(record.protocolVersion).toEqual(2015);
      expect(record.deviceType).toEqual("AP300");
    });
  });
});
