import { describe, test, expect } from "bun:test";
import {
  splitRanges,
  parseRegisterData,
  registerToUint16,
  uint16ToRegister,
} from "../../src/bluetooth/register-reader.ts";

describe("splitRanges", () => {
  test("passes through ranges that fit in one request", () => {
    const ranges = [
      { start: 0, count: 5 },
      { start: 100, count: 7 },
    ];

    const result = splitRanges(ranges);

    expect(result).toEqual([
      { start: 0, count: 5 },
      { start: 100, count: 7 },
    ]);
  });

  test("splits range larger than max into multiple chunks", () => {
    const ranges = [{ start: 0, count: 20 }];

    const result = splitRanges(ranges);

    expect(result).toEqual([
      { start: 0, count: 7 },
      { start: 7, count: 7 },
      { start: 14, count: 6 },
    ]);
  });

  test("handles multiple ranges that need splitting", () => {
    const ranges = [
      { start: 0, count: 10 },
      { start: 100, count: 15 },
    ];

    const result = splitRanges(ranges);

    expect(result).toEqual([
      { start: 0, count: 7 },
      { start: 7, count: 3 },
      { start: 100, count: 7 },
      { start: 107, count: 7 },
      { start: 114, count: 1 },
    ]);
  });

  test("handles empty ranges", () => {
    expect(splitRanges([])).toEqual([]);
  });

  test("handles zero count ranges", () => {
    const ranges = [{ start: 0, count: 0 }];
    expect(splitRanges(ranges)).toEqual([]);
  });

  test("uses custom max per request", () => {
    const ranges = [{ start: 0, count: 10 }];

    const result = splitRanges(ranges, 3);

    expect(result).toEqual([
      { start: 0, count: 3 },
      { start: 3, count: 3 },
      { start: 6, count: 3 },
      { start: 9, count: 1 },
    ]);
  });
});

describe("parseRegisterData", () => {
  test("parses register data into individual values", () => {
    const data = new Uint8Array([0x00, 0x64, 0x00, 0xc8, 0x01, 0x2c]); // 100, 200, 300

    const results = parseRegisterData(10, data);

    expect(results).toEqual([
      { address: 10, value: new Uint8Array([0x00, 0x64]) },
      { address: 11, value: new Uint8Array([0x00, 0xc8]) },
      { address: 12, value: new Uint8Array([0x01, 0x2c]) },
    ]);
  });

  test("handles empty data", () => {
    expect(parseRegisterData(0, new Uint8Array([]))).toEqual([]);
  });

  test("handles single register", () => {
    const data = new Uint8Array([0xab, 0xcd]);

    const results = parseRegisterData(42, data);

    expect(results).toEqual([{ address: 42, value: new Uint8Array([0xab, 0xcd]) }]);
  });
});

describe("registerToUint16", () => {
  test("converts big-endian bytes to uint16", () => {
    expect(registerToUint16(new Uint8Array([0x00, 0x64]))).toBe(100);
    expect(registerToUint16(new Uint8Array([0x00, 0xc8]))).toBe(200);
    expect(registerToUint16(new Uint8Array([0x01, 0x2c]))).toBe(300);
    expect(registerToUint16(new Uint8Array([0xff, 0xff]))).toBe(65535);
    expect(registerToUint16(new Uint8Array([0x00, 0x00]))).toBe(0);
  });
});

describe("uint16ToRegister", () => {
  test("converts uint16 to big-endian bytes", () => {
    expect(uint16ToRegister(100)).toEqual(new Uint8Array([0x00, 0x64]));
    expect(uint16ToRegister(200)).toEqual(new Uint8Array([0x00, 0xc8]));
    expect(uint16ToRegister(300)).toEqual(new Uint8Array([0x01, 0x2c]));
    expect(uint16ToRegister(65535)).toEqual(new Uint8Array([0xff, 0xff]));
    expect(uint16ToRegister(0)).toEqual(new Uint8Array([0x00, 0x00]));
  });

  test("round-trips with registerToUint16", () => {
    for (const value of [0, 1, 100, 256, 1000, 32768, 65535]) {
      expect(registerToUint16(uint16ToRegister(value))).toBe(value);
    }
  });
});
