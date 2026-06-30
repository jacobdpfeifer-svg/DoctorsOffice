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

/**
 * An encrypted payload, base64-encoded. Used ONLY for at-rest storage of the
 * Profile in IndexedDB, encrypted under the STORAGE KEY. Never used for transit.
 */
export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

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
