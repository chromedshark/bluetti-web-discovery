import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import { Field } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "bool";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type BoolFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

export class BoolField extends Field<boolean, BoolFieldJson> {
  readonly type = TYPE;

  constructor(location: RegisterLocation, name: string) {
    super(location, name);
  }

  get byteSize(): number {
    return 2;
  }

  parse(bytes: Uint8Array): boolean {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint16(0) === 1;
  }

  static fromFieldJson(json: BoolFieldJson): BoolField {
    return new BoolField(json.location, json.name);
  }

  override toFieldJson(): BoolFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
    };
  }
}
BoolField satisfies FieldConstructor<boolean, BoolFieldJson>;
