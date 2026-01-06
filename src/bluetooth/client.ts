import {
  BLUETTI_SERVICE_UUID,
  BLUETTI_WRITE_UUID,
  BLUETTI_NOTIFY_UUID,
  RESPONSE_TIMEOUT_MS,
  INITIAL_ENCRYPTION_TIMEOUT_MS,
  MAX_PACKET_SIZE,
} from "./constants.ts";
import {
  ReadHoldingRegisters,
  WriteHoldingRegisters,
  type DeviceCommand,
} from "../modbus/commands.ts";
import { HandshakeProtocol } from "../encryption/handshake.ts";
import { aesEncrypt, aesDecrypt } from "../encryption/aes.ts";
import type { KeyBundle } from "../encryption/key-bundle.ts";
import type { MockBluetoothDevice } from "../testing/mock-bluetooth-device.ts";
import { withAbort } from "../utils/withAbort.ts";

/**
 * Error thrown when a MODBUS exception response is received.
 */
export class ModbusError extends Error {
  constructor(
    message: string,
    public readonly exceptionCode: number
  ) {
    super(message);
    this.name = "ModbusError";
  }
}

/**
 * Error thrown when the response CRC is invalid.
 */
export class ChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChecksumError";
  }
}

/**
 * Error thrown when communication times out.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Options for connect and register operations.
 */
export interface ConnectionOptions {
  /** Timeout in milliseconds (default: RESPONSE_TIMEOUT_MS) */
  timeout?: number;
}

/**
 * Client for communicating with Bluetti devices over Web Bluetooth.
 *
 * Use the static `request()` method to create an instance, then call `connect()`.
 *
 * @example
 * ```typescript
 * const client = await BluetoothClient.request();
 * await client.connect();
 * const data = await client.readRegisters(0, 3);
 * ```
 */
export class BluetoothClient {
  private device: BluetoothDevice;
  private keyBundle: KeyBundle | undefined;

  // Characteristics - wiped on disconnect, re-acquired on connect
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

