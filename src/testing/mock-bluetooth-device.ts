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
 * Extends EventTarget to support native event dispatch.
 */
export class MockCharacteristic extends EventTarget {
  readonly uuid: string;
  private readonly type: "write" | "notify";
  private readonly device: MockBluetoothDevice;
  private invalid: boolean; // After disconnect characteristics should stop working

  /** Current value - writable for mock, used by notify characteristic */
  value: DataView | null = null;

  constructor(uuid: string, type: "write" | "notify", device: MockBluetoothDevice) {
    super();
    this.uuid = uuid;
    this.type = type;
    this.device = device;

    this.invalid = false;
    this.device.addEventListener(
      "gattserverdisconnected",
      () => {
        this.invalid = true;
      },
      { once: true }
    );
  }

  async writeValue(value: Uint8Array): Promise<void> {
    await this.writeValueWithResponse(value);
  }

  async writeValueWithResponse(value: Uint8Array): Promise<void> {
    if (this.type === "notify") throw new Error("Cannot write to notify characteristic");

    if (this.invalid) throw new DOMException("Invalid after disconnect", "InvalidStateError");

    // Check for connection error
    this.device.failureInjector.checkConnectionError();

    // Check for timeout (no response)
    if (this.device.failureInjector.shouldTimeout()) return;

    // Build response
    let response = this.device.failureInjector.getResponseOverride();
    if (!response) {
      // Process the command normally
      response = this.device.modbusHandler.handleCommand(value);
    }
    if (this.device.failureInjector.shouldCorruptCrc()) {
      response = new Uint8Array(response);
      response[response.length - 1]! ^= 0xff;
    }

    // Send response via notification
    this.device.sendNotification(response);
  }

  async startNotifications(): Promise<void> {
    // No-op, just allows notifications
  }

  async stopNotifications(): Promise<void> {
    // No-op for mock
  }
}

/**
 * A mock GATT service for testing.
 * Caches characteristics so the same instance is returned on subsequent calls.
 */
class MockService {
  readonly uuid: BluetoothServiceUUID;
  private readonly device: MockBluetoothDevice;
  private writeChar: MockCharacteristic | null = null;
  private notifyChar: MockCharacteristic | null = null;

  constructor(uuid: BluetoothServiceUUID, device: MockBluetoothDevice) {
    this.uuid = uuid;
    this.device = device;
  }

  async getCharacteristic(uuid: string): Promise<MockCharacteristic> {
    if (uuid === BLUETTI_WRITE_UUID) {
      if (!this.writeChar) {
        this.writeChar = new MockCharacteristic(uuid, "write", this.device);
      }
      return this.writeChar;
    } else if (uuid === BLUETTI_NOTIFY_UUID) {
      if (!this.notifyChar) {
        this.notifyChar = new MockCharacteristic(uuid, "notify", this.device);
        this.device.setNotifyCharacteristic(this.notifyChar);
      }
      return this.notifyChar;
    } else {
      throw new Error(`Unknown characteristic UUID: ${uuid}`);
    }
  }
}

/**
 * A mock GATT server for testing.
 * Extends EventTarget for proper event dispatch support.
 */
class MockGATTServer {
  private readonly device: MockBluetoothDevice;
  private _connected = false;
  private service: MockService | null = null;

  constructor(device: MockBluetoothDevice) {
    this.device = device;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): Promise<MockGATTServer> {
    if (this.device.failureInjector.shouldTimeout()) {
      return new Promise<MockGATTServer>(() => {});
    } else {
      this._connected = true;
      return Promise.resolve(this);
    }
  }

  disconnect(): void {
    this._connected = false;
    this.service = null;
    this.device.dispatchEvent(new Event("gattserverdisconnected"));
  }

  async getPrimaryService(uuid: BluetoothServiceUUID): Promise<MockService> {
    if (uuid !== BLUETTI_SERVICE_UUID) {
      throw new Error(`Unknown service UUID: ${uuid}`);
    }

    if (!this.service) {
      this.service = new MockService(uuid, this.device);
    }
    return this.service;
  }
}

/**
 * A mock Bluetti Bluetooth device for testing.
 *
 * Integrates RegisterMemory, MODBUSHandler, and FailureInjector to provide
 * a fully functional mock that can be used in place of a real device.
 *
 * Extends EventTarget to support the gattserverdisconnected event.
 */
export class MockBluetoothDevice extends EventTarget {
  readonly name: string;
  readonly id: string;

  private readonly memory: RegisterMemory;
  /** @internal */
  readonly modbusHandler: MODBUSHandler;
  /** @internal */
  readonly failureInjector: FailureInjector;

  private _gatt: MockGATTServer | null = null;
  private notifyCharacteristic: MockCharacteristic | null = null;

  /**
   * Creates a new mock Bluetti device.
   */
  constructor(config: MockBluetoothDeviceConfig) {
    super();
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
    if (!this._gatt) this._gatt = new MockGATTServer(this);
    return this._gatt;
  }

  /**
   * Sets the notify characteristic reference.
   * @internal Called by MockService when the notify characteristic is created.
   */
  setNotifyCharacteristic(char: MockCharacteristic): void {
    this.notifyCharacteristic = char;
  }

  /**
   * Sends a notification to the registered listener.
   * Sets the value on the notify characteristic and dispatches the event.
   */
  sendNotification(data: Uint8Array): void {
    if (!this.notifyCharacteristic) return;

    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.notifyCharacteristic.value = dataView;
    this.notifyCharacteristic.dispatchEvent(new Event("characteristicvaluechanged"));
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
  };
}

/**
 * Helper to create address ranges from start and count.
 */
export { createRange };
