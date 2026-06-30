import type { EncryptedBlob, Profile } from "./types.ts";

/**
 * STORAGE KEY domain — at-rest encryption only.
 *
 * This module derives and uses the storage key, which encrypts the full
 * Profile at rest in IndexedDB. It is derived from a patient-held secret
 * (PIN now), never leaves the device, and is NEVER imported or referenced by
 * transit code (crypto-transit.ts). Keep these two domains fully separate.
 */

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

export async function deriveStorageKey(pin: string): Promise<CryptoKey> {
  // TODO: salt is fixed for this prototype only. Before any real PHI touches
  // this code, the salt MUST become a random per-device value generated at
  // first setup and stored alongside the blob (it is not secret, only unique).
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

export async function encryptProfile(
  profile: Profile,
  key: CryptoKey,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(profile));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptProfile(
  blob: EncryptedBlob,
  key: CryptoKey,
): Promise<Profile> {
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as Profile;
}
