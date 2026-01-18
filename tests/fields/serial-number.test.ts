import { describe, test, expect } from "bun:test";
import { SerialNumberField } from "../../src/fields/serial-number";

describe("SerialNumberField", () => {
  const location = { register: 1 };

  describe("byteSize", () => {
    test("returns 8 (4 registers)", () => {
      const field = new SerialNumberField(location, "test");
      expect(field.byteSize).toBe(8);
    });
  });

  describe("parse", () => {
    test("parses serial numbers correctly", () => {
      const field = new SerialNumberField(location, "test");
      const bytes = Uint8Array.fromHex("db3b065c01f20000");
      expect(field.parse(bytes)).toEqual(2139000462139n);
    });
  });

  describe("JSON serialization", () => {
    test("serializes to JSON", () => {
      const field = new SerialNumberField(location, "test");
      expect(field.toFieldJson()).toEqual({
        type: "serialNumber",
        location: { register: 1 },
        name: "test",
      });
    });

    test("it round-trips through JSON", () => {
      const json = {
        type: "serialNumber" as const,
        location: { register: 100 },
        name: "roundTrip",
      };
      const field = SerialNumberField.fromFieldJson(json);
      expect(field.toFieldJson()).toEqual(json);
    });
  });
});
