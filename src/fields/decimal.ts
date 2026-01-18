import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import Decimal from "decimal.js";
import { Field } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "decimal";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
    scale: { type: "uint8" }, // Divisor (e.g., 2 means divide raw value by 10 ** 2)
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type DecimalFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

export class DecimalField extends Field<Decimal, DecimalFieldJson> {
  readonly type = TYPE;
  readonly scale: number;

  constructor(location: RegisterLocation, name: string, scale: number) {
    super(location, name);
    this.scale = scale;
  }

  get byteSize(): number {
    return 2;
  }

  parse(bytes: Uint8Array): Decimal {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const raw = view.getUint16(0);
    return new Decimal(raw).div(10 ** this.scale);
  }

  static fromFieldJson(json: DecimalFieldJson): DecimalField {
    return new DecimalField(json.location, json.name, json.scale);
  }

  override toFieldJson(): DecimalFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
      scale: this.scale,
    };
  }
}
DecimalField satisfies FieldConstructor<Decimal, DecimalFieldJson>;
