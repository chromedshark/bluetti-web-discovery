import { db, type DeviceRecord } from "../database";
import {
  ModbusError,
  ChecksumError,
  TimeoutError,
  type ConnectionOptions,
} from "../bluetooth/client";
import { delay } from "../utils/delay";

export interface RecognizableDevice {
  id: string;
  deviceName: string | null;
  readRegisters(
    startAddress: number,
    count: number,
    options?: ConnectionOptions
  ): Promise<Uint8Array>;
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY = 3000;

export interface RecognizeOptions {
  /** Timeout for each request in milliseconds (default: 5000) */
  timeout?: number;
  /** Maximum number of retries for timeout/checksum errors (default: 3) */
  retryLimit?: number;
  /** Delay between retries in milliseconds (default: 3000) */
  retryDelay?: number;
}

/**
 * A log entry for the recognition process.
 */
type LogEntryField = "protocolVersion" | "deviceType";
interface StartedLogEntry {
  type: "started";
  field: LogEntryField;
}
interface SucceededLogEntry {
  type: "success";
  field: LogEntryField;
  value: number | string;
}
interface ErrorLogEntry {
  type: "error";
  field: LogEntryField;
  error: Error;
}
export type LogEntry = StartedLogEntry | SucceededLogEntry | ErrorLogEntry;

interface FieldConfig {
  name: LogEntryField;
  register: number;
  byteSize: number;
  parse: (bytes: Uint8Array) => string | number;
}

/**
 * Decodes a string field from register data (for protocol version < 2000).
 */
function decodeStringField(bytes: Uint8Array): string {
  const lastNonNull = bytes.findLastIndex((byte) => byte !== 0);
  bytes = bytes.subarray(0, lastNonNull + 1);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Decodes a swap string field from register data (for protocol version >= 2000).
 * Bytes within each 16-bit register are swapped.
 */
function decodeSwapStringField(bytes: Uint8Array): string {
  // Create a copy to avoid mutating the original
  const swapped = new Uint8Array(bytes);
  for (let i = 0; i < bytes.length; i += 2) {
    swapped[i] = bytes[i + 1]!;
    swapped[i + 1] = bytes[i]!;
  }
  return decodeStringField(swapped);
}

/**
 * Recognizes a Bluetti device by reading its protocol version and device type.
 * These values are required to enable discovery and exploration.
 */
export class DeviceRecognizer {
  private device: RecognizableDevice;
  private _log: LogEntry[] = [];

  constructor(device: RecognizableDevice) {
    this.device = device;
  }

  /**
   * The log of recognition steps, useful for displaying progress in the UI.
   */
  get log(): readonly LogEntry[] {
    return this._log;
  }

  /**
   * Recognizes the device by reading its protocol version and device type if
   * not previously seen, or returning a previous result stored in the database.
   *
   * @param options - Optional configuration for timeouts, retries, and delays
   * @returns A DeviceRecord with the recognized device information
   */
  async recognize(options: RecognizeOptions = {}): Promise<DeviceRecord> {
    let record = await db.devices.get(this.device.id);
    if (!record) {
      record = await this.queryDevice(options);
      await db.devices.add(record);
    }
    return record;
  }

  /**
   * Queries the device for its protocol version and device type.
   *
   * @param options - Optional configuration for timeouts, retries, and delays
   * @returns A DeviceRecord with the recognized device information
   */
  private async queryDevice(options: RecognizeOptions): Promise<DeviceRecord> {
    const retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;

    // Read protocol version
    let field = this.getProtocolVersionField();
    const protocolVersion = (await this.readWithRetry(field, options)) as number;

    // Delay before reading device type
    await delay(retryDelay);

    // Read device type
    field = this.getDeviceTypeField(protocolVersion);
    const deviceType = (await this.readWithRetry(field, options)) as string;

    return {
      id: this.device.id,
      name: this.device.deviceName || "",
      protocolVersion,
      deviceType,
    };
  }

  /**
   * Reads registers with retry logic for timeout and checksum errors.
   */
  private async readWithRetry(
    field: FieldConfig,
    options: RecognizeOptions
  ): Promise<string | number> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT;
    const retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      if (attempt > 0) await delay(retryDelay);

      this.logStarted(field.name);
      try {
        const bytes = await this.device.readRegisters(
          field.register,
          Math.ceil(field.byteSize / 2),
          { timeout: timeout }
        );
        const value = field.parse(bytes);
        this.logSuccess(field.name, value);
        return value;
      } catch (error) {
        if (error instanceof ModbusError) {
          // Modbus errors mean the device doesn't have data in the location we
          // think it should be, so fail out
          this.logError(field.name, error);
          throw error;
        } else if (error instanceof TimeoutError || error instanceof ChecksumError) {
          // These should be retried
          this.logError(field.name, error);
        } else {
          // Unknown error
          throw error;
        }
      }
    }

    throw new Error("Retries exhausted");
  }

  /**
   * Builds a field config for the protocol version
   */
  private getProtocolVersionField(): FieldConfig {
    return {
      name: "protocolVersion",
      register: 16,
      byteSize: 2,
      parse: (bytes: Uint8Array): number => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return view.getUint16(0);
      },
    };
  }

  /**
   * Builds a field config for the device type
   */
  private getDeviceTypeField(protocolVersion: number): FieldConfig {
    if (protocolVersion < 2000) {
      return { name: "deviceType", register: 10, byteSize: 12, parse: decodeStringField };
    } else {
      return { name: "deviceType", register: 110, byteSize: 12, parse: decodeSwapStringField };
    }
  }

  private logStarted(field: LogEntryField): void {
    this._log.push({ type: "started", field });
  }

  private logSuccess(field: LogEntryField, value: number | string): void {
    this._log.push({ type: "success", field, value });
  }

  private logError(field: LogEntryField, error: Error): void {
    this._log.push({ type: "error", field, error });
  }
}
