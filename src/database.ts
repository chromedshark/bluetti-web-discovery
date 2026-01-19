import Dexie, { type Table } from "dexie";

/**
 * Record representing a connected Bluetti device.
 */
export interface DeviceRecord {
  /** Device ID from the Bluetooth API (stable identifier) */
  id: string;

  /** Device name (e.g., "AC300...") */
  name: string;

  /** Protocol version */
  protocolVersion: number;

  /** Device type */
  deviceType: string;
}

/**
 * Record representing a scan result for a single register.
 */
export interface ScanResultRecord {
  /** Foreign key to device */
  deviceId: string;

  /** Register address */
  register: number;

  /** Whether the register is readable */
  readable: boolean;

  /** When this result was recorded */
  scannedAt: Date;

  /** Raw 2-byte value if readable, null if unreadable */
  value: Uint8Array | null;
}

/**
 * Dexie database for storing device information and scan results.
 */
export class BluettiDatabase extends Dexie {
  declare devices: Table<DeviceRecord, string>;
  declare scanResults: Table<ScanResultRecord, [string, number]>;

  constructor() {
    super("bluetti-discovery");
    this.version(1).stores({
      devices: "&id, name",
      scanResults: "[deviceId+register]",
    });
  }
}

/** Singleton database instance */
export const db = new BluettiDatabase();
