import type { FieldJson } from "./schema";
import { BoolField } from "./bool";
import { DecimalField } from "./decimal";
import { DecimalArrayField } from "./decimal-array";
import { EnumField } from "./enum";
import { SerialNumberField } from "./serial-number";
import { StringField } from "./string";
import { SwapStringField } from "./swap-string";
import { Uint16Field } from "./uint16";
import { VersionField } from "./version";

export type { RegisterLocation } from "./shared";
export { fieldSchema } from "./schema";
export {
  BoolField,
  DecimalField,
  DecimalArrayField,
  EnumField,
  SerialNumberField,
  StringField,
  SwapStringField,
  Uint16Field,
  VersionField,
};

export function fromFieldJson(json: FieldJson) {
  switch (json.type) {
    case "bool":
      return BoolField.fromFieldJson(json);
    case "decimal":
      return DecimalField.fromFieldJson(json);
    case "decimalArray":
      return DecimalArrayField.fromFieldJson(json);
    case "enum":
      return EnumField.fromFieldJson(json);
    case "serialNumber":
      return SerialNumberField.fromFieldJson(json);
    case "string":
      return StringField.fromFieldJson(json);
    case "swapString":
      return SwapStringField.fromFieldJson(json);
    case "uint16":
      return Uint16Field.fromFieldJson(json);
    case "version":
      return VersionField.fromFieldJson(json);
  }
}
