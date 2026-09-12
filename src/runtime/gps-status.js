import { GPS_ACCURACY_THRESHOLD_M, STALE_FIX_MAX_MS } from '../config/constants.js';

/**
 * Decide whether a device GPS fix can be used for logging.
 * @param {object} options - GPS fix and logging policy inputs.
 * @param {object|null} options.fix - Coordinates and accuracy in `lat`, `lon`, and `acc_m`.
 * @param {number} options.timestampMs - Time the device measured the fix.
 * @param {number} [options.nowMs] - Current time, in milliseconds since the epoch.
 * @param {boolean} [options.allowPoorAccuracy] - Allow a known accuracy above the normal limit.
 * @returns {{allowed: boolean, reason: 'missing'|'stale'|'accuracy'|'unknown-accuracy'|null, warning: string|null}} The logging decision.
 */
export function evaluateGpsLoggingFix({
  fix,
  timestampMs,
  nowMs = Date.now(),
  allowPoorAccuracy = false
} = {}) {
  if (!fix || !Number.isFinite(fix.lat) || Math.abs(fix.lat) > 90 ||
      !Number.isFinite(fix.lon) || Math.abs(fix.lon) > 180) {
    return { allowed: false, reason: 'missing', warning: null };
  }
  if (!Number.isFinite(timestampMs) || timestampMs <= 0 ||
      !Number.isFinite(nowMs) || nowMs < timestampMs || nowMs - timestampMs > STALE_FIX_MAX_MS) {
    return { allowed: false, reason: 'stale', warning: null };
  }
  if (!Number.isFinite(fix.acc_m) || fix.acc_m < 0) {
    return { allowed: false, reason: 'unknown-accuracy', warning: null };
  }
  if (fix.acc_m > GPS_ACCURACY_THRESHOLD_M) {
    if (!allowPoorAccuracy) return { allowed: false, reason: 'accuracy', warning: null };
    return {
      allowed: true,
      reason: null,
      warning: `GPS accuracy is ±${fix.acc_m}m; this position may be unreliable.`
    };
  }
  return { allowed: true, reason: null, warning: null };
}

/**
 * Compute GPS tile display state/message with optional ASNAP backfill overlay.
 * @param {object} options - Inputs for the GPS status tile.
 * @param {'ok'|'warn'|'alert'|null} options.state - Base GPS status state.
 * @param {string} options.message - Base GPS status message.
 * @param {boolean} options.asnapBackfillEnabled - Whether ASNAP backfill is overriding phone GPS.
 * @returns {{state: string|null, message: string}} The display state and message to render.
 */
export function resolveGpsStatusDisplay({
  state = null,
  message = '',
  asnapBackfillEnabled = false
} = {}) {
  if (asnapBackfillEnabled) {
    // Preserve alert state (sensor failure, permission denied) so the crew
    // still sees that the local sensor died — otherwise toggling backfill off
    // would silently revert to broken GPS with no warning.
    if (state === 'alert') {
      const suffix = ' · backfill on';
      const baseMessage = message || 'GPS unavailable';
      return {
        state: 'alert',
        message: baseMessage.endsWith(suffix) ? baseMessage : `${baseMessage}${suffix}`
      };
    }
    return {
      state: 'warn',
      message: 'GPS backfill on (phone GPS ignored)'
    };
  }
  return {
    state,
    message
  };
}

/**
 * Map a geolocation error to a human-readable message.
 * @param {object|null} err - A GeolocationPositionError (with `code`/`message`), or null.
 * @returns {string} A short description of the failure.
 */
export function mapGeoError(err) {
  if (!err) return 'Unknown GPS error';
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission denied';
    case err.POSITION_UNAVAILABLE:
      return 'Unable to determine location';
    case err.TIMEOUT:
      return 'Timed out waiting for GPS';
    default:
      return err.message || 'Unknown GPS error';
  }
}
