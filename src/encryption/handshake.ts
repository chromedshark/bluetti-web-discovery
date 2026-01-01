/**
 * Handshake protocol for encrypted Bluetti device communication.
 *
 * Implements the encryption handshake with:
 * 1. Challenge/response for initial key derivation
 * 2. ECDH key exchange for session key generation
 * 3. Signed public keys for authentication
 */

import type { KeyBundle } from "./key-bundle.ts";
import { aesEncrypt, aesDecrypt } from "./aes.ts";
import { md5 } from "./md5.ts";

/** Magic prefix for handshake messages */
export const HANDSHAKE_PREFIX = Uint8Array.from([0x2a, 0x2a]); // '**'

/** Handshake states in order of protocol flow */
export enum HandshakeState {
  CHALLENGE = 1,
  CHALLENGE_RESPONSE = 2,
  CHALLENGE_ACCEPTED = 3,
  SERVER_PUBLIC_KEY = 4,
  CLIENT_PUBLIC_KEY = 5,
  ECDH_ACCEPTED = 6,
}

/**
 * A handshake message with state, body, and checksum.
 *
 * Format: [prefix:2][state:1][length:1][body:N][checksum:2]
 */
export class HandshakeMessage {
  constructor(
    public readonly state: HandshakeState,
    public readonly body: Uint8Array
  ) {}

  toBytes(): Uint8Array {
    const msg = new Uint8Array(this.body.length + 6);

    // Prefix
    msg.set(HANDSHAKE_PREFIX, 0);

    // State and length
    msg[2] = this.state;
    msg[3] = this.body.length;

    // Body
    msg.set(this.body, 4);

    // Checksum: sum of state + length + body bytes (big-endian)
    let sum = 0;
    for (let i = 2; i < msg.length - 2; i++) {
      sum += msg[i]!;
    }
    msg[msg.length - 2] = (sum >> 8) & 0xff;
    msg[msg.length - 1] = sum & 0xff;

    return msg;
  }

  /** Parse a handshake message from bytes */
  static parse(data: Uint8Array): HandshakeMessage {
    if (data.length < 6) {
      throw new Error(`Message too short: ${data.length} bytes`);
    }

    // Check prefix
    if (data[0] !== HANDSHAKE_PREFIX[0] || data[1] !== HANDSHAKE_PREFIX[1]) {
      throw new Error(`Prefix is not correct: ${data.slice(0, 2).toHex()}`);
    }

    // Check checksum
    let sum = 0;
    for (let i = 2; i < data.length - 2; i++) {
      sum += data[i]!;
    }
    const expectedChecksum = (data[data.length - 2]! << 8) | data[data.length - 1]!;
    if (sum !== expectedChecksum) {
      throw new Error(
        `Checksum is not correct: expected ${sum.toString(16)} but got ${expectedChecksum.toString(16)}`
      );
    }

    // Check body length
    const state = data[2]! as HandshakeState;
    const length = data[3]!;
    const bodyLength = data.length - 6;
    if (length !== bodyLength) {
      throw new Error(`Body length should be ${length} but is ${bodyLength}`);
    }

    const body = data.slice(4, -2);
    return new HandshakeMessage(state, body);
  }

  /** Check if data starts with handshake prefix */
  static isHandshakeMessage(data: Uint8Array): boolean {
    return data.length >= 2 && data[0] === HANDSHAKE_PREFIX[0] && data[1] === HANDSHAKE_PREFIX[1];
  }
}

/**
 * Handshake protocol state machine.
 *
 * Handles the complete encryption handshake flow for both client and server roles.
 * The role is determined by how handle() is called:
 * - Server role: call handle(null) to generate challenge/public key
 * - Client role: call handle(data) with received message
 */
export class HandshakeProtocol {
  private _keyBundle: KeyBundle;
  private _sessionKeyPromise: { resolve: (key: CryptoKey) => void; promise: Promise<CryptoKey> };
  private _aesKey: CryptoKey | null = null;
  private _aesIv: Uint8Array | null = null;
  private _ephemeralKeyPair: CryptoKeyPair | null = null;
  private _peerPublicKey: CryptoKey | null = null;
  private _sessionAesKey: CryptoKey | null = null;

