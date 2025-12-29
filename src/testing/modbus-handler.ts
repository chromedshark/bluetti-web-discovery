import { crc16 } from "../modbus/crc.ts";
import type { RegisterMemory } from "./register-memory.ts";

/** MODBUS function codes */
const FUNCTION_CODES = {
  READ_HOLDING_REGISTERS: 0x03,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_REGISTERS: 0x10,
} as const;

/** MODBUS exception codes */
export const EXCEPTION_CODES = {
  ILLEGAL_FUNCTION: 0x01,
  ILLEGAL_DATA_ADDRESS: 0x02,
  ILLEGAL_DATA_VALUE: 0x03,
} as const;

/**
 * A range of register addresses.
 */
export interface AddressRange {
  start: number;
  end: number; // exclusive
}

/**
 * Creates an AddressRange from start address and count.
 */
export function createRange(start: number, count: number): AddressRange {
  return { start, end: start + count };
}

/**
 * Checks if an address is within a range.
 */
function isInRange(address: number, range: AddressRange): boolean {
  return address >= range.start && address < range.end;
}

/**
 * Checks if an address is within any of the given ranges.
 */
function isInAnyRange(address: number, ranges: AddressRange[]): boolean {
  return ranges.some((range) => isInRange(address, range));
}

/**
 * MODBUS command handler for testing.
 *
 * Processes incoming MODBUS commands and generates responses.
 * Validates CRC, address ranges, and data.
 */
export class MODBUSHandler {
  private readonly memory: RegisterMemory;
  private readonly readableRanges: AddressRange[];
  private readonly writableRanges: AddressRange[];

  /**
   * Creates a new MODBUS handler.
   *
   * @param memory - The register memory to read/write
   * @param readableRanges - Ranges of addresses that can be read
   * @param writableRanges - Ranges of addresses that can be written
   */
  constructor(
    memory: RegisterMemory,
    readableRanges: AddressRange[],
    writableRanges: AddressRange[]
  ) {
    this.memory = memory;
    this.readableRanges = readableRanges;
    this.writableRanges = writableRanges;
  }

  /**
   * Handles an incoming MODBUS command and returns the response.
   *
   * @param cmdBytes - The raw command bytes including CRC
   * @returns The response bytes including CRC
   * @throws Error if the command is too short or has invalid CRC
   */
  handleCommand(cmdBytes: Uint8Array): Uint8Array {
    if (cmdBytes.length < 4) {
      throw new Error(`Command too short: ${cmdBytes.length} bytes`);
    }

    // Validate CRC
    if (!this.validateCrc(cmdBytes)) throw new Error("Invalid CRC");

    const deviceAddr = cmdBytes[0]!;
    const functionCode = cmdBytes[1]!;

    switch (functionCode) {
      case FUNCTION_CODES.READ_HOLDING_REGISTERS:
        return this.handleReadHoldingRegisters(deviceAddr, cmdBytes);

      case FUNCTION_CODES.WRITE_SINGLE_REGISTER:
        return this.handleWriteSingleRegister(deviceAddr, cmdBytes);

      case FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS:
        return this.handleWriteMultipleRegisters(deviceAddr, cmdBytes);

      default:
        return this.generateExceptionResponse(
          deviceAddr,
          functionCode,
          EXCEPTION_CODES.ILLEGAL_FUNCTION
        );
    }
  }

  /**
   * Validates the CRC of a message.
   */
  private validateCrc(data: Uint8Array): boolean {
    const calculatedCrc = crc16(data.subarray(0, -2));
    const expectedCrc = data.at(-2)! | (data.at(-1)! << 8);
    return calculatedCrc === expectedCrc;
  }

  /**
   * Adds CRC to a response.
   */
  private addCrc(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(data.length + 2);
    result.set(data);
    const crc = crc16(data);
    result[data.length] = crc & 0xff;
    result[data.length + 1] = (crc >> 8) & 0xff;
    return result;
  }

  /**
   * Generates a MODBUS exception response.
   */
  private generateExceptionResponse(
    deviceAddr: number,
    functionCode: number,
    exceptionCode: number
  ): Uint8Array {
    const response = new Uint8Array([deviceAddr, functionCode + 0x80, exceptionCode]);
    return this.addCrc(response);
  }

