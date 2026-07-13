import { type RealtimeChannel } from "@supabase/supabase-js";
import { z } from "zod";
import {
  generateSessionKeypair,
  exportPublicKey,
  deriveSharedKey,
  encryptPacket,
  decryptPacket,
  encryptAck,
  decryptAck,
} from "./crypto-transit.ts";
import type { ConsentedPacket, EncryptedBlob } from "./types.ts";
import { getSupabase } from "./supabase.ts";

/**
 * Pairing-code handshake over Supabase Realtime BROADCAST channels only.
 *
 * Hardened handshake — v4 protocol:
 *
 *   1. Desk generates a fresh ECDH keypair and an 8-character high-entropy
 *      pairing code from an unambiguous alphabet.  The code is claimed in a
 *      per-process in-memory registry (see claimPairingCode) to guarantee
 *      uniqueness within this browser session before the channel is opened.
 *
 *   2. Channel messages (in order):
 *        "join"             → patient ping; triggers desk to re-send its public
 *                             key if the session is not yet consumed
 *        "desk-pubkey"      → desk's ephemeral P-256 public key (base64)
 *        "patient-pubkey"   → patient's ephemeral P-256 public key (base64)
 *        "session-consumed" → broadcast by desk after accepting the first
 *                             patient, so late arrivals receive a clear error
 *                             instead of hanging on the handshake timeout
 *        "packet"           → AES-GCM ciphertext + IV only (never plaintext)
 *        "ack"              → AES-GCM ciphertext of "carry-ack-v1", sent by
 *                             the desk immediately after successfully decrypting
 *                             the packet. The patient waits up to ACK_TIMEOUT_MS
 *                             for a valid ack before transitioning to "done".
 *
 *   3. After both public keys are known each side independently derives:
 *        • AES-GCM-256 shared key via ECDH + HKDF (info = transcript)
 *        • 6-digit SAS (Short Authenticated String) via a separate HKDF call
 *      The HKDF `info` (the transcript) is:
 *        "carry-enc-v2" | pairingCode | deskPubKey | patientPubKey
 *      This binding means that if an active MITM substitutes either key,
 *      the two sides' shared secrets will differ → the SAS values will
 *      differ → the human visual comparison will detect the attack.
 *
 *   4. Single-use enforcement: the desk sets `consumed = true` immediately on
 *      receiving the first "patient-pubkey" and stops responding to further
 *      "join" pings.  It also broadcasts "session-consumed" so any late joiner
 *      receives a clear error rather than timing out silently.
 *
 *   5. SAS check (human step): both screens display the 6-digit code.
 *      The patient must visually confirm it matches the desk screen before
 *      sending the packet.  Mismatch → patient aborts, session discarded.
 *
 *   6. Delivery receipt: the desk broadcasts an AES-GCM "ack" encrypted
 *      under the shared key after decryption.  The patient waits for this ack
 *      (up to ACK_TIMEOUT_MS) before showing "done".  Because AES-GCM is
 *      authenticated, only the desk (the only other holder of the shared key)
 *      can produce a valid ack — a third party on the channel cannot forge
 *      one.  Duplicate or late acks are handled idempotently via a settled
 *      flag; decryption failures are silently ignored and the wait continues.
 *
 *   7. Trust-boundary hardening: EVERY inbound frame is validated by a Zod
 *      schema before any field value is touched.  Frames that fail validation
 *      are logged and dropped — they never reach atob/importKey/JSON.parse.
 *      The desk additionally tracks a set of already-processed IVs and a
 *      packetDelivered flag to prevent duplicate delivery to the chart even if
 *      Realtime re-delivers a broadcast or an attacker replays the packet event.
 *
 *   8. Server-side rate limiting: Realtime RLS policies (see
 *      supabase/migrations/20250101000003_realtime_rls_v2.sql) validate that
 *      the officeId segment of the channel name corresponds to a real row in
 *      the offices table.  Because office IDs are non-guessable UUIDs and
 *      pairing codes are 2^40-entropy strings, the two unknowns compose to
 *      make brute-force enumeration computationally infeasible.
 *
 * ⚠️  SECURITY REVIEW REQUIRED ⚠️
 * See comments in crypto-transit.ts for the full threat-model disclaimer.
 * Do NOT hand-roll a stronger protocol here; integrate an audited PAKE
 * library instead (e.g. OPAQUE or SRP) if higher assurance is needed.
 */

