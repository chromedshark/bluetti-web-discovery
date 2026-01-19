import { describe, test, expect, beforeEach } from "bun:test";

import { RegisterMemory } from "../../src/testing/register-memory.ts";
import { RegisterScanner, ProgressEvent } from "../../src/discovery/index.ts";
import type { ScannableDevice } from "../../src/discovery/index.ts";
import { db } from "../../src/database";

/**
 * Creates a ScannableDevice from RegisterMemory with configurable readable ranges.
 */
function createMockDevice(
  deviceId: string,
  config: {
    readableRanges: Array<{ start: number; end: number }>;
    registerData?: Array<[number, Uint8Array]>;
  }
): ScannableDevice {
  const memory = new RegisterMemory();

  // Initialize register data
  if (config.registerData) {
    for (const [address, data] of config.registerData) {
      memory.writeRegisters(address, data);
    }
  }

  return {
    id: deviceId,
    async readRegisters(startAddress: number, count: number): Promise<Uint8Array> {
      // Check if all registers in range are readable
      const endAddress = startAddress + count;
      const isReadable = config.readableRanges.some(
        (range) => startAddress >= range.start && endAddress <= range.end
      );

      if (!isReadable) {
        throw new Error(`Registers ${startAddress}-${endAddress - 1} not readable`);
      }

      return memory.readRegisters(startAddress, count);
    },
  };
}

