import { devices, validateDeviceJson } from "./src/devices";

for (const [type, schema] of Object.entries(devices)) {
  if (!validateDeviceJson(schema)) {
    console.log(`Schema for ${type} is invalid`, validateDeviceJson.errors);
    process.exit(1);
  }
}
