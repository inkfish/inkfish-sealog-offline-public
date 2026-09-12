import test from 'node:test';
import assert from 'node:assert/strict';
import { earliestVerifyFrom, earliestRetryFrom } from '../../src/sync/scheduling.js';
import { SYNC_STATE } from '../../src/config/constants.js';

const NOW = 1_000_000;

test('earliestVerifyFrom returns the soonest future verify time', () => {
  const events = [
    { syncState: SYNC_STATE.VERIFY_PENDING, verifyNextAttemptMs: NOW + 5000 },
    { syncState: SYNC_STATE.VERIFY_PENDING, verifyNextAttemptMs: NOW + 2000 },
    { syncState: SYNC_STATE.VERIFY_PENDING, verifyNextAttemptMs: NOW - 1000 }, // past -> ignored
    { syncState: SYNC_STATE.SYNCED, verifyNextAttemptMs: NOW + 1 } // wrong state -> ignored
  ];
  assert.equal(earliestVerifyFrom(events, NOW), NOW + 2000);
});

test('earliestVerifyFrom returns null when nothing is pending in the future', () => {
  assert.equal(earliestVerifyFrom([], NOW), null);
  assert.equal(
    earliestVerifyFrom([{ syncState: SYNC_STATE.VERIFY_PENDING, verifyNextAttemptMs: NOW - 1 }], NOW),
    null
  );
});

test('earliestRetryFrom returns the soonest future retry among syncable events', () => {
  const events = [
    { syncState: SYNC_STATE.UNSYNCED, nextAttemptMs: NOW + 8000 },
    { syncState: SYNC_STATE.PATCH_PENDING, nextAttemptMs: NOW + 3000 },
    { syncState: SYNC_STATE.UNSYNCED, nextAttemptMs: NOW - 5 }, // past -> ignored
    { syncState: SYNC_STATE.VERIFY_PENDING, nextAttemptMs: NOW + 1 },
    { syncState: SYNC_STATE.SYNCED, nextAttemptMs: NOW + 1 } // synced -> not pending
  ];
  assert.equal(earliestRetryFrom(events, NOW), NOW + 3000);
});

test('earliestRetryFrom returns null when no pending event has a future retry', () => {
  assert.equal(earliestRetryFrom([], NOW), null);
});
