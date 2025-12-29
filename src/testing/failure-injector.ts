/**
 * Types of failures that can be injected.
 */
export enum OverrideType {
  /** Simulate a timeout (no response) */
  TIMEOUT = "timeout",
  /** Corrupt the CRC of the response */
  CRC_ERROR = "crc_error",
  /** Simulate a connection error */
  CONNECTION_ERROR = "connection_error",
  /** Override the response with custom bytes */
  RESPONSE_OVERRIDE = "response_override",
}

/**
 * Types of connection errors.
 */
export enum ConnectionErrorType {
  /** BLE connection error */
  BLE = "ble",
  /** End-of-file / stream closed error */
  EOF = "eof",
}

/**
 * A queued failure injection.
 */
type Override =
  | { type: OverrideType.TIMEOUT }
  | { type: OverrideType.CRC_ERROR }
  | { type: OverrideType.CONNECTION_ERROR; errorType: ConnectionErrorType }
  | { type: OverrideType.RESPONSE_OVERRIDE; response: Uint8Array };

/**
 * Error thrown for injected BLE connection failures.
 */
export class BleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BleError";
  }
}

/**
 * Error thrown for injected EOF failures.
 */
export class EofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EofError";
  }
}

/**
 * FIFO queue-based failure injector for testing error conditions.
 *
 * Allows tests to inject failures like timeouts, CRC errors, and
 * connection errors that will be consumed in order.
 */
export class FailureInjector {
  private overrideQueue: Override[] = [];

  /**
   * Injects timeout failures into the queue.
   *
   * @param count - Number of timeouts to inject
   */
  injectTimeout(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.overrideQueue.push({ type: OverrideType.TIMEOUT });
    }
  }

  /**
   * Injects CRC errors into the queue.
   *
   * @param count - Number of CRC errors to inject
   */
  injectCrcError(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.overrideQueue.push({ type: OverrideType.CRC_ERROR });
    }
  }

  /**
   * Injects connection errors into the queue.
   *
   * @param errorType - Type of connection error
   * @param count - Number of errors to inject
   */
  injectConnectionError(errorType = ConnectionErrorType.BLE, count = 1): void {
    for (let i = 0; i < count; i++) {
      this.overrideQueue.push({ type: OverrideType.CONNECTION_ERROR, errorType });
    }
  }

  /**
   * Overrides the next response with custom bytes.
   *
   * @param response - The bytes to return instead of the real response
   */
  overrideNextResponse(response: Uint8Array): void {
    this.overrideQueue.push({ type: OverrideType.RESPONSE_OVERRIDE, response });
  }

  /**
   * Checks if the next failure is a timeout and consumes it.
   *
   * @returns True if a timeout should occur
   */
  shouldTimeout(): boolean {
    const next = this.overrideQueue[0];
    if (next?.type === OverrideType.TIMEOUT) {
      this.overrideQueue.shift();
      return true;
    }
    return false;
  }

  /**
   * Checks if the next failure is a CRC error and consumes it.
   *
   * @returns True if the CRC should be corrupted
   */
  shouldCorruptCrc(): boolean {
    const next = this.overrideQueue[0];
    if (next?.type === OverrideType.CRC_ERROR) {
      this.overrideQueue.shift();
      return true;
    }
    return false;
  }

  /**
   * Checks if the next failure is a connection error and throws if so.
   *
   * @throws BleError or EofError if a connection error is queued
   */
  checkConnectionError(): void {
    const next = this.overrideQueue[0];
    if (next?.type === OverrideType.CONNECTION_ERROR) {
      this.overrideQueue.shift();
      if (next.errorType === ConnectionErrorType.BLE) {
        throw new BleError("Injected BLE error");
      } else {
        throw new EofError("Injected EOF error");
      }
    }
  }

  /**
   * Gets a response override if one is queued.
   *
   * @returns The override response bytes, or undefined if none queued
   */
  getResponseOverride(): Uint8Array | undefined {
    const next = this.overrideQueue[0];
    if (next?.type === OverrideType.RESPONSE_OVERRIDE) {
      this.overrideQueue.shift();
      return next.response;
    }
    return undefined;
  }

  /**
   * Returns the number of pending overrides in the queue.
   */
  get pendingCount(): number {
    return this.overrideQueue.length;
  }

  /**
   * Clears all pending overrides.
   */
  clear(): void {
    this.overrideQueue = [];
  }
}
