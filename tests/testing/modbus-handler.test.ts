import { describe, test, expect, beforeEach } from "bun:test";
import { MODBUSHandler, createRange, EXCEPTION_CODES } from "../../src/testing/modbus-handler.ts";
import { RegisterMemory } from "../../src/testing/register-memory.ts";
import { crc16 } from "../../src/modbus/crc.ts";

/**
 * Helper to create a command with CRC.
 */
function buildCommand(bytes: number[]): Uint8Array {
  const data = new Uint8Array(bytes.length + 2);
  data.set(bytes);
  const crc = crc16(new Uint8Array(bytes));
  data[bytes.length] = crc & 0xff;
  data[bytes.length + 1] = (crc >> 8) & 0xff;
  return data;
}

/**
 * Helper to parse a 16-bit big-endian value.
 */
function getUint16BE(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!;
}

describe("MODBUSHandler", () => {
  let memory: RegisterMemory;
  let handler: MODBUSHandler;

  beforeEach(() => {
    memory = new RegisterMemory();
    // Readable: 0-99 and 3000-3099
    // Writable: 3000-3099 only
    handler = new MODBUSHandler(
      memory,
      [createRange(0, 100), createRange(3000, 100)],
      [createRange(3000, 100)]
    );
  });

  describe("Read Holding Registers (0x03)", () => {
    test("reads registers successfully", () => {
      // Set up test data: registers 10, 11, 12 = [100, 200, 300]
      memory.writeRegisters(10, new Uint8Array([0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c]));

      // Build command: Read 3 registers starting at address 10
      // [0x01][0x03][0x00][0x0A][0x00][0x03][CRC]
      const cmd = buildCommand([0x01, 0x03, 0x00, 0x0a, 0x00, 0x03]);
      const response = handler.handleCommand(cmd);

      // Response: [0x01][0x03][0x06][data:6][CRC:2] = 11 bytes
      expect(response.length).toBe(11);
      expect(response[0]).toBe(0x01); // Device address
      expect(response[1]).toBe(0x03); // Function code
      expect(response[2]).toBe(0x06); // Byte count (3 registers * 2)

      // Verify register data
      expect(response[3]).toBe(0x00);
      expect(response[4]).toBe(0x64); // 100
      expect(response[5]).toBe(0x00);
      expect(response[6]).toBe(0xc8); // 200
      expect(response[7]).toBe(0x01);
      expect(response[8]).toBe(0x2c); // 300
    });

    test("returns exception for invalid address", () => {
      // Try to read from address 150 (outside readable range)
      const cmd = buildCommand([0x01, 0x03, 0x00, 0x96, 0x00, 0x01]);
      const response = handler.handleCommand(cmd);

      // Exception response: [addr][fc+0x80][exception_code][CRC] = 5 bytes
      expect(response.length).toBe(5);
      expect(response[1]).toBe(0x83); // 0x03 + 0x80
      expect(response[2]).toBe(EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS);
    });

    test("returns exception for partially invalid range", () => {
      // Try to read 5 registers starting at 98 (98, 99 valid; 100, 101, 102 invalid)
      const cmd = buildCommand([0x01, 0x03, 0x00, 0x62, 0x00, 0x05]);
      const response = handler.handleCommand(cmd);

      expect(response.length).toBe(5);
      expect(response[1]).toBe(0x83);
      expect(response[2]).toBe(EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS);
    });

    test("returns zeros for uninitialized registers", () => {
      const cmd = buildCommand([0x01, 0x03, 0x00, 0x00, 0x00, 0x02]);
      const response = handler.handleCommand(cmd);

      expect(response.length).toBe(9); // 2 registers * 2 + 5
      expect(response[3]).toBe(0x00);
      expect(response[4]).toBe(0x00);
      expect(response[5]).toBe(0x00);
      expect(response[6]).toBe(0x00);
    });
  });

  describe("Write Single Register (0x06)", () => {
    test("writes register successfully", () => {
      // Write value 0x1234 to register 3010
      // [0x01][0x06][0x0B][0xC2][0x12][0x34][CRC]
      const cmd = buildCommand([0x01, 0x06, 0x0b, 0xc2, 0x12, 0x34]);
      const response = handler.handleCommand(cmd);

      // Response echoes command: [0x01][0x06][0x0B][0xC2][0x12][0x34][CRC]
      expect(response.length).toBe(8);
      expect(response[0]).toBe(0x01);
      expect(response[1]).toBe(0x06);
      expect(getUint16BE(response, 2)).toBe(3010);
      expect(getUint16BE(response, 4)).toBe(0x1234);

      // Verify memory was written
      const data = memory.readRegisters(3010, 1);
      expect(data[0]).toBe(0x12);
      expect(data[1]).toBe(0x34);
    });

    test("returns exception for read-only address", () => {
      // Try to write to address 10 (readable but not writable)
      const cmd = buildCommand([0x01, 0x06, 0x00, 0x0a, 0x12, 0x34]);
      const response = handler.handleCommand(cmd);

      expect(response.length).toBe(5);
      expect(response[1]).toBe(0x86); // 0x06 + 0x80
      expect(response[2]).toBe(EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS);
    });
  });

  describe("Write Multiple Registers (0x10)", () => {
    test("writes multiple registers successfully", () => {
      // Write [0x1111, 0x2222, 0x3333] to registers 3000-3002
      // [0x01][0x10][0x0B][0xB8][0x00][0x03][0x06][data:6][CRC]
      const cmd = buildCommand([
        0x01, 0x10, 0x0b, 0xb8, 0x00, 0x03, 0x06, 0x11, 0x11, 0x22, 0x22, 0x33, 0x33,
      ]);
      const response = handler.handleCommand(cmd);

      // Response: [0x01][0x10][startAddr:2][quantity:2][CRC] = 8 bytes
      expect(response.length).toBe(8);
      expect(response[0]).toBe(0x01);
      expect(response[1]).toBe(0x10);
      expect(getUint16BE(response, 2)).toBe(3000);
      expect(getUint16BE(response, 4)).toBe(3);

      // Verify memory
      const data = memory.readRegisters(3000, 3);
      expect(Array.from(data)).toEqual([0x11, 0x11, 0x22, 0x22, 0x33, 0x33]);
    });

    test("returns exception for non-writable address", () => {
      // Try to write to addresses 0-2 (readable but not writable)
      const cmd = buildCommand([0x01, 0x10, 0x00, 0x00, 0x00, 0x02, 0x04, 0x11, 0x11, 0x22, 0x22]);
      const response = handler.handleCommand(cmd);

      expect(response.length).toBe(5);
      expect(response[1]).toBe(0x90); // 0x10 + 0x80
      expect(response[2]).toBe(EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS);
    });

    test("returns exception for mismatched byte count", () => {
      // Byte count (0x06) doesn't match quantity (0x02 = 4 bytes expected)
      const cmd = buildCommand([
        0x01, 0x10, 0x0b, 0xb8, 0x00, 0x02, 0x06, 0x11, 0x11, 0x22, 0x22, 0x33, 0x33,
      ]);
      const response = handler.handleCommand(cmd);

      expect(response.length).toBe(5);
      expect(response[1]).toBe(0x90);
      expect(response[2]).toBe(EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
    });
  });

  describe("Error handling", () => {
    test("returns exception for unknown function code", () => {
      // Function code 0x07 is not supported
      const cmd = buildCommand([0x01, 0x07, 0x00, 0x00]);
      const response = handler.handleCommand(cmd);

      expect(response.length).toBe(5);
      expect(response[1]).toBe(0x87); // 0x07 + 0x80
      expect(response[2]).toBe(EXCEPTION_CODES.ILLEGAL_FUNCTION);
    });

    test("throws error for invalid CRC", () => {
      // Create command with wrong CRC
      const cmd = new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0xff, 0xff]);

      expect(() => handler.handleCommand(cmd)).toThrow("Invalid CRC");
    });

    test("throws error for command too short", () => {
      const cmd = new Uint8Array([0x01, 0x03, 0x00]);

      expect(() => handler.handleCommand(cmd)).toThrow("Command too short");
    });
  });

  describe("CRC validation", () => {
    test("valid response has correct CRC", () => {
      memory.writeRegister(0, new Uint8Array([0xab, 0xcd]));
      const cmd = buildCommand([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
      const response = handler.handleCommand(cmd);

      // Verify CRC is correct
      const calculatedCrc = crc16(response.subarray(0, -2));
      const responseCrc = response[response.length - 2]! | (response[response.length - 1]! << 8);
      expect(calculatedCrc).toBe(responseCrc);
    });
  });
});
