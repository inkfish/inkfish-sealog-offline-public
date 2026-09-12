/**
 * Event sync-state transitions and predicates. Functions here mutate event
 * records in place to advance them through the sync lifecycle.
 * @module
 */

import { SYNC_STATE } from '../config/constants.js';
import { buildEventFreeText, syncEventPayload } from '../events/event-transform.js';
import { verificationBackoff } from './backoff.js';

/**
 * Transition an event to the SYNCED state. Clears error/retry fields, sets
 * sync timestamps, and rebuilds the payload via buildEventFreeText and
 * syncEventPayload.
 *
 * Mutates event in place.
 * @param {object} event - Event record to mutate.
 * @param {string|null} serverId - Server-assigned event ID.
 * @param {number} [timestampMs] - Sync completion time in ms.
 * @returns {void}
 */
export function markEventAsSynced(event, serverId, timestampMs = Date.now()) {
  if (!event) return;
  const resolvedId = serverId != null ? String(serverId) : null;
  if (resolvedId) {
    event.serverId = resolvedId;
  }
  event.syncState = SYNC_STATE.SYNCED;
  event.lastError = null;
  event.attemptCount = 0;
  event.nextAttemptMs = null;
  event.verifyAttemptCount = 0;
  event.verifyNextAttemptMs = null;
  event.lastSyncMs = timestampMs;
  event.lastSyncUTC = new Date(timestampMs).toISOString();
  event.updatedAtMs = timestampMs;
  event.updatedAtUTC = event.lastSyncUTC;
  const normalizedPayload = buildEventFreeText(event);
  event.payload = normalizedPayload;
  syncEventPayload(event);
}

/**
 * Transition an event to VERIFY_PENDING state and schedule the next
 * verification attempt using exponential backoff.
 *
 * Mutates event in place.
 * @param {object} event - Event record to mutate.
 * @param {object} [options] - Verification retry options for the next sync pass.
 * @param {string|null} [options.reason] - Error message stored in lastError.
 * @param {boolean} [options.resetAttempts] - Reset attempt counter to 0.
 * @returns {number|null} Scheduled next-attempt timestamp (ms since epoch),
 *   or null if event is falsy.
 */
export function markEventAsVerifyPending(event, { reason = null, resetAttempts = false } = {}) {
  if (!event) return null;
  event.syncState = SYNC_STATE.VERIFY_PENDING;
  event.nextAttemptMs = null;
  if (reason) {
    event.lastError = reason;
  }
  let attempts = Number(event.verifyAttemptCount ?? 0);
  if (!Number.isFinite(attempts) || resetAttempts) {
    attempts = 0;
  }
  event.verifyAttemptCount = attempts;
  const delay = verificationBackoff(attempts);
  const nextMs = Date.now() + delay;
  event.verifyNextAttemptMs = nextMs;
  return nextMs;
}

/**
 * Check if an event is in the SYNCED state.
 * @param {object} event - Event record to inspect.
 * @returns {boolean} True when the event is currently synced.
 */
export function isEventSynced(event) {
  return event?.syncState === SYNC_STATE.SYNCED;
}

/**
 * Check whether the local event has no assigned serverId. An accepted
 * upload can still lack this ID while awaiting server confirmation.
 * @param {object} event - Event record to inspect.
 * @returns {boolean} True when the event has not been assigned a server id.
 */
export function isEventLocal(event) {
  return !event?.serverId;
}

/**
 * Check if an event needs syncing (any state other than SYNCED).
 * Returns false for null/undefined events.
 * @param {object} event - Event record to inspect.
 * @returns {boolean} True when the event is not yet in the synced state.
 */
export function isEventPending(event) {
  if (!event) return false;
  return event.syncState !== SYNC_STATE.SYNCED;
}

/**
 * Check if an event is eligible for a sync attempt: UNSYNCED,
 * PATCH_PENDING, or PATCH_FAILED.
 * @param {object} event - Event record to inspect.
 * @returns {boolean} True when the event is in a state that can be synced.
 */
export function isEventSyncable(event) {
  if (!event) return false;
  return (
    event.syncState === SYNC_STATE.UNSYNCED ||
    event.syncState === SYNC_STATE.PATCH_PENDING ||
    event.syncState === SYNC_STATE.PATCH_FAILED
  );
}
