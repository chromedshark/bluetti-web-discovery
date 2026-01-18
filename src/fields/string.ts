import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import { Field } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "string";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
    size: { type: "uint8" }, // Number of registers (each 2 bytes)
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type StringFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

/**
 * Converts a null terminated array of bytes into a string
 */
export function decodeStringField(bytes: Uint8Array): string {
  const lastNonNull = bytes.findLastIndex((byte) => byte !== 0);
  bytes = bytes.subarray(0, lastNonNull + 1);
  return new TextDecoder("utf-8").decode(bytes);
}

export class StringField extends Field<string, StringFieldJson> {
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
    return decodeStringField(bytes);
  }

  static fromFieldJson(json: StringFieldJson): StringField {
    return new StringField(json.location, json.name, json.size);
  }

  override toFieldJson(): StringFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
      size: this.size,
    };
  }
}
StringField satisfies FieldConstructor<string, StringFieldJson>;
