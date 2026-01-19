import Ajv, { type JTDDataType, type SomeJTDSchemaType } from "ajv/dist/jtd";
import ac300 from "./ac300.jsonc";
import { fieldSchema } from "../fields";

const { definitions, ...fieldRest } = fieldSchema;
const schema = {
  properties: {
    type: { type: "string" },
    readableRegisters: { elements: { ref: "registerRange" } },
    fields: { elements: { ref: "field" } },
  },
  definitions: {
    registerRange: {
      properties: {
        start: { type: "uint16" },
        end: { type: "uint16" },
      },
    },
    field: fieldRest,
    ...definitions,
  },
} as const satisfies SomeJTDSchemaType;

export type DeviceJson = JTDDataType<typeof schema>;

const ajv = new Ajv();
export const validateDeviceJson = ajv.compile<DeviceJson>(schema);

export const devices: Record<string, DeviceJson> = {
  [ac300.type]: ac300 as DeviceJson,
};
