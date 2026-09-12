import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markEventAsSynced,
  markEventAsVerifyPending,
  isEventSynced,
  isEventLocal,
  isEventPending,
  isEventSyncable
} from '../../src/sync/state.js';
import { SYNC_STATE } from '../../src/config/constants.js';

test('markEventAsSynced updates sync metadata and payload', () => {
  const event = {
    syncState: SYNC_STATE.UNSYNCED,
    payload: { notes: 'test', options: {} },
    option_values: [],
    localId: 'abc'
  };
  markEventAsSynced(event, 'server-1', 1700000000000);
  assert.equal(event.syncState, SYNC_STATE.SYNCED);
  assert.equal(event.serverId, 'server-1');
  assert.equal(event.lastError, null);
  assert.ok(event.payload);
  assert.equal(event.payload.client_uuid, 'abc');
});

test('markEventAsSynced tolerates null events and missing server ids', () => {
  assert.equal(markEventAsSynced(null, 'server-1'), undefined);

  const event = {
    syncState: SYNC_STATE.UNSYNCED,
    payload: {},
    option_values: [],
    localId: 'abc'
  };
  markEventAsSynced(event, null, 1700000000000);
  assert.equal(event.syncState, SYNC_STATE.SYNCED);
  assert.equal(event.serverId, undefined);
});

test('markEventAsVerifyPending sets state and schedules retry', () => {
  const event = { syncState: SYNC_STATE.UNSYNCED };
  const originalNow = Date.now;
  Date.now = () => 1700000001000;
  try {
    const nextMs = markEventAsVerifyPending(event, { reason: 'missing' });
    assert.equal(event.syncState, SYNC_STATE.VERIFY_PENDING);
    assert.equal(event.lastError, 'missing');
    assert.equal(event.verifyAttemptCount, 0);
    assert.equal(typeof nextMs, 'number');
    assert.ok(event.verifyNextAttemptMs >= 1700000001000);
  } finally {
    Date.now = originalNow;
  }
});

test('markEventAsVerifyPending resets invalid verify attempt counts', () => {
  const event = {
    syncState: SYNC_STATE.UNSYNCED,
    verifyAttemptCount: Number.NaN
  };
  const originalNow = Date.now;
  Date.now = () => 1700000010000;
  try {
    markEventAsVerifyPending(event, { resetAttempts: false });
    assert.equal(event.verifyAttemptCount, 0);
    assert.ok(event.verifyNextAttemptMs >= 1700000010000);
  } finally {
    Date.now = originalNow;
  }
});

test('markEventAsVerifyPending returns null for missing events and can reset attempts', () => {
  assert.equal(markEventAsVerifyPending(null), null);

  const event = {
    syncState: SYNC_STATE.UNSYNCED,
    verifyAttemptCount: 9
  };
  const originalNow = Date.now;
  Date.now = () => 1700000020000;
  try {
    const nextMs = markEventAsVerifyPending(event, { resetAttempts: true });
    assert.equal(event.verifyAttemptCount, 0);
    assert.equal(event.lastError, undefined);
    assert.equal(nextMs, event.verifyNextAttemptMs);
  } finally {
    Date.now = originalNow;
  }
});

test('sync state helpers reflect event state', () => {
  const syncedEvent = { syncState: SYNC_STATE.SYNCED, serverId: 'srv' };
  assert.equal(isEventSynced(syncedEvent), true);
  assert.equal(isEventLocal(syncedEvent), false);
  const local = { syncState: SYNC_STATE.UNSYNCED, serverId: null };
  assert.equal(isEventLocal(local), true);
  assert.equal(isEventPending(local), true);
  assert.equal(isEventSyncable(local), true);
  const verifyFailed = { syncState: SYNC_STATE.VERIFY_FAILED };
  assert.equal(isEventSyncable(verifyFailed), false);
  assert.equal(isEventPending(null), false);
  assert.equal(isEventSyncable(null), false);
});
