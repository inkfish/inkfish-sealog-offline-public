import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPostBody, buildPatchBody } from '../../src/events/event-transform.js';
import { markEventAsSynced, markEventAsVerifyPending, isEventSyncable } from '../../src/sync/state.js';
import { SYNC_STATE } from '../../src/config/constants.js';

test('a captured event can post, sync, edit, and await verification', () => {
  const record = {
    localId: 'evt-lifecycle',
    client_uuid: 'evt-lifecycle',
    type: 'TEST_EVENT',
    notes: 'initial',
    eventTimestampUTC: '2026-09-08T12:00:00.000Z',
    originalTimestampUTC: '2026-09-08T12:00:00.000Z',
    option_values: [],
    payload: {},
    syncState: SYNC_STATE.UNSYNCED,
    verifyAttemptCount: 0
  };
  assert.equal(record.syncState, SYNC_STATE.UNSYNCED);
  assert.ok(isEventSyncable(record));

  const postBody = buildPostBody({ ...record });
  assert.deepEqual(postBody, {
    event_value: 'TEST_EVENT',
    event_free_text: 'initial',
    ts: record.eventTimestampUTC,
    event_options: [{ event_option_name: 'client_uuid', event_option_value: record.localId }]
  });

  markEventAsSynced(record, 'server-123', 1700000000000);
  assert.equal(record.syncState, SYNC_STATE.SYNCED);
  assert.equal(record.serverId, 'server-123');

  record.notes = 'edited note';
  record.syncState = SYNC_STATE.PATCH_PENDING;
  const patchBody = buildPatchBody({ ...record });
  assert.equal(patchBody.event_free_text, 'edited note');
  assert.deepEqual(patchBody.event_options, postBody.event_options);

  const nextAttempt = markEventAsVerifyPending(record, { reason: 'verify' });
  assert.equal(record.syncState, SYNC_STATE.VERIFY_PENDING);
  assert.ok(nextAttempt > Date.now() - 1);
});