  constructor(keyBundle: KeyBundle) {
    this._keyBundle = keyBundle;
    let resolve: ((key: CryptoKey) => void) | null = null;
    const promise = new Promise<CryptoKey>((r, _) => {
      resolve = r;
    });
    this._sessionKeyPromise = { resolve: resolve!, promise };
  }

  /** The AES key to use after the handshake has been completed */
  get sessionAesKey(): CryptoKey | null {
    return this._sessionAesKey;
  }

  /** The AES key and IV for challenge-round encryption (useful for testing) */
  get challengeRoundKeys(): { aesKey: CryptoKey; iv: Uint8Array } | null {
    if (this._aesKey && this._aesIv) {
      return { aesKey: this._aesKey, iv: this._aesIv };
    }
    return null;
  }

  /** Whether the handshake is complete */
  get isComplete(): boolean {
    return this._sessionAesKey !== null;
  }

  /**
   * Session AES Key promise for awaiting
   */
  sessionKeyPromise(): Promise<CryptoKey> {
    return this._sessionKeyPromise.promise;
  }

  /**
   * Decodes client or server messages and generates the correct response.
   *
   * @param data - The raw bytes received, or null for server-initiated messages
   * @returns Response bytes to send, or null if no response needed
   */
  async handle(data: Uint8Array | null): Promise<Uint8Array | null> {
    let response: HandshakeMessage;

    if (data === null) {
      // Handle server-initiated rounds - challenge then key exchange
      if (this._aesKey === null) {
        response = await this._generateChallenge();
      } else {
        response = await this._generateServerPublicKey();
      }
    } else {
      // Parse message
      let message: HandshakeMessage;
      if (this._ephemeralKeyPair && this._aesKey && this._aesIv) {
        const decrypted = await aesDecrypt(data, this._aesKey, this._aesIv);
        message = HandshakeMessage.parse(decrypted);
      } else {
        message = HandshakeMessage.parse(data);
      }

      // Handle message responses
      switch (message.state) {
        case HandshakeState.CHALLENGE:
          response = await this._handleChallenge(message);
          break;
        case HandshakeState.CHALLENGE_RESPONSE:
          response = this._handleChallengeResponse(message);
          break;
        case HandshakeState.CHALLENGE_ACCEPTED:
          await this._handleChallengeAccepted(message);
          return null;
        case HandshakeState.SERVER_PUBLIC_KEY:
          response = await this._handleServerPublicKey(message);
          break;
        case HandshakeState.CLIENT_PUBLIC_KEY:
          response = await this._handleClientPublicKey(message);
          break;
        case HandshakeState.ECDH_ACCEPTED:
          await this._handleEcdhAccepted(message);
          return null;
      }
    }

    if (this._ephemeralKeyPair && this._aesKey && this._aesIv) {
      return aesEncrypt(response.toBytes(), this._aesKey, this._aesIv);
    } else {
      return response.toBytes();
    }
  }

  private async _generateChallenge(): Promise<HandshakeMessage> {
    const challenge = crypto.getRandomValues(new Uint8Array(4));
    await this._setAesKey(challenge);
    return new HandshakeMessage(HandshakeState.CHALLENGE, challenge);
  }

  private async _handleChallenge(message: HandshakeMessage): Promise<HandshakeMessage> {
    await this._setAesKey(message.body);
    return new HandshakeMessage(HandshakeState.CHALLENGE_RESPONSE, this._aesIv!.slice(8, 12));
  }

  private _handleChallengeResponse(message: HandshakeMessage): HandshakeMessage {
    const expected = this._aesIv!.slice(8, 12);
    const isValid =
      message.body.length === 4 &&
      message.body[0] === expected[0] &&
      message.body[1] === expected[1] &&
      message.body[2] === expected[2] &&
      message.body[3] === expected[3];

    return new HandshakeMessage(
      HandshakeState.CHALLENGE_ACCEPTED,
      new Uint8Array([isValid ? 0x00 : 0x01])
    );
  }

  private async _handleChallengeAccepted(message: HandshakeMessage): Promise<void> {
    if (message.body[0] !== 0x00) {
      throw new Error(`Challenge response was not 0: ${message.body.toHex()}`);
    }

    // Generate ephemeral keys so that future messages are assumed to be encrypted
    await this._setEphemeralKeys();
  }