  // Response handling
  private responsePromise: {
    resolve: (value: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  // Encryption support
  private handshakeProtocol: HandshakeProtocol | null = null;

  /**
   * Private constructor - use `BluetoothClient.request()` to create instances.
   */
  private constructor(device: BluetoothDevice, keyBundle?: KeyBundle) {
    this.device = device;
    this.keyBundle = keyBundle;
    this.device.addEventListener("gattserverdisconnected", this.handleGattServerDisconnected);
  }

  /**
   * Triggers the browser's device picker to select a Bluetti device.
   *
   * Returns a client instance with the device selected but NOT connected.
   * Call `connect()` to establish the GATT connection.
   *
   * @throws DOMException if the user cancels or no device is found
   */
  static async request(keyBundle?: KeyBundle): Promise<BluetoothClient> {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLUETTI_SERVICE_UUID] }],
    });

    // If device is a mock device, use the key bundle from there
    const mockDevice = device as unknown as MockBluetoothDevice;
    if (mockDevice.clientKeyBundle) keyBundle = mockDevice.clientKeyBundle;

    return new BluetoothClient(device, keyBundle);
  }

  /**
   * Whether the GATT server is currently connected.
   */
  get isConnected(): boolean {
    return this.writeCharacteristic != null && this.notifyCharacteristic != null;
  }

  /**
   * The device id assigned by the browser
   */
  get id(): string {
    return this.device.id;
  }

  /**
   * The name of the device, or null if unnamed.
   */
  get deviceName(): string | null {
    return this.device.name ?? null;
  }

  /**
   * Whether the connection is using encryption.
   */
  get isEncrypted(): boolean {
    return !!this.handshakeProtocol?.sessionAesKey;
  }

  /**
   * Connects to the device's GATT server and acquires characteristics.
   *
   * Can be called multiple times to reconnect after disconnection.
   *
   * @param options - Optional timeout configuration
   */
  async connect(options?: ConnectionOptions): Promise<void> {
    const signal = AbortSignal.timeout(options?.timeout ?? RESPONSE_TIMEOUT_MS);
    await this.connectInternal(signal);
  }

  /**
   * Disconnects from the device.
   *
   * The device reference is kept, allowing reconnection via `connect()`.
   */
  disconnect(): void {
    // Cleanup happens in handleGattServerDisconnected
    if (this.device.gatt) this.device.gatt.disconnect();
  }

  /**
   * Reads registers from the device.
   *
   * Auto-reconnects if disconnected.
   *
   * @param startAddress - Starting register address
   * @param count - Number of registers to read (max 7)
   * @param options - Optional timeout configuration
   * @returns Raw register data (2 bytes per register, big-endian)
   * @throws Error if count exceeds maximum
   * @throws ModbusError on MODBUS exception
   * @throws ChecksumError on CRC failure
   * @throws TimeoutError on response timeout
   */
  async readRegisters(
    startAddress: number,
    count: number,
    options?: ConnectionOptions
  ): Promise<Uint8Array> {
    const command = new ReadHoldingRegisters(startAddress, count);
    const responseSize = command.responseSize();
    if (responseSize > MAX_PACKET_SIZE) {
      throw new Error(`Response size ${responseSize} exceeds max packet size ${MAX_PACKET_SIZE}`);
    }

    return this.sendCommand(command, options?.timeout);
  }

  /**
   * Writes registers to the device.
   *
   * Auto-reconnects if disconnected.
   *
   * @param startAddress - Starting register address
   * @param data - Register data to write (2 bytes per register, big-endian)
   * @param options - Optional timeout configuration
   * @throws Error if data length is odd or exceeds packet size
   * @throws ModbusError on MODBUS exception
   * @throws ChecksumError on CRC failure
   * @throws TimeoutError on response timeout
   */
  async writeRegisters(
    startAddress: number,
    data: Uint8Array,
    options?: ConnectionOptions
  ): Promise<void> {
    const command = new WriteHoldingRegisters(startAddress, data);
    if (command.command.length > MAX_PACKET_SIZE) {
      throw new Error(
        `Write command too large: ${command.command.length} bytes exceeds max packet size ${MAX_PACKET_SIZE}`
      );
    }

    await this.sendCommand(command, options?.timeout);
  }

  /**
   * Internal connect implementation that accepts an AbortSignal.
   */
  private async connectInternal(signal: AbortSignal): Promise<void> {
    if (this.isConnected) return;

    if (!this.device.gatt) throw new Error("Device has no GATT server");

    try {
      // Connect to GATT server
      await withAbort(this.device.gatt.connect(), signal);

      // Get service and characteristics
      const service = await withAbort(
        this.device.gatt.getPrimaryService(BLUETTI_SERVICE_UUID),
        signal
      );
      this.writeCharacteristic = await withAbort(
        service.getCharacteristic(BLUETTI_WRITE_UUID),
        signal
      );
      this.notifyCharacteristic = await withAbort(
        service.getCharacteristic(BLUETTI_NOTIFY_UUID),
        signal
      );

      // Start notifications
      this.notifyCharacteristic.addEventListener(
        "characteristicvaluechanged",
        this.handleNotification
      );
      await withAbort(this.notifyCharacteristic.startNotifications(), signal);

      // Wait briefly for potential encryption handshake initiation
      // Encrypted devices send a challenge immediately after notification subscription
      await this.detectAndHandleEncryption(signal);
    } catch (error) {
      if (signal.aborted) throw new TimeoutError("Connection timeout");
      throw error;
    }
  }

  /**
   * Detects encryption initiation and waits for handshake to finish.
   */
  private async detectAndHandleEncryption(signal: AbortSignal): Promise<void> {
    if (!this.keyBundle) return;

    // Wait for an initial handshake message
    let data: Uint8Array;
    const encryptionTimeout = AbortSignal.timeout(INITIAL_ENCRYPTION_TIMEOUT_MS);
    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      this.responsePromise = { resolve, reject };
    });
    try {
      data = await withAbort(responsePromise, AbortSignal.any([signal, encryptionTimeout]));
    } catch {
      return;
    } finally {
      this.responsePromise = null;
    }

    // Set up the handshake protocol and wait for it to finish
    const handshakeProtocol = new HandshakeProtocol(this.keyBundle);
    const res = await handshakeProtocol.handle(data);
    await this.write(res!);
    this.handshakeProtocol = handshakeProtocol;
    await withAbort(handshakeProtocol.sessionKeyPromise(), signal);
  }

  /**
   * Sends a MODBUS command and waits for the response.
   * Auto-reconnects if disconnected.
   *
   * @param command - The command to send
   * @param timeout - Timeout in milliseconds (covers both reconnect and command)
   * @returns The parsed response data
   */
  private async sendCommand(
    command: DeviceCommand,
    timeout = RESPONSE_TIMEOUT_MS
  ): Promise<Uint8Array> {
    const signal = AbortSignal.timeout(timeout);

    // Ensure we are connected. Re-connect if disconnected.
    await this.connectInternal(signal);

    // Do not allow concurrent requests
    if (this.responsePromise) throw new Error("Command in progress");

    // Create promise for response
    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      this.responsePromise = { resolve, reject };
    });

    try {
      // Encrypt command if connection is encrypted
      let commandData = command.command;
      if (this.handshakeProtocol?.sessionAesKey) {
        commandData = await aesEncrypt(commandData, this.handshakeProtocol.sessionAesKey);
      }

      // Send command
      await withAbort(this.write(commandData), signal);

      // Wait for response
      let response = await withAbort(responsePromise, signal);

      // Decrypt response if connection is encrypted
      if (this.handshakeProtocol?.sessionAesKey) {
        response = await aesDecrypt(response, this.handshakeProtocol.sessionAesKey);
      }

      // Validate response
      if (!command.isValidResponse(response)) {
        throw new ChecksumError(`Invalid response checksum: ${response.toHex()}`);
      } else if (command.isExceptionResponse(response)) {
        const exceptionCode = command.getExceptionCode(response);
        throw new ModbusError(`MODBUS exception: ${exceptionCode}`, exceptionCode);
      }

      // Parse and return data
      return command.parseResponse(response);
    } catch (error) {
      if (signal.aborted) throw new TimeoutError("Response timeout");
      throw error;
    } finally {
      this.responsePromise = null;
    }
  }

  /**
   * Directly writes the given data to the GATT characteristic
   */
  private write(data: Uint8Array): Promise<void> {
    return this.writeCharacteristic!.writeValueWithResponse(data as Uint8Array<ArrayBuffer>);
  }

  /**
   * Handles incoming notification data.
   */
  private handleNotification = async (event: Event): Promise<void> => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;

    if (!value) return;

    // Convert DataView to Uint8Array
    const response = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

    if (this.handshakeProtocol && !this.handshakeProtocol.isComplete) {
      // Advance the handshake
      const res = await this.handshakeProtocol.handle(response);
      if (res) await this.write(res);
    } else if (this.responsePromise) {
      // Resolve the response promise
      this.responsePromise.resolve(response);
      this.responsePromise = null;
    }
  };

  /**
   * Handles disconnect event. Clears any internal state that is no longer
   * valid.
   */
  private handleGattServerDisconnected = (): void => {
    if (this.notifyCharacteristic) {
      this.notifyCharacteristic.removeEventListener(
        "characteristicvaluechanged",
        this.handleNotification
      );
    }

    // Wipe characteristics (they're dead after disconnect)
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;

    // Wipe response promise. It will get rejected automatically.
    this.responsePromise = null;

    // Wipe encryption state (session key is no longer valid)
    this.handshakeProtocol = null;
  };
}