const CHANNEL_PREFIX = "carry";

// All timeout constants live in session-config.ts — the single source of truth.
// Re-export ACK_TIMEOUT_MS so existing callers (e.g. PatientView) don't need
// to change their import path.
export { ACK_TIMEOUT_MS } from "./session-config.ts";
import {
  SESSION_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  ACK_TIMEOUT_MS,
} from "./session-config.ts";

/**
 * Thrown by `sendPacket` when the desk's ack does not arrive within
 * ACK_TIMEOUT_MS.  Callers should distinguish this from channel errors:
 * on AckTimeoutError the packet was almost certainly delivered (only the
 * confirmation was lost), so the right response is an "unconfirmed" warning,
 * not a "retry" prompt.
 */
export class AckTimeoutError extends Error {
  constructor() {
    super(
      "Delivery not confirmed — the front desk did not acknowledge within " +
      String(Math.round(ACK_TIMEOUT_MS / 1000)) +
      " seconds. Your information was likely received; please check with the receptionist.",
    );
    this.name = "AckTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Inbound frame schemas — Zod
//
// Every payload received from a Realtime broadcast channel is untrusted.
// Validate FIRST; touch field values only after safeParse succeeds.
//
// Size rationale:
//   P-256 raw public key:  65 bytes → 88 standard-base64 chars (87 + "=")
//   AES-GCM IV:            12 bytes → 16 standard-base64 chars (no padding)
//   Max packet ciphertext: a full ConsentedPacket is at most ~2 KB of JSON;
//                          AES-GCM adds a 16-byte tag.  8 KB is very generous.
// ---------------------------------------------------------------------------

/**
 * Standard base64 alphabet: A-Z a-z 0-9 + /  with 0–2 `=` pad chars.
 * Note: the functions in crypto-transit.ts use btoa() which produces this
 * exact encoding; URL-safe (`-`, `_`) variants are never produced.
 */
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * P-256 uncompressed public key: exactly 65 bytes → 87 base64 chars + `=`.
 * Both encodings are from btoa(raw-65-byte-buffer).
 */
const PubkeySchema = z
  .string()
  .length(88, "pubkey must be 88 base64 characters (65-byte P-256 public key)")
  .regex(/^[A-Za-z0-9+/]{87}=$/, "pubkey must be standard base64 with exactly one pad character");

/**
 * AES-GCM IV: exactly 12 bytes → 16 base64 chars with no padding.
 */
const IvSchema = z
  .string()
  .length(16, "IV must be 16 base64 characters (12-byte AES-GCM IV)")
  .regex(/^[A-Za-z0-9+/]{16}$/, "IV must be standard base64 with no padding");

const MAX_CIPHERTEXT_B64 = 8192; // 8 KB — far more than any realistic ConsentedPacket

const EncryptedBlobSchema = z.object({
  iv: IvSchema,
  ciphertext: z
    .string()
    .min(1, "ciphertext must not be empty")
    .max(MAX_CIPHERTEXT_B64, `ciphertext must not exceed ${MAX_CIPHERTEXT_B64} base64 characters`)
    .regex(B64_RE, "ciphertext must be standard base64"),
});

/** Validated shape of a "desk-pubkey" or "patient-pubkey" payload. */
const PubkeyFrameSchema = z.object({ pubkey: PubkeySchema });

/** Validated shape of a "packet" or "ack" payload. */
const BlobFrameSchema = z.object({ blob: EncryptedBlobSchema });

// Type inferred by Zod so the rest of the code is fully typed.
type ValidatedBlob = z.infer<typeof EncryptedBlobSchema>;

// ---------------------------------------------------------------------------
// Frame drop logger
//
// Logs security-relevant drops to the console without emitting raw payload
// values (which could be arbitrarily large or contain unexpected content).
// Uses console.warn, not console.error, to signal "expected defence" rather
// than "application bug".
// ---------------------------------------------------------------------------

function frameLog(event: string, reason: string, issues?: z.ZodIssue[]): void {
  if (issues && issues.length > 0) {
    // Log only the issue metadata (path + code), never the raw received value.
    const summary = issues
      .map((i) => `${i.path.join(".")}: ${i.code}`)
      .join("; ");
    console.warn(`[carry:transit] Dropped "${event}" frame — ${reason}: ${summary}`);
  } else {
    console.warn(`[carry:transit] Dropped "${event}" frame — ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Pairing code — 8 characters from the unambiguous alphabet
// ---------------------------------------------------------------------------

/**
 * Characters excluded from the pairing alphabet to prevent visual confusion:
 *   0 / O  (zero vs letter-O)
 *   1 / I / l  (one vs letter-I vs lowercase-L)
 * This gives a 32-character alphabet and 32^8 ≈ 2^40 possible codes.
 */
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * 256 / 32 = 8 exactly, so taking `byte % 32` is perfectly uniform —
 * no rejection sampling needed.
 */
function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join("");
}

// ---------------------------------------------------------------------------
// Single-use code registry (per-process, in-memory)
// ---------------------------------------------------------------------------

/**
 * Tracks the set of pairing codes currently active for each officeId within
 * this browser session.  Prevents two simultaneous desk sessions from
 * accidentally using the same code.
 */
const activeCodesPerOffice = new Map<string, Set<string>>();

function claimPairingCode(officeId: string): string {
  let bucket = activeCodesPerOffice.get(officeId);
  if (!bucket) {
    bucket = new Set();
    activeCodesPerOffice.set(officeId, bucket);
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generatePairingCode();
    if (!bucket.has(code)) {
      bucket.add(code);
      return code;
    }
  }
  throw new Error(
    "Failed to generate a unique pairing code after 10 attempts. " +
    "This should never happen in normal use.",
  );
}

function releasePairingCode(officeId: string, code: string): void {
  activeCodesPerOffice.get(officeId)?.delete(code);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelName(officeId: string, code: string): string {
  return `${CHANNEL_PREFIX}:${officeId}:${code}`;
}

function subscribeChannel(channel: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        reject(new Error(`Realtime channel ${status}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Desk-side session state
// ---------------------------------------------------------------------------

/**
 * Per-channel desk-side session state.  Held only inside this module so
 * that the desk's private key and derived shared key never cross a function
 * boundary into UI code.  Cleared on session close.
 */
interface DeskState {
  officeId: string;
  privateKey: CryptoKey | null;
  /** Own (desk) public key, kept for transcript construction. */
  deskPubKeyB64: string;
  /** Pairing code, kept for transcript construction and release on close. */
  pairingCode: string;
  sharedKey: CryptoKey | null;
  onPacket: ((packet: ConsentedPacket) => void) | null;
  /**
   * True once the first "patient-pubkey" message has been accepted.
   * The desk stops responding to further "join" pings and broadcasts
   * "session-consumed" so late arrivals get a clear error immediately.
   */
  consumed: boolean;
  /**
   * True once the first packet has been successfully decrypted and delivered
   * to the UI via onPacket.  Any subsequent "packet" broadcasts — whether
   * from Realtime re-delivery or an active replay attack — are dropped with
   * a frameLog warning.  Combined with seenIVs, this prevents duplicate
   * delivery to the patient chart.
   */
  packetDelivered: boolean;
  /**
   * AES-GCM IVs of every packet this session has already processed.
   * Checked synchronously in the "packet" listener AND again before
   * decryption inside flushDesk (the async gap between the two lets a second
   * replay sneak past the first check).
   */
  seenIVs: Set<string>;
  /**
   * Fires once, immediately after both public keys are exchanged and the
   * shared key + SAS are derived.  The UI should display the SAS and wait
   * for the user's visual confirmation on the patient device.
   */
  onSAS: ((sas: string) => void) | null;
  /**
   * Optional error sink.  Called when a frame or cryptographic operation
   * produces an irrecoverable error that the UI should surface (e.g. key
   * derivation failure after a well-formed but invalid public key).
   * Not called for dropped frames (those go to frameLog only).
   */
  onError: ((err: Error) => void) | null;
  pending: ValidatedBlob[];
  timer: ReturnType<typeof setTimeout> | null;
  draining: boolean;
  closed: boolean;
}

const deskStates = new WeakMap<RealtimeChannel, DeskState>();

function closeDeskSession(channel: RealtimeChannel): void {
  const state = deskStates.get(channel);
  if (!state || state.closed) return;
  state.closed = true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  void channel.unsubscribe();
  releasePairingCode(state.officeId, state.pairingCode);
  // Wipe every sensitive value and clear replay-tracking state.
  state.privateKey = null;
  state.sharedKey = null;
  state.onPacket = null;
  state.onSAS = null;
  state.onError = null;
  state.pending = [];
  state.seenIVs.clear();
  state.packetDelivered = false;
  deskStates.delete(channel);
}

/**
 * Desk side: encrypt the ack marker and broadcast it on the session channel.
 *
 * Best-effort — if the channel send fails (channel unsubscribed or network
 * error), the error is swallowed and the patient will time out and see the
 * "unconfirmed" screen.  The desk still has the decrypted packet regardless.
 */
async function sendAck(channel: RealtimeChannel, sharedKey: CryptoKey): Promise<void> {
  try {
    const blob = await encryptAck(sharedKey);
    await channel.send({ type: "broadcast", event: "ack", payload: { blob } });
  } catch {
    // Intentional no-op — see JSDoc above.
  }
}

/**
 * Drains buffered packets once BOTH the shared key and the onPacket handler
 * are available.  Decrypts in arrival order; serialised so concurrent
 * triggers can't deliver out-of-order.
 *
 * Trust guarantees:
 *   • Blobs in `state.pending` have already passed schema validation in the
 *     "packet" listener — their iv and ciphertext strings are well-formed
 *     base64 of the correct lengths.
 *   • A second IV check before decryption covers the async race where two
 *     replays both pass the synchronous listener check before either is
 *     processed here.
 *   • decryptPacket() is wrapped in try/catch; a failure (AES-GCM tag error,
 *     malformed JSON, etc.) is logged and surfaced via onError rather than
 *     swallowed or allowed to propagate as an unhandled rejection.
 *   • packetDelivered is set AFTER the first successful decryption; any blob
 *     still in the queue after that point is dropped.
 */
async function flushDesk(channel: RealtimeChannel): Promise<void> {
  const state = deskStates.get(channel);
  if (!state || state.closed || state.draining) return;
  if (!state.sharedKey || !state.onPacket) return;

  state.draining = true;
  try {
    while (!state.closed && state.pending.length > 0) {
      const sharedKey = state.sharedKey;
      const onPacket = state.onPacket;
      if (!sharedKey || !onPacket) break;

      // We can't use EncryptedBlob directly here because the Zod-validated
      // type is { iv: string; ciphertext: string }, which decryptPacket accepts.
      const blob = state.pending.shift()!;

      // Belt-and-suspenders IV dedup: covers the async race where two replays
      // passed the synchronous listener check before either was processed.
      if (state.seenIVs.has(blob.iv)) {
        frameLog("packet", `skipping already-processed IV (async replay)`);
        continue;
      }

      // Drop any further blobs after the first packet was delivered.
      if (state.packetDelivered) {
        frameLog("packet", "session already delivered a packet — dropping duplicate");
        continue;
      }

      let packet: ConsentedPacket;
      try {
        packet = await decryptPacket(blob as EncryptedBlob, sharedKey);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        frameLog("packet", `decryption failed: ${error.message}`);
        state.onError?.(
          new Error(`Packet decryption failed — the ciphertext may be corrupted or tampered: ${error.message}`),
        );
        // Drop this blob; continue processing if more are queued (though in
        // practice there should never be more than one valid packet per session).
        continue;
      }

      if (state.closed) return;

      // Record the IV and mark delivery BEFORE the ack and the UI callback
      // so that any concurrent replay that somehow reaches here is rejected
      // immediately, even in the presence of async scheduling.
      state.seenIVs.add(blob.iv);
      state.packetDelivered = true;

      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }

      // Broadcast the authenticated ack BEFORE firing the UI callback so the
      // patient can transition to "confirmed done" while the desk React tree
      // updates.
      void sendAck(channel, sharedKey);

      onPacket(packet);
    }
  } finally {
    state.draining = false;
  }
}

// ---------------------------------------------------------------------------
// Public API — desk side
// ---------------------------------------------------------------------------

export interface DeskSession {
  code: string;
  channel: RealtimeChannel;
}

/**
 * Desk side.  Claims a unique pairing code, generates a fresh session keypair,
 * opens the Realtime channel, and registers permanent listeners.
 *
 * @param onSAS   Called once the SAS is computed.  The UI should show the
 *                6-digit code prominently and instruct the receptionist to
 *                ask the patient to verify it matches their screen.
 *
 * @param onError Called when an irrecoverable error occurs asynchronously
 *                inside a channel listener (e.g. malformed public key passes
 *                schema validation but fails crypto.subtle.importKey, causing
 *                the key-derivation promise to reject).  The UI should surface
 *                the message and invite the receptionist to refresh.
 *
 * All other trust-boundary rejections (invalid frame shapes, IV replays,
 * post-delivery duplicates) are handled internally and logged via frameLog —
 * they do NOT call onError and do NOT affect session state.
 */
export async function startDeskSession(
  officeId: string,
  onSAS: (sas: string) => void,
  onError?: (err: Error) => void,
): Promise<DeskSession> {
  const keyPair = await generateSessionKeypair();
  const publicKeyB64 = await exportPublicKey(keyPair);
  const code = claimPairingCode(officeId);

  const channel = getSupabase().channel(channelName(officeId, code), {
    config: { broadcast: { self: false } },
  });

  const state: DeskState = {
    officeId,
    privateKey: keyPair.privateKey,
    deskPubKeyB64: publicKeyB64,
    pairingCode: code,
    sharedKey: null,
    consumed: false,
    packetDelivered: false,
    seenIVs: new Set(),
    onPacket: null,
    onSAS,
    onError: onError ?? null,
    pending: [],
    timer: null,
    draining: false,
    closed: false,
  };
  deskStates.set(channel, state);

  // "join" — patient ping, no payload to validate.
  // Only respond if the session hasn't been consumed by a previous patient.
  channel.on("broadcast", { event: "join" }, () => {
    const s = deskStates.get(channel);
    if (!s || s.closed || s.consumed) return;
    void channel.send({
      type: "broadcast",
      event: "desk-pubkey",
      payload: { pubkey: publicKeyB64 },
    });
  });

  // "patient-pubkey" — contains the patient's P-256 public key.
  // Validate the payload BEFORE touching any field value.
  channel.on("broadcast", { event: "patient-pubkey" }, ({ payload }) => {
    const s = deskStates.get(channel);
    if (!s || s.closed || s.consumed || !s.privateKey) return;

    const parsed = PubkeyFrameSchema.safeParse(payload);
    if (!parsed.success) {
      frameLog("patient-pubkey", "schema validation failed", parsed.error.issues);
      // Session NOT consumed — a malformed frame doesn't lock out the session.
      // The patient can retry; the receptionist can wait.
      return;
    }

    // Mark consumed synchronously before any async work so no second patient
    // can sneak in during the key-derivation await.
    s.consumed = true;

    // Notify any late joiners that the session is taken.
    void channel.send({
      type: "broadcast",
      event: "session-consumed",
      payload: {},
    });

    const patientPubKeyB64 = parsed.data.pubkey;

    deriveSharedKey(s.privateKey, patientPubKeyB64, {
      deskPubKeyB64: s.deskPubKeyB64,
      patientPubKeyB64,
      pairingCode: s.pairingCode,
    })
      .then(({ key, sas }) => {
        if (s.closed) return;
        s.sharedKey = key;
        s.onSAS?.(sas);
        void flushDesk(channel);
      })
      .catch((err: unknown) => {
        // key derivation can fail if the public key string passes base64
        // validation but is not a valid P-256 point.
        const error = err instanceof Error ? err : new Error(String(err));
        frameLog("patient-pubkey", `key derivation failed: ${error.message}`);
        s.onError?.(
          new Error(`Session key derivation failed — ask the patient to retry: ${error.message}`),
        );
      });
  });

  await subscribeChannel(channel);

  return { code, channel };
}

// ---------------------------------------------------------------------------
// Public API — patient side
// ---------------------------------------------------------------------------

export interface JoinedSession {
  sharedKey: CryptoKey;
  channel: RealtimeChannel;
  /**
   * 6-digit SAS to display to the patient for visual confirmation.
   * The patient must compare this with the desk screen before sending.
   */
  sas: string;
}

/**
 * Patient side.  Opens the channel, announces "join", and waits for either
 * the desk's public key, a "session-consumed" event, or a timeout.
 *
 * Trust guarantees:
 *   • The "desk-pubkey" payload is validated by PubkeyFrameSchema before the
 *     public key string is passed to deriveSharedKey.  An invalid frame is
 *     logged and discarded; the timeout remains running.  (We do not reject
 *     the promise on a single bad frame because the desk might legitimately
 *     re-broadcast after a transient duplicate.)
 *   • "session-consumed" has no payload; it just triggers an immediate clear
 *     rejection so the patient gets a fast error instead of waiting 30 s.
 */
export async function joinSession(
  officeId: string,
  code: string,
): Promise<JoinedSession> {
  const channel = getSupabase().channel(channelName(officeId, code), {
    config: { broadcast: { self: false } },
  });

  const deskPubKeyB64 = await new Promise<string>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out waiting for desk — the session may have expired."));
    }, HANDSHAKE_TIMEOUT_MS);

    channel.on("broadcast", { event: "desk-pubkey" }, ({ payload }) => {
      if (settled) return;

      const parsed = PubkeyFrameSchema.safeParse(payload);
      if (!parsed.success) {
        // Drop the malformed frame and keep waiting — don't reject because
        // a subsequent legitimate broadcast from the desk may still arrive.
        frameLog("desk-pubkey", "schema validation failed, dropping frame", parsed.error.issues);
        return;
      }

      clearTimeout(timer);
      settled = true;
      resolve(parsed.data.pubkey);
    });

    channel.on("broadcast", { event: "session-consumed" }, () => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      void channel.unsubscribe();
      reject(
        new Error(
          "This session is already in use. Ask the receptionist for a new code.",
        ),
      );
    });

    subscribeChannel(channel)
      .then(() =>
        channel.send({ type: "broadcast", event: "join", payload: {} }),
      )
      .catch((err) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });

