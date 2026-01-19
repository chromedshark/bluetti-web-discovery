import { db, type ScanResultRecord } from "../database";

export interface ExportRange {
  /** First register in range (inclusive) */
  start: number;
  /** Last register in range (inclusive) */
  end: number;
}

export interface ExportResult {
  /** Device type */
  type: string;

  /** List of ranges that did not return a read error */
  readableRegisters: ExportRange[];

  /**
   * Data read from the device. The number is the starting register, and the
   * string as a base64 encoded string of all the data read starting at that
   * register.
   */
  data?: [number, string][];
}

/**
 * Check whether any scan results exist for the given device.
 */
export async function hasScanResults(deviceId: string): Promise<boolean> {
  const count = await db.scanResults.where("deviceId").equals(deviceId).count();
  return count > 0;
}

export interface ExportOptions {
  /** Whether to include raw register data (may contain private info) */
  includeData?: boolean;
}

/**
 * Build a JSON Blob containing the export data for a device's scan results.
 */
export async function buildExportBlob(
  deviceId: string,
  deviceType: string,
  options: ExportOptions = {}
): Promise<Blob> {
  const { includeData = true } = options;

  const ranges: ExportRange[] = [];
  const dataChunks: [number, string][] = [];

  let currentRange: ExportRange | null = null;
  let currentChunk: { start: number; bytes: number[] } | null = null;

  const finalizeRange = () => {
    if (currentRange) ranges.push(currentRange);
    currentRange = null;
  };

  const finalizeChunk = () => {
    if (currentChunk && currentChunk.bytes.length > 0) {
      const bytes = new Uint8Array(currentChunk.bytes);
      dataChunks.push([currentChunk.start, bytes.toBase64()]);
    }
    currentChunk = null;
  };

  await db.scanResults
    .where("deviceId")
    .equals(deviceId)
    .each((record: ScanResultRecord) => {
      // Unreadable register breaks the current range and chunk
      if (!record.readable) {
        finalizeRange();
        finalizeChunk();
        return;
      }

      // Assert that all readable registers should have a value
      if (!record.value) throw new Error("All readable registers should have a value");

      // Extend or start a new range
      if (currentRange && record.register === currentRange.end + 1) {
        currentRange.end = record.register;
        if (includeData) currentChunk!.bytes.push(...record.value);
      } else {
        finalizeRange();
        currentRange = { start: record.register, end: record.register };

        if (includeData) {
          finalizeChunk();
          currentChunk = { start: record.register, bytes: [...record.value] };
        }
      }
    });

  // Finalize any remaining range and chunk
  finalizeRange();
  finalizeChunk();

  const result: ExportResult = {
    type: deviceType,
    readableRegisters: ranges,
  };
  if (includeData && dataChunks.length > 0) {
    result.data = dataChunks;
  }

  return new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
}
