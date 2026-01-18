import type { JTDDataType, SomeJTDSchemaType } from "ajv/dist/core";

/** Define any shared schema definitions here */
export const definitions = {
  location: {
    properties: {
      register: { type: "uint16" },
    },
  } satisfies SomeJTDSchemaType,
} as const;

export type RegisterLocation = JTDDataType<typeof definitions.location>;

/** Helper to create full field JSON schema type with type discriminator */
export type FieldJsonSchema<
  T extends string,
  S extends { readonly properties: Record<string, SomeJTDSchemaType> },
> = JTDDataType<{
  readonly properties: { readonly type: { readonly enum: readonly [T] } } & S["properties"];
  readonly definitions: typeof definitions;
}>;

/**
 * Returns a new Uint8Array where all bytes are swapped in 2 byte chunks
 */
export function swapBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 2 === 1) throw new Error("Cannot swap bytes on odd length");

  const swapped = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 2) {
    swapped[i] = bytes[i + 1]!;
    swapped[i + 1] = bytes[i]!;
  }
  return swapped;
}

/**
 * Base class for fields
 */
export abstract class Field<ParseType, JsonType> {
  abstract readonly type: string;
  readonly location: RegisterLocation;
  readonly name: string;

  constructor(location: RegisterLocation, name: string) {
    this.location = location;
    this.name = name;
  }

  /** Returns the number of bytes this field occupies */
  abstract get byteSize(): number;

  /** Parse raw bytes into a typed value */
  abstract parse(bytes: Uint8Array): ParseType;

  /** Serialize this field to JSON for storage */
  abstract toFieldJson(): JsonType;
}

export interface FieldConstructor<ParseType, JsonType> {
  new (...args: any[]): Field<ParseType, JsonType>; // eslint-disable-line @typescript-eslint/no-explicit-any
  fromFieldJson(json: JsonType): Field<ParseType, JsonType>;
}
