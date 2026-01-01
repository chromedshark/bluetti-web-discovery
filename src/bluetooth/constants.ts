/** GATT UUIDs for Bluetti devices */
export const BLUETTI_SERVICE_UUID = 0xff00;
export const BLUETTI_WRITE_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
export const BLUETTI_NOTIFY_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";

/** Communication timeouts */
export const RESPONSE_TIMEOUT_MS = 5000;
export const INITIAL_ENCRYPTION_TIMEOUT_MS = 500;

/** BLE packet size limit (default MTU 23 minus 3-byte ATT header) */
export const MAX_PACKET_SIZE = 20;

/** MODBUS limits */
export const MAX_REGISTERS_PER_REQUEST = 7;
