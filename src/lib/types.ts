/**
 * ⚠️  PHI — SECURITY REVIEW REQUIRED ⚠️
 * All types in this file touch patient health information. Changes to
 * EncryptedBlob or KdfParams affect how PHI is stored at rest. Any
 * modification must be reviewed by a security engineer before deployment.
 */

/**
 * The patient's full intake data. This lives only on the patient's own device
 * and is encrypted at rest with the STORAGE KEY. It is never transmitted in
 * full — only a consented subset (see ConsentedPacket) ever leaves the device.
 */
export interface Profile {
  name?: string;
  dob?: string;
  phone?: string;
  email?: string;
  address?: string;
  insurer?: string;
  memberId?: string;
  groupNo?: string;
  pharmacy?: string;
  allergies?: string;
  medications?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// KDF parameters (stored with every v2 blob for forward migration)
// ---------------------------------------------------------------------------

/**
 * All parameters needed to re-derive the storage key from the user's
 * passphrase.  These are NOT secret (salt is not a key), but they are
 * stored alongside the ciphertext so future code can re-derive the key
 * without hard-coded assumptions about which parameters were used.
 */
export interface KdfParams {
  /** Always "argon2id". Discriminant for forward-compatibility. */
  algorithm: "argon2id";
  /** Argon2 algorithm version integer (19 = v1.3). */
  v: number;
  /** Memory cost in kibibytes (KiB). */
  m: number;
  /** Number of iterations (time cost). */
  t: number;
  /** Degree of parallelism. */
  p: number;
  /** Base64-encoded 16-byte per-device random salt. Not secret — only unique. */
  saltB64: string;
}

// ---------------------------------------------------------------------------
// EncryptedBlob — versioned union
// ---------------------------------------------------------------------------

/**
 * Legacy (v1) format: AES-GCM blob encrypted under a PBKDF2 key derived
 * with a hard-coded global salt.  This format is WEAK — precomputable
 * rainbow tables exist for any 4-digit PIN against the fixed salt.
 *
 * V1 blobs are automatically migrated to v2 on the next successful unlock.
 * No new v1 blobs are ever written.
 */
export interface EncryptedBlobV1 {
  /** No version field — absence of `v` is the discriminant for v1. */
  iv: string;
  ciphertext: string;
}

/**
 * Current (v2) format: AES-GCM blob encrypted under an Argon2id-derived key,
 * with a per-device random salt stored inline.  All KDF parameters are
 * embedded so the blob is self-contained for future migration.
 */
export interface EncryptedBlobV2 {
  v: 2;
  kdf: KdfParams;
  iv: string;
  ciphertext: string;
}

/**
 * Union of all known encrypted-blob versions.
 * Use `'v' in blob && blob.v === 2` to discriminate.
 */
export type EncryptedBlob = EncryptedBlobV1 | EncryptedBlobV2;

// ---------------------------------------------------------------------------
// Transit types (PHI never reaches these in plaintext)
// ---------------------------------------------------------------------------

/**
 * The subset of Profile fields the patient explicitly chose to share for a
 * single visit. This — never the full Profile — is what gets transit-encrypted
 * under the per-session TRANSIT KEY and sent to the desk.
 */
export type ConsentedPacket = Partial<Profile>;

/**
 * Ephemeral key material for one check-in session. Transit-only: this is
 * derived fresh per session via ECDH and must NEVER be persisted anywhere
 * (not IndexedDB, not localStorage, not the relay).
 */
export interface SessionKeys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  sharedKey?: CryptoKey;
}
