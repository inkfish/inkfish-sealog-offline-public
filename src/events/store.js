/**
 * IndexedDB operations for the current local event record format.
 * @module
 */

import { EVENT_STORE, SYNC_STATE } from '../config/constants.js';
import { getAll, get, getDb, putMany } from '../db/indexed-db.js';

/**
 * Return all cached events without modifying stored records.
 * @returns {Promise<Array<object>>} All event records.
 */
export async function getAllEvents() {
  return getAll(EVENT_STORE);
}

/**
 * Retrieve a single event by its client_uuid primary key.
 * @param {string} localId - The event's local identifier.
 * @returns {Promise<object | null>} Stored record, or null if not found.
 */
export async function getEvent(localId) {
  return (await get(EVENT_STORE, localId)) ?? null;
}

/**
 * Requeue requests interrupted by the previous page closing or reloading.
 * Run once at startup, before starting any new sync work.
 * @returns {Promise<number>} Number of interrupted events requeued.
 */
export async function recoverInterruptedSync() {
  const events = await getAllEvents();
  const interrupted = events.filter((event) =>
    event.syncState === SYNC_STATE.SYNCING || event.syncState === SYNC_STATE.PATCHING
  );
  for (const event of interrupted) {
    event.syncState = event.serverId ? SYNC_STATE.PATCH_PENDING : SYNC_STATE.UNSYNCED;
    event.nextAttemptMs = null;
  }
  await putMany(EVENT_STORE, interrupted);
  return interrupted.length;
}

/**
 * Delete all events in SYNC_STATE.SYNCED state from IndexedDB in a
 * single transaction.
 * @returns {Promise<number>} Count of deleted records.
 * @throws {Error} If the transaction aborts.
 */
export async function clearSyncedCachedEvents() {
  const events = await getAllEvents();
  const removableIds = Array.from(
    new Set(
      events
        .filter((event) => event.syncState === SYNC_STATE.SYNCED && event?.localId)
        .map((event) => event.localId)
    )
  );

  if (!removableIds.length) {
    return 0;
  }

  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENT_STORE, 'readwrite');
    const store = tx.objectStore(EVENT_STORE);
    removableIds.forEach((id) => {
      store.delete(id);
    });
    const handleFailure = (error) => {
      reject(error || new Error('Failed to clear cached events.'));
    };
    tx.oncomplete = () => resolve(removableIds.length);
    tx.onerror = () => handleFailure(tx.error);
    tx.onabort = () => handleFailure(tx.error);
  });
}
