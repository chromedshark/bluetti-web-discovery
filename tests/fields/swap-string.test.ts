import { describe, test, expect } from "bun:test";
import { SwapStringField } from "../../src/fields/swap-string";

describe("SwapStringField", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns size * 2", () => {
      const field = new SwapStringField(location, "test", 4);
      expect(field.byteSize).toBe(8);
    });
  });

  describe("parse", () => {
    test("parses a string", () => {
      const field = new SwapStringField(location, "test", 4);
      const bytes = new Uint8Array([112, 65, 108, 112, 0, 101, 0, 0]); // "pAlp\0e"
      expect(field.parse(bytes)).toBe("Apple");
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new SwapStringField(location, "test", 5);
      expect(field.toFieldJson()).toEqual({
        type: "swapString",
        location: { register: 1 },
        name: "test",
        size: 5,
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "swapString" as const,
        location: { register: 100 },
        name: "roundTrip",
        size: 8,
      };
      const field = SwapStringField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
