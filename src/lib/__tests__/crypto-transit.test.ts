/**
 * Unit tests for crypto-transit.ts
 *
 * High-risk paths covered:
 *   • ECDH + HKDF key agreement: both sides derive the same key and SAS
 *   • SAS is exactly 6 digits on both sides
 *   • Transcript binding: different pairing code → different SAS
 *   • MITM detection: key substitution → different SAS on each side
 *   • Packet encrypt/decrypt round-trip
 *   • Wrong-key rejection (AES-GCM tag failure)
 *   • Tampered-ciphertext rejection
 *   • Ack encrypt/decrypt round-trip
 *   • Forged ack (different key) rejection
 *   • Wrong ACK_MARKER rejection
 */

import { describe, it, expect } from "vitest";
import {
  generateSessionKeypair,
  exportPublicKey,
  deriveSharedKey,
  encryptPacket,
  decryptPacket,
  encryptAck,
  decryptAck,
} from "../crypto-transit.ts";
import type { ConsentedPacket } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Generate a full ECDH keypair pair + transcript for both sides. */
async function makeSessionPair(pairingCode = "ABCDE123") {
  const deskKP = await generateSessionKeypair();
  const patientKP = await generateSessionKeypair();
  const deskPubKeyB64 = await exportPublicKey(deskKP);
  const patientPubKeyB64 = await exportPublicKey(patientKP);
  const transcript = { deskPubKeyB64, patientPubKeyB64, pairingCode };
  return { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript };
}

// ---------------------------------------------------------------------------
// ECDH + HKDF key agreement
// ---------------------------------------------------------------------------