  private async _generateServerPublicKey(): Promise<HandshakeMessage> {
    await this._setEphemeralKeys();
    const keyAndSignature = await this._signPublicKey();
    return new HandshakeMessage(HandshakeState.SERVER_PUBLIC_KEY, keyAndSignature);
  }

  private async _handleServerPublicKey(message: HandshakeMessage): Promise<HandshakeMessage> {
    // Verify and load the server public key
    this._peerPublicKey = await this._verifyPublicKey(message.body);

    // Build response with our signed public key
    const keyAndSignature = await this._signPublicKey();
    return new HandshakeMessage(HandshakeState.CLIENT_PUBLIC_KEY, keyAndSignature);
  }

  private async _handleClientPublicKey(message: HandshakeMessage): Promise<HandshakeMessage> {
    // Verify and load the client public key
    this._peerPublicKey = await this._verifyPublicKey(message.body);

    // Derive session key via ECDH
    await this._setSessionKey();

    return new HandshakeMessage(HandshakeState.ECDH_ACCEPTED, new Uint8Array([0x00]));
  }

  private async _handleEcdhAccepted(message: HandshakeMessage): Promise<void> {
    if (message.body[0] !== 0x00) {
      throw new Error(`ECDH accepted response was not 0: ${message.body.toHex()}`);
    }

    await this._setSessionKey();
  }

  private async _signPublicKey(): Promise<Uint8Array> {
    // Convert the ephemeral public key to a 64 byte string, removing the
    // first byte that says that it's an uncompressed point
    const rawPublicKey = await crypto.subtle.exportKey("raw", this._ephemeralKeyPair!.publicKey);
    const publicKeyBytes = new Uint8Array(rawPublicKey).slice(1);

    // Sign the public key with our signing key
    const signingData = new Uint8Array(80);
    signingData.set(publicKeyBytes, 0);
    signingData.set(this._aesIv!, 64);
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this._keyBundle.signingKey,
      signingData
    );

    // Return public key + signature (128 bytes total)
    const result = new Uint8Array(128);
    result.set(publicKeyBytes, 0);
    result.set(new Uint8Array(signature), 64);
    return result;
  }

  private async _verifyPublicKey(keyAndSignature: Uint8Array): Promise<CryptoKey> {
    // Split the message into the public key and the signature
    if (keyAndSignature.length !== 128) {
      throw new Error(`Signed key length should be 128 but is ${keyAndSignature.length}`);
    }
    const publicKeyBytes = keyAndSignature.slice(0, 64);
    const signature = keyAndSignature.slice(64);

    // Check the signature
    const signingData = new Uint8Array(80);
    signingData.set(publicKeyBytes, 0);
    signingData.set(this._aesIv!, 64);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      this._keyBundle.verifyKey,
      signature,
      signingData
    );
    if (!valid) throw new Error("Invalid signature on peer public key");

    // Import public key
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.set(publicKeyBytes, 1);
    return crypto.subtle.importKey(
      "raw",
      uncompressed,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    );
  }

  private async _setAesKey(challenge: Uint8Array): Promise<void> {
    if (challenge.length !== 4) {
      throw new Error(`Expected challenge to be 4 bytes but was ${challenge.length}`);
    }

    // Calculate MD5 of reverse order challenge for IV
    this._aesIv = md5(challenge.toReversed());

    // XOR the IV with the shared secret to derive the key
    const aesKeyBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      aesKeyBytes[i] = this._aesIv[i]! ^ this._keyBundle.sharedSecret[i]!;
    }

    this._aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, { name: "AES-CBC" }, false, [
      "decrypt",
      "encrypt",
    ]);
  }

  private async _setEphemeralKeys(): Promise<void> {
    this._ephemeralKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"]
    );
  }

  private async _setSessionKey(): Promise<void> {
    this._sessionAesKey = await crypto.subtle.deriveKey(
      { name: "ECDH", public: this._peerPublicKey! },
      this._ephemeralKeyPair!.privateKey,
      { name: "AES-CBC", length: 256 },
      false,
      ["decrypt", "encrypt"]
    );
    this._sessionKeyPromise.resolve(this._sessionAesKey);
  }
}
