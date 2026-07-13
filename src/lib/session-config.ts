/**
 * Shared session and handshake timeout constants.
 *
 * Single source of truth — import from here everywhere.  Do NOT duplicate
 * these values in individual modules or views (see the "mirroring" bug this
 * file was introduced to fix).
 */

/** How long a desk session stays alive with no packet received (5 min). */
export const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How long the patient waits for the desk's public key after sending "join"
 * (30 s).  The desk is expected to respond within a few hundred milliseconds
 * on a normal connection; 30 s covers very slow networks.
 */
export const HANDSHAKE_TIMEOUT_MS = 30 * 1000;

/**
 * How long the patient waits for the desk's authenticated ack after sending
 * the encrypted packet (15 s).  See AckTimeoutError in transit.ts.
 */
export const ACK_TIMEOUT_MS = 15_000;
