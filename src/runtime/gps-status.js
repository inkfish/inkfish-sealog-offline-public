import { GPS_ACCURACY_THRESHOLD_M, STALE_FIX_MAX_MS } from '../config/constants.js';
import { formatDuration } from '../utils/time.js';

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
 * Convert a Geolocation API position into a device GPS fix.
 * @param {object} position - A GeolocationPosition with `coords` and `timestamp`.
 * @param {number} [receivedAtMs] - Time the page received the position, in milliseconds since the epoch.
 * @returns {{lat: number, lon: number, acc_m: number, timestampMs: number}} The fix and its measurement time.
 */
export function fixFromPosition(position, receivedAtMs = Date.now()) {
  const { latitude, longitude, accuracy } = position.coords;
  // Location services can stamp fixes from GPS time, which may run ahead of an
  // unsynced device clock; a fix cannot have been measured after it arrived.
  return { lat: latitude, lon: longitude, acc_m: accuracy, timestampMs: Math.min(position.timestamp, receivedAtMs) };
}

/** Most GPS log entries kept on the device; about 16 hours at one GPS request a minute. */
export const GPS_LOG_LIMIT = 1000;

const GPS_LOG_RESULT_LABELS = Object.freeze({
  usable: 'usable',
  'poor-accuracy-allowed': 'usable (poor accuracy allowed)',
  missing: 'rejected: invalid position',
  stale: 'rejected: stale fix',
  accuracy: 'rejected: accuracy over limit',
  'unknown-accuracy': 'rejected: accuracy unknown'
});

function gpsLogResult(decision) {
  if (!decision) return undefined;
  if (!decision.allowed) return decision.reason;
  return decision.warning ? 'poor-accuracy-allowed' : 'usable';
}

/**
 * Build a GPS log entry for a position the device delivered.
 * The raw fix time is kept so the log shows any gap between it and the phone clock.
 * @param {object} options - Entry inputs.
 * @param {object} options.position - A GeolocationPosition with `coords` and `timestamp`.
 * @param {number} options.receivedAtMs - Phone clock time when the position arrived.
 * @param {string} options.trigger - What requested the fix, such as `warm-up`, `capture`, `edit`, or `ASNAP`.
 * @param {object} options.decision - The evaluateGpsLoggingFix result for the fix.
 * @returns {{at: number, trigger: string, fixTime: number, acc: number, result: string}} The log entry.
 */
export function gpsLogFixEntry({ position, receivedAtMs, trigger, decision }) {
  return {
    at: receivedAtMs,
    trigger,
    fixTime: position?.timestamp,
    acc: position?.coords?.accuracy,
    result: gpsLogResult(decision)
  };
}

/**
 * Build a GPS log entry for a failed position request.
 * @param {object} options - Entry inputs.
 * @param {object|null} options.error - The GeolocationPositionError.
 * @param {number} options.receivedAtMs - Phone clock time when the error arrived.
 * @param {string} options.trigger - What requested the fix.
 * @param {number} [options.savedFixAgeMs] - Age of the saved fix used instead, if any.
 * @param {object} [options.decision] - The evaluateGpsLoggingFix result for that saved fix.
 * @returns {object} The log entry.
 */
export function gpsLogErrorEntry({ error, receivedAtMs, trigger, savedFixAgeMs, decision }) {
  const entry = { at: receivedAtMs, trigger, error: mapGeoError(error) };
  if (Number.isFinite(savedFixAgeMs)) {
    entry.savedAge = savedFixAgeMs;
    entry.result = gpsLogResult(decision);
  }
  return entry;
}

/**
 * Append an entry, keeping only the newest entries.
 * @param {object[]} entries - Existing entries, oldest first.
 * @param {object} entry - Entry to add.
 * @param {number} [limit] - Maximum entries to keep.
 * @returns {object[]} A new array, oldest first.
 */
export function appendGpsLogEntry(entries, entry, limit = GPS_LOG_LIMIT) {
  return [...entries, entry].slice(-limit);
}

/**
 * Read a stored GPS log, dropping anything that is not an entry.
 * @param {string|null} raw - Stored JSON.
 * @returns {object[]} Entries, oldest first; empty when storage is missing or damaged.
 */
export function parseGpsLog(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry) => entry && typeof entry === 'object' && Number.isFinite(entry.at));
}

function formatLogSpan(ms) {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : formatDuration(ms);
}

/**
 * Format a GPS log entry as one line of text, with times in UTC.
 * @param {object} entry - Entry from gpsLogFixEntry or gpsLogErrorEntry.
 * @returns {string} The formatted line.
 */
export function formatGpsLogEntry(entry) {
  const at = Number.isFinite(entry.at)
    ? `${new Date(entry.at).toISOString().slice(0, 19).replace('T', ' ')}Z` : 'time unknown';
  const parts = [];
  if (entry.error) {
    let detail = `error: ${entry.error}`;
    if (Number.isFinite(entry.savedAge)) {
      detail += `; used saved fix from ${formatDuration(entry.savedAge)} ago`;
    }
    parts.push(detail);
  } else {
    parts.push(Number.isFinite(entry.acc) && entry.acc >= 0 ? `±${Math.round(entry.acc)}m` : 'accuracy unknown');
    const ageMs = entry.at - entry.fixTime;
    if (!Number.isFinite(ageMs)) parts.push('fix time missing');
    else if (ageMs < 0) parts.push(`fix time ${formatLogSpan(-ageMs)} ahead of phone clock`);
    else parts.push(`fix ${formatLogSpan(ageMs)} old`);
  }
  if (entry.result) parts.push(GPS_LOG_RESULT_LABELS[entry.result] || entry.result);
  return `${at} ${entry.trigger}: ${parts.join(', ')}`;
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