describe("crypto-transit", () => {
  describe("ECDH + HKDF key agreement", () => {
    it("both sides derive the identical SAS", async () => {
      const { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript } =
        await makeSessionPair();

      const desk = await deriveSharedKey(deskKP.privateKey, patientPubKeyB64, transcript);
      const patient = await deriveSharedKey(patientKP.privateKey, deskPubKeyB64, transcript);

      expect(desk.sas).toBe(patient.sas);
    });

    it("SAS is exactly 6 decimal digits", async () => {
      const { deskKP, patientPubKeyB64, transcript } = await makeSessionPair();
      const { sas } = await deriveSharedKey(deskKP.privateKey, patientPubKeyB64, transcript);
      expect(sas).toMatch(/^\d{6}$/);
    });

    it("different pairing code produces different SAS (transcript binding)", async () => {
      const { deskKP, deskPubKeyB64, patientPubKeyB64 } = await makeSessionPair();

      const code1 = { deskPubKeyB64, patientPubKeyB64, pairingCode: "AAAAAAAA" };
      const code2 = { deskPubKeyB64, patientPubKeyB64, pairingCode: "BBBBBBBB" };

      const a = await deriveSharedKey(deskKP.privateKey, patientPubKeyB64, code1);
      const b = await deriveSharedKey(deskKP.privateKey, patientPubKeyB64, code2);

      expect(a.sas).not.toBe(b.sas);
    });

    it("MITM key substitution produces different SAS on each side", async () => {
      // Represents an attacker who intercepts the exchange and substitutes
      // their own public key in both directions.
      const deskKP = await generateSessionKeypair();
      const patientKP = await generateSessionKeypair();
      const mitmKP = await generateSessionKeypair();

      const realDeskPub = await exportPublicKey(deskKP);
      const realPatientPub = await exportPublicKey(patientKP);
      const mitmPub = await exportPublicKey(mitmKP);
      const pairingCode = "TESTMITM";

      // Desk believes it's talking to the patient, but sees the MITM's pubkey.
      // Transcript the desk computes: realDeskPub | mitmPub
      const deskTranscript = {
        deskPubKeyB64: realDeskPub,
        patientPubKeyB64: mitmPub,
        pairingCode,
      };
      const deskSide = await deriveSharedKey(deskKP.privateKey, mitmPub, deskTranscript);

      // Patient believes it's talking to the desk, but sees the MITM's pubkey.
      // Transcript the patient computes: mitmPub | realPatientPub
      const patientTranscript = {
        deskPubKeyB64: mitmPub,
        patientPubKeyB64: realPatientPub,
        pairingCode,
      };
      const patientSide = await deriveSharedKey(
        patientKP.privateKey,
        mitmPub,
        patientTranscript,
      );

      // The SAS values differ, so the human comparison will catch the MITM.
      expect(deskSide.sas).not.toBe(patientSide.sas);
    });

    it("keys encrypt/decrypt between the two sides", async () => {
      const { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript } =
        await makeSessionPair();

      const { key: deskKey } = await deriveSharedKey(
        deskKP.privateKey,
        patientPubKeyB64,
        transcript,
      );
      const { key: patientKey } = await deriveSharedKey(
        patientKP.privateKey,
        deskPubKeyB64,
        transcript,
      );

      const packet: ConsentedPacket = { name: "Alice", allergies: "none" };
      const blob = await encryptPacket(packet, patientKey);
      const recovered = await decryptPacket(blob, deskKey);

      expect(recovered).toEqual(packet);
    });
  });

  // ---------------------------------------------------------------------------
  // Packet encryption
  // ---------------------------------------------------------------------------

  describe("packet encryption", () => {
    it("round-trip preserves all ConsentedPacket fields", async () => {
      const { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript } =
        await makeSessionPair();
      const { key: deskKey } = await deriveSharedKey(
        deskKP.privateKey,
        patientPubKeyB64,
        transcript,
      );
      const { key: patientKey } = await deriveSharedKey(
        patientKP.privateKey,
        deskPubKeyB64,
        transcript,
      );

      const packet: ConsentedPacket = {
        name: "Bob Barker",
        dob: "1923-12-12",
        allergies: "aspirin",
        medications: "lisinopril 10 mg",
        reason: "follow-up",
      };
      const recovered = await decryptPacket(await encryptPacket(packet, patientKey), deskKey);
      expect(recovered).toEqual(packet);
    });

    it("produces a different ciphertext on each call (random IV)", async () => {
      const { deskKP, patientPubKeyB64, transcript } = await makeSessionPair();
      const { key } = await deriveSharedKey(deskKP.privateKey, patientPubKeyB64, transcript);
      const p: ConsentedPacket = { name: "Carol" };
      const b1 = await encryptPacket(p, key);
      const b2 = await encryptPacket(p, key);
      expect(b1.iv).not.toBe(b2.iv);
    });

    it("rejects decryption with an unrelated key", async () => {
      const { deskKP, patientPubKeyB64, transcript } = await makeSessionPair();
      const { key: realKey } = await deriveSharedKey(
        deskKP.privateKey,
        patientPubKeyB64,
        transcript,
      );

      // An unrelated keypair that was never part of this session
      const rogueA = await generateSessionKeypair();
      const rogueB = await generateSessionKeypair();
      const roguePub = await exportPublicKey(rogueB);
      const { key: rogueKey } = await deriveSharedKey(rogueA.privateKey, roguePub, {
        deskPubKeyB64: roguePub,
        patientPubKeyB64: roguePub,
        pairingCode: "ROGUE123",
      });

      const blob = await encryptPacket({ name: "Dave" }, realKey);
      await expect(decryptPacket(blob, rogueKey)).rejects.toThrow();
    });

    it("rejects a tampered ciphertext (bit-flip)", async () => {
      const { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript } =
        await makeSessionPair();
      const { key: deskKey } = await deriveSharedKey(
        deskKP.privateKey,
        patientPubKeyB64,
        transcript,
      );
      const { key: patientKey } = await deriveSharedKey(
        patientKP.privateKey,
        deskPubKeyB64,
        transcript,
      );

      const blob = await encryptPacket({ name: "Eve" }, patientKey);
      const raw = fromBase64(blob.ciphertext);
      raw[0] ^= 0xff;
      const tampered = { ...blob, ciphertext: toBase64(raw) };

      await expect(decryptPacket(tampered, deskKey)).rejects.toThrow();
    });

    it("rejects a tampered IV", async () => {
      const { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript } =
        await makeSessionPair();
      const { key: deskKey } = await deriveSharedKey(
        deskKP.privateKey,
        patientPubKeyB64,
        transcript,
      );
      const { key: patientKey } = await deriveSharedKey(
        patientKP.privateKey,
        deskPubKeyB64,
        transcript,
      );

      const blob = await encryptPacket({ name: "Frank" }, patientKey);
      const raw = fromBase64(blob.iv);
      raw[0] ^= 0xff;
      const tampered = { ...blob, iv: toBase64(raw) };

      await expect(decryptPacket(tampered, deskKey)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Delivery receipt (ack)
  // ---------------------------------------------------------------------------

  describe("delivery receipt (ack)", () => {
    it("round-trip: desk encrypts ack, patient decrypts successfully", async () => {
      const { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript } =
        await makeSessionPair();
      const { key: deskKey } = await deriveSharedKey(
        deskKP.privateKey,
        patientPubKeyB64,
        transcript,
      );
      const { key: patientKey } = await deriveSharedKey(
        patientKP.privateKey,
        deskPubKeyB64,
        transcript,
      );

      const ackBlob = await encryptAck(deskKey);
      await expect(decryptAck(ackBlob, patientKey)).resolves.toBeUndefined();
    });

    it("rejects a forged ack encrypted with a different key", async () => {
      const { patientKP, deskPubKeyB64, transcript } = await makeSessionPair();
      const { key: patientKey } = await deriveSharedKey(
        patientKP.privateKey,
        deskPubKeyB64,
        transcript,
      );

      // Rogue party encrypts an ack with their own unrelated key
      const rogueA = await generateSessionKeypair();
      const rogueB = await generateSessionKeypair();
      const roguePub = await exportPublicKey(rogueB);
      const { key: rogueKey } = await deriveSharedKey(rogueA.privateKey, roguePub, {
        deskPubKeyB64: roguePub,
        patientPubKeyB64: roguePub,
        pairingCode: "FORGERY1",
      });

      const forgedAck = await encryptAck(rogueKey);
      await expect(decryptAck(forgedAck, patientKey)).rejects.toThrow();
    });

    it("rejects an ack whose plaintext is not the expected ACK_MARKER", async () => {
      const { deskKP, patientKP, deskPubKeyB64, patientPubKeyB64, transcript } =
        await makeSessionPair();
      const { key: deskKey } = await deriveSharedKey(
        deskKP.privateKey,
        patientPubKeyB64,
        transcript,
      );
      const { key: patientKey } = await deriveSharedKey(
        patientKP.privateKey,
        deskPubKeyB64,
        transcript,
      );

      // Encrypt something that is NOT the ack marker under the real session key
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        deskKey,
        new TextEncoder().encode("not-the-ack-marker"),
      );
      const wrongMarkerBlob = {
        iv: toBase64(iv.buffer),
        ciphertext: toBase64(ct),
      };

      await expect(decryptAck(wrongMarkerBlob, patientKey)).rejects.toThrow(
        /Invalid ack payload/,
      );
    });
  });
});
