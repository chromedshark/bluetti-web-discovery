import type { JTDDataType, SomeJTDSchemaType } from "ajv/dist/jtd";
import { definitions } from "./shared";
import { schema as boolSchema, TYPE as boolType } from "./bool";
import { schema as decimalSchema, TYPE as decimalType } from "./decimal";
import { schema as decimalArraySchema, TYPE as decimalArrayType } from "./decimal-array";
import { schema as enumSchema, TYPE as enumType } from "./enum";
import { schema as serialNumberSchema, TYPE as serialNumberType } from "./serial-number";
import { schema as stringSchema, TYPE as stringType } from "./string";
import { schema as swapStringSchema, TYPE as swapStringType } from "./swap-string";
import { schema as uint16Schema, TYPE as uint16Type } from "./uint16";
import { schema as versionSchema, TYPE as versionType } from "./version";

export const fieldSchema = {
  discriminator: "type",
  mapping: {
    [boolType]: boolSchema,
    [decimalType]: decimalSchema,
    [decimalArrayType]: decimalArraySchema,
    [enumType]: enumSchema,
    [serialNumberType]: serialNumberSchema,
    [stringType]: stringSchema,
    [swapStringType]: swapStringSchema,
    [uint16Type]: uint16Schema,
    [versionType]: versionSchema,
  },
  definitions,
} as const satisfies SomeJTDSchemaType;

export type FieldJson = JTDDataType<typeof fieldSchema>;
