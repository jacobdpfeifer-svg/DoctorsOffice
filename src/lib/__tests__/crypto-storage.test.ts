/**
 * Unit tests for crypto-storage.ts
 *
 * High-risk paths covered:
 *   • encrypt/decrypt round-trip (correct passphrase)
 *   • wrong-passphrase rejection (AES-GCM tag failure)
 *   • tampered-ciphertext rejection (bit-flip → tag failure)
 *   • tampered-IV rejection
 *   • legacy v1 (PBKDF2) round-trip and wrong-PIN rejection
 *   • deriveNewStorageKey returns correct structure
 *
 * All Argon2id-dependent tests use minimal parameters (m=8, t=1) so they
 * complete in milliseconds rather than seconds.  The deriveNewStorageKey test
 * uses the real OWASP params and therefore has a generous timeout.
 */

import { describe, it, expect } from "vitest";
import {
  deriveStorageKey,
  deriveNewStorageKey,
  deriveStorageKeyV1,
  encryptProfile,
  decryptProfile,
} from "../crypto-storage.ts";
import type { KdfParams, Profile } from "../types.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Minimal Argon2id params — 8 KiB is the spec minimum, 1 iteration. */
const fastKdf: KdfParams = {
  algorithm: "argon2id",
  v: 19,
  m: 8,
  t: 1,
  p: 1,
  saltB64: toBase64(new Uint8Array(16).fill(0xab)),
};

// ---------------------------------------------------------------------------
// Encrypt / decrypt round-trip
// ---------------------------------------------------------------------------

