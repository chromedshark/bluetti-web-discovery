import { describe, test, expect } from "bun:test";
import { VersionField } from "../../src/fields/version";

describe("VersionField", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns 4 (2 registers)", () => {
      const field = new VersionField(location, "test");
      expect(field.byteSize).toBe(4);
    });
  });

  describe("parse", () => {
    test("parses versions correctly", () => {
      const field = new VersionField(location, "test");
      const bytes = Uint8Array.fromHex("27090006");
      expect(field.parse(bytes)).toEqual("4032.09");
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new VersionField(location, "test");
      expect(field.toFieldJson()).toEqual({
        type: "version",
        location: { register: 1 },
        name: "test",
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "version" as const,
        location: { register: 100 },
        name: "roundTrip",
      };
      const field = VersionField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
