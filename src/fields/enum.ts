import type { SomeJTDSchemaType } from "ajv/dist/jtd";
import { Field } from "./shared";
import type { FieldConstructor, FieldJsonSchema, RegisterLocation } from "./shared";

// Discriminated union type constant
export const TYPE = "enum";

// JTD schema without the type property
export const schema = {
  properties: {
    location: { ref: "location" },
    name: { type: "string" },
    values: { values: { type: "uint16" } }, // Record<string, number>
  },
} as const satisfies SomeJTDSchemaType;

// JSON type including the type property
export type EnumFieldJson = FieldJsonSchema<typeof TYPE, typeof schema>;

type ParseType = string | number;
export class EnumField extends Field<ParseType, EnumFieldJson> {
  readonly type = TYPE;
  readonly values: Record<string, number>;
  private readonly lookup: Map<number, string>;

  constructor(location: RegisterLocation, name: string, values: Record<string, number>) {
    super(location, name);
    this.values = values;

    // Build lookup for parser
    this.lookup = new Map(Object.entries(this.values).map(([name, value]) => [value, name]));
  }

  get byteSize(): number {
    return 2;
  }

  parse(bytes: Uint8Array): ParseType {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const raw = view.getUint16(0);
    return this.lookup.get(raw) || raw;
  }

  static fromFieldJson(json: EnumFieldJson): EnumField {
    return new EnumField(json.location, json.name, json.values);
  }

  override toFieldJson(): EnumFieldJson {
    return {
      type: this.type,
      location: this.location,
      name: this.name,
      values: this.values,
    };
  }
}
EnumField satisfies FieldConstructor<ParseType, EnumFieldJson>;
