import { describe, test, expect } from "bun:test";
import Decimal from "decimal.js";
import { DecimalField } from "../../src/fields/decimal";

describe("DecimalField", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns 2", () => {
      const field = new DecimalField(location, "test", 1);
      expect(field.byteSize).toBe(2);
    });
  });

  describe("parse", () => {
    test("divides by scale of 10", () => {
      const field = new DecimalField(location, "test", 1);
      const bytes = new Uint8Array(2);
      new DataView(bytes.buffer).setUint16(0, 201);
      expect(field.parse(bytes)).toEqual(new Decimal("20.1"));
    });

    test("divides by scale of 100", () => {
      const field = new DecimalField(location, "test", 2);
      const bytes = new Uint8Array(2);
      new DataView(bytes.buffer).setUint16(0, 201);
      expect(field.parse(bytes)).toEqual(new Decimal("2.01"));
    });

    test("handles zero value", () => {
      const field = new DecimalField(location, "test", 1);
      const bytes = new Uint8Array([0x00, 0x00]);
      expect(field.parse(bytes)).toEqual(new Decimal(0));
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new DecimalField(location, "test", 1);
      expect(field.toFieldJson()).toEqual({
        type: "decimal",
        location: { register: 1 },
        name: "test",
        scale: 1,
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "decimal" as const,
        location: { register: 100 },
        name: "roundTrip",
        scale: 2,
      };
      const field = DecimalField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
