import { argon2id } from "hash-wasm";
import type { EncryptedBlobV1, EncryptedBlobV2, KdfParams, Profile } from "./types.ts";

/**
 * STORAGE KEY domain — at-rest encryption of PHI only.
 *
 * ⚠️  PHI — SECURITY REVIEW REQUIRED ⚠️
 * This module derives and manages the storage key that encrypts the patient's
 * full Profile at rest in IndexedDB. It handles Protected Health Information
 * (PHI) directly. All changes must be reviewed by a qualified security
 * engineer before deployment. Key security invariants:
 *
 *   1. The storage key is derived from the user's passphrase and a per-device
 *      random salt (16 bytes, stored in the EncryptedBlob itself).  The salt
 *      is NOT secret — only unique — so it may be stored in plaintext.
 *
 *   2. Key derivation uses Argon2id (memory-hard KDF) followed by HKDF for
 *      domain separation, NOT raw PBKDF2 with a fixed salt.
 *
 *   3. This module is intentionally isolated from crypto-transit.ts.  The two
 *      key domains (storage vs transit) must NEVER share material, functions,
 *      or imports. Only ConsentedPacket (never the full Profile) crosses the
 *      boundary.
 *
 *   4. The Argon2id WASM binary is provided by the `hash-wasm` package, which
 *      has been audited independently. The HKDF step uses the browser's native
 *      Web Crypto API.  Do NOT add custom crypto primitives here.
 *
 * DO NOT HAND-ROLL CRYPTO. If stronger primitives are needed (e.g. a
 * memory-hard KDF with hardware-level protection or HSM backing), engage a
 * security specialist rather than extending this module.
 */

// ---------------------------------------------------------------------------
// Encoding helpers (isolated from crypto-transit.ts)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Argon2id parameters
// ---------------------------------------------------------------------------

/**
 * OWASP 2023 recommended minimum for Argon2id.
 * m=19456 KiB (19 MiB), t=2 iterations, p=1 parallelism.
 *
 * These are the MINIMUM recommended values. For higher-assurance deployments,
 * increase memorySize to 65536 (64 MiB) and/or iterations to 3.
 * Parameters are stored inside every blob, so they can be upgraded without
 * breaking existing stored profiles.
 *
 * ⚠️  SECURITY REVIEW: Re-evaluate these parameters periodically as hardware
 * capabilities improve. The goal is ~1–2 seconds of wall-clock time on the
 * target device.
 */
const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19_456, // KiB
  hashLength: 32,     // bytes of raw output fed into HKDF
} as const;

/** Argon2 algorithm version 1.3, represented as decimal 19. */
const ARGON2_VERSION = 19;

/** HKDF domain string for the storage key (must never equal the transit domain). */
const STORAGE_HKDF_INFO = new TextEncoder().encode("carry-storage-v2");

// ---------------------------------------------------------------------------
// Key derivation — current (v2)
// ---------------------------------------------------------------------------

/**
 * Derives an AES-GCM-256 storage key from a passphrase + fresh random salt.
 * Call this when CREATING a new profile (first setup or re-encryption).
 *
 * The 16-byte salt is generated here and returned inside `kdfParams` so the
 * caller can embed it in the EncryptedBlobV2 for future decryption.
 *
 * Derivation pipeline:
 *   passphrase + salt → Argon2id (memory-hard, 19 MiB) → 32 raw bytes
 *                     → HKDF(info="carry-storage-v2") → AES-GCM-256 key
 */
export async function deriveNewStorageKey(
  passphrase: string,
): Promise<{ key: CryptoKey; kdfParams: KdfParams }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await runArgon2idPipeline(passphrase, salt, ARGON2_PARAMS);

  const kdfParams: KdfParams = {
    algorithm: "argon2id",
    v: ARGON2_VERSION,
    m: ARGON2_PARAMS.memorySize,
    t: ARGON2_PARAMS.iterations,
    p: ARGON2_PARAMS.parallelism,
    saltB64: bytesToBase64(salt),
  };

  return { key, kdfParams };
}