  const keyPair = await generateSessionKeypair();
  const patientPubKeyB64 = await exportPublicKey(keyPair);

  const { key: sharedKey, sas } = await deriveSharedKey(
    keyPair.privateKey,
    deskPubKeyB64,
    {
      deskPubKeyB64,
      patientPubKeyB64,
      pairingCode: code,
    },
  );

  await channel.send({
    type: "broadcast",
    event: "patient-pubkey",
    payload: { pubkey: patientPubKeyB64 },
  });

  return { sharedKey, channel, sas };
}

// ---------------------------------------------------------------------------
// Public API — shared
// ---------------------------------------------------------------------------

/**
 * Encrypts the consented packet, sends it, and waits for an authenticated
 * delivery receipt ("ack") from the desk.
 *
 * Trust guarantees:
 *   • The ack listener validates the payload schema (BlobFrameSchema) before
 *     any field value is extracted.  A frame that fails validation is dropped;
 *     the wait continues and the timeout remains running.
 *   • After schema validation, decryptAck verifies the AES-GCM tag and the
 *     "carry-ack-v1" marker.  A failure (wrong key, tampered ciphertext,
 *     unexpected marker) is silently discarded — not a valid ack.
 *   • Duplicate or late acks are handled by the settled flag; only the first
 *     successfully validated ack resolves the promise.
 *
 * @throws {AckTimeoutError} if no valid ack arrives within ACK_TIMEOUT_MS.
 * @throws if the underlying channel.send fails (network error).
 *
 * MUST NOT be called before the user has confirmed the SAS.
 */
