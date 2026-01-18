import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import { Field, swapBytes } from "./shared";
import { decodeStringField } from "./string";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "swapString";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
    size: { type: "uint8" }, // Number of registers (each 2 bytes)
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type SwapStringFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

export class SwapStringField extends Field<string, SwapStringFieldJson> {
  readonly type = TYPE;
  readonly size: number;

  constructor(location: RegisterLocation, name: string, size: number) {
    super(location, name);
    this.size = size;
  }

  get byteSize(): number {
    return this.size * 2; // Each register is 2 bytes
  }

  parse(bytes: Uint8Array): string {
    return decodeStringField(swapBytes(bytes));
  }

  static fromFieldJson(json: SwapStringFieldJson): SwapStringField {
    return new SwapStringField(json.location, json.name, json.size);
  }

  override toFieldJson(): SwapStringFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
      size: this.size,
    };
  }
}
SwapStringField satisfies FieldConstructor<string, SwapStringFieldJson>;
