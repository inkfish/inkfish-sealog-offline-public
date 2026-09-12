import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { closeDb, put, getAll } from '../../src/db/indexed-db.js';
import { EVENT_STORE, SYNC_STATE } from '../../src/config/constants.js';
import { getAllEvents, getEvent, recoverInterruptedSync, clearSyncedCachedEvents } from '../../src/events/store.js';

const DB_NAME = 'sealog-offline';

async function resetDb() {
  await closeDb();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

test.afterEach(async () => {
  await closeDb();
});

test.beforeEach(async () => {
  await resetDb();
});

test('event reads preserve captured data and retry state across reopening the database', async () => {
  const event = {
    localId: 'evt-1',
    client_uuid: 'evt-1',
    type: 'OBSERVATION',
    eventTimestampUTC: '2026-09-08T12:00:00.000Z',
    notes: 'Saved offline',
    syncState: SYNC_STATE.VERIFY_PENDING,
    verifyAttemptCount: 2,
    verifyNextAttemptMs: 1788872400000,
    payload: { notes: 'Saved offline', options: { Station: 'A12' } },
    option_values: [{ event_option_name: 'Station', event_option_value: 'A12' }]
  };
  await put(EVENT_STORE, event);
  await closeDb();

  assert.deepEqual(await getAllEvents(), [event]);
  assert.deepEqual(await getEvent(event.localId), event);
  assert.deepEqual(await getAll(EVENT_STORE), [event]);
  assert.equal(await getEvent('missing'), null);
});

test('clearSyncedCachedEvents removes only synced rows', async () => {
  await put(EVENT_STORE, { localId: 'evt-1', client_uuid: 'evt-1', syncState: SYNC_STATE.SYNCED, payload: {}, option_values: [] });
  await put(EVENT_STORE, { localId: 'evt-2', client_uuid: 'evt-2', syncState: SYNC_STATE.UNSYNCED, payload: {}, option_values: [] });
  const removed = await clearSyncedCachedEvents();
  const remaining = await getAll(EVENT_STORE);
  assert.equal(removed, 1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].client_uuid, 'evt-2');
});

test('startup requeues interrupted POST and PATCH work without losing event data', async () => {
  const events = [
    { localId: 'post', syncState: SYNC_STATE.SYNCING, serverId: null },
    { localId: 'post-with-id', syncState: SYNC_STATE.SYNCING, serverId: 'server-1' },
    { localId: 'patch', syncState: SYNC_STATE.PATCHING, serverId: 'server-2' },
    { localId: 'verify', syncState: SYNC_STATE.VERIFY_PENDING, serverId: 'server-3' },
    { localId: 'synced', syncState: SYNC_STATE.SYNCED, serverId: 'server-4' }
  ].map((event) => ({
    ...event,
    client_uuid: event.localId,
    type: 'OBSERVATION',
    notes: 'Saved aboard ship',
    eventTimestampUTC: '2026-09-08T12:00:00.000Z',
    option_values: [],
    payload: { notes: 'Saved aboard ship', options: {} },
    attemptCount: 2,
    nextAttemptMs: 1788872400000,
    verifyAttemptCount: 1,
    verifyNextAttemptMs: 1788872405000,
    lastError: null
  }));
  for (const event of events) await put(EVENT_STORE, event);
  await closeDb();

  assert.equal(await recoverInterruptedSync(), 3);
  for (const original of events) {
    const recovered = await getEvent(original.localId);
    if (original.localId === 'verify' || original.localId === 'synced') {
      assert.deepEqual(recovered, original);
    } else {
      assert.deepEqual(recovered, {
        ...original,
        syncState: original.serverId ? SYNC_STATE.PATCH_PENDING : SYNC_STATE.UNSYNCED,
        nextAttemptMs: null
      });
    }
  }
  assert.equal(await recoverInterruptedSync(), 0);
});
