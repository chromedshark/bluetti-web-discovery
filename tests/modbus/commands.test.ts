import { describe, test, expect } from "bun:test";
import { ReadHoldingRegisters } from "../../src/modbus/commands.ts";

describe("ReadHoldingRegisters", () => {
  test("constructs correct command packet", () => {
    const cmd = new ReadHoldingRegisters(0x000a, 3);

    // Expected: [0x01][0x03][0x00][0x0A][0x00][0x03][CRC_L][CRC_H]
    expect(cmd.command.length).toBe(8);
    expect(cmd.command[0]).toBe(0x01); // MODBUS address
    expect(cmd.command[1]).toBe(0x03); // Function code
    expect(cmd.command[2]).toBe(0x00); // Starting address high byte
    expect(cmd.command[3]).toBe(0x0a); // Starting address low byte
    expect(cmd.command[4]).toBe(0x00); // Quantity high byte
    expect(cmd.command[5]).toBe(0x03); // Quantity low byte
    // CRC bytes are at indices 6 and 7
  });

  test("stores starting address and quantity", () => {
    const cmd = new ReadHoldingRegisters(100, 5);

    expect(cmd.startingAddress).toBe(100);
    expect(cmd.quantity).toBe(5);
    expect(cmd.functionCode).toBe(0x03);
  });

  test("calculates correct response size", () => {
    // Response: [addr:1][fc:1][byteCount:1][data:qty*2][crc:2] = qty*2 + 5
    expect(new ReadHoldingRegisters(0, 1).responseSize()).toBe(7);
    expect(new ReadHoldingRegisters(0, 3).responseSize()).toBe(11);
    expect(new ReadHoldingRegisters(0, 8).responseSize()).toBe(21);
  });

  test("validates response CRC", () => {
    const cmd = new ReadHoldingRegisters(10, 3);

    // Valid response with correct CRC (calculated from Python reference)
    // Values: [100, 200, 300] at registers [10, 11, 12]
    // Response: [0x01, 0x03, 0x06, 0x00, 0x64, 0x00, 0xC8, 0x01, 0x2C, 0xD1, 0x0E]
    const validResponse = new Uint8Array([
      0x01, 0x03, 0x06, 0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c, 0xd1, 0x0e,
    ]);
    expect(cmd.isValidResponse(validResponse)).toBe(true);

    // Invalid CRC (flip last byte)
    const invalidResponse = new Uint8Array([
      0x01, 0x03, 0x06, 0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c, 0xd1, 0xff,
    ]);
    expect(cmd.isValidResponse(invalidResponse)).toBe(false);
  });

  test("parses response data correctly", () => {
    const cmd = new ReadHoldingRegisters(10, 3);

    // Response with values [100, 200, 300]
    const response = new Uint8Array([
      0x01, 0x03, 0x06, 0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c, 0xd1, 0x0e,
    ]);

    const data = cmd.parseResponse(response);

    // Should extract just the register data: [0x00, 0x64, 0x00, 0xC8, 0x01, 0x2C]
    expect(data.length).toBe(6);
    expect(data[0]).toBe(0x00);
    expect(data[1]).toBe(0x64); // 100
    expect(data[2]).toBe(0x00);
    expect(data[3]).toBe(0xc8); // 200
    expect(data[4]).toBe(0x01);
    expect(data[5]).toBe(0x2c); // 300
  });

  test("detects exception response", () => {
    const cmd = new ReadHoldingRegisters(99, 5);

    // Normal response
    const normalResponse = new Uint8Array([0x01, 0x03, 0x0a, 0x00, 0x00]);
    expect(cmd.isExceptionResponse(normalResponse)).toBe(false);

    // Exception response (function code + 0x80)
    // Exception code 0x02 = ILLEGAL_DATA_ADDRESS
    const exceptionResponse = new Uint8Array([0x01, 0x83, 0x02, 0xc0, 0xf1]);
    expect(cmd.isExceptionResponse(exceptionResponse)).toBe(true);
    expect(cmd.getExceptionCode(exceptionResponse)).toBe(0x02);
  });

  test("handles short responses gracefully", () => {
    const cmd = new ReadHoldingRegisters(0, 1);

    expect(cmd.isValidResponse(new Uint8Array([]))).toBe(false);
    expect(cmd.isValidResponse(new Uint8Array([0x01]))).toBe(false);
    expect(cmd.isValidResponse(new Uint8Array([0x01, 0x03]))).toBe(false);

    expect(cmd.isExceptionResponse(new Uint8Array([]))).toBe(false);
    expect(cmd.isExceptionResponse(new Uint8Array([0x01]))).toBe(false);
  });
});
