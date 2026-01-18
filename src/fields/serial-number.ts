import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import { Field, swapBytes } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "serialNumber";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type SerialNumberFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

export class SerialNumberField extends Field<bigint, SerialNumberFieldJson> {
  readonly type = TYPE;

  constructor(location: RegisterLocation, name: string) {
    super(location, name);
  }

  get byteSize(): number {
    return 8; // 4 registers, 8 bytes
  }

  parse(bytes: Uint8Array): bigint {
    const swapped = swapBytes(bytes);
    const view = new DataView(swapped.buffer);
    return view.getBigUint64(0, true);
  }

  static fromFieldJson(json: SerialNumberFieldJson): SerialNumberField {
    return new SerialNumberField(json.location, json.name);
  }

  override toFieldJson(): SerialNumberFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
    };
  }
}
SerialNumberField satisfies FieldConstructor<bigint, SerialNumberFieldJson>;
