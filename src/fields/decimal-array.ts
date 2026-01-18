import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import Decimal from "decimal.js";
import { Field } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "decimalArray";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
    scale: { type: "uint8" }, // Divisor (e.g., 2 means divide raw value by 10 ** 2)
    size: { type: "uint8" }, // Number of registers to read
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type DecimalArrayFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

export class DecimalArrayField extends Field<Decimal[], DecimalArrayFieldJson> {
  readonly type = TYPE;
  readonly scale: number;
  readonly size: number;

  constructor(location: RegisterLocation, name: string, scale: number, size: number) {
    super(location, name);
    this.scale = scale;
    this.size = size;
  }

  get byteSize(): number {
    return this.size * 2; // Each register is 2 bytes
  }

  parse(bytes: Uint8Array): Decimal[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result: Decimal[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
      const raw = view.getUint16(i);
      result.push(new Decimal(raw).div(10 ** this.scale));
    }
    return result;
  }

  static fromFieldJson(json: DecimalArrayFieldJson): DecimalArrayField {
    return new DecimalArrayField(json.location, json.name, json.scale, json.size);
  }

  override toFieldJson(): DecimalArrayFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
      scale: this.scale,
      size: this.size,
    };
  }
}
DecimalArrayField satisfies FieldConstructor<Decimal[], DecimalArrayFieldJson>;
