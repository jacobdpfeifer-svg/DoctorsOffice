import type { ConsentedPacket, EncryptedBlob } from "./types.ts";

/**
 * TRANSIT KEY domain — per-session, in-flight encryption only.
 *
 * INVARIANT: the transit key is generated fresh for every check-in session
 * via ECDH, is NEVER persisted (not IndexedDB, not localStorage, not the
 * relay), and CANNOT be derived from the storage key in crypto-storage.ts.
 * This module intentionally shares no functions, constants, or imports with
 * crypto-storage.ts. Only the consented field subset (ConsentedPacket) is
 * ever encrypted here — never the full Profile.
 *
 * ⚠️  SECURITY REVIEW REQUIRED ⚠️
 * The handshake implemented here (unauthenticated ECDH + HKDF transcript
 * binding + Short Authenticated String) is a significant improvement over
 * raw unauthenticated ECDH, but it is NOT a vetted PAKE (Password-Authenticated
 * Key Exchange) and has NOT been formally audited. Known limitations:
 *   - The pairing code is used only for channel routing and transcript
 *     binding; it does NOT provide the same security guarantees as a
 *     PAKE such as OPAQUE or SRP.
 *   - The SAS (Short Authenticated String) step detects MITM attacks only
 *     if users perform the visual comparison. A distracted or socially-
 *     engineered user can skip it.
 *   - Passive eavesdroppers cannot decrypt (ECDH secrecy holds), but active
 *     MITM is detectable — not prevented — by the SAS step.
 * For a higher-assurance deployment, replace this handshake with an audited
 * PAKE library rather than extending this hand-rolled protocol.
 */

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function abToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToAb(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Key generation & export
// ---------------------------------------------------------------------------

export async function generateSessionKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
}

export async function exportPublicKey(keyPair: CryptoKeyPair): Promise<string> {
  // Exported as "raw" format: the uncompressed P-256 point (65 bytes), base64.
  const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  return abToBase64(raw);
}

// ---------------------------------------------------------------------------
// Transcript construction
// ---------------------------------------------------------------------------

/**
 * Builds the HKDF `info` bytes that bind the derived key to the full
 * handshake transcript.
 *
 * Layout (all lengths fixed → no separators needed):
 *   domain (UTF-8, variable but constant per call) |
 *   pairingCode (8 bytes, ASCII)                   |
 *   deskPubKey (65 bytes, P-256 uncompressed raw)  |
 *   patientPubKey (65 bytes, P-256 uncompressed raw)
 *
 * Using a domain prefix ("carry-enc-v2" vs "carry-sas-v2") provides
 * domain separation so the encryption key and the SAS are derived
 * independently from the same HKDF input material.
 *
 * BOTH sides compute the identical transcript because:
 *   - `deskPubKeyB64` is broadcast by the desk and received by the patient
 *   - `patientPubKeyB64` is broadcast by the patient and received by the desk
 * A man-in-the-middle who substitutes keys will cause the transcripts on each
 * side to diverge, producing different SAS values that the human comparison
 * will detect.
 */
function buildTranscriptInfo(
  domain: string,
  pairingCode: string,
  deskPubKeyB64: string,
  patientPubKeyB64: string,
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const domainBytes    = enc.encode(domain);
  const codeBytes      = enc.encode(pairingCode);
  const deskBytes      = new Uint8Array(base64ToAb(deskPubKeyB64));
  const patientBytes   = new Uint8Array(base64ToAb(patientPubKeyB64));

  const out = new Uint8Array(
    domainBytes.length + codeBytes.length + deskBytes.length + patientBytes.length,
  );
  let offset = 0;
  out.set(domainBytes,  offset); offset += domainBytes.length;
  out.set(codeBytes,    offset); offset += codeBytes.length;
  out.set(deskBytes,    offset); offset += deskBytes.length;
  out.set(patientBytes, offset);
  return out;
}

// ---------------------------------------------------------------------------
// Shared-key derivation  ← the core change
// ---------------------------------------------------------------------------

export interface DerivedSession {
  /**
   * Non-extractable AES-GCM-256 key used for encrypting/decrypting the
   * consented packet. Derived from ECDH + HKDF with the full transcript.
   */
  key: CryptoKey;
  /**
   * 6-digit Short Authenticated String (SAS) displayed on both devices for
   * visual key confirmation.  Both sides must display the same value; a
   * mismatch means the connection is not direct (MITM detected).
   * Derived from a SEPARATE HKDF call with a different domain string, so it
   * is independent of the encryption key.
   */
  sas: string;
}

