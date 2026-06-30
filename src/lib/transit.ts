import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  generateSessionKeypair,
  exportPublicKey,
  deriveSharedKey,
  encryptPacket,
  decryptPacket,
} from "./crypto-transit.ts";
import type { ConsentedPacket, EncryptedBlob } from "./types.ts";

/**
 * Pairing-code handshake over Supabase Realtime BROADCAST channels only.
 *
 * No table writes. Nothing is persisted server-side. Over the wire, on the
 * channel `carry:${officeId}:${code}`, the relay only ever sees:
 *   - "join"          → an empty ping (patient announcing it has subscribed)
 *   - "desk-pubkey"   → the desk's ephemeral ECDH PUBLIC key (base64)
 *   - "patient-pubkey"→ the patient's ephemeral ECDH PUBLIC key (base64)
 *   - "packet"        → AES-GCM CIPHERTEXT + IV only
 *
 * The relay cannot decrypt anything, and NO private key is ever transmitted.
 * Each side's ECDH private key stays on the device that generated it; the
 * shared AES key is derived independently on each device (ECDH + HKDF, see
 * crypto-transit.ts) and is discarded when the session ends. The desk's
 * private key and derived shared key never leave this module.
 */

const CHANNEL_PREFIX = "carry";
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 30 * 1000;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !anonKey) {
      throw new Error(
        "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY environment variables",
      );
    }
    client = createClient(url, anonKey);
  }
  return client;
}

function channelName(officeId: string, code: string): string {
  return `${CHANNEL_PREFIX}:${officeId}:${code}`;
}

function generatePairingCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return n.toString().padStart(4, "0");
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

/**
 * Per-channel desk-side session state. Held only inside this module so that the
 * desk's private key and derived shared key never cross a function boundary
 * into UI code. Cleared and dropped when the session closes.
 */
interface DeskState {
  privateKey: CryptoKey | null;
  sharedKey: CryptoKey | null;
  onPacket: ((packet: ConsentedPacket) => void) | null;
  pending: EncryptedBlob[];
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
  // Discard every key: the desk's private key, the patient's contributed
  // material, and the derived shared key.
  state.privateKey = null;
  state.sharedKey = null;
  state.onPacket = null;
  state.pending = [];
  deskStates.delete(channel);
}

/**
 * Drains buffered packets once BOTH the shared key (derived from the patient's
 * public key) and the onPacket handler are available. Decrypts in arrival
 * order and serialises so concurrent triggers can't deliver out of order.
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
      const blob = state.pending.shift() as EncryptedBlob;
      const packet = await decryptPacket(blob, sharedKey);
      if (state.closed) return;
      // A real packet decrypted: the inactivity timeout no longer applies.
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      onPacket(packet);
    }
  } finally {
    state.draining = false;
  }
}

export interface DeskSession {
  code: string;
  channel: RealtimeChannel;
}

/**
 * Desk side. Generates a fresh session keypair and pairing code, opens the
 * channel, and keeps two listeners active for the session's lifetime:
 *   - "join"           → re-broadcast this desk's public key under
 *                        "desk-pubkey" (the only reliable way the key reaches a
 *                        patient who subscribes after the session started,
 *                        since broadcast channels don't replay missed messages).
 *   - "patient-pubkey" → derive the shared key immediately and store it for
 *                        decrypting packets.
 * The private key and derived shared key stay inside this module.
 */
export async function startDeskSession(officeId: string): Promise<DeskSession> {
  const keyPair = await generateSessionKeypair();
  const publicKeyB64 = await exportPublicKey(keyPair);
  const code = generatePairingCode();

  const channel = getClient().channel(channelName(officeId, code), {
    config: { broadcast: { self: false } },
  });

  const state: DeskState = {
    privateKey: keyPair.privateKey,
    sharedKey: null,
    onPacket: null,
    pending: [],
    timer: null,
    draining: false,
    closed: false,
  };
  deskStates.set(channel, state);

  channel.on("broadcast", { event: "join" }, () => {
    void channel.send({
      type: "broadcast",
      event: "desk-pubkey",
      payload: { pubkey: publicKeyB64 },
    });
  });

  channel.on("broadcast", { event: "patient-pubkey" }, ({ payload }) => {
    const s = deskStates.get(channel);
    if (!s || s.closed || s.sharedKey || !s.privateKey) return;
    const theirPublicKeyB64 = (payload as { pubkey: string }).pubkey;
    void deriveSharedKey(s.privateKey, theirPublicKeyB64).then((sharedKey) => {
      if (s.closed) return;
      s.sharedKey = sharedKey;
      void flushDesk(channel);
    });
  });

  await subscribeChannel(channel);

  return { code, channel };
}

export interface JoinedSession {
  sharedKey: CryptoKey;
  channel: RealtimeChannel;
}

/**
 * Patient side. Opens the same channel, announces "join", waits for the desk's
 * public key, generates its own session keypair, derives the shared key, then
 * broadcasts its own public key so the desk can derive the identical key.
 */
export async function joinSession(
  officeId: string,
  code: string,
): Promise<JoinedSession> {
  const channel = getClient().channel(channelName(officeId, code), {
    config: { broadcast: { self: false } },
  });

  const deskPublicKeyB64 = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for desk public key")),
      HANDSHAKE_TIMEOUT_MS,
    );
    channel.on("broadcast", { event: "desk-pubkey" }, ({ payload }) => {
      clearTimeout(timer);
      resolve((payload as { pubkey: string }).pubkey);
    });
    subscribeChannel(channel)
      .then(() =>
        channel.send({ type: "broadcast", event: "join", payload: {} }),
      )
      .catch((err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });

  const keyPair = await generateSessionKeypair();
  const sharedKey = await deriveSharedKey(keyPair.privateKey, deskPublicKeyB64);

  const myPublicKeyB64 = await exportPublicKey(keyPair);
  await channel.send({
    type: "broadcast",
    event: "patient-pubkey",
    payload: { pubkey: myPublicKeyB64 },
  });

  return { sharedKey, channel };
}

/**
 * Encrypts the consented packet with the per-session shared key and broadcasts
 * only the ciphertext + IV. The relay never sees the plaintext.
 */
export async function sendPacket(
  channel: RealtimeChannel,
  packet: ConsentedPacket,
  sharedKey: CryptoKey,
): Promise<void> {
  const blob = await encryptPacket(packet, sharedKey);
  await channel.send({ type: "broadcast", event: "packet", payload: { blob } });
}

/**
 * Desk side, called after startDeskSession. Registers the packet handler and
 * starts the 5-minute inactivity timeout. On "packet", if the shared key
 * derived from "patient-pubkey" hasn't landed yet, the ciphertext is buffered
 * and processed once the key is ready (we do NOT assume "patient-pubkey"
 * arrives before "packet"). If no packet is decrypted within 5 minutes the
 * channel is closed and all keys are discarded.
 */
export function listenForPacket(
  channel: RealtimeChannel,
  onPacket: (packet: ConsentedPacket) => void,
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
    s.pending.push((payload as { blob: EncryptedBlob }).blob);
    void flushDesk(channel);
  });

  state.timer = setTimeout(() => closeDeskSession(channel), SESSION_TIMEOUT_MS);

  // A packet (or the shared key) may already be waiting from before this call.
  void flushDesk(channel);
}

/**
 * Tears down a session channel (used by the patient side on unmount). The
 * caller drops its own sharedKey reference afterward. Safe to call repeatedly.
 */
export function endSession(channel: RealtimeChannel): void {
  void channel.unsubscribe();
}
