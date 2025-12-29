import { RegisterMemory } from "./register-memory.ts";
import { MODBUSHandler, createRange, type AddressRange } from "./modbus-handler.ts";
import { FailureInjector, ConnectionErrorType, BleError, EofError } from "./failure-injector.ts";

// Re-export for convenience
export { ConnectionErrorType, BleError, EofError };

/** GATT UUIDs for Bluetti devices */
export const BLUETTI_SERVICE_UUID = 0xff00;
export const BLUETTI_WRITE_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
export const BLUETTI_NOTIFY_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";

/**
 * Configuration for creating a mock Bluetti device.
 */
export interface MockBluetoothDeviceConfig {
  /** Device name (e.g., "AC3001234567890") */
  name: string;

  /** Initial register data as [address, data] pairs */
  registerData?: Array<[number, Uint8Array]>;

  /** Ranges of addresses that can be read */
  readableRanges: AddressRange[];

  /** Ranges of addresses that can be written */
  writableRanges: AddressRange[];
}

/**
 * A mock GATT characteristic for testing.
 */
interface MockCharacteristic {
  uuid: string;
  writeValue(value: Uint8Array): Promise<void>;
  writeValueWithResponse(value: Uint8Array): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  addEventListener(
    type: "characteristicvaluechanged",
    listener: (event: { target: { value: DataView } }) => void
  ): void;
  removeEventListener(
    type: "characteristicvaluechanged",
    listener: (event: { target: { value: DataView } }) => void
  ): void;
}

/**
 * A mock GATT service for testing.
 */
interface MockService {
  uuid: BluetoothServiceUUID;
  getCharacteristic(uuid: string): Promise<MockCharacteristic>;
}

/**
 * A mock GATT server for testing.
 */
interface MockGATTServer {
  connected: boolean;
  connect(): Promise<MockGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: BluetoothServiceUUID): Promise<MockService>;
}

/**
 * A mock Bluetti Bluetooth device for testing.
 *
 * Integrates RegisterMemory, MODBUSHandler, and FailureInjector to provide
 * a fully functional mock that can be used in place of a real device.
 */
export class MockBluetoothDevice {
  readonly name: string;
  readonly id: string;

  private readonly memory: RegisterMemory;
  private readonly modbusHandler: MODBUSHandler;
  private readonly failureInjector: FailureInjector;

  private notifyListener: ((event: { target: { value: DataView } }) => void) | null = null;
  private _connected = false;
  private _gatt: MockGATTServer | null = null;

  /**
   * Creates a new mock Bluetti device.
   */
  constructor(config: MockBluetoothDeviceConfig) {
    this.name = config.name;
    this.id = `mock-device-${crypto.randomUUID()}`;

    this.memory = new RegisterMemory();
    if (config.registerData) {
      for (const [address, data] of config.registerData) {
        this.memory.writeRegisters(address, data);
      }
    }

    this.modbusHandler = new MODBUSHandler(
      this.memory,
      config.readableRanges,
      config.writableRanges
    );

    this.failureInjector = new FailureInjector();
  }

  /**
   * Gets direct access to the register memory for test setup.
   */
  get registerMemory(): RegisterMemory {
    return this.memory;
  }

  /**
   * Injects timeout failures.
   */
  injectTimeout(count = 1): void {
    this.failureInjector.injectTimeout(count);
  }

  /**
   * Injects CRC errors.
   */
  injectCrcError(count = 1): void {
    this.failureInjector.injectCrcError(count);
  }

  /**
   * Injects connection errors.
   */
  injectConnectionError(errorType = ConnectionErrorType.BLE, count = 1): void {
    this.failureInjector.injectConnectionError(errorType, count);
  }

  /**
   * Overrides the next response with custom bytes.
   */
  overrideNextResponse(response: Uint8Array): void {
    this.failureInjector.overrideNextResponse(response);
  }

