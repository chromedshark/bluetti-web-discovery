/**
 * Key management for encrypted Bluetti device communication.
 *
 * Handles loading and validation of cryptographic keys used for the
 * encryption handshake protocol.
 */

/**
 * Bundle of cryptographic keys needed for encrypted communication.
 *
 * Contains:
 * - signingKey: EC private key for signing our own public key during handshake
 * - verifyKey: EC public key for verifying peer's signature
 * - sharedSecret: 16-byte static shared secret (same for client and server)
 */
export interface KeyBundle {
  signingKey: CryptoKey;
  verifyKey: CryptoKey;
  sharedSecret: Uint8Array;
}

/**
 * Create a KeyBundle from hex-encoded strings.
 *
 * This is the format used for configuration (env vars, config files).
 *
 * @param signingKey - EC private key as 64 hex characters (32 bytes)
 * @param verifyKey - EC public key in DER format as hex string
 * @param sharedSecret - 16-byte secret as 32 hex characters
 * @returns KeyBundle with parsed cryptographic objects
 * @throws Error if hex format or key lengths are invalid
 */
export async function createKeyBundle(
  signingKey: string,
  verifyKey: string,
  sharedSecret: string
): Promise<KeyBundle> {
  // Validate lengths
  if (signingKey.length !== 64) {
    throw new Error("signing_key must be 64 hex characters");
  }
  if (sharedSecret.length !== 32) {
    throw new Error("shared_secret must be 32 hex characters");
  }

  // Parse hex strings
  const signingKeyBytes = Uint8Array.fromHex(signingKey);
  const verifyKeyBytes = Uint8Array.fromHex(verifyKey);
  const sharedSecretBytes = Uint8Array.fromHex(sharedSecret);

  if (sharedSecretBytes.length !== 16) {
    throw new Error("shared_secret must be exactly 16 bytes");
  }

  // Import EC private key (SECP256R1/P-256)
  // WebCrypto needs the key in PKCS#8 format, but we have raw 32-byte scalar.
  // We need to wrap it in the proper ASN.1 structure.
  const cryptoSigningKey = await importEcPrivateKey(signingKeyBytes);

  // Import EC public key (already in DER/SPKI format)
  const cryptoVerifyKey = await crypto.subtle.importKey(
    "spki",
    verifyKeyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  );

  return {
    signingKey: cryptoSigningKey,
    verifyKey: cryptoVerifyKey,
    sharedSecret: sharedSecretBytes,
  };
}

/**
 * Load key bundle from environment variables.
 *
 * Expects:
 * - BLUETTI_SIGNING_KEY: 64 hex characters
 * - BLUETTI_VERIFY_KEY: DER-encoded public key as hex
 * - BLUETTI_SHARED_SECRET: 32 hex characters
 *
 * @returns KeyBundle or null if keys not configured
 */
export async function loadKeyBundleFromEnv(): Promise<KeyBundle | null> {
  const signingKey = process.env["BLUETTI_SIGNING_KEY"];
  const verifyKey = process.env["BLUETTI_VERIFY_KEY"];
  const sharedSecret = process.env["BLUETTI_SHARED_SECRET"];

  if (!signingKey || !verifyKey || !sharedSecret) {
    return null;
  }

  return createKeyBundle(signingKey, verifyKey, sharedSecret);
}

/**
 * Import a raw 32-byte EC private key scalar into WebCrypto.
 *
 * WebCrypto doesn't support raw key import directly, so we need to
 * wrap the scalar in a PKCS#8 structure.
 */
async function importEcPrivateKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.length !== 32) {
    throw new Error("EC private key must be 32 bytes");
  }

  // PKCS#8 structure for P-256 private key:
  // SEQUENCE {
  //   INTEGER 0 (version)
  //   SEQUENCE { OID ecPublicKey, OID secp256r1 }
  //   OCTET STRING { OCTET STRING { raw key bytes } }
  // }
  const pkcs8Header = new Uint8Array([
    0x30,
    0x41, // SEQUENCE, 65 bytes
    0x02,
    0x01,
    0x00, // INTEGER 0
    0x30,
    0x13, // SEQUENCE, 19 bytes
    0x06,
    0x07,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x02,
    0x01, // OID 1.2.840.10045.2.1 (ecPublicKey)
    0x06,
    0x08,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x03,
    0x01,
    0x07, // OID 1.2.840.10045.3.1.7 (secp256r1)
    0x04,
    0x27, // OCTET STRING, 39 bytes
    0x30,
    0x25, // SEQUENCE, 37 bytes
    0x02,
    0x01,
    0x01, // INTEGER 1 (version)
    0x04,
    0x20, // OCTET STRING, 32 bytes (the private key)
  ]);

  // Combine header with raw key
  const pkcs8Key = new Uint8Array(pkcs8Header.length + rawKey.length);
  pkcs8Key.set(pkcs8Header);
  pkcs8Key.set(rawKey, pkcs8Header.length);

  return crypto.subtle.importKey("pkcs8", pkcs8Key, { name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ]);
}