describe("crypto-storage", () => {
  describe("encrypt/decrypt round-trip", () => {
    it("recovers the full profile with the correct passphrase", async () => {
      const key = await deriveStorageKey("correct-passphrase", fastKdf);
      const profile: Profile = {
        name: "Alice Aardvark",
        dob: "1990-01-15",
        allergies: "penicillin",
        medications: "none",
      };
      const blob = await encryptProfile(profile, key, fastKdf);
      const recovered = await decryptProfile(blob, key);

      expect(recovered.name).toBe("Alice Aardvark");
      expect(recovered.dob).toBe("1990-01-15");
      expect(recovered.allergies).toBe("penicillin");
      expect(recovered.medications).toBe("none");
    });

    it("produces a different IV and ciphertext on each call (random IV)", async () => {
      const key = await deriveStorageKey("passphrase-xyz", fastKdf);
      const profile: Profile = { name: "Bob" };
      const blob1 = await encryptProfile(profile, key, fastKdf);
      const blob2 = await encryptProfile(profile, key, fastKdf);

      expect(blob1.iv).not.toBe(blob2.iv);
      expect(blob1.ciphertext).not.toBe(blob2.ciphertext);
    });

    it("blob carries the v:2 discriminant and kdf metadata", async () => {
      const key = await deriveStorageKey("passphrase", fastKdf);
      const blob = await encryptProfile({ name: "Charlie" }, key, fastKdf);

      expect(blob.v).toBe(2);
      expect((blob as { kdf: KdfParams }).kdf.algorithm).toBe("argon2id");
    });
  });

  // ---------------------------------------------------------------------------
  // Wrong-passphrase rejection
  // ---------------------------------------------------------------------------

  describe("wrong-passphrase rejection", () => {
    it("throws when decrypting with a different passphrase (same KDF params)", async () => {
      const rightKey = await deriveStorageKey("correct-passphrase", fastKdf);
      const wrongKey = await deriveStorageKey("wrong-passphrase", fastKdf);

      const blob = await encryptProfile({ name: "Dana" }, rightKey, fastKdf);
      await expect(decryptProfile(blob, wrongKey)).rejects.toThrow();
    });

    it("throws when decrypting with a key derived from a different salt", async () => {
      const salt2: KdfParams = {
        ...fastKdf,
        saltB64: toBase64(new Uint8Array(16).fill(0xcd)),
      };
      const key1 = await deriveStorageKey("same-passphrase", fastKdf);
      const key2 = await deriveStorageKey("same-passphrase", salt2);

      const blob = await encryptProfile({ name: "Eva" }, key1, fastKdf);
      await expect(decryptProfile(blob, key2)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Tamper rejection
  // ---------------------------------------------------------------------------

  describe("tamper rejection", () => {
    it("throws after a single bit-flip in the ciphertext", async () => {
      const key = await deriveStorageKey("my-passphrase", fastKdf);
      const blob = await encryptProfile({ name: "Frank" }, key, fastKdf);

      const raw = fromBase64(blob.ciphertext);
      raw[0] ^= 0xff;
      const tampered = { ...blob, ciphertext: toBase64(raw) };

      await expect(decryptProfile(tampered, key)).rejects.toThrow();
    });

    it("throws after a bit-flip in the IV", async () => {
      const key = await deriveStorageKey("my-passphrase", fastKdf);
      const blob = await encryptProfile({ name: "Grace" }, key, fastKdf);

      const raw = fromBase64(blob.iv);
      raw[0] ^= 0xff;
      const tampered = { ...blob, iv: toBase64(raw) };

      await expect(decryptProfile(tampered, key)).rejects.toThrow();
    });

    it("throws after a byte is appended to the ciphertext", async () => {
      const key = await deriveStorageKey("my-passphrase", fastKdf);
      const blob = await encryptProfile({ name: "Hank" }, key, fastKdf);

      const raw = fromBase64(blob.ciphertext);
      const extended = new Uint8Array(raw.length + 1);
      extended.set(raw);
      extended[raw.length] = 0x42;
      const tampered = { ...blob, ciphertext: toBase64(extended) };

      await expect(decryptProfile(tampered, key)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Legacy v1 (PBKDF2) scheme
  // ---------------------------------------------------------------------------

  describe("legacy deriveStorageKeyV1", () => {
    it("encrypts and decrypts a profile with the v1 scheme", async () => {
      const key = await deriveStorageKeyV1("abcd1");
      const blob = await encryptProfile({ name: "Ivy" }, key, fastKdf);
      const recovered = await decryptProfile(blob, key);
      expect(recovered.name).toBe("Ivy");
    });

    it("rejects the wrong PIN under the v1 scheme", async () => {
      const rightKey = await deriveStorageKeyV1("abcd1");
      const wrongKey = await deriveStorageKeyV1("zzz99");
      const blob = await encryptProfile({ name: "Jack" }, rightKey, fastKdf);
      await expect(decryptProfile(blob, wrongKey)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // deriveNewStorageKey (full OWASP params — slow)
  // ---------------------------------------------------------------------------

  describe("deriveNewStorageKey", () => {
    it(
      "returns a non-extractable CryptoKey and well-formed KdfParams",
      { timeout: 30_000 },
      async () => {
        const { key, kdfParams } = await deriveNewStorageKey("test-passphrase");

        expect(key).toBeInstanceOf(CryptoKey);
        expect(key.extractable).toBe(false);
        expect(key.usages).toContain("encrypt");
        expect(key.usages).toContain("decrypt");

        expect(kdfParams.algorithm).toBe("argon2id");
        expect(kdfParams.v).toBe(19);
        expect(typeof kdfParams.saltB64).toBe("string");
        // 16-byte salt → 24 base64 chars (with `==` padding)
        expect(fromBase64(kdfParams.saltB64)).toHaveLength(16);
      },
    );

    it(
      "produces a different salt on each call (random salt)",
      { timeout: 60_000 },
      async () => {
        const { kdfParams: p1 } = await deriveNewStorageKey("pass");
        const { kdfParams: p2 } = await deriveNewStorageKey("pass");
        expect(p1.saltB64).not.toBe(p2.saltB64);
      },
    );
  });
});
