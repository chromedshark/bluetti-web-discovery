import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import Decimal from "decimal.js";
import { Field, swapBytes } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "version";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type VersionFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

export class VersionField extends Field<string, VersionFieldJson> {
  readonly type = TYPE;

  constructor(location: RegisterLocation, name: string) {
    super(location, name);
  }

  get byteSize(): number {
    return 4; // 2 registers, 4 bytes
  }

  parse(bytes: Uint8Array): string {
    const swapped = swapBytes(bytes);
    const view = new DataView(swapped.buffer);
    const version = new Decimal(view.getUint32(0, true)).div(100);
    return version.toString();
  }

  static fromFieldJson(json: VersionFieldJson): VersionField {
    return new VersionField(json.location, json.name);
  }

  override toFieldJson(): VersionFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
    };
  }
}
VersionField satisfies FieldConstructor<string, VersionFieldJson>;
