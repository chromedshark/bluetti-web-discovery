import { describe, test, expect } from "bun:test";
import {
  HandshakeMessage,
  HandshakeState,
  HandshakeProtocol,
  HANDSHAKE_PREFIX,
} from "../../src/encryption/handshake.ts";
import type { KeyBundle } from "../../src/encryption/key-bundle.ts";
import { aesEncrypt } from "../../src/encryption/aes.ts";

const SHARED_SECRET = Uint8Array.fromHex("297962f3a6104e002c1f222a28d0a601");

async function createTestKeyBundles(): Promise<{ client: KeyBundle; server: KeyBundle }> {
  const clientKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const serverKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  return {
    client: {
      signingKey: clientKey.privateKey,
      verifyKey: serverKey.publicKey,
      sharedSecret: SHARED_SECRET,
    },
    server: {
      signingKey: serverKey.privateKey,
      verifyKey: clientKey.publicKey,
      sharedSecret: SHARED_SECRET,
    },
  };
}

describe("HandshakeMessage", () => {
  test("serializes and parses roundtrip", () => {
    const body = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const message = new HandshakeMessage(HandshakeState.CHALLENGE, body);
    const bytes = message.toBytes();
    const parsed = HandshakeMessage.parse(bytes);

    expect(parsed.state).toBe(HandshakeState.CHALLENGE);
    expect(parsed.body).toEqual(body);
  });

  test("prefix is correct", () => {
    const message = new HandshakeMessage(HandshakeState.CHALLENGE, new Uint8Array([0x01]));
    const bytes = message.toBytes();

    expect(bytes[0]).toBe(HANDSHAKE_PREFIX[0]);
    expect(bytes[1]).toBe(HANDSHAKE_PREFIX[1]);
  });

  test("throws on invalid prefix", () => {
    const message = new HandshakeMessage(
      HandshakeState.CHALLENGE_ACCEPTED,
      new Uint8Array([1, 2, 3, 4])
    );
    const bytes = message.toBytes();
    bytes[0] = 0x58; // 'X'
    bytes[1] = 0x58; // 'X'

    expect(() => HandshakeMessage.parse(bytes)).toThrow("Prefix is not correct");
  });

  test("throws on invalid checksum", () => {
    const message = new HandshakeMessage(
      HandshakeState.ECDH_ACCEPTED,
      new Uint8Array([1, 2, 3, 4])
    );
    const bytes = message.toBytes();
    bytes[bytes.length - 1] = 0x00; // Corrupt checksum

    expect(() => HandshakeMessage.parse(bytes)).toThrow("Checksum is not correct");
  });

  test("throws on invalid body length", () => {
    const message = new HandshakeMessage(
      HandshakeState.SERVER_PUBLIC_KEY,
      new Uint8Array([1, 2, 3, 4])
    );
    const bytes = message.toBytes();
    bytes[3] = 5; // Claim body is 5 bytes when it's actually 4
    // Update checksum
    let sum = 0;
    for (let i = 2; i < bytes.length - 2; i++) {
      sum += bytes[i]!;
    }
    bytes[bytes.length - 2] = (sum >> 8) & 0xff;
    bytes[bytes.length - 1] = sum & 0xff;

    expect(() => HandshakeMessage.parse(bytes)).toThrow("Body length should be 5 but is 4");
  });

  test("isHandshakeMessage detects prefix", () => {
    expect(HandshakeMessage.isHandshakeMessage(new Uint8Array([0x2a, 0x2a, 0x01]))).toBe(true);
    expect(HandshakeMessage.isHandshakeMessage(new Uint8Array([0x2a, 0x2b, 0x01]))).toBe(false);
    expect(HandshakeMessage.isHandshakeMessage(new Uint8Array([0x2a]))).toBe(false);
  });
});

