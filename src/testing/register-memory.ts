/**
 * Sparse register storage for simulating MODBUS device memory.
 *
 * Stores 16-bit registers (2 bytes each) in a sparse map.
 * Uninitialized registers return zeros.
 */
export class RegisterMemory {
  /** Sparse storage: register address -> 2-byte value */
  private registers = new Map<number, Uint8Array>();

  /**
   * Writes a single 2-byte value to a register.
   *
   * @param address - The register address
   * @param value - The 2-byte value to write
   * @throws Error if value is not exactly 2 bytes
   */
  writeRegister(address: number, value: Uint8Array): void {
    if (value.length !== 2) {
      throw new Error(`Register value must be 2 bytes, got ${value.length}`);
    }
    // Store a copy to prevent external modification
    this.registers.set(address, new Uint8Array(value));
  }

  /**
   * Writes multiple contiguous registers from a byte array.
   *
   * @param startAddress - The address of the first register
   * @param data - The data to write (must be even length)
   * @throws Error if data length is not even
   */
  writeRegisters(startAddress: number, data: Uint8Array): void {
    if (data.length % 2 !== 0) {
      throw new Error(`Data length must be even, got ${data.length}`);
    }

    for (let i = 0; i < data.length; i += 2) {
      const address = startAddress + i / 2;
      this.writeRegister(address, data.subarray(i, i + 2));
    }
  }

  /**
   * Reads multiple contiguous registers.
   *
   * @param start - The address of the first register
   * @param count - The number of registers to read
   * @returns Concatenated register data (count * 2 bytes)
   */
  readRegisters(start: number, count: number): Uint8Array {
    const result = new Uint8Array(count * 2);

    for (let i = 0; i < count; i++) {
      const value = this.registers.get(start + i);
      if (!value) continue; // Default in result is already 0s, so just skip

      result.set(value, i * 2);
    }

    return result;
  }

  /**
   * Clears all stored registers.
   */
  clear(): void {
    this.registers.clear();
  }

  /**
   * Returns the number of registers currently stored.
   */
  get size(): number {
    return this.registers.size;
  }
}
