import { describe, test, expect, beforeEach } from "bun:test";
import {
  MockBluetoothDevice,
  createMockBluetooth,
  createRange,
  BLUETTI_SERVICE_UUID,
  BLUETTI_WRITE_UUID,
  BLUETTI_NOTIFY_UUID,
  ConnectionErrorType,
  BleError,
} from "../../src/testing/mock-bluetooth-device.ts";
import { ReadHoldingRegisters } from "../../src/modbus/commands.ts";

describe("MockBluetoothDevice", () => {
  let device: MockBluetoothDevice;

  beforeEach(() => {
    device = new MockBluetoothDevice({
      name: "AC3001234567890",
      registerData: [
        [10, new Uint8Array([0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c])], // 100, 200, 300
      ],
      readableRanges: [createRange(0, 100), createRange(3000, 100)],
      writableRanges: [createRange(3000, 100)],
    });
  });

  describe("basic properties", () => {
    test("has name and id", () => {
      expect(device.name).toBe("AC3001234567890");
      expect(device.id).toMatch(/^mock-device-/);
    });

    test("provides access to register memory", () => {
      const memory = device.registerMemory;
      const data = memory.readRegisters(10, 3);

      expect(Array.from(data)).toEqual([0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c]);
    });
  });

  describe("GATT connection", () => {
    test("connects and disconnects", async () => {
      const gatt = device.gatt;

      expect(gatt.connected).toBe(false);

      await gatt.connect();
      expect(gatt.connected).toBe(true);

      gatt.disconnect();
      expect(gatt.connected).toBe(false);
    });

    test("gets primary service", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);

      expect(service.uuid).toBe(BLUETTI_SERVICE_UUID);
    });

    test("throws for unknown service", async () => {
      const gatt = await device.gatt.connect();

      await expect(gatt.getPrimaryService(0x1234)).rejects.toThrow("Unknown service UUID");
    });
  });

  describe("characteristics", () => {
    test("gets write and notify characteristics", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);

      const writeChar = await service.getCharacteristic(BLUETTI_WRITE_UUID);
      const notifyChar = await service.getCharacteristic(BLUETTI_NOTIFY_UUID);

      expect(writeChar.uuid).toBe(BLUETTI_WRITE_UUID);
      expect(notifyChar.uuid).toBe(BLUETTI_NOTIFY_UUID);
    });

    test("throws for unknown characteristic", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);

      await expect(service.getCharacteristic("unknown")).rejects.toThrow(
        "Unknown characteristic UUID"
      );
    });
  });

  describe("MODBUS communication", () => {
    test("sends command and receives response", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);
      const writeChar = await service.getCharacteristic(BLUETTI_WRITE_UUID);
      const notifyChar = await service.getCharacteristic(BLUETTI_NOTIFY_UUID);

      // Set up notification listener
      let response: DataView | null = null;
      notifyChar.addEventListener("characteristicvaluechanged", (event) => {
        response = event.target.value;
      });
      await notifyChar.startNotifications();

      // Send ReadHoldingRegisters command
      const cmd = new ReadHoldingRegisters(10, 3);
      await writeChar.writeValue(cmd.command);

      // Verify response
      expect(response).not.toBeNull();
      const responseBytes = new Uint8Array(
        response!.buffer,
        response!.byteOffset,
        response!.byteLength
      );

      // Should be valid response
      expect(cmd.isValidResponse(responseBytes)).toBe(true);

      // Parse and verify data
      const data = cmd.parseResponse(responseBytes);
      expect(Array.from(data)).toEqual([0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c]);
    });

    test("handles read from uninitialized registers", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);
      const writeChar = await service.getCharacteristic(BLUETTI_WRITE_UUID);
      const notifyChar = await service.getCharacteristic(BLUETTI_NOTIFY_UUID);

      let response: DataView | null = null;
      notifyChar.addEventListener("characteristicvaluechanged", (event) => {
        response = event.target.value;
      });
      await notifyChar.startNotifications();

      // Read from uninitialized address
      const cmd = new ReadHoldingRegisters(0, 2);
      await writeChar.writeValue(cmd.command);

      expect(response).not.toBeNull();
      const responseBytes = new Uint8Array(
        response!.buffer,
        response!.byteOffset,
        response!.byteLength
      );

      const data = cmd.parseResponse(responseBytes);
      expect(Array.from(data)).toEqual([0, 0, 0, 0]);
    });
  });

  describe("failure injection", () => {
    test("injects timeout (no response)", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);
      const writeChar = await service.getCharacteristic(BLUETTI_WRITE_UUID);
      const notifyChar = await service.getCharacteristic(BLUETTI_NOTIFY_UUID);

      let responseCount = 0;
      notifyChar.addEventListener("characteristicvaluechanged", () => {
        responseCount++;
      });
      await notifyChar.startNotifications();

      // Inject timeout
      device.injectTimeout();

      const cmd = new ReadHoldingRegisters(10, 1);
      await writeChar.writeValue(cmd.command);

      // No response should be received
      expect(responseCount).toBe(0);

      // Next command should work
      await writeChar.writeValue(cmd.command);
      expect(responseCount).toBe(1);
    });

    test("injects CRC error", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);
      const writeChar = await service.getCharacteristic(BLUETTI_WRITE_UUID);
      const notifyChar = await service.getCharacteristic(BLUETTI_NOTIFY_UUID);

      let response: DataView | null = null;
      notifyChar.addEventListener("characteristicvaluechanged", (event) => {
        response = event.target.value;
      });
      await notifyChar.startNotifications();

      // Inject CRC error
      device.injectCrcError();

      const cmd = new ReadHoldingRegisters(10, 1);
      await writeChar.writeValue(cmd.command);

      expect(response).not.toBeNull();
      const responseBytes = new Uint8Array(
        response!.buffer,
        response!.byteOffset,
        response!.byteLength
      );

      // CRC should be invalid
      expect(cmd.isValidResponse(responseBytes)).toBe(false);
    });

    test("injects connection error", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);
      const writeChar = await service.getCharacteristic(BLUETTI_WRITE_UUID);

      // Inject BLE connection error
      device.injectConnectionError(ConnectionErrorType.BLE);

      const cmd = new ReadHoldingRegisters(10, 1);

      await expect(writeChar.writeValue(cmd.command)).rejects.toThrow(BleError);
    });

    test("overrides response", async () => {
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(BLUETTI_SERVICE_UUID);
      const writeChar = await service.getCharacteristic(BLUETTI_WRITE_UUID);
      const notifyChar = await service.getCharacteristic(BLUETTI_NOTIFY_UUID);

      let response: DataView | null = null;
      notifyChar.addEventListener("characteristicvaluechanged", (event) => {
        response = event.target.value;
      });
      await notifyChar.startNotifications();

      // Override with custom response
      const customResponse = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      device.overrideNextResponse(customResponse);

      const cmd = new ReadHoldingRegisters(10, 1);
      await writeChar.writeValue(cmd.command);

      expect(response).not.toBeNull();
      const responseBytes = new Uint8Array(
        response!.buffer,
        response!.byteOffset,
        response!.byteLength
      );

      expect(Array.from(responseBytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });
  });
});

describe("createMockBluetooth", () => {
  test("returns device from requestDevice", async () => {
    const device = new MockBluetoothDevice({
      name: "TestDevice",
      readableRanges: [createRange(0, 10)],
      writableRanges: [],
    });

    const mockBluetooth = createMockBluetooth(device);
    const result = await mockBluetooth.requestDevice();

    expect(result).toBe(device);
  });

  test("getAvailability returns true", async () => {
    const device = new MockBluetoothDevice({
      name: "TestDevice",
      readableRanges: [],
      writableRanges: [],
    });

    const mockBluetooth = createMockBluetooth(device);

    expect(await mockBluetooth.getAvailability()).toBe(true);
  });

  test("getDevices returns array with device", async () => {
    const device = new MockBluetoothDevice({
      name: "TestDevice",
      readableRanges: [],
      writableRanges: [],
    });

    const mockBluetooth = createMockBluetooth(device);
    const devices = await mockBluetooth.getDevices();

    expect(devices).toEqual([device]);
  });
});
