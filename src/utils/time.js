/**
 * ISO 8601 UTC timestamp validation and date/duration display helpers.
 * @module
 */

/**
 * Return the current UTC time as an ISO 8601 string.
 * @returns {string} Timestamp ending with 'Z', e.g. "2025-01-01T00:00:00.000Z".
 */
export function nowUtc() {
  return new Date().toISOString();
}

/**
 * Coerce a timestamp value to an ISO 8601 string ending with 'Z'.
 *
 * Valid strings already ending in 'Z' retain their original formatting
 * after validation with the Date constructor.
 * Non-parseable values fall through to the fallback, then to nowUtc().
 * @param {string} value - Timestamp string to normalize.
 * @param {string} [fallback] - Used when value cannot be parsed. Falls back
 *   to nowUtc() when this also fails.
 * @returns {string} ISO 8601 string ending with 'Z'.
 */
export function ensureIsoString(value, fallback) {
  if (typeof value === 'string' && value.endsWith('Z')) {
    const check = new Date(value);
    if (!Number.isNaN(check.getTime())) return value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (fallback) return ensureIsoString(fallback, null) || nowUtc();
  return nowUtc();
}

/**
 * Validate and re-parse a user-supplied UTC timestamp.
 * @param {string} value - Must be a non-empty string ending with 'Z'.
 * @returns {string} Re-parsed ISO 8601 string.
 * @throws {Error} "UTC timestamp required" if value is not a string or is empty.
 * @throws {Error} "Timestamp must end with Z" if the trailing 'Z' is missing.
 * @throws {Error} "Invalid timestamp" if the Date constructor cannot parse it.
 */
export function normalizeUtcInput(value) {
  if (typeof value !== 'string') {
    throw new Error('UTC timestamp required');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('UTC timestamp required');
  }
  if (!trimmed.endsWith('Z')) {
    throw new Error('Timestamp must end with Z');
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid timestamp');
  }
  return parsed.toISOString();
}

/**
 * Try to parse any value into an ISO string. Returns null on failure.
 *
 * Falsy input (0, "", null, undefined) returns null immediately.
 * @param {*} value - Any value accepted by the Date constructor.
 * @returns {string|null} ISO 8601 string or null if unparseable.
 */
export function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Format a millisecond duration as a coarse minutes label.
 * @param {number} ms - Duration in milliseconds. Non-finite or <= 0 returns "0 min".
 * @returns {string} e.g. "1 min", "5 mins".
 */
export function formatMinutes(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 min';
  const minutes = Math.round(ms / 60000);
  if (minutes < 2) return `${minutes || 1} min`;
  return `${minutes} mins`;
}

/**
 * Format a millisecond duration as a compact hours/minutes/seconds string.
 * @param {number} ms - Duration in milliseconds. Non-finite or < 0 returns "0s".
 * @returns {string} e.g. "45s", "3m 5s", "2h 10m".
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rem = seconds - minutes * 60;
    return `${minutes}m ${rem}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes - hours * 60;
  return `${hours}h ${remMin}m`;
}

/**
 * Format an ISO timestamp as a UTC locale string (24-hour clock).
 * @param {string} iso - ISO 8601 timestamp.
 * @returns {string} Localized UTC date-time string.
 */
export function formatUtc(iso) {
  return new Date(iso).toLocaleString(undefined, { timeZone: 'UTC', hour12: false });
}

/**
 * Describe how long ago (or until) an ISO timestamp is, relative to `now`.
 * @param {string} iso - ISO 8601 timestamp. Falsy or unparseable returns "".
 * @param {number} [now] - Reference epoch ms; defaults to Date.now().
 * @returns {string} e.g. "just now", "5m 3s ago", "in 2m 0s".
 */
export function describeRelativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const diff = now - time;
  const abs = Math.abs(diff);
  if (abs < 1000) return 'just now';
  const duration = formatDuration(abs);
  if (!duration) return '';
  return diff >= 0 ? `${duration} ago` : `in ${duration}`;
}