  /**
   * Creates a mock GATT server that mimics the BluetoothRemoteGATTServer interface.
   */
  get gatt(): MockGATTServer {
    if (this._gatt) {
      return this._gatt;
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const device = this;

    this._gatt = {
      get connected(): boolean {
        return device._connected;
      },

      async connect(): Promise<MockGATTServer> {
        device._connected = true;
        return device._gatt!;
      },

      disconnect(): void {
        device._connected = false;
        device.notifyListener = null;
      },

      async getPrimaryService(uuid: BluetoothServiceUUID): Promise<MockService> {
        if (uuid !== BLUETTI_SERVICE_UUID) {
          throw new Error(`Unknown service UUID: ${uuid}`);
        }

        return {
          uuid,

          async getCharacteristic(charUuid: string): Promise<MockCharacteristic> {
            if (charUuid === BLUETTI_WRITE_UUID) {
              return device.createWriteCharacteristic();
            } else if (charUuid === BLUETTI_NOTIFY_UUID) {
              return device.createNotifyCharacteristic();
            } else {
              throw new Error(`Unknown characteristic UUID: ${charUuid}`);
            }
          },
        };
      },
    };

    return this._gatt;
  }

  /**
   * Creates the write characteristic that receives MODBUS commands.
   */
  private createWriteCharacteristic(): MockCharacteristic {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const device = this;

    return {
      uuid: BLUETTI_WRITE_UUID,

      async writeValue(value: Uint8Array): Promise<void> {
        await this.writeValueWithResponse(value);
      },

      async writeValueWithResponse(value: Uint8Array): Promise<void> {
        // Check for connection error
        device.failureInjector.checkConnectionError();

        // Check for timeout (no response)
        if (device.failureInjector.shouldTimeout()) {
          return; // Don't send any response
        }

        const cmdBytes = value;

        // Check for response override
        let response = device.failureInjector.getResponseOverride();

        if (!response) {
          // Process the command normally
          response = device.modbusHandler.handleCommand(cmdBytes);
        }

        // Check for CRC corruption
        if (device.failureInjector.shouldCorruptCrc()) {
          response = new Uint8Array(response);
          response[response.length - 1]! ^= 0xff;
        }

        // Send response via notification
        device.sendNotification(response);
      },

      async startNotifications(): Promise<void> {
        // No-op for write characteristic
      },

      async stopNotifications(): Promise<void> {
        // No-op for write characteristic
      },

      addEventListener(): void {
        // No-op for write characteristic
      },

      removeEventListener(): void {
        // No-op for write characteristic
      },
    };
  }

  /**
   * Creates the notify characteristic that sends responses.
   */
  private createNotifyCharacteristic(): MockCharacteristic {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const device = this;

    return {
      uuid: BLUETTI_NOTIFY_UUID,

      async writeValue(): Promise<void> {
        throw new Error("Cannot write to notify characteristic");
      },

      async writeValueWithResponse(): Promise<void> {
        throw new Error("Cannot write to notify characteristic");
      },

      async startNotifications(): Promise<void> {
        // No-op, just allows notifications
      },

      async stopNotifications(): Promise<void> {
        device.notifyListener = null;
      },

      addEventListener(
        type: "characteristicvaluechanged",
        listener: (event: { target: { value: DataView } }) => void
      ): void {
        if (type === "characteristicvaluechanged") {
          device.notifyListener = listener;
        }
      },

      removeEventListener(
        type: "characteristicvaluechanged",
        listener: (event: { target: { value: DataView } }) => void
      ): void {
        if (type === "characteristicvaluechanged" && device.notifyListener === listener) {
          device.notifyListener = null;
        }
      },
    };
  }

  /**
   * Sends a notification to the registered listener.
   */
  private sendNotification(data: Uint8Array): void {
    if (this.notifyListener) {
      const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      this.notifyListener({ target: { value: dataView } });
    }
  }
}

/**
 * Creates a mock navigator.bluetooth implementation with a MockBluetoothDevice.
 *
 * @param device - The mock device to return from requestDevice()
 * @returns Mock bluetooth object to assign to navigator.bluetooth
 */
export function createMockBluetooth(device: MockBluetoothDevice) {
  return {
    async requestDevice(): Promise<MockBluetoothDevice> {
      return device;
    },

    async getAvailability(): Promise<boolean> {
      return true;
    },

    async getDevices(): Promise<MockBluetoothDevice[]> {
      return [device];
    },
  };
}

/**
 * Helper to create address ranges from start and count.
 */
export { createRange };
