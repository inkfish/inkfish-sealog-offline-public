/**
 * Pure helpers for computing the next sync/verify wake-up time from a set of
 * events. The scheduling side effects (setTimeout) stay in the app shell.
 * @module
 */

import { SYNC_STATE } from '../config/constants.js';
import { isEventSyncable } from './state.js';

/**
 * Earliest future `verifyNextAttemptMs` among events awaiting verification.
 * @param {Array<object>} events - Event records.
 * @param {number} [now] - Reference epoch ms; defaults to Date.now().
 * @returns {number|null} The soonest future verify time, or null when none.
 */
export function earliestVerifyFrom(events, now = Date.now()) {
  const future = events
    .filter((event) =>
      event &&
      event.syncState === SYNC_STATE.VERIFY_PENDING &&
      event.verifyNextAttemptMs &&
      event.verifyNextAttemptMs > now
    )
    .map((event) => event.verifyNextAttemptMs);
  if (!future.length) return null;
  return future.reduce((min, v) => v < min ? v : min, Infinity);
}

/**
 * Earliest future `nextAttemptMs` among pending events awaiting a sync retry.
 * @param {Array<object>} events - Event records.
 * @param {number} [now] - Reference epoch ms; defaults to Date.now().
 * @returns {number|null} The soonest future retry time, or null when none.
 */
export function earliestRetryFrom(events, now = Date.now()) {
  const future = events
    .filter((event) => isEventSyncable(event) && event.nextAttemptMs && event.nextAttemptMs > now)
    .map((event) => event.nextAttemptMs);
  if (!future.length) return null;
  return future.reduce((min, v) => v < min ? v : min, Infinity);
}