describe("RegisterScanner", () => {
  beforeEach(async () => {
    await db.devices.clear();
    await db.scanResults.clear();
  });

  describe("static getDefaultRange", () => {
    test("returns 0-8000 for protocol version less than 2000", () => {
      expect(RegisterScanner.getDefaultRange(1001)).toEqual({ start: 0, end: 8000 });
      expect(RegisterScanner.getDefaultRange(1)).toEqual({ start: 0, end: 8000 });
      expect(RegisterScanner.getDefaultRange(1999)).toEqual({ start: 0, end: 8000 });
    });

    test("returns 0-20000 for protocol version 2000 or greater", () => {
      expect(RegisterScanner.getDefaultRange(2000)).toEqual({ start: 0, end: 20000 });
      expect(RegisterScanner.getDefaultRange(2001)).toEqual({ start: 0, end: 20000 });
      expect(RegisterScanner.getDefaultRange(3000)).toEqual({ start: 0, end: 20000 });
    });
  });

  describe("static getScannedRegisters", () => {
    const mockDevice: ScannableDevice = {
      id: "test-device",
      readRegisters: async () => new Uint8Array(),
    };

    const seedScannedRegisters = async (registers: number[]): Promise<void> => {
      await db.scanResults.bulkAdd(
        registers.map((register) => ({
          deviceId: "test-device",
          register,
          readable: false,
          scannedAt: new Date(),
          value: null,
        }))
      );
    };

    test("it returns scanned registers in order", async () => {
      await seedScannedRegisters([7, 5, 6, 2]);
      const scanned = await RegisterScanner.getScannedRegisters(mockDevice);
      expect(scanned).toEqual([2, 5, 6, 7]);
    });

    test("it returns an empty array if no previous scans", async () => {
      const scanned = await RegisterScanner.getScannedRegisters(mockDevice);
      expect(scanned).toEqual([]);
    });
  });

  describe("static calculatePendingRanges", () => {
    test("returns full range when none scanned", () => {
      const ranges = RegisterScanner.calculatePendingRanges(0, 10, []);
      expect(ranges).toEqual([{ start: 0, end: 10 }]);
    });

    test("excludes already scanned registers and returns contiguous ranges", () => {
      const ranges = RegisterScanner.calculatePendingRanges(0, 10, [2, 5, 6, 7]);
      expect(ranges).toEqual([
        { start: 0, end: 2 },
        { start: 3, end: 5 },
        { start: 8, end: 10 },
      ]);
    });

    test("returns empty array when all scanned", () => {
      const ranges = RegisterScanner.calculatePendingRanges(0, 5, [0, 1, 2, 3, 4]);
      expect(ranges).toEqual([]);
    });

    test("handles gap at the beginning", () => {
      const ranges = RegisterScanner.calculatePendingRanges(0, 5, [0, 1]);
      expect(ranges).toEqual([{ start: 2, end: 5 }]);
    });

    test("handles gap at the end", () => {
      const ranges = RegisterScanner.calculatePendingRanges(0, 5, [3, 4]);
      expect(ranges).toEqual([{ start: 0, end: 3 }]);
    });
  });

  describe("basic scanning with step()", () => {
    test("scans readable registers and marks them as readable", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 10 }],
        registerData: [[0, new Uint8Array([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7])]],
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 7 }]);

      // Process all blocks
      while (await scanner.step()) {
        // Continue
      }

      // Verify persisted results
      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      expect(results).toHaveLength(7);
      expect(results.every((r) => r.readable)).toBe(true);
    });

    test("scans unreadable registers and marks them as unreadable", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [], // Nothing is readable
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 7 }]);

      while (await scanner.step()) {
        // Continue
      }

      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      expect(results).toHaveLength(7);
      expect(results.every((r) => !r.readable)).toBe(true);
    });

    test("scans mixed readable and unreadable registers", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 5 }], // Only 0-4 readable
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 10 }]);

      while (await scanner.step()) {
        // Continue
      }

      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      expect(results).toHaveLength(10);

      const readable = results.filter((r) => r.readable);
      const unreadable = results.filter((r) => !r.readable);
      expect(readable).toHaveLength(5); // 0-4
      expect(unreadable).toHaveLength(5); // 5-9
    });
  });

  describe("block subdivision", () => {
    test("subdivides blocks when read fails", async () => {
      // Only registers 0-2 and 4-6 are readable (register 3 is not)
      const device = createMockDevice("test-device", {
        readableRanges: [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ],
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 7 }]);

      // Track steps to verify subdivision
      let steps = 0;
      while (await scanner.step()) {
        steps++;
      }

      // Should have needed multiple steps due to subdivision
      expect(steps).toBeGreaterThan(1);

      // Verify results in database
      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      const readable = results.filter((r) => r.readable);
      const unreadable = results.filter((r) => !r.readable);

      expect(readable).toHaveLength(6);
      expect(unreadable).toHaveLength(1);

      // Register 3 should be marked unreadable
      const reg3 = results.find((r) => r.register === 3);
      expect(reg3?.readable).toBe(false);
    });

    test("step() returns false when complete", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 3 }],
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 3 }]);

      // First step processes the block
      const hasMore = await scanner.step();
      expect(hasMore).toBe(false); // All 3 registers fit in one block
    });
  });

  describe("progress events", () => {
    test("emits progress events during scan", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 14 }],
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 14 }]);

      const progressUpdates: { scanned: number; total: number }[] = [];
      scanner.addEventListener("progress", (e) => {
        const pe = e as ProgressEvent;
        progressUpdates.push({ scanned: pe.scanned, total: pe.total });
      });

      await scanner.run();

      expect(progressUpdates.length).toBeGreaterThan(0);

      // First update should have total set
      expect(progressUpdates[0]!.total).toBe(14);

      // Last update should have all registers scanned
      expect(progressUpdates[progressUpdates.length - 1]!.scanned).toBe(14);
    });
  });

  describe("resume scan", () => {
    test("resume skips already-scanned registers", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 10 }],
      });

      // First scan some registers
      const scanner1 = new RegisterScanner(device, [{ start: 0, end: 5 }]);
      await scanner1.run();

      // Get the registers that still need scanning
      const scanned = await RegisterScanner.getScannedRegisters(device);
      const pendingRanges = await RegisterScanner.calculatePendingRanges(0, 10, scanned);

      // Resume with pending ranges
      const scanner2 = new RegisterScanner(device, pendingRanges);
      await scanner2.run();

      // Verify all 10 registers are now in database
      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      expect(results).toHaveLength(10);
    });

    test("full scan re-scans all registers", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 10 }],
      });

      // First scan some registers
      const scanner1 = new RegisterScanner(device, [{ start: 0, end: 5 }]);
      await scanner1.run();

      // Now do a full scan (not using calculatePendingRanges)
      const scanner2 = new RegisterScanner(device, [{ start: 0, end: 10 }]);
      await scanner2.run();

      // Should have all 10 registers (some will be updated)
      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      expect(results).toHaveLength(10);
    });
  });

  describe("abort via signal", () => {
    test("abort signal stops scan", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 100 }],
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 100 }]);
      const controller = new AbortController();

      // Do a few steps
      await scanner.step(controller.signal);
      await scanner.step(controller.signal);

      // Abort
      controller.abort();

      // step() should return false after abort
      const hasMore = await scanner.step(controller.signal);
      expect(hasMore).toBe(false);

      // Should have some results, but not all 100
      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThan(100);
    });
  });

  describe("result persistence", () => {
    test("persists readable results with values", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 3 }],
        registerData: [[0, new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])]],
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 3 }]);
      await scanner.run();

      const result0 = await db.scanResults.get(["test-device", 0]);
      expect(result0?.readable).toBe(true);
      expect(result0?.value).toEqual(new Uint8Array([0x12, 0x34]));
      expect(result0?.scannedAt).toBeInstanceOf(Date);
    });

    test("persists unreadable results with null value", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [], // Nothing readable
      });

      const scanner = new RegisterScanner(device, [{ start: 50, end: 51 }]);
      await scanner.run();

      const result = await db.scanResults.get(["test-device", 50]);
      expect(result?.readable).toBe(false);
      expect(result?.value).toBeNull();
    });
  });

  describe("run() convenience method", () => {
    test("runs complete scan", async () => {
      const device = createMockDevice("test-device", {
        readableRanges: [{ start: 0, end: 7 }],
      });

      const scanner = new RegisterScanner(device, [{ start: 0, end: 7 }]);
      await scanner.run();

      const results = await db.scanResults.where("deviceId").equals("test-device").toArray();
      expect(results).toHaveLength(7);
    });
  });
});
