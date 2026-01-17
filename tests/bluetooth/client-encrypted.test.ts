import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

import {
  BLUETTI_SERVICE_UUID,
  BLUETTI_WRITE_UUID,
  BLUETTI_NOTIFY_UUID,
  MockBluetoothDevice,
  createMockBluetooth,
  createRange,
} from "../../src/testing/mock-bluetooth-device.ts";

// Mock the constants module to use a shorter timeout for tests
mock.module("../../src/bluetooth/constants.ts", () => ({
  BLUETTI_SERVICE_UUID,
  BLUETTI_WRITE_UUID,
  BLUETTI_NOTIFY_UUID,
  RESPONSE_TIMEOUT_MS: 500, // 500ms for faster tests
  INITIAL_ENCRYPTION_TIMEOUT_MS: 50, // 50ms for faster tests
  MAX_PACKET_SIZE: 20,
  MAX_REGISTERS_PER_REQUEST: 7,
}));

import { BluetoothClient, TimeoutError } from "../../src/bluetooth/client.ts";

async function connectedClient() {
  const client = await BluetoothClient.request();
  await client.connect();
  return client;
}

describe("BluetoothClient encryption", () => {
  let mockDevice: MockBluetoothDevice;
  let originalBluetooth: Bluetooth | undefined;

  beforeEach(async () => {
    // Save original navigator.bluetooth
    originalBluetooth = navigator.bluetooth;

    // Create mock device with test data
    mockDevice = new MockBluetoothDevice({
      name: "AC300Test",
      readableRanges: [createRange(0, 100)],
      writableRanges: [createRange(50, 20)],
      registerData: [
        [0, new Uint8Array([0x00, 0x64])], // Register 0 = 100
        [1, new Uint8Array([0x00, 0xc8])], // Register 1 = 200
        [2, new Uint8Array([0x01, 0x2c])], // Register 2 = 300
        [10, new Uint8Array([0x12, 0x34])], // Register 10 = 0x1234
        [11, new Uint8Array([0x56, 0x78])], // Register 11 = 0x5678
      ],
      encrypted: true,
    });

    // Install mock
    Object.defineProperty(navigator, "bluetooth", {
      value: createMockBluetooth(mockDevice),
      configurable: true,
    });
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

  describe("request()", () => {
    test("returns client instance with device but not connected", async () => {
      const client = await BluetoothClient.request();

      expect(client.deviceName).toBe("AC300Test");
      expect(client.isConnected).toBe(false);
    });
  });

  describe("connect()", () => {
    test("connects to GATT server", async () => {
      const client = await BluetoothClient.request();
      expect(client.isConnected).toBe(false);

      await client.connect();

      expect(client.isConnected).toBe(true);
    });

    test("can reconnect after disconnect", async () => {
      const client = await BluetoothClient.request();
      await client.connect();
      expect(client.isConnected).toBe(true);

      client.disconnect();
      expect(client.isConnected).toBe(false);

      await client.connect();
      expect(client.isConnected).toBe(true);
    });
  });

  describe("disconnect()", () => {
    test("disconnects from device", async () => {
      const client = await connectedClient();
      expect(client.isConnected).toBe(true);

      client.disconnect();

      expect(client.isConnected).toBe(false);
      // deviceName is still available (device reference kept)
      expect(client.deviceName).toBe("AC300Test");
    });
  });

  describe("integration tests", () => {
    test("automatically reconnects", async () => {
      const client = await connectedClient();

      // It doesn't consider itself disconnected until a failed command, which
      // just times out
      mockDevice.injectTimeout();
      await expect(client.readRegisters(50, 1)).rejects.toBeInstanceOf(TimeoutError);
      mockDevice.gatt.disconnect();

      // Try a command again, this time with a failed connection
      mockDevice.injectTimeout();
      await expect(client.writeRegisters(50, new Uint8Array([0xab, 0xcd]))).rejects.toBeInstanceOf(
        TimeoutError
      );

      // Finally try it and this time let it succeed
      await client.writeRegisters(50, new Uint8Array([0xab, 0xcd]));
      const data = await client.readRegisters(50, 1);
      expect(data).toEqual(new Uint8Array([0xab, 0xcd]));
    });
  });
});
