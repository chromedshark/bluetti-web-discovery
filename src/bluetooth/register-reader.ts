import { MAX_REGISTERS_PER_REQUEST } from "./constants.ts";

/**
 * A range of register addresses to read.
 */
export interface RegisterRange {
  /** Starting register address */
  start: number;
  /** Number of registers to read */
  count: number;
}

/**
 * Splits register ranges into chunks that fit within the maximum registers per request.
 *
 * MODBUS limits the number of registers that can be read in a single request.
 * This function splits larger ranges into multiple smaller ranges.
 *
 * @param ranges - The ranges to split
 * @param maxPerRequest - Maximum registers per request (default: 7)
 * @returns Array of ranges, each with count <= maxPerRequest
 *
 * @example
 * splitRanges([{ start: 0, count: 20 }])
 * // Returns: [{ start: 0, count: 7 }, { start: 7, count: 7 }, { start: 14, count: 6 }]
 */
export function splitRanges(
  ranges: RegisterRange[],
  maxPerRequest = MAX_REGISTERS_PER_REQUEST
): RegisterRange[] {
  const result: RegisterRange[] = [];

  for (const range of ranges) {
    let { start, count } = range;

    while (count > 0) {
      const chunkSize = Math.min(count, maxPerRequest);
      result.push({ start, count: chunkSize });
      start += chunkSize;
      count -= chunkSize;
    }
  }

  return result;
}

/**
 * Result of reading registers.
 */
export interface RegisterReadResult {
  /** The register address */
  address: number;
  /** The raw 2-byte value (big-endian) */
  value: Uint8Array;
}

/**
 * Parses raw response data into individual register values.
 *
 * @param startAddress - The starting address of the read
 * @param data - The raw register data (2 bytes per register, big-endian)
 * @returns Array of register read results
 */
export function parseRegisterData(startAddress: number, data: Uint8Array): RegisterReadResult[] {
  const results: RegisterReadResult[] = [];

  for (let i = 0; i < data.length; i += 2) {
    results.push({
      address: startAddress + i / 2,
      value: data.slice(i, i + 2),
    });
  }

  return results;
}

/**
 * Converts a register value to a 16-bit unsigned integer.
 *
 * @param value - The raw 2-byte value (big-endian)
 * @returns The unsigned integer value
 */
export function registerToUint16(value: Uint8Array): number {
  return (value[0]! << 8) | value[1]!;
}

/**
 * Converts a 16-bit unsigned integer to a register value.
 *
 * @param value - The unsigned integer value
 * @returns The raw 2-byte value (big-endian)
 */
export function uint16ToRegister(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}
