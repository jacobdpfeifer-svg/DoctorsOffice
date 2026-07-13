import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { EncryptedBlob } from "./types.ts";

/**
 * At-rest storage for the patient's encrypted profile and unlock-throttle state.
 *
 * ⚠️  PHI — SECURITY REVIEW REQUIRED ⚠️
 * The "profile" store holds ONLY an EncryptedBlob — never plaintext, never a
 * Profile, never a ConsentedPacket. Transit data must never touch this database.
 *
 * Schema versions:
 *   v1  — "profile" store only (EncryptedBlobV1: no KDF params, fixed PBKDF2 salt)
 *   v2  — adds "meta" store for unlock throttling; profile values are EncryptedBlobV2
 *         (Argon2id, per-device salt, KDF params embedded in blob)
 */

const DB_NAME = "carry";
const DB_VERSION = 2;
const PROFILE_STORE = "profile";
const META_STORE = "meta";
const PROFILE_KEY = "self";
const THROTTLE_KEY = "pin-throttle";

// ---------------------------------------------------------------------------
// DB schema
// ---------------------------------------------------------------------------

interface ThrottleRecord {
  /** Total number of consecutive failed unlock attempts. */
  failCount: number;
  /**
   * Timestamp (ms since epoch) after which the next attempt is allowed.
   * 0 means "not locked".
   */
  lockedUntil: number;
}

interface CarryDB extends DBSchema {
  profile: {
    key: string;
    value: EncryptedBlob;
  };
  /**
   * Key/value store for non-profile metadata.
   * Currently only holds the unlock-throttle record.
   */
  meta: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<CarryDB>> | null = null;

function getDB(): Promise<IDBPDatabase<CarryDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CarryDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Migrations are additive: each block runs only if the DB was below
        // that version when the upgrade started.
        if (oldVersion < 1) {
          db.createObjectStore(PROFILE_STORE);
        }
        if (oldVersion < 2) {
          // Add the meta store for throttle state (and any future metadata).
          // Existing profile data (v1 EncryptedBlobV1) is preserved as-is;
          // it will be migrated to v2 the next time the user unlocks.
          db.createObjectStore(META_STORE);
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<EncryptedBlob | undefined> {
  const db = await getDB();
  return db.get(PROFILE_STORE, PROFILE_KEY);
}

export async function saveProfile(blob: EncryptedBlob): Promise<void> {
  const db = await getDB();
  await db.put(PROFILE_STORE, blob, PROFILE_KEY);
}

export async function clearProfile(): Promise<void> {
  const db = await getDB();
  await db.delete(PROFILE_STORE, PROFILE_KEY);
}

// ---------------------------------------------------------------------------
// Unlock throttle
// ---------------------------------------------------------------------------

/**
 * Result of a throttle check: either the attempt is allowed, or it is
 * blocked and the caller should tell the user how long to wait.
 */
export type ThrottleStatus =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Lockout durations indexed by consecutive fail count.
 * Counts 0–2: no lockout.
 * Count 3: 30 s  |  4: 2 min  |  5: 10 min  |  6+: 1 hour.
 *
 * These values are intentionally graduated so a legitimate user who mis-types
 * gets a short correction window, while sustained brute-force is stopped quickly.
 */
function lockoutDurationMs(failCount: number): number {
  if (failCount < 3) return 0;
  if (failCount === 3) return 30_000;          // 30 seconds
  if (failCount === 4) return 2 * 60_000;      // 2 minutes
  if (failCount === 5) return 10 * 60_000;     // 10 minutes
  return 60 * 60_000;                          // 1 hour (6+ failures)
}

async function getThrottleRecord(): Promise<ThrottleRecord> {
  const db = await getDB();
  const stored = await db.get(META_STORE, THROTTLE_KEY) as ThrottleRecord | undefined;
  return stored ?? { failCount: 0, lockedUntil: 0 };
}

/**
 * Checks whether an unlock attempt is currently permitted.
 *
 * This is a READ-ONLY check — it does not increment the failure counter.
 * Call it BEFORE running the expensive KDF so a locked device skips the work.
 */
export async function checkUnlockThrottle(): Promise<ThrottleStatus> {
  const record = await getThrottleRecord();
  const now = Date.now();
  if (record.lockedUntil > now) {
    return { allowed: false, retryAfterMs: record.lockedUntil - now };
  }
  return { allowed: true };
}

/**
 * Records a failed unlock attempt and enforces a lockout if the threshold
 * has been reached.  Must be called AFTER confirming the passphrase was wrong.
 */
export async function recordFailedUnlock(): Promise<void> {
  const db = await getDB();
  const record = await getThrottleRecord();
  const newCount = record.failCount + 1;
  const duration = lockoutDurationMs(newCount);
  const updated: ThrottleRecord = {
    failCount: newCount,
    lockedUntil: duration > 0 ? Date.now() + duration : 0,
  };
  await db.put(META_STORE, updated, THROTTLE_KEY);
}

/**
 * Resets the throttle state after a successful unlock.
 * Also call when creating a brand-new profile (no prior failures possible).
 */
export async function clearUnlockThrottle(): Promise<void> {
  const db = await getDB();
  await db.delete(META_STORE, THROTTLE_KEY);
}
