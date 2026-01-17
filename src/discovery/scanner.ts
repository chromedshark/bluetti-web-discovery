import { MAX_REGISTERS_PER_REQUEST } from "../bluetooth/constants.ts";
import { db, type ScanResultRecord } from "../database/db.ts";

export interface ScannableDevice {
  id: string;
  readRegisters(startAddress: number, count: number): Promise<Uint8Array>;
}

export interface RegisterRange {
  start: number;
  end: number; // End is exclusive
}

export class ProgressEvent extends Event {
  #scanned: number;
  #total: number;

  constructor(scanned: number, total: number) {
    super("progress");
    this.#scanned = scanned;
    this.#total = total;
  }

  get scanned() {
    return this.#scanned;
  }

  get total() {
    return this.#total;
  }
}

/**
 * Divides the given array of scan ranges into ranges that include no more than
 * the given number of registers (so the response fits inside the MTU)
 */
function splitRangesToSize(scanRanges: RegisterRange[], maxRegisterCount: number): RegisterRange[] {
  const result: RegisterRange[] = [];

  for (const range of scanRanges) {
    let start = range.start;
    const end = range.end;

    while (start < end) {
      const count = Math.min(end - start, maxRegisterCount);
      result.push({ start, end: start + count });
      start += count;
    }
  }

  return result;
}

export class RegisterScanner extends EventTarget {
  private readonly device: ScannableDevice;
  private readonly totalRegisters: number;

  private remainingRanges: RegisterRange[];
  private scannedRegisters = 0;

  /**
   * Progress tracking scanner for determining all the readable registers on a
   * device.
   *
   * @param device - A device with id and readRegisters method
   * @param scanRanges - All the register ranges that the scanner should cover
   */
  constructor(device: ScannableDevice, scanRanges: RegisterRange[]) {
    super();
    this.device = device;
    this.totalRegisters = scanRanges.reduce((sum, range) => sum + (range.end - range.start), 0);
    this.remainingRanges = splitRangesToSize(scanRanges, MAX_REGISTERS_PER_REQUEST).toReversed();
  }

  /**
   * Returns the recommended scan range based on protocol version.
   * Protocol < 2000: 0-8000
   * Protocol >= 2000: 0-20000
   */
  static getDefaultRange(protocolVersion: number): RegisterRange {
    const end = protocolVersion < 2000 ? 8000 : 20000;
    return { start: 0, end };
  }

  /**
   * Queries IndexedDB for the previously scanned registers. This should be
   * passed to calculatePendingRanges.
   */
  static async getScannedRegisters(device: ScannableDevice): Promise<number[]> {
    const results = await db.scanResults.where("deviceId").equals(device.id).primaryKeys();
    return results.map(([_, r]) => r);
  }

  /**
   * Calculates which register ranges still need to be scanned in the given
   * range based on what registers have previously been scanned.
   *
   * @param startRegister - Starting register address
   * @param endRegister - Ending register address (exclusive)
   * @param scannedRegisters - The sorted previously scanned registers
   * @returns Array of contiguous ranges that still need to be scanned
   */
  static calculatePendingRanges(
    startRegister: number,
    endRegister: number,
    scannedRegisters: number[]
  ): RegisterRange[] {
    // Find the first scanned register >= startRegister
    let idx = scannedRegisters.findIndex((r) => r >= startRegister);

    // Process scanned registers within our range
    const ranges: RegisterRange[] = [];
    let current = startRegister;
    while (idx !== -1 && idx < scannedRegisters.length && scannedRegisters[idx]! < endRegister) {
      const scanned = scannedRegisters[idx]!;

      // Gap before this scanned register?
      if (scanned > current) {
        ranges.push({ start: current, end: scanned });
      }

      current = scanned + 1;
      idx++;
    }

    // Final gap after last scanned register?
    if (current < endRegister) ranges.push({ start: current, end: endRegister });

    return ranges;
  }

  /**
   * Run the scan to completion. Pass a signal to cancel it early.
   */
  async run(signal?: AbortSignal): Promise<void> {
    this.emitProgress();
    while (await this.step(signal)) {
      // Continue until complete
    }
  }

  /**
   * Run a single step of the scan. Pass a signal to cancel it early.
   * Returns true if there are more ranges to scan, false if complete or aborted.
   */
  async step(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || this.remainingRanges.length === 0) {
      return false;
    }

    const range = this.remainingRanges.pop()!;
    const count = range.end - range.start;

    try {
      // Try to read the entire range
      const data = await this.device.readRegisters(range.start, count);

      // Success - all registers are readable, save each one
      for (let i = 0; i < count; i++) {
        const register = range.start + i;
        const value = data.slice(i * 2, (i + 1) * 2);
        await this.recordResult(register, value);
      }
      this.scannedRegisters += count;
    } catch {
      // Failure - need to subdivide or mark as unreadable
      if (count === 1) {
        // Single register failure - mark as unreadable
        await this.recordResult(range.start, null);
        this.scannedRegisters += 1;
      } else {
        // Split in half and add sub-ranges back
        const mid = range.start + Math.floor(count / 2);
        this.remainingRanges.push({ start: range.start, end: mid }, { start: mid, end: range.end });
      }
    }

    this.emitProgress();

    return this.remainingRanges.length > 0;
  }

  /**
   * Save a scan result to the database. Updates the existing record if it
   * exists.
   *
   * @param register The register to save result for
   * @param value The read value if readable, or null if not readable
   */
  private async recordResult(register: number, value: Uint8Array | null): Promise<void> {
    const update = {
      value,
      scannedAt: new Date(),
      readable: !!value,
    };
    const record: ScanResultRecord = { deviceId: this.device.id, register, ...update };
    await db.transaction("rw", db.scanResults, async () => {
      try {
        // Insert
        await db.scanResults.add(record);
      } catch {
        // Or do a conditional update
        await db.scanResults
          .where("[deviceId+register]")
          .equals([record.deviceId, record.register])
          .modify((obj) => {
            // Don't modify if it just failed, but previously succeeded
            if (!update.readable && obj.readable) return;

            Object.assign(obj, update);
          });
      }
    });
  }

  private emitProgress(): void {
    this.dispatchEvent(new ProgressEvent(this.scannedRegisters, this.totalRegisters));
  }
}
