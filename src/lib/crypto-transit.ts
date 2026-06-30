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
 */

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

export async function deriveSharedKey(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string,
): Promise<CryptoKey> {
  const theirPublicKey = await crypto.subtle.importKey(
    "raw",
    base64ToAb(theirPublicKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // 1. ECDH to a raw shared secret.
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    256,
  );

  // 2. HKDF the raw secret into a usable AES-GCM key (don't use ECDH output
  //    directly as a key).
  const hkdfMaterial = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("carry-transit-session-v1"),
    },
    hkdfMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

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