export async function sendPacket(
  channel: RealtimeChannel,
  packet: ConsentedPacket,
  sharedKey: CryptoKey,
): Promise<void> {
  const blob = await encryptPacket(packet, sharedKey);

  const ackPromise = new Promise<void>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AckTimeoutError());
    }, ACK_TIMEOUT_MS);

    channel.on("broadcast", { event: "ack" }, ({ payload }) => {
      if (settled) return;

      const parsed = BlobFrameSchema.safeParse(payload);
      if (!parsed.success) {
        frameLog("ack", "schema validation failed, dropping frame", parsed.error.issues);
        return;
      }

      void (async () => {
        try {
          await decryptAck(parsed.data.blob as EncryptedBlob, sharedKey);
          // Double-check settled after the async gap.
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          resolve();
        } catch {
          // AES-GCM tag failure or wrong marker — not a valid ack from the desk.
          // Silently discard; keep waiting for a genuine ack or the timeout.
        }
      })();
    });
  });

  await channel.send({ type: "broadcast", event: "packet", payload: { blob } });
  await ackPromise;
}

/**
 * Desk side, called after startDeskSession.  Registers the packet handler and
 * starts the SESSION_TIMEOUT_MS inactivity timer.
 *
 * Transit.ts is the sole owner of session teardown.  When the timer fires it:
 *   1. Calls closeDeskSession (unsubscribes the channel, wipes all keys).
 *   2. Calls onExpire so the view can update its UI.
 *
 * The caller MUST NOT start a separate expiry timer — doing so creates a race
 * between two timers and risks nulling channelRef before endSession is called,
 * leaking a subscribed-but-unreferenced Realtime channel.
 *
 * Trust guarantees:
 *   • The "packet" listener validates BlobFrameSchema before any field value
 *     is extracted.  Malformed frames are dropped with a frameLog warning.
 *   • packetDelivered is checked synchronously: any "packet" event arriving
 *     after the first delivery is dropped immediately.
 *   • IV dedup is checked synchronously in the listener AND again inside
 *     flushDesk before decryption, covering the async race window.
 */