describe("HandshakeProtocol", () => {
  test("complete handshake flow", async () => {
    const { client, server } = await createTestKeyBundles();
    const clientProtocol = new HandshakeProtocol(client);
    const serverProtocol = new HandshakeProtocol(server);

    // Step 1: Server generates challenge
    const step1 = await serverProtocol.handle(null);
    expect(step1).not.toBeNull();

    // Step 2: Client handles challenge, generates response
    const step2 = await clientProtocol.handle(step1!);
    expect(step2).not.toBeNull();

    // Step 3: Server validates challenge response
    const step3 = await serverProtocol.handle(step2!);
    expect(step3).not.toBeNull();

    // Step 4: Client handles challenge accepted (returns null)
    const step4 = await clientProtocol.handle(step3!);
    expect(step4).toBeNull();

    // Step 5: Server generates public key
    const step5 = await serverProtocol.handle(null);
    expect(step5).not.toBeNull();

    // Step 6: Client handles server public key, generates own public key
    const step6 = await clientProtocol.handle(step5!);
    expect(step6).not.toBeNull();

    // Step 7: Server handles client public key, generates ECDH accepted
    const step7 = await serverProtocol.handle(step6!);
    expect(step7).not.toBeNull();

    // Step 8: Client handles ECDH accepted (returns null)
    const step8 = await clientProtocol.handle(step7!);
    expect(step8).toBeNull();

    // Both should have session keys
    expect(serverProtocol.sessionAesKey).not.toBeNull();
    expect(clientProtocol.sessionAesKey).not.toBeNull();

    // Both should report complete
    expect(serverProtocol.isComplete).toBe(true);
    expect(clientProtocol.isComplete).toBe(true);
  });

  test("rejects invalid challenge response", async () => {
    const { server } = await createTestKeyBundles();
    const serverProtocol = new HandshakeProtocol(server);

    // Generate challenge
    await serverProtocol.handle(null);

    // Send wrong challenge response
    const badResponse = new HandshakeMessage(
      HandshakeState.CHALLENGE_RESPONSE,
      new Uint8Array([0xff, 0xff, 0xff, 0xff])
    );
    const result = await serverProtocol.handle(badResponse.toBytes());

    // Server should respond with rejection (body = 0x01)
    const parsed = HandshakeMessage.parse(result!);
    expect(parsed.state).toBe(HandshakeState.CHALLENGE_ACCEPTED);
    expect(parsed.body[0]).toBe(0x01);
  });

  test("client rejects invalid challenge accepted", async () => {
    const { client } = await createTestKeyBundles();
    const clientProtocol = new HandshakeProtocol(client);

    // Create a challenge message
    const challenge = new HandshakeMessage(
      HandshakeState.CHALLENGE,
      new Uint8Array([0x01, 0x02, 0x03, 0x04])
    );
    await clientProtocol.handle(challenge.toBytes());

    // Send rejection
    const rejection = new HandshakeMessage(
      HandshakeState.CHALLENGE_ACCEPTED,
      new Uint8Array([0x01])
    );

    await expect(clientProtocol.handle(rejection.toBytes())).rejects.toThrow(
      "Challenge response was not 0"
    );
  });

  test("client rejects invalid ECDH accepted", async () => {
    const { client, server } = await createTestKeyBundles();
    const clientProtocol = new HandshakeProtocol(client);
    const serverProtocol = new HandshakeProtocol(server);

    // Run through challenge round
    const step1 = await serverProtocol.handle(null);
    const step2 = await clientProtocol.handle(step1!);
    const step3 = await serverProtocol.handle(step2!);
    await clientProtocol.handle(step3!);

    // Get server public key
    const step5 = await serverProtocol.handle(null);
    await clientProtocol.handle(step5!);

    // Create rejection message and encrypt it with challenge-round keys
    const rejection = new HandshakeMessage(HandshakeState.ECDH_ACCEPTED, new Uint8Array([0x01]));
    const { aesKey, iv } = serverProtocol.challengeRoundKeys!;
    const encrypted = await aesEncrypt(rejection.toBytes(), aesKey, iv);

    await expect(clientProtocol.handle(encrypted)).rejects.toThrow(
      "ECDH accepted response was not 0"
    );
  });

  test("client rejects invalid signed key length", async () => {
    const { client, server } = await createTestKeyBundles();
    const clientProtocol = new HandshakeProtocol(client);
    const serverProtocol = new HandshakeProtocol(server);

    // Run through challenge round
    const step1 = await serverProtocol.handle(null);
    const step2 = await clientProtocol.handle(step1!);
    const step3 = await serverProtocol.handle(step2!);
    await clientProtocol.handle(step3!);

    // Create invalid public key message (wrong length)
    const invalidPk = new HandshakeMessage(HandshakeState.SERVER_PUBLIC_KEY, new Uint8Array(100));
    const { aesKey, iv } = serverProtocol.challengeRoundKeys!;
    const encrypted = await aesEncrypt(invalidPk.toBytes(), aesKey, iv);

    await expect(clientProtocol.handle(encrypted)).rejects.toThrow(
      "Signed key length should be 128"
    );
  });
});
