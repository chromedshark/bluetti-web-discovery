import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import { Field } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "uint16";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type Uint16FieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

export class Uint16Field extends Field<number, Uint16FieldJson> {
  readonly type = TYPE;

  constructor(location: RegisterLocation, name: string) {
    super(location, name);
  }

  get byteSize(): number {
    return 2;
  }

  parse(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint16(0);
  }

  static fromFieldJson(json: Uint16FieldJson): Uint16Field {
    return new Uint16Field(json.location, json.name);
  }

  override toFieldJson(): Uint16FieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
    };
  }
}
Uint16Field satisfies FieldConstructor<number, Uint16FieldJson>;