export function listenForPacket(
  channel: RealtimeChannel,
  onPacket: (packet: ConsentedPacket) => void,
  onExpire: () => void,
): void {
  const state = deskStates.get(channel);
  if (!state) {
    throw new Error(
      "listenForPacket: no desk session for this channel — call startDeskSession first",
    );
  }

  state.onPacket = onPacket;

  channel.on("broadcast", { event: "packet" }, ({ payload }) => {
    const s = deskStates.get(channel);
    if (!s || s.closed) return;

    // Fast-path drop: session already delivered one packet.
    if (s.packetDelivered) {
      frameLog("packet", "session already delivered a packet — dropping replay");
      return;
    }

    const parsed = BlobFrameSchema.safeParse(payload);
    if (!parsed.success) {
      frameLog("packet", "schema validation failed", parsed.error.issues);
      return;
    }

    const { blob } = parsed.data;

    // Synchronous IV dedup: catches an exact replay before it enters the
    // async decryption queue.  A second check in flushDesk covers the async
    // race window between this listener and the decryption loop.
    if (s.seenIVs.has(blob.iv)) {
      frameLog("packet", "IV already processed — dropping replay");
      return;
    }

    s.pending.push(blob);
    void flushDesk(channel);
  });

  // Single timer — transit.ts is the sole owner of session teardown.
  // closeDeskSession unsubscribes the channel and wipes all keys; onExpire
  // then notifies the view so it can update its step state and offer a
  // "Start new session" action.  The view must NOT run a parallel timer.
  state.timer = setTimeout(() => {
    closeDeskSession(channel);
    onExpire();
  }, SESSION_TIMEOUT_MS);

  void flushDesk(channel);
}

/**
 * Tears down a session channel.  Safe to call repeatedly.
 */
export function endSession(channel: RealtimeChannel): void {
  closeDeskSession(channel);
}
