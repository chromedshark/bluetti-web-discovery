/**
 * Browser entry point for Bluetti Web Discovery.
 *
 * Exports all public APIs for use in the browser.
 */

// MODBUS
export { ReadHoldingRegisters } from "./modbus/commands.ts";
export type { DeviceCommand } from "./modbus/commands.ts";

// Bluetooth
export { BluetoothClient, ModbusError, ChecksumError, TimeoutError } from "./bluetooth/client.ts";
export {
  splitRanges,
  parseRegisterData,
  registerToUint16,
  uint16ToRegister,
} from "./bluetooth/register-reader.ts";
export type { RegisterRange, RegisterReadResult } from "./bluetooth/register-reader.ts";
export {
  BLUETTI_SERVICE_UUID,
  BLUETTI_WRITE_UUID,
  BLUETTI_NOTIFY_UUID,
  RESPONSE_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_PACKET_SIZE,
  MAX_REGISTERS_PER_REQUEST,
} from "./bluetooth/constants.ts";
