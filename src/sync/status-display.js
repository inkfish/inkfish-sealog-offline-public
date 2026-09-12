/**
 * Build the user-facing sync-status descriptor (label, description, icon, class)
 * for an event, derived from its sync state.
 * @module
 */

import { SYNC_STATE } from '../config/constants.js';
import { formatDuration } from '../utils/time.js';

/**
 * Describe an event's sync state for display.
 * @param {object} event - Event record (reads syncState, lastError, serverId,
 *   lastSyncMs, verifyNextAttemptMs, nextAttemptMs).
 * @param {number} [now] - Reference epoch ms; defaults to Date.now().
 * @returns {{label: string, description: string, icon: string, className: string}}
 *   The status chip descriptor.
 */
export function buildSyncStatus(event, now = Date.now()) {
  const errorInfo = event.lastError ? ` — ${event.lastError}` : '';
  switch (event.syncState) {
    case SYNC_STATE.SYNCED: {
      const syncMs = event.lastSyncMs;
      const label = 'Synced';
      let description = 'Synced with Sealog';
      if (Number.isFinite(syncMs)) {
        description = `Synced ${formatDuration(now - syncMs)} ago`;
      }
      if (event.serverId) {
        description += ` (server ${event.serverId})`;
      }
      return { label, description, icon: 'check-circle', className: 'status-synced' };
    }
    case SYNC_STATE.SYNCING:
      return {
        label: 'Syncing',
        description: `Syncing${errorInfo}`,
        icon: 'arrows-clockwise',
        className: 'status-syncing'
      };
    case SYNC_STATE.PATCHING:
      return {
        label: 'Patching',
        description: `Patching on server${errorInfo}`,
        icon: 'arrows-clockwise',
        className: 'status-syncing'
      };
    case SYNC_STATE.PATCH_PENDING:
      return {
        label: 'Patch queued',
        description: `Queued patch — will sync when online${errorInfo}`,
        icon: 'pencil-simple',
        className: 'status-pending'
      };
    case SYNC_STATE.VERIFY_PENDING: {
      let description = 'Awaiting server confirmation';
      if (event.verifyNextAttemptMs && event.verifyNextAttemptMs > now) {
        description += ` — retry in ${formatDuration(event.verifyNextAttemptMs - now)}`;
      }
      return {
        label: 'Confirming',
        description,
        icon: 'hourglass-high',
        className: 'status-pending'
      };
    }
    case SYNC_STATE.VERIFY_FAILED:
      return {
        label: 'Verify stalled',
        description: event.lastError || 'Unable to confirm with server — review before re-posting.',
        icon: 'warning-circle',
        className: 'status-error'
      };
    case SYNC_STATE.PATCH_FAILED: {
      let description = 'Patch failed';
      if (event.nextAttemptMs && event.nextAttemptMs > now) {
        description += ` — retry in ${formatDuration(event.nextAttemptMs - now)}`;
      } else {
        description += ' — ready to retry';
      }
      if (event.lastError) {
        description += errorInfo;
      }
      return {
        label: 'Patch failed',
        description,
        icon: 'warning-circle',
        className: 'status-error'
      };
    }
    default: {
      if (event.nextAttemptMs && event.nextAttemptMs > now) {
        return {
          label: 'Queued',
          description: `Retry in ${formatDuration(event.nextAttemptMs - now)}${errorInfo}`,
          icon: 'hourglass-high',
          className: 'status-pending'
        };
      }
      return {
        label: 'Pending',
        description: `Awaiting sync${errorInfo}`,
        icon: 'hourglass-high',
        className: 'status-pending'
      };
    }
  }
}
