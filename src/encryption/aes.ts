import { md5 } from "./md5.ts";

/**
 * Decrypt data using Bluetti's non-standard AES-CBC format.
 *
 * Format: [length:2][iv_seed:4?][encrypted_data:N]
 *
 * @param data - Encrypted message
 * @param aesKey - Subtle crypto AES key
 * @param iv - Optional 16-byte IV. If not provided, IV seed will be extracted from data
 * @returns Decrypted plaintext (without padding)
 */
export async function aesDecrypt(
  data: Uint8Array,
  aesKey: CryptoKey,
  iv?: Uint8Array
): Promise<Uint8Array> {
  // Extract length prefix
  if (data.length < 2) throw new Error("Must be at least 2 bytes");
  const dataLen = (data[0]! << 8) | data[1]!;

  // If no IV is given, derive it from the 4 bytes after the length header
  let actualIv: Uint8Array;
  let encrypted: Uint8Array;
  if (!iv) {
    const ivSeed = data.slice(2, 6);
    actualIv = md5(ivSeed);
    encrypted = data.slice(6);
  } else {
    actualIv = iv;
    encrypted = data.slice(2);
  }

  // Bluetti uses null padding, but web crypto mandates PKCS7 so we've got to
  // add a valid padding block to the end to fool it into decrypting
  const lastBlock = data.slice(-16);
  const pkcs7PaddingBlock = new Uint8Array(16).fill(16);
  const encryptedPadding = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: lastBlock },
    aesKey,
    pkcs7PaddingBlock
  );
  const paddingBlock = new Uint8Array(encryptedPadding).slice(0, 16);
  const extendedData = new Uint8Array(encrypted.length + 16);
  extendedData.set(encrypted);
  extendedData.set(paddingBlock, encrypted.length);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: actualIv as Uint8Array<ArrayBuffer> },
    aesKey,
    extendedData
  );

  // Return only the specified length (strips padding)
  return new Uint8Array(decrypted).slice(0, dataLen);
}

/**
 * Encrypt data using Bluetti's non-standard AES-CBC format.
 *
 * Format: [length:2][iv_seed:4?][encrypted_data:N]
 *
 * @param data - Plaintext data to encrypt
 * @param aesKey - Subtle crypto AES key
 * @param iv - Optional 16-byte IV. If not provided, random IV seed will be generated
 * @returns Encrypted message
 */
export async function aesEncrypt(
  data: Uint8Array,
  aesKey: CryptoKey,
  iv?: Uint8Array
): Promise<Uint8Array> {
  // Calculate whether or not we need to inject an IV seed or not and get IV
  let ivSeed: Uint8Array | null = null;
  let actualIv: Uint8Array;
  if (iv) {
    actualIv = iv;
  } else {
    ivSeed = crypto.getRandomValues(new Uint8Array(4));
    actualIv = md5(ivSeed);
  }

  // Encrypt the data with the IV
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: actualIv as Uint8Array<ArrayBuffer> },
    aesKey,
    data as Uint8Array<ArrayBuffer>
  );

  // Build output message now that we have the sizes for everything
  const headerSize = ivSeed ? 6 : 2;
  const result = new Uint8Array(headerSize + encrypted.byteLength);
  result[0] = (data.length >> 8) & 0xff;
  result[1] = data.length & 0xff;
  if (ivSeed) result.set(ivSeed, 2);
  result.set(new Uint8Array(encrypted), headerSize);

  return result;
}
