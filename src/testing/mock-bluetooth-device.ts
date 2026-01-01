import { RegisterMemory } from "./register-memory.ts";
import { MODBUSHandler, createRange, type AddressRange } from "./modbus-handler.ts";
import { FailureInjector, ConnectionErrorType, BleError, EofError } from "./failure-injector.ts";
import { HandshakeProtocol, HandshakeMessage, HandshakeState } from "../encryption/handshake.ts";
import { aesEncrypt, aesDecrypt } from "../encryption/aes.ts";
import type { KeyBundle } from "../encryption/key-bundle.ts";

// Re-export for convenience
export { ConnectionErrorType, BleError, EofError };

/** GATT UUIDs for Bluetti devices */
export const BLUETTI_SERVICE_UUID = 0xff00;
export const BLUETTI_WRITE_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
export const BLUETTI_NOTIFY_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";

export async function generateKey(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
}

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

  /** Whether this device uses encryption */
  encrypted?: boolean;

  /** Key bundle for encryption (required if encrypted is true) */
  keyBundle?: KeyBundle;
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

    // Handle the write
    await this.device.handleWrite(value);
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

  // Encryption support
  private _clientKeyBundle: KeyBundle | null = null;
  private _serverKeyBundle: KeyBundle | null = null;
  private _handshakeProtocol: HandshakeProtocol | null = null;

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

    // Encryption setup
    if (config.encrypted) {
      Promise.all([generateKey(), generateKey()]).then(([clientKey, serverKey]) => {
        const sharedSecret = crypto.getRandomValues(new Uint8Array(16));
        this._clientKeyBundle = {
          signingKey: clientKey.privateKey,
          verifyKey: serverKey.publicKey,
          sharedSecret,
        };
        this._serverKeyBundle = {
          signingKey: serverKey.privateKey,
          verifyKey: clientKey.publicKey,
          sharedSecret,
        };
      });
    }
  }

  /**
   * Gets direct access to the register memory for test setup.
   */
  get registerMemory(): RegisterMemory {
    return this.memory;
  }

  /**
   * Returns the key bundle to use for the client if encryption is on.
   */
  get clientKeyBundle(): KeyBundle | null {
    return this._clientKeyBundle;
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
   * Whether the encryption handshake is complete.
   */
  get handshakeComplete(): boolean {
    return this._handshakeProtocol?.isComplete ?? false;
  }

  /**
   * Sets the notify characteristic reference.
   * @internal Called by MockService when the notify characteristic is created.
   */
  setNotifyCharacteristic(char: MockCharacteristic): void {
    this.notifyCharacteristic = char;

    // If encrypted, initiate handshake by sending challenge after a delay
    if (this._serverKeyBundle) {
      this._handshakeProtocol = new HandshakeProtocol(this._serverKeyBundle);
      this._handshakeProtocol.handle(null).then((challenge) => {
        this.sendDelayedNotification(challenge!);
      });
    }
  }

  /**
   * Handles an incoming command, with encryption support.
   * @internal Called by MockCharacteristic when data is written.
   */
  async handleWrite(value: Uint8Array): Promise<void> {
    // If it's encrypted...
    if (this._handshakeProtocol) {
      if (!this._handshakeProtocol.sessionAesKey) {
        // If we're still in the handshake protocol, let it handle things
        await this._handleHandshakeMessage(value);
        return;
      } else {
        value = await aesDecrypt(value, this._handshakeProtocol.sessionAesKey);
      }
    }

    // Process command
    let response = this.failureInjector.getResponseOverride();
    if (!response) {
      response = this.modbusHandler.handleCommand(value);
    }

    // Apply CRC corruption if injected
    if (this.failureInjector.shouldCorruptCrc()) {
      response[response.length - 1]! ^= 0xff;
    }

    // Ecnrypt it if we have the session key
    if (this._handshakeProtocol?.sessionAesKey) {
      response = await aesEncrypt(response, this._handshakeProtocol.sessionAesKey);
    }

    // Send response via notification
    this.sendNotification(response);
  }

  private async _handleHandshakeMessage(value: Uint8Array): Promise<void> {
    // Generate response - all writes will result in a response message
    const response = (await this._handshakeProtocol!.handle(value))!;
    this.sendDelayedNotification(response);

    // After the challenge round is done we need to initiate the key exchange
    // round
    const challengeAccepted = new HandshakeMessage(
      HandshakeState.CHALLENGE_ACCEPTED,
      new Uint8Array([0])
    );
    if (challengeAccepted.toBytes().every((v, i) => response[i] == v)) {
      const keyRound = await this._handshakeProtocol!.handle(null);
      this.sendDelayedNotification(keyRound!);
    }
  }

  /**
   * Sends the notification with a setTimeout(x, 0) delay, to simulate a real
   * device response delay
   */
  private sendDelayedNotification(data: Uint8Array): void {
    setTimeout(this.sendNotification, 0, data);
  }

  /**
   * Sends a notification to the registered listener.
   * Sets the value on the notify characteristic and dispatches the event.
   */
  private sendNotification = (data: Uint8Array): void => {
    if (!this.notifyCharacteristic) return;

    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.notifyCharacteristic.value = dataView;
    this.notifyCharacteristic.dispatchEvent(new Event("characteristicvaluechanged"));
  };
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
