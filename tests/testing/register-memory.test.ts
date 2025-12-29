import { describe, test, expect, beforeEach } from "bun:test";
import { RegisterMemory } from "../../src/testing/register-memory.ts";

describe("RegisterMemory", () => {
  let memory: RegisterMemory;

  beforeEach(() => {
    memory = new RegisterMemory();
  });

  describe("writeRegister / readRegisters", () => {
    test("writes and reads a single register", () => {
      memory.writeRegister(10, new Uint8Array([0x00, 0x64])); // 100

      const result = memory.readRegisters(10, 1);

      expect(result.length).toBe(2);
      expect(result[0]).toBe(0x00);
      expect(result[1]).toBe(0x64);
    });

    test("reads uninitialized registers as zeros", () => {
      const result = memory.readRegisters(100, 3);

      expect(result.length).toBe(6);
      expect(Array.from(result)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    test("reads mixture of initialized and uninitialized", () => {
      memory.writeRegister(10, new Uint8Array([0xab, 0xcd]));
      // Register 11 is not initialized

      const result = memory.readRegisters(10, 2);

      expect(result.length).toBe(4);
      expect(result[0]).toBe(0xab);
      expect(result[1]).toBe(0xcd);
      expect(result[2]).toBe(0x00); // Uninitialized
      expect(result[3]).toBe(0x00);
    });

    test("throws error for wrong value size", () => {
      expect(() => memory.writeRegister(0, new Uint8Array([0x01]))).toThrow(
        "Register value must be 2 bytes"
      );
      expect(() => memory.writeRegister(0, new Uint8Array([0x01, 0x02, 0x03]))).toThrow(
        "Register value must be 2 bytes"
      );
    });
  });

  describe("writeRegisters", () => {
    test("writes multiple contiguous registers", () => {
      // Write values [100, 200, 300] to registers [10, 11, 12]
      const data = new Uint8Array([0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c]);
      memory.writeRegisters(10, data);

      const result = memory.readRegisters(10, 3);
      expect(Array.from(result)).toEqual([0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c]);
    });

    test("throws error for odd data length", () => {
      expect(() => memory.writeRegisters(0, new Uint8Array([0x01, 0x02, 0x03]))).toThrow(
        "Data length must be even"
      );
    });

    test("overwrites existing values", () => {
      memory.writeRegister(10, new Uint8Array([0xff, 0xff]));
      memory.writeRegisters(10, new Uint8Array([0x00, 0x01]));

      const result = memory.readRegisters(10, 1);
      expect(Array.from(result)).toEqual([0x00, 0x01]);
    });
  });

  describe("sparse storage", () => {
    test("stores only initialized registers", () => {
      expect(memory.size).toBe(0);

      memory.writeRegister(0, new Uint8Array([0, 0]));
      memory.writeRegister(1000, new Uint8Array([0, 0]));

      expect(memory.size).toBe(2);
    });

    test("clear removes all registers", () => {
      memory.writeRegisters(0, new Uint8Array([0, 0, 0, 0, 0, 0]));
      expect(memory.size).toBe(3);

      memory.clear();
      expect(memory.size).toBe(0);
    });
  });

  describe("data isolation", () => {
    test("modifications to input do not affect stored value", () => {
      const input = new Uint8Array([0xab, 0xcd]);
      memory.writeRegister(0, input);

      // Modify input after storing
      input[0] = 0xff;

      const result = memory.readRegisters(0, 1);
      expect(result[0]).toBe(0xab); // Should be original value
    });

    test("modifications to output do not affect stored value", () => {
      memory.writeRegister(0, new Uint8Array([0xab, 0xcd]));

      const result1 = memory.readRegisters(0, 1);
      result1[0] = 0xff;

      const result2 = memory.readRegisters(0, 1);
      expect(result2[0]).toBe(0xab); // Should be original value
    });
  });
});
