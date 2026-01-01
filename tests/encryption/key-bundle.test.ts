import { describe, test, expect } from "bun:test";
import { createKeyBundle } from "../../src/encryption/key-bundle.ts";

// Valid test keys (same format as in Python tests)
const VALID_SIGNING_KEY = "790a020bee8eaedf6513bbe0eca02a65e7d9066b62870512a3e3395b29eab01c";
const VALID_VERIFY_KEY =
  "3059301306072a8648ce3d020106082a8648ce3d03010703420004f7fac1a0285c21e98448c2e9863dc9521102f28a60d49706d52bed924d6ce8501264fea523af1a30d52caf1b9b2d42f2906521481172886069256980488a5bc7";
const VALID_SHARED_SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("createKeyBundle", () => {
  test("creates bundle from valid hex strings", async () => {
    const bundle = await createKeyBundle(VALID_SIGNING_KEY, VALID_VERIFY_KEY, VALID_SHARED_SECRET);

    expect(bundle.signingKey.type).toBe("private");
    expect(bundle.verifyKey.type).toBe("public");
    expect(bundle.sharedSecret.length).toBe(16);
  });

  test("throws on invalid signing key length", async () => {
    await expect(createKeyBundle("ABCD", VALID_VERIFY_KEY, VALID_SHARED_SECRET)).rejects.toThrow(
      "signing_key must be 64 hex characters"
    );
  });

  test("throws on invalid shared secret length", async () => {
    await expect(createKeyBundle(VALID_SIGNING_KEY, VALID_VERIFY_KEY, "ABCD")).rejects.toThrow(
      "shared_secret must be 32 hex characters"
    );
  });
});
