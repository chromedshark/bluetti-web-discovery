import { db, type DeviceRecord } from "../database";
import {
  ModbusError,
  ChecksumError,
  TimeoutError,
  type ConnectionOptions,
} from "../bluetooth/client";
import { StringField, SwapStringField, Uint16Field, type Field } from "../fields";
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
interface StartedLogEntry {
  type: "started";
  field: string;
}
interface SucceededLogEntry {
  type: "success";
  field: string;
  value: number | string;
}
interface ErrorLogEntry {
  type: "error";
  field: string;
  error: Error;
}
export type LogEntry = StartedLogEntry | SucceededLogEntry | ErrorLogEntry;

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

    // Query device
    const protocolVersion = await this.readWithRetry(this.getProtocolVersionField(), options);
    await delay(retryDelay); // Delay before reading device type
    const deviceType = await this.readWithRetry(this.getDeviceTypeField(protocolVersion), options);

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
  private async readWithRetry<T extends string | number>(
    field: Field<T, unknown>,
    options: RecognizeOptions
  ): Promise<T> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT;
    const retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      if (attempt > 0) await delay(retryDelay);

      this.logStarted(field.name);
      try {
        const bytes = await this.device.readRegisters(
          field.location.register,
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
  private getProtocolVersionField() {
    return new Uint16Field({ register: 16 }, "protocol_version");
  }

  /**
   * Builds a field config for the device type
   */
  private getDeviceTypeField(protocolVersion: number) {
    if (protocolVersion < 2000) {
      return new StringField({ register: 10 }, "device_type", 6);
    } else {
      return new SwapStringField({ register: 110 }, "device_type", 6);
    }
  }

  private logStarted(field: string): void {
    this._log.push({ type: "started", field });
  }

  private logSuccess(field: string, value: number | string): void {
    this._log.push({ type: "success", field, value });
  }

  private logError(field: string, error: Error): void {
    this._log.push({ type: "error", field, error });
  }
}
