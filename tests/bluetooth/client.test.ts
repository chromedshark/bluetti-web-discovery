import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock the constants module to use a shorter timeout for tests
mock.module("../../src/bluetooth/constants.ts", () => ({
  BLUETTI_SERVICE_UUID: 0xff00,
  BLUETTI_WRITE_UUID: "0000ff02-0000-1000-8000-00805f9b34fb",
  BLUETTI_NOTIFY_UUID: "0000ff01-0000-1000-8000-00805f9b34fb",
  RESPONSE_TIMEOUT_MS: 50, // 50ms instead of 5000ms for faster tests
  MAX_PACKET_SIZE: 20,
  MAX_REGISTERS_PER_REQUEST: 7,
}));

import {
  BluetoothClient,
  ModbusError,
  ChecksumError,
  TimeoutError,
} from "../../src/bluetooth/client.ts";
import {
  MockBluetoothDevice,
  createMockBluetooth,
  createRange,
} from "../../src/testing/mock-bluetooth-device.ts";

async function connectedClient() {
  const client = await BluetoothClient.request();
  await client.connect();
  return client;
}

describe("BluetoothClient", () => {
  let mockDevice: MockBluetoothDevice;
  let originalBluetooth: Bluetooth | undefined;

  beforeEach(() => {
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

  describe("readRegisters()", () => {
    test("reads single register", async () => {
      const client = await connectedClient();
      const data = await client.readRegisters(0, 1);

      expect(data).toEqual(new Uint8Array([0x00, 0x64])); // 100
    });

    test("reads multiple registers", async () => {
      const client = await connectedClient();
      const data = await client.readRegisters(0, 3);

      expect(data.length).toBe(6);
      expect(data).toEqual(
        new Uint8Array([
          0x00,
          0x64, // Register 0 = 100
          0x00,
          0xc8, // Register 1 = 200
          0x01,
          0x2c, // Register 2 = 300
        ])
      );
    });

    test("reads from different address", async () => {
      const client = await connectedClient();
      const data = await client.readRegisters(10, 2);

      expect(data).toEqual(
        new Uint8Array([
          0x12,
          0x34, // Register 10 = 0x1234
          0x56,
          0x78, // Register 11 = 0x5678
        ])
      );
    });

    test("returns zeros for uninitialized registers", async () => {
      const client = await connectedClient();
      const data = await client.readRegisters(50, 2);

      expect(data).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00]));
    });

    test("throws when response would exceed packet size", async () => {
      const client = await connectedClient();
      // 8 registers = 21 byte response, exceeds 20 byte limit
      await expect(client.readRegisters(0, 8)).rejects.toThrow(/exceeds max packet size/);
    });
  });

  describe("writeRegisters()", () => {
    test("writes single register", async () => {
      const client = await connectedClient();
      await client.writeRegisters(50, new Uint8Array([0x12, 0x34]));

      // Read back to verify
      const data = await client.readRegisters(50, 1);
      expect(data).toEqual(new Uint8Array([0x12, 0x34]));
    });

    test("writes multiple registers", async () => {
      const client = await connectedClient();
      await client.writeRegisters(50, new Uint8Array([0x11, 0x22, 0x33, 0x44]));

      const data = await client.readRegisters(50, 2);
      expect(data).toEqual(new Uint8Array([0x11, 0x22, 0x33, 0x44]));
    });

    test("throws on odd data length", async () => {
      const client = await connectedClient();
      await expect(client.writeRegisters(50, new Uint8Array([0x12, 0x34, 0x56]))).rejects.toThrow(
        /even/
      );
    });

    test("throws when command exceeds packet size", async () => {
      const client = await connectedClient();
      // 9 + 12 = 21 > 20 (MAX_PACKET_SIZE)
      await expect(client.writeRegisters(50, new Uint8Array(12))).rejects.toThrow(/too large/);
    });
  });

  describe("error handling", () => {
    test("throws ModbusError for invalid address", async () => {
      const client = await connectedClient();

      // Address 200 is outside readable range (0-99)
      await expect(client.readRegisters(200, 1)).rejects.toBeInstanceOf(ModbusError);

      try {
        await client.readRegisters(200, 1);
      } catch (e) {
        expect(e).toBeInstanceOf(ModbusError);
        expect((e as ModbusError).exceptionCode).toBe(0x02); // ILLEGAL_DATA_ADDRESS
      }
    });

    test("throws ModbusError for write to non-writable address", async () => {
      const client = await connectedClient();

      // Address 0 is readable but not writable
      await expect(client.writeRegisters(0, new Uint8Array([0x12, 0x34]))).rejects.toBeInstanceOf(
        ModbusError
      );
    });

    test("throws ChecksumError when CRC is corrupted", async () => {
      const client = await connectedClient();
      mockDevice.injectCrcError();

      await expect(client.readRegisters(0, 1)).rejects.toBeInstanceOf(ChecksumError);
    });

    test("throws TimeoutError when device doesn't respond", async () => {
      const client = await connectedClient();
      mockDevice.injectTimeout();

      await expect(client.readRegisters(0, 1)).rejects.toBeInstanceOf(TimeoutError);
    });
  });

  describe("integration tests", () => {
    test("automatically reconnects", async() => {
      const client = await connectedClient();

      // It doesn't consider itself disconnected until a failed command, which
      // just times out
      mockDevice.injectTimeout();
      await expect(client.readRegisters(50, 1)).rejects.toBeInstanceOf(TimeoutError);
      mockDevice.gatt.disconnect();

      // Try a command again, this time with a failed connection
      mockDevice.injectTimeout();
      await expect(client.writeRegisters(50, new Uint8Array([0xab, 0xcd]))).rejects.toBeInstanceOf(TimeoutError);

      // Finally try it and this time let it succeed
      await client.writeRegisters(50, new Uint8Array([0xab, 0xcd]));
      const data = await client.readRegisters(50, 1);
      expect(data).toEqual(new Uint8Array([0xab, 0xcd]));
    });
  });
});
