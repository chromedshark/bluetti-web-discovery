import { describe, test, expect, beforeEach } from "bun:test";
import { db, type ScanResultRecord } from "../../src/database";
import { buildExportBlob, hasScanResults, type ExportResult } from "../../src/discovery/export.ts";

const TEST_DEVICE_ID = "test-device";
const TEST_DEVICE_TYPE = "AC300";

async function seedScanResults(records: Partial<ScanResultRecord>[]): Promise<void> {
  await db.scanResults.bulkAdd(
    records.map((r) => ({
      deviceId: TEST_DEVICE_ID,
      register: 0,
      readable: true,
      scannedAt: new Date(),
      value: new Uint8Array([0, 0]),
      ...r,
    }))
  );
}

async function parseExportBlob(blob: Blob): Promise<ExportResult> {
  const text = await blob.text();
  return JSON.parse(text);
}

describe("hasScanResults", () => {
  beforeEach(async () => {
    await db.scanResults.clear();
  });

  test("returns false for device with no results", async () => {
    const result = await hasScanResults(TEST_DEVICE_ID);
    expect(result).toBe(false);
  });

  test("returns true for device with results", async () => {
    await seedScanResults([{ register: 0 }]);
    const result = await hasScanResults(TEST_DEVICE_ID);
    expect(result).toBe(true);
  });

  test("returns false for different device ID", async () => {
    await seedScanResults([{ register: 0 }]);
    const result = await hasScanResults("other-device");
    expect(result).toBe(false);
  });
});

describe("buildExportBlob", () => {
  beforeEach(async () => {
    await db.scanResults.clear();
  });

  describe("readableRegisters ranges", () => {
    test("empty scan results returns empty ranges", async () => {
      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.type).toBe(TEST_DEVICE_TYPE);
      expect(result.readableRegisters).toEqual([]);
    });

    test("single readable register creates range with same start and end", async () => {
      await seedScanResults([{ register: 5, readable: true }]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.readableRegisters).toEqual([{ start: 5, end: 5 }]);
    });

    test("consecutive readable registers merge into single range", async () => {
      await seedScanResults([
        { register: 0, readable: true },
        { register: 1, readable: true },
        { register: 2, readable: true },
      ]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.readableRegisters).toEqual([{ start: 0, end: 2 }]);
    });

    test("gaps in readable registers create separate ranges", async () => {
      await seedScanResults([
        { register: 0, readable: true },
        { register: 1, readable: true },
        { register: 2, readable: false, value: null },
        { register: 3, readable: true },
        { register: 4, readable: true },
      ]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.readableRegisters).toEqual([
        { start: 0, end: 1 },
        { start: 3, end: 4 },
      ]);
    });

    test("unreadable registers do not create ranges", async () => {
      await seedScanResults([
        { register: 0, readable: false, value: null },
        { register: 1, readable: false, value: null },
      ]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.readableRegisters).toEqual([]);
    });
  });

  describe("data encoding", () => {
    test("data encoding produces valid base64", async () => {
      await seedScanResults([{ register: 0, readable: true, value: new Uint8Array([0x12, 0x34]) }]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(1);

      const chunk = result.data?.[0];
      expect(chunk?.[0]).toBe(0);

      // Decode and verify
      const decoded = Uint8Array.fromBase64(chunk![1]);
      expect(decoded).toEqual(new Uint8Array([0x12, 0x34]));
    });

    test("consecutive register values are merged into single base64 chunk", async () => {
      await seedScanResults([
        { register: 0, readable: true, value: new Uint8Array([0x12, 0x34]) },
        { register: 1, readable: true, value: new Uint8Array([0x56, 0x78]) },
        { register: 2, readable: true, value: new Uint8Array([0x9a, 0xbc]) },
      ]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.data).toHaveLength(1);

      const chunk = result.data?.[0];
      expect(chunk?.[0]).toBe(0);

      const decoded = Uint8Array.fromBase64(chunk![1]);
      expect(decoded).toEqual(new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]));
    });

    test("gaps in registers create separate data chunks", async () => {
      await seedScanResults([
        { register: 0, readable: true, value: new Uint8Array([0x12, 0x34]) },
        { register: 1, readable: false, value: null },
        { register: 2, readable: true, value: new Uint8Array([0x56, 0x78]) },
      ]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.data).toHaveLength(2);
      expect(result.data?.[0]?.[0]).toBe(0);
      expect(result.data?.[1]?.[0]).toBe(2);
    });

    test("includeData: false omits the data property", async () => {
      await seedScanResults([{ register: 0, readable: true, value: new Uint8Array([0x12, 0x34]) }]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE, { includeData: false });
      const result = await parseExportBlob(blob);

      expect(result.data).toBeUndefined();
    });

    test("data is omitted when all results are unreadable", async () => {
      await seedScanResults([
        { register: 0, readable: false, value: null },
        { register: 1, readable: false, value: null },
      ]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const result = await parseExportBlob(blob);

      expect(result.data).toBeUndefined();
    });
  });

  describe("blob properties", () => {
    test("blob has correct MIME type", async () => {
      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      expect(blob.type).toStartWith("application/json");
    });

    test("blob contains valid JSON", async () => {
      await seedScanResults([{ register: 0, readable: true }]);

      const blob = await buildExportBlob(TEST_DEVICE_ID, TEST_DEVICE_TYPE);
      const text = await blob.text();

      expect(() => JSON.parse(text)).not.toThrow();
    });
  });
});