  /**
   * Handles Read Holding Registers (function code 0x03).
   */
  private handleReadHoldingRegisters(deviceAddr: number, cmdBytes: Uint8Array): Uint8Array {
    // Command: [addr][fc][startAddr:2][quantity:2][crc:2] = 8 bytes
    if (cmdBytes.length !== 8) {
      throw new Error(`Invalid Read Holding Registers command length: ${cmdBytes.length}`);
    }

    const view = new DataView(cmdBytes.buffer, cmdBytes.byteOffset);
    const startingAddr = view.getUint16(2, false); // big-endian
    const quantity = view.getUint16(4, false); // big-endian

    // Validate all addresses are readable
    for (let i = 0; i < quantity; i++) {
      if (!isInAnyRange(startingAddr + i, this.readableRanges)) {
        return this.generateExceptionResponse(
          deviceAddr,
          FUNCTION_CODES.READ_HOLDING_REGISTERS,
          EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS
        );
      }
    }

    // Read the registers
    const registerData = this.memory.readRegisters(startingAddr, quantity);
    const byteCount = quantity * 2;

    // Response: [addr][fc][byteCount][data...][crc]
    const response = new Uint8Array(3 + byteCount);
    response[0] = deviceAddr;
    response[1] = FUNCTION_CODES.READ_HOLDING_REGISTERS;
    response[2] = byteCount;
    response.set(registerData, 3);

    return this.addCrc(response);
  }

  /**
   * Handles Write Single Register (function code 0x06).
   */
  private handleWriteSingleRegister(deviceAddr: number, cmdBytes: Uint8Array): Uint8Array {
    // Command: [addr][fc][regAddr:2][value:2][crc:2] = 8 bytes
    if (cmdBytes.length !== 8) {
      throw new Error(`Invalid Write Single Register command length: ${cmdBytes.length}`);
    }

    const view = new DataView(cmdBytes.buffer, cmdBytes.byteOffset);
    const regAddr = view.getUint16(2, false); // big-endian

    // Validate address is writable
    if (!isInAnyRange(regAddr, this.writableRanges)) {
      return this.generateExceptionResponse(
        deviceAddr,
        FUNCTION_CODES.WRITE_SINGLE_REGISTER,
        EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS
      );
    }

    // Write the register
    this.memory.writeRegister(regAddr, cmdBytes.subarray(4, 6));

    // Response: echo back the command (without the original CRC, add new CRC)
    const response = new Uint8Array(6);
    response.set(cmdBytes.subarray(0, 6));
    return this.addCrc(response);
  }

  /**
   * Handles Write Multiple Registers (function code 0x10).
   */
  private handleWriteMultipleRegisters(deviceAddr: number, cmdBytes: Uint8Array): Uint8Array {
    // Command: [addr][fc][startAddr:2][quantity:2][byteCount][data...][crc:2]
    // Minimum: 1 + 1 + 2 + 2 + 1 + 2 + 2 = 11 bytes (for 1 register)
    if (cmdBytes.length < 11) {
      throw new Error(`Invalid Write Multiple Registers command length: ${cmdBytes.length}`);
    }

    const view = new DataView(cmdBytes.buffer, cmdBytes.byteOffset);
    const startingAddr = view.getUint16(2, false); // big-endian
    const quantity = view.getUint16(4, false); // big-endian
    const byteCount = cmdBytes[6]!;

    // Validate byte count matches quantity
    if (byteCount !== quantity * 2) {
      return this.generateExceptionResponse(
        deviceAddr,
        FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS,
        EXCEPTION_CODES.ILLEGAL_DATA_VALUE
      );
    }

    // Validate command length
    if (cmdBytes.length !== 7 + byteCount + 2) {
      throw new Error(`Invalid Write Multiple Registers command length: ${cmdBytes.length}`);
    }

    // Validate all addresses are writable
    for (let i = 0; i < quantity; i++) {
      if (!isInAnyRange(startingAddr + i, this.writableRanges)) {
        return this.generateExceptionResponse(
          deviceAddr,
          FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS,
          EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS
        );
      }
    }

    // Write the registers
    const data = cmdBytes.subarray(7, 7 + byteCount);
    this.memory.writeRegisters(startingAddr, data);

    // Response: [addr][fc][startAddr:2][quantity:2][crc]
    const response = new Uint8Array(6);
    response[0] = deviceAddr;
    response[1] = FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS;
    view.setUint16(0, startingAddr, false);
    response[2] = (startingAddr >> 8) & 0xff;
    response[3] = startingAddr & 0xff;
    response[4] = (quantity >> 8) & 0xff;
    response[5] = quantity & 0xff;

    return this.addCrc(response);
  }
}
