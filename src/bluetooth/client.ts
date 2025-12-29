import {
  BLUETTI_SERVICE_UUID,
  BLUETTI_WRITE_UUID,
  BLUETTI_NOTIFY_UUID,
  RESPONSE_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_PACKET_SIZE,
} from "./constants.ts";
import type { DeviceCommand } from "../modbus/commands.ts";

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
 * Client for communicating with Bluetti devices over Web Bluetooth.
 *
 * Handles GATT connection, command sending, and response validation.
 */
export class BluetoothClient {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

  private responsePromise: {
    resolve: (value: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  /**
   * Whether the client is currently connected.
   */
  get isConnected(): boolean {
    return this.server?.connected ?? false;
  }

  /**
   * The name of the connected device, or null if not connected.
   */
  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  /**
   * Requests a Bluetti device from the user and connects to it.
   *
   * This triggers the browser's device picker dialog.
   *
   * @throws DOMException if the user cancels or no device is found
   */
  async requestAndConnect(): Promise<void> {
    // Request device from user
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLUETTI_SERVICE_UUID] }],
    });

    await this.connect();
  }

  /**
   * Connects to the previously selected device.
   *
   * @throws Error if no device has been selected
   */
  async connect(): Promise<void> {
    if (!this.device?.gatt) {
      throw new Error("No device selected");
    }

    // Connect to GATT server
    this.server = await this.device.gatt.connect();

    // Get service and characteristics
    const service = await this.server.getPrimaryService(BLUETTI_SERVICE_UUID);
    this.writeCharacteristic = await service.getCharacteristic(BLUETTI_WRITE_UUID);
    this.notifyCharacteristic = await service.getCharacteristic(BLUETTI_NOTIFY_UUID);

    // Start notifications
    await this.notifyCharacteristic.startNotifications();
    this.notifyCharacteristic.addEventListener(
      "characteristicvaluechanged",
      this.handleNotification
    );
  }

  /**
   * Disconnects from the device.
   */
  disconnect(): void {
    if (this.notifyCharacteristic) {
      this.notifyCharacteristic.removeEventListener(
        "characteristicvaluechanged",
        this.handleNotification
      );
    }

    if (this.server?.connected) {
      this.server.disconnect();
    }

    this.device = null;
    this.server = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
    this.responsePromise = null;
  }

  /**
   * Sends a MODBUS command and waits for the response.
   *
   * @param command - The command to send
   * @param retries - Number of retry attempts (default: MAX_RETRIES)
   * @returns The parsed response data
   * @throws ModbusError if a MODBUS exception is received
   * @throws ChecksumError if the response CRC is invalid
   * @throws TimeoutError if no response is received
   */
  async sendCommand(command: DeviceCommand, retries = MAX_RETRIES): Promise<Uint8Array> {
    if (!this.writeCharacteristic || !this.notifyCharacteristic) {
      throw new Error("Not connected");
    }

    const responseSize = command.responseSize();
    if (responseSize > MAX_PACKET_SIZE) {
      throw new Error(`Response size ${responseSize} exceeds max packet size ${MAX_PACKET_SIZE}`);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await this.sendCommandOnce(command);
      } catch (error) {
        if (error instanceof ModbusError) {
          // Don't retry MODBUS errors - they're from the device
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new TimeoutError("Max retries exceeded");
  }

  /**
   * Sends a command once without retrying.
   */
  private async sendCommandOnce(command: DeviceCommand): Promise<Uint8Array> {
    // Create promise for response
    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      this.responsePromise = { resolve, reject };
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (this.responsePromise) {
        this.responsePromise.reject(new TimeoutError("Response timeout"));
        this.responsePromise = null;
      }
    }, RESPONSE_TIMEOUT_MS);

    try {
      // Send command
      await this.writeCharacteristic!.writeValueWithResponse(command.command as BufferSource);

      // Wait for response
      const response = await responsePromise;

      // Validate response
      if (command.isExceptionResponse(response)) {
        const exceptionCode = command.getExceptionCode(response);
        throw new ModbusError(`MODBUS exception: ${exceptionCode}`, exceptionCode);
      }

      if (!command.isValidResponse(response)) {
        throw new ChecksumError("Invalid response checksum");
      }

      // Parse and return data
      return command.parseResponse(response);
    } finally {
      clearTimeout(timeoutId);
      this.responsePromise = null;
    }
  }

  /**
   * Handles incoming notification data.
   */
  private handleNotification = (event: Event): void => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;

    if (!value || !this.responsePromise) {
      return;
    }

    // Convert DataView to Uint8Array
    const response = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

    // Resolve the response promise
    this.responsePromise.resolve(response);
    this.responsePromise = null;
  };
}
