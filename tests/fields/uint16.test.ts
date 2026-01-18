import { describe, test, expect } from "bun:test";
import { Uint16Field } from "../../src/fields/uint16";

describe("Uint16Field", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns 2", () => {
      const field = new Uint16Field(location, "test");
      expect(field.byteSize).toBe(2);
    });
  });

  describe("parse", () => {
    test("parses zero", () => {
      const field = new Uint16Field(location, "test");
      const bytes = new Uint8Array([0x00, 0x00]);
      expect(field.parse(bytes)).toBe(0);
    });

    test("parses small value", () => {
      const field = new Uint16Field(location, "test");
      const bytes = new Uint8Array([0x00, 0x42]);
      expect(field.parse(bytes)).toBe(66);
    });

    test("parses big-endian uint16", () => {
      const field = new Uint16Field(location, "test");
      const bytes = new Uint8Array([0x01, 0x02]);
      expect(field.parse(bytes)).toBe(258);
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new Uint16Field(location, "test");
      expect(field.toFieldJson()).toEqual({
        type: "uint16",
        location: { register: 1 },
        name: "test",
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "uint16" as const,
        location: { register: 100 },
        name: "roundTrip",
      };
      const field = Uint16Field.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
