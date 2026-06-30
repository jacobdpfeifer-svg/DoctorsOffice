import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { EncryptedBlob } from "./types.ts";

/**
 * At-rest storage for the patient's profile.
 *
 * INVARIANT: the "profile" store holds ONLY an EncryptedBlob, encrypted under
 * the STORAGE KEY. It must never contain plaintext, a Profile, or a
 * ConsentedPacket. Transit data never touches this database.
 */

const DB_NAME = "carry";
const DB_VERSION = 1;
const STORE = "profile";
const KEY = "self";

interface CarryDB extends DBSchema {
  profile: {
    key: string;
    value: EncryptedBlob;
  };
}

let dbPromise: Promise<IDBPDatabase<CarryDB>> | null = null;

function getDB(): Promise<IDBPDatabase<CarryDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CarryDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function getProfile(): Promise<EncryptedBlob | undefined> {
  const db = await getDB();
  return db.get(STORE, KEY);
}

export async function saveProfile(blob: EncryptedBlob): Promise<void> {
  const db = await getDB();
  await db.put(STORE, blob, KEY);
}

export async function clearProfile(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, KEY);
}
