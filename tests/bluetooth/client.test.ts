import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock the constants module to use a shorter timeout for tests
mock.module("../../src/bluetooth/constants.ts", () => ({
  BLUETTI_SERVICE_UUID: 0xff00,
  BLUETTI_WRITE_UUID: "0000ff02-0000-1000-8000-00805f9b34fb",
  BLUETTI_NOTIFY_UUID: "0000ff01-0000-1000-8000-00805f9b34fb",
  RESPONSE_TIMEOUT_MS: 50, // 50ms instead of 5000ms for faster tests
  MAX_RETRIES: 5,
  MAX_PACKET_SIZE: 20,
  MAX_REGISTERS_PER_REQUEST: 7,
}));
import {
  BluetoothClient,
  ModbusError,
  ChecksumError,
  TimeoutError,
} from "../../src/bluetooth/client.ts";
import { ReadHoldingRegisters } from "../../src/modbus/commands.ts";
import {
  MockBluetoothDevice,
  createMockBluetooth,
  createRange,
} from "../../src/testing/mock-bluetooth-device.ts";

describe("BluetoothClient", () => {
  let mockDevice: MockBluetoothDevice;
  let client: BluetoothClient;
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

    client = new BluetoothClient();
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

  describe("connection", () => {
    test("connects to device via requestAndConnect", async () => {
      expect(client.isConnected).toBe(false);
      expect(client.deviceName).toBeNull();

      await client.requestAndConnect();

      expect(client.isConnected).toBe(true);
      expect(client.deviceName).toBe("AC300Test");
    });

    test("disconnects from device", async () => {
      await client.requestAndConnect();
      expect(client.isConnected).toBe(true);

      client.disconnect();

      expect(client.isConnected).toBe(false);
      expect(client.deviceName).toBeNull();
    });

    test("throws when sending command while disconnected", async () => {
      const cmd = new ReadHoldingRegisters(0, 1);

      await expect(client.sendCommand(cmd)).rejects.toThrow("Not connected");
    });
  });

  describe("sendCommand", () => {
    beforeEach(async () => {
      await client.requestAndConnect();
    });

    test("reads single register", async () => {
      const cmd = new ReadHoldingRegisters(0, 1);
      const data = await client.sendCommand(cmd);

      expect(data).toEqual(new Uint8Array([0x00, 0x64])); // 100
    });

    test("reads multiple registers", async () => {
      const cmd = new ReadHoldingRegisters(0, 3);
      const data = await client.sendCommand(cmd);

      // 3 registers * 2 bytes = 6 bytes
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
      const cmd = new ReadHoldingRegisters(10, 2);
      const data = await client.sendCommand(cmd);

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
      const cmd = new ReadHoldingRegisters(50, 2);
      const data = await client.sendCommand(cmd);

      expect(data).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00]));
    });
  });

  describe("error handling", () => {
    beforeEach(async () => {
      await client.requestAndConnect();
    });

    test("throws ModbusError for invalid address", async () => {
      // Address 200 is outside readable range (0-99)
      const cmd = new ReadHoldingRegisters(200, 1);

      await expect(client.sendCommand(cmd)).rejects.toBeInstanceOf(ModbusError);

      try {
        await client.sendCommand(cmd);
      } catch (e) {
        expect(e).toBeInstanceOf(ModbusError);
        expect((e as ModbusError).exceptionCode).toBe(0x02); // ILLEGAL_DATA_ADDRESS
      }
    });

    test("throws ChecksumError when CRC is corrupted", async () => {
      mockDevice.injectCrcError();

      const cmd = new ReadHoldingRegisters(0, 1);

      // With retries, it should eventually throw ChecksumError after all retries fail
      await expect(client.sendCommand(cmd, 1)).rejects.toBeInstanceOf(ChecksumError);
    });

    test("retries on checksum error and succeeds", async () => {
      // Inject one CRC error, then succeed
      mockDevice.injectCrcError(1);

      const cmd = new ReadHoldingRegisters(0, 1);
      const data = await client.sendCommand(cmd, 2); // Allow 2 attempts

      expect(data).toEqual(new Uint8Array([0x00, 0x64]));
    });

    test("throws TimeoutError when device doesn't respond", async () => {
      mockDevice.injectTimeout();

      const cmd = new ReadHoldingRegisters(0, 1);

      // Should timeout after retries exhausted (now only 50ms per attempt)
      await expect(client.sendCommand(cmd, 1)).rejects.toBeInstanceOf(TimeoutError);
    });

    test("retries on timeout and succeeds", async () => {
      // Inject one timeout, then succeed
      mockDevice.injectTimeout(1);

      const cmd = new ReadHoldingRegisters(0, 1);
      const data = await client.sendCommand(cmd, 2); // Allow 2 attempts

      expect(data).toEqual(new Uint8Array([0x00, 0x64]));
    });

    test("does not retry MODBUS errors", async () => {
      // MODBUS errors should be thrown immediately without retry
      const cmd = new ReadHoldingRegisters(200, 1); // Invalid address

      // Even with many retries, it should fail on first attempt
      await expect(client.sendCommand(cmd, 10)).rejects.toBeInstanceOf(ModbusError);
    });

    test("throws error when response exceeds max packet size", async () => {
      // 8 registers = 21 bytes response, exceeds 20 byte limit
      const cmd = new ReadHoldingRegisters(0, 8);

      await expect(client.sendCommand(cmd)).rejects.toThrow(
        "Response size 21 exceeds max packet size 20"
      );
    });

    test("allows 7 registers (19 byte response)", async () => {
      // 7 registers = 19 bytes response, within limit
      const cmd = new ReadHoldingRegisters(0, 7);
      const data = await client.sendCommand(cmd);

      expect(data.length).toBe(14); // 7 registers * 2 bytes
    });
  });

  describe("custom response override", () => {
    beforeEach(async () => {
      await client.requestAndConnect();
    });

    test("returns overridden response data", async () => {
      // Override with a valid MODBUS response for 1 register
      // [addr:1][fc:1][byteCount:1][data:2][crc:2]
      const customResponse = new Uint8Array([
        0x01,
        0x03,
        0x02,
        0xab,
        0xcd,
        0x00,
        0x00, // Placeholder CRC
      ]);

      // Calculate correct CRC
      const { crc16 } = await import("../../src/modbus/crc.ts");
      const crc = crc16(customResponse.subarray(0, -2));
      customResponse[5] = crc & 0xff;
      customResponse[6] = (crc >> 8) & 0xff;

      mockDevice.overrideNextResponse(customResponse);

      const cmd = new ReadHoldingRegisters(0, 1);
      const data = await client.sendCommand(cmd);

      expect(data).toEqual(new Uint8Array([0xab, 0xcd]));
    });
  });
});
