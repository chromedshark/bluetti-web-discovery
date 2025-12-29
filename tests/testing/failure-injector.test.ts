import { describe, test, expect, beforeEach } from "bun:test";
import {
  FailureInjector,
  ConnectionErrorType,
  BleError,
  EofError,
} from "../../src/testing/failure-injector.ts";

describe("FailureInjector", () => {
  let injector: FailureInjector;

  beforeEach(() => {
    injector = new FailureInjector();
  });

  describe("timeout injection", () => {
    test("shouldTimeout returns true when timeout is queued", () => {
      injector.injectTimeout();

      expect(injector.shouldTimeout()).toBe(true);
    });

    test("shouldTimeout returns false when nothing queued", () => {
      expect(injector.shouldTimeout()).toBe(false);
    });

    test("shouldTimeout consumes the timeout from queue", () => {
      injector.injectTimeout();

      expect(injector.shouldTimeout()).toBe(true);
      expect(injector.shouldTimeout()).toBe(false);
    });

    test("injects multiple timeouts", () => {
      injector.injectTimeout(3);

      expect(injector.pendingCount).toBe(3);
      expect(injector.shouldTimeout()).toBe(true);
      expect(injector.shouldTimeout()).toBe(true);
      expect(injector.shouldTimeout()).toBe(true);
      expect(injector.shouldTimeout()).toBe(false);
    });
  });

  describe("CRC error injection", () => {
    test("shouldCorruptCrc returns true when CRC error is queued", () => {
      injector.injectCrcError();

      expect(injector.shouldCorruptCrc()).toBe(true);
    });

    test("shouldCorruptCrc returns false when nothing queued", () => {
      expect(injector.shouldCorruptCrc()).toBe(false);
    });

    test("shouldCorruptCrc consumes the error from queue", () => {
      injector.injectCrcError();

      expect(injector.shouldCorruptCrc()).toBe(true);
      expect(injector.shouldCorruptCrc()).toBe(false);
    });

    test("injects multiple CRC errors", () => {
      injector.injectCrcError(2);

      expect(injector.pendingCount).toBe(2);
      expect(injector.shouldCorruptCrc()).toBe(true);
      expect(injector.shouldCorruptCrc()).toBe(true);
      expect(injector.shouldCorruptCrc()).toBe(false);
    });
  });

  describe("connection error injection", () => {
    test("checkConnectionError throws BleError when BLE error queued", () => {
      injector.injectConnectionError(ConnectionErrorType.BLE);

      expect(() => injector.checkConnectionError()).toThrow(BleError);
    });

    test("checkConnectionError throws EofError when EOF error queued", () => {
      injector.injectConnectionError(ConnectionErrorType.EOF);

      expect(() => injector.checkConnectionError()).toThrow(EofError);
    });

    test("checkConnectionError does nothing when nothing queued", () => {
      expect(() => injector.checkConnectionError()).not.toThrow();
    });

    test("checkConnectionError consumes the error from queue", () => {
      injector.injectConnectionError();

      expect(() => injector.checkConnectionError()).toThrow();
      expect(() => injector.checkConnectionError()).not.toThrow();
    });

    test("injects multiple connection errors", () => {
      injector.injectConnectionError(ConnectionErrorType.BLE, 2);

      expect(injector.pendingCount).toBe(2);
      expect(() => injector.checkConnectionError()).toThrow(BleError);
      expect(() => injector.checkConnectionError()).toThrow(BleError);
      expect(() => injector.checkConnectionError()).not.toThrow();
    });
  });

  describe("response override", () => {
    test("getResponseOverride returns override when queued", () => {
      const response = new Uint8Array([0x01, 0x02, 0x03]);
      injector.overrideNextResponse(response);

      const result = injector.getResponseOverride();
      expect(result).toEqual(response);
    });

    test("getResponseOverride returns undefined when nothing queued", () => {
      expect(injector.getResponseOverride()).toBeUndefined();
    });

    test("getResponseOverride consumes the override from queue", () => {
      injector.overrideNextResponse(new Uint8Array([0x01]));

      expect(injector.getResponseOverride()).toBeDefined();
      expect(injector.getResponseOverride()).toBeUndefined();
    });
  });

  describe("FIFO ordering", () => {
    test("overrides are consumed in order", () => {
      injector.injectTimeout();
      injector.injectCrcError();
      injector.injectConnectionError();

      // Only the first one matches each type check
      expect(injector.shouldTimeout()).toBe(true);

      // Now CRC error is at front
      expect(injector.shouldTimeout()).toBe(false);
      expect(injector.shouldCorruptCrc()).toBe(true);

      // Now connection error is at front
      expect(injector.shouldCorruptCrc()).toBe(false);
      expect(() => injector.checkConnectionError()).toThrow();
    });

    test("wrong type check does not consume override", () => {
      injector.injectCrcError();

      // Timeout check should not consume the CRC error
      expect(injector.shouldTimeout()).toBe(false);
      expect(injector.pendingCount).toBe(1);

      // CRC check should consume it
      expect(injector.shouldCorruptCrc()).toBe(true);
      expect(injector.pendingCount).toBe(0);
    });
  });

  describe("queue management", () => {
    test("pendingCount reflects queue size", () => {
      expect(injector.pendingCount).toBe(0);

      injector.injectTimeout(2);
      expect(injector.pendingCount).toBe(2);

      injector.injectCrcError();
      expect(injector.pendingCount).toBe(3);

      injector.shouldTimeout();
      expect(injector.pendingCount).toBe(2);
    });

    test("clear removes all pending overrides", () => {
      injector.injectTimeout(2);
      injector.injectCrcError(3);

      expect(injector.pendingCount).toBe(5);

      injector.clear();
      expect(injector.pendingCount).toBe(0);
    });
  });
});
