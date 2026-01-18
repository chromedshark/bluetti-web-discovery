import { describe, test, expect } from "bun:test";
import Decimal from "decimal.js";
import { DecimalArrayField } from "../../src/fields/decimal-array";

function buildData(numbers: number[]): Uint8Array {
  const bytes = new Uint8Array(numbers.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < numbers.length; i++) view.setUint16(i * 2, numbers[i]!);
  return bytes;
}

describe("DecimalArrayField", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns size * 2", () => {
      const field = new DecimalArrayField(location, "test", 1, 5);
      expect(field.byteSize).toBe(10);
    });
  });

  describe("parse", () => {
    test("parses single value array", () => {
      const field = new DecimalArrayField(location, "test", 1, 1);
      const bytes = buildData([201]);
      expect(field.parse(bytes)).toEqual([new Decimal("20.1")]);
    });

    test("parses multiple values", () => {
      const field = new DecimalArrayField(location, "test", 2, 3);
      const bytes = buildData([101, 202, 303]);
      expect(field.parse(bytes)).toEqual([
        new Decimal("1.01"),
        new Decimal("2.02"),
        new Decimal("3.03"),
      ]);
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new DecimalArrayField(location, "test", 1, 5);
      expect(field.toFieldJson()).toEqual({
        type: "decimalArray",
        location: { register: 1 },
        name: "test",
        scale: 1,
        size: 5,
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "decimalArray" as const,
        location: { register: 100 },
        name: "roundTrip",
        scale: 2,
        size: 2,
      };
      const field = DecimalArrayField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
