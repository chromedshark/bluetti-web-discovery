import { describe, test, expect } from "bun:test";
import { EnumField } from "../../src/fields/enum";

describe("EnumField", () => {
  const location = { register: 1 };
  const values = { ZERO: 0, ONE: 1, TWO: 2 };

  describe("byteSize", () => {
    test("returns 2", () => {
      const field = new EnumField(location, "test", values);
      expect(field.byteSize).toBe(2);
    });
  });

  describe("parse", () => {
    test("returns correct name for each defined value", () => {
      const field = new EnumField(location, "test", values);

      expect(field.parse(new Uint8Array([0x00, 0x00]))).toBe("ZERO");
      expect(field.parse(new Uint8Array([0x00, 0x01]))).toBe("ONE");
      expect(field.parse(new Uint8Array([0x00, 0x02]))).toBe("TWO");
    });

    test("returns raw number for unknown value", () => {
      const field = new EnumField(location, "test", values);
      const bytes = new Uint8Array([0x00, 0x03]);
      expect(field.parse(bytes)).toBe(3);
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new EnumField(location, "test", values);
      expect(field.toFieldJson()).toEqual({
        type: "enum",
        location: { register: 1 },
        name: "test",
        values,
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "enum" as const,
        location: { register: 100 },
        name: "roundTrip",
        values: { ONE: 1, TWO: 2 },
      };
      const field = EnumField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