/**
 * Re-derives the AES-GCM-256 storage key from a passphrase and the KDF
 * parameters stored inside an existing EncryptedBlobV2.
 * Call this when UNLOCKING an existing profile.
 *
 * The parameters are trusted as stored — no re-validation is performed beyond
 * what Argon2id and the Web Crypto API enforce.
 */
export async function deriveStorageKey(
  passphrase: string,
  kdfParams: KdfParams,
): Promise<CryptoKey> {
  if (kdfParams.algorithm !== "argon2id") {
    throw new Error(`Unsupported KDF algorithm: ${kdfParams.algorithm}`);
  }
  const salt = base64ToBytes(kdfParams.saltB64);
  return runArgon2idPipeline(passphrase, salt, {
    parallelism: kdfParams.p,
    iterations: kdfParams.t,
    memorySize: kdfParams.m,
    hashLength: ARGON2_PARAMS.hashLength,
  });
}

/**
 * Shared Argon2id + HKDF pipeline used by both derivation paths.
 *
 * Argon2id provides memory hardness (defeats GPU/ASIC brute-force).
 * HKDF provides domain separation (ensures the output cannot be reused
 * in a different context even if the Argon2id output is somehow leaked).
 */
async function runArgon2idPipeline(
  passphrase: string,
  salt: Uint8Array,
  params: { parallelism: number; iterations: number; memorySize: number; hashLength: number },
): Promise<CryptoKey> {
  // Step 1: Argon2id — the memory-hard bottleneck.
  // outputType "binary" returns a raw Uint8Array (no Argon2 encoded header).
  const argon2Output = (await argon2id({
    password: passphrase,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: params.hashLength,
    outputType: "binary",
  })) as Uint8Array<ArrayBuffer>;

  // Step 2: HKDF domain separation.
  // Import the raw Argon2id output as HKDF key material, then derive a
  // non-extractable AES-GCM key bound to the "carry-storage-v2" domain.
  const hkdfMaterial = await crypto.subtle.importKey(
    "raw",
    argon2Output,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: STORAGE_HKDF_INFO,
    },
    hkdfMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------------
// Key derivation — legacy v1 (migration only)
// ---------------------------------------------------------------------------

/**
 * Derives a storage key using the legacy v1 scheme:
 *   PBKDF2(SHA-256, pin, salt="carry-storage-fixed-salt-v1", iter=310_000)
 *
 * ⚠️  THIS IS THE OLD WEAK SCHEME — do not use for new profiles. ⚠️
 * This function exists ONLY to decrypt existing v1 blobs so they can be
 * re-encrypted under the v2 Argon2id scheme.  It will be removed once no
 * v1 blobs remain in the wild.
 *
 * Weakness: the global fixed salt means pre-computed rainbow tables exist
 * for any 4-digit PIN.  PBKDF2 is not memory-hard (GPU/ASIC friendly).
 */
export async function deriveStorageKeyV1(pin: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode("carry-storage-fixed-salt-v1");

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 310_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypts `profile` under `key` and returns a self-contained v2 blob that
 * embeds all KDF parameters needed to re-derive the key in future.
 *
 * ⚠️  PHI: the plaintext Profile must be discarded from memory as soon as
 * this function returns; do not cache it beyond the immediate need.
 */
export async function encryptProfile(
  profile: Profile,
  key: CryptoKey,
  kdfParams: KdfParams,
): Promise<EncryptedBlobV2> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(profile));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  return {
    v: 2,
    kdf: kdfParams,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts an encrypted blob (any version) and returns the Profile.
 *
 * If the key is wrong, `crypto.subtle.decrypt` throws a DOMException
 * ("operation failed" / "AES-GCM decryption failed"). The caller is
 * responsible for counting failed attempts and applying throttling.
 *
 * ⚠️  PHI: the returned Profile is plaintext.  Caller must not expose it
 * beyond the minimum necessary scope.
 */
export async function decryptProfile(
  blob: Pick<EncryptedBlobV1 | EncryptedBlobV2, "iv" | "ciphertext">,
  key: CryptoKey,
): Promise<Profile> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(blob.iv) },
    key,
    base64ToBytes(blob.ciphertext),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as Profile;
}
