import { describe, test, expect } from "bun:test";
import { StringField } from "../../src/fields/string";

describe("StringField", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns size * 2", () => {
      const field = new StringField(location, "test", 4);
      expect(field.byteSize).toBe(8);
    });
  });

  describe("parse", () => {
    test("parses a string", () => {
      const field = new StringField(location, "test", 4);
      const bytes = new Uint8Array([65, 112, 112, 108, 101, 0, 0, 0]); // "Apple"
      expect(field.parse(bytes)).toBe("Apple");
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new StringField(location, "test", 5);
      expect(field.toFieldJson()).toEqual({
        type: "string",
        location: { register: 1 },
        name: "test",
        size: 5,
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "string" as const,
        location: { register: 100 },
        name: "roundTrip",
        size: 8,
      };
      const field = StringField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
