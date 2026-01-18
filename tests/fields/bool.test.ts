import { describe, test, expect } from "bun:test";
import { BoolField } from "../../src/fields/bool";

describe("BoolField", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns 2", () => {
      const field = new BoolField(location, "test");
      expect(field.byteSize).toBe(2);
    });
  });

  describe("parse", () => {
    test("returns true for value 1", () => {
      const field = new BoolField(location, "test");
      const bytes = new Uint8Array([0x00, 0x01]);
      expect(field.parse(bytes)).toBe(true);
    });

    test("returns false for value 0", () => {
      const field = new BoolField(location, "test");
      const bytes = new Uint8Array([0x00, 0x00]);
      expect(field.parse(bytes)).toBe(false);
    });

    test("returns false for values other than 1", () => {
      const field = new BoolField(location, "test");
      const bytes = new Uint8Array([0x00, 0x02]);
      expect(field.parse(bytes)).toBe(false);
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new BoolField(location, "test");
      expect(field.toFieldJson()).toEqual({
        type: "bool",
        location: { register: 1 },
        name: "test",
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "bool" as const,
        location: { register: 100 },
        name: "roundTrip",
      };
      const field = BoolField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
