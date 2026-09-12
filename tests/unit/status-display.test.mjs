import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncStatus } from '../../src/sync/status-display.js';
import { SYNC_STATE } from '../../src/config/constants.js';

const NOW = 1_000_000;

test('buildSyncStatus: synced renders relative time and server id', () => {
  const s = buildSyncStatus({ syncState: SYNC_STATE.SYNCED, lastSyncMs: NOW - 60000, serverId: 'srv1' }, NOW);
  assert.equal(s.label, 'Synced');
  assert.equal(s.icon, 'check-circle');
  assert.equal(s.className, 'status-synced');
  assert.equal(s.description, 'Synced 1m 0s ago (server srv1)');
});

test('buildSyncStatus: synced without a sync time falls back to a plain label', () => {
  assert.equal(buildSyncStatus({ syncState: SYNC_STATE.SYNCED }, NOW).description, 'Synced with Sealog');
});

test('buildSyncStatus: syncing/patching/patch-queued states', () => {
  assert.equal(buildSyncStatus({ syncState: SYNC_STATE.SYNCING }, NOW).label, 'Syncing');
  assert.equal(buildSyncStatus({ syncState: SYNC_STATE.PATCHING }, NOW).className, 'status-syncing');
  const q = buildSyncStatus({ syncState: SYNC_STATE.PATCH_PENDING, lastError: 'oops' }, NOW);
  assert.equal(q.label, 'Patch queued');
  assert.match(q.description, /oops/);
});

test('buildSyncStatus: verify-pending shows a retry countdown', () => {
  const s = buildSyncStatus({ syncState: SYNC_STATE.VERIFY_PENDING, verifyNextAttemptMs: NOW + 30000 }, NOW);
  assert.equal(s.label, 'Confirming');
  assert.match(s.description, /retry in 30s/);
});

test('buildSyncStatus: verify-failed and patch-failed are error states', () => {
  assert.equal(buildSyncStatus({ syncState: SYNC_STATE.VERIFY_FAILED }, NOW).className, 'status-error');
  const pf = buildSyncStatus({ syncState: SYNC_STATE.PATCH_FAILED, nextAttemptMs: NOW + 5000 }, NOW);
  assert.equal(pf.label, 'Patch failed');
  assert.match(pf.description, /retry in 5s/);
  assert.match(buildSyncStatus({ syncState: SYNC_STATE.PATCH_FAILED }, NOW).description, /ready to retry/);
});

test('buildSyncStatus: default branch is Queued (with retry) or Pending', () => {
  const queued = buildSyncStatus({ syncState: SYNC_STATE.UNSYNCED, nextAttemptMs: NOW + 10000 }, NOW);
  assert.equal(queued.label, 'Queued');
  assert.match(queued.description, /Retry in 10s/);
  assert.equal(buildSyncStatus({ syncState: SYNC_STATE.UNSYNCED }, NOW).label, 'Pending');
});
