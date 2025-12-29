import { crc16 } from "./crc.ts";

/** MODBUS slave address used by all Bluetti devices */
const MODBUS_ADDRESS = 0x01;

/**
 * Base class for MODBUS commands.
 *
 * Handles command packet construction with CRC and response validation.
 */
export abstract class DeviceCommand {
  /** The MODBUS function code for this command */
  readonly functionCode: number;

  /** The complete command packet including address, function code, data, and CRC */
  readonly command: Uint8Array;

  /**
   * Creates a new MODBUS command.
   *
   * @param functionCode - The MODBUS function code
   * @param data - The command data (without address, function code, or CRC)
   */
  constructor(functionCode: number, data: Uint8Array) {
    this.functionCode = functionCode;

    // Packet layout: [MODBUS_ADDR][FUNCTION_CODE][...data...][CRC_LOW][CRC_HIGH]
    this.command = new Uint8Array(data.length + 4);
    this.command[0] = MODBUS_ADDRESS;
    this.command[1] = functionCode;
    this.command.set(data, 2);

    // Calculate and append CRC (little-endian)
    const crc = crc16(this.command.subarray(0, -2));
    this.command[this.command.length - 2] = crc & 0xff;
    this.command[this.command.length - 1] = (crc >> 8) & 0xff;
  }

  /**
   * Returns the expected size of a valid response in bytes.
   */
  abstract responseSize(): number;

  /**
   * Parses the response data from a valid response packet.
   *
   * @param response - The complete response packet
   * @returns The extracted data portion of the response
   */
  abstract parseResponse(response: Uint8Array): Uint8Array;

  /**
   * Validates that the response has a correct CRC.
   *
   * @param response - The complete response packet
   * @returns True if the CRC is valid
   */
  isValidResponse(response: Uint8Array): boolean {
    if (response.length < 3) {
      return false;
    }

    // Calculate CRC on all bytes except the last 2
    const calculatedCrc = crc16(response.subarray(0, -2));

    // Extract CRC from response (little-endian)
    const responseCrc = response[response.length - 2]! | (response[response.length - 1]! << 8);

    return calculatedCrc === responseCrc;
  }

  /**
   * Checks if the response is a MODBUS exception response.
   *
   * Exception responses have the high bit set on the function code.
   *
   * @param response - The complete response packet
   * @returns True if this is an exception response
   */
  isExceptionResponse(response: Uint8Array): boolean {
    if (response.length < 2) {
      return false;
    }
    return response[1] === this.functionCode + 0x80;
  }

  /**
   * Extracts the exception code from an exception response.
   *
   * @param response - The exception response packet
   * @returns The MODBUS exception code
   */
  getExceptionCode(response: Uint8Array): number {
    if (response.length < 3) {
      throw new Error("Response too short to contain exception code");
    }
    return response[2]!;
  }
}

/**
 * MODBUS Read Holding Registers command (function code 0x03).
 *
 * Reads one or more 16-bit holding registers from the device.
 */
export class ReadHoldingRegisters extends DeviceCommand {
  /** The starting register address */
  readonly startingAddress: number;

  /** The number of registers to read */
  readonly quantity: number;

  /**
   * Creates a Read Holding Registers command.
   *
   * @param startingAddress - The address of the first register to read
   * @param quantity - The number of registers to read
   */
  constructor(startingAddress: number, quantity: number) {
    // Pack starting address and quantity as big-endian
    const data = new Uint8Array(4);
    const view = new DataView(data.buffer);
    view.setUint16(0, startingAddress, false); // big-endian
    view.setUint16(2, quantity, false); // big-endian

    super(0x03, data);

    this.startingAddress = startingAddress;
    this.quantity = quantity;
  }

  /**
   * Returns the expected response size.
   *
   * Response format: [addr:1][fc:1][byteCount:1][data:qty*2][crc:2]
   */
  responseSize(): number {
    return 2 * this.quantity + 5;
  }

  /**
   * Parses the register data from the response.
   *
   * @param response - The complete response packet
   * @returns The raw register data (2 bytes per register, big-endian)
   */
  parseResponse(response: Uint8Array): Uint8Array {
    // Strip: address (1) + function code (1) + byte count (1) at start
    // Strip: CRC (2) at end
    return response.slice(3, -2);
  }
}