/**
 * Derives the shared AES-GCM key and SAS from an ECDH exchange, binding
 * the derivation to the full handshake transcript via the HKDF `info`
 * parameter.
 *
 * Caller is responsible for passing the keys in the CANONICAL ORDER:
 *   - `deskPubKeyB64`    → desk's public key (first broadcaster)
 *   - `patientPubKeyB64` → patient's public key (second broadcaster)
 * Both sides must use this same ordering. `theirPublicKeyB64` is the
 * counterpart used for the actual ECDH deriveBits call.
 */
export async function deriveSharedKey(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string,
  transcript: {
    deskPubKeyB64: string;
    patientPubKeyB64: string;
    pairingCode: string;
  },
): Promise<DerivedSession> {
  // --- Step 1: ECDH ---
  const theirPublicKey = await crypto.subtle.importKey(
    "raw",
    base64ToAb(theirPublicKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    256,
  );

  // --- Step 2: Import as HKDF material ---
  const hkdfMaterial = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey", "deriveBits"],
  );

  // --- Step 3: Derive the AES-GCM encryption key (domain "carry-enc-v2") ---
  const infoEnc = buildTranscriptInfo(
    "carry-enc-v2",
    transcript.pairingCode,
    transcript.deskPubKeyB64,
    transcript.patientPubKeyB64,
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: infoEnc,
    },
    hkdfMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  // --- Step 4: Derive the SAS (domain "carry-sas-v2") ---
  // A separate HKDF call with a different domain string produces an
  // output that is cryptographically independent of the encryption key.
  const infoSas = buildTranscriptInfo(
    "carry-sas-v2",
    transcript.pairingCode,
    transcript.deskPubKeyB64,
    transcript.patientPubKeyB64,
  );
  const sasBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: infoSas,
    },
    hkdfMaterial,
    32, // 4 bytes; mod 10^6 gives negligible bias (< 0.01%)
  );

  const b = new Uint8Array(sasBits);
  const sasNum = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  const sas = (sasNum % 1_000_000).toString().padStart(6, "0");

  return { key, sas };
}

// ---------------------------------------------------------------------------
// Packet encryption / decryption
// ---------------------------------------------------------------------------

export async function encryptPacket(
  packet: ConsentedPacket,
  sharedKey: CryptoKey,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(packet));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    plaintext,
  );

  return {
    iv: abToBase64(iv.buffer),
    ciphertext: abToBase64(ciphertext),
  };
}

export async function decryptPacket(
  blob: EncryptedBlob,
  sharedKey: CryptoKey,
): Promise<ConsentedPacket> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToAb(blob.iv) },
    sharedKey,
    base64ToAb(blob.ciphertext),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as ConsentedPacket;
}

// ---------------------------------------------------------------------------
// Delivery receipt (ack) — authenticated under the shared session key
// ---------------------------------------------------------------------------

/**
 * Constant marker embedded in every ack ciphertext.
 *
 * AES-GCM provides authenticated encryption, so the only way to produce a
 * ciphertext that decrypts to this exact string is to hold the shared key.
 * A third party on the Realtime channel cannot forge a valid ack because they
 * never learned the shared key (it was derived from the ECDH exchange and
 * never transmitted).
 *
 * Versioned so that future protocol changes can introduce a new marker and
 * reject acks from older protocol versions if needed.
 */
const ACK_MARKER = "carry-ack-v1";

/**
 * Desk side: encrypt the ack marker under the shared session key.
 * Called inside `flushDesk` immediately after successful packet decryption.
 */
export async function encryptAck(sharedKey: CryptoKey): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(ACK_MARKER);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    plaintext,
  );
  return { iv: abToBase64(iv.buffer), ciphertext: abToBase64(ciphertext) };
}

/**
 * Patient side: decrypt and validate an ack blob.
 *
 * Throws if:
 *   • AES-GCM authentication fails (wrong key, bit-flip, forged ciphertext)
 *   • Decrypted plaintext is not exactly ACK_MARKER (unexpected protocol msg)
 *
 * The caller MUST treat any throw as "not a valid ack from the desk" and
 * continue waiting rather than failing.  Only a resolve (no throw) is a
 * confirmed delivery.
 */
export async function decryptAck(
  blob: EncryptedBlob,
  sharedKey: CryptoKey,
): Promise<void> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToAb(blob.iv) },
    sharedKey,
    base64ToAb(blob.ciphertext),
  );
  const text = new TextDecoder().decode(plaintext);
  if (text !== ACK_MARKER) {
    throw new Error(`Invalid ack payload: expected "${ACK_MARKER}", got "${text}"`);
  }
}
