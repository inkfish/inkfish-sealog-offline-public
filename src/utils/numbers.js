/**
 * Numeric coercion and comparison helpers.
 * @module
 */

/**
 * Coerce a value to a finite number, returning null for anything
 * non-numeric (NaN, Infinity, non-numeric strings).
 * @param {*} value - String or number to coerce.
 * @returns {number|null} Finite number or null.
 */
export function toNumberOrNull(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? Number(num) : null;
}

/**
 * Compare two values for numeric equality with a small tolerance.
 *
 * Both-nullish returns true. One-nullish returns false.
 * Non-finite values return false. Tolerance is 1.5 * Number.EPSILON.
 * @param {*} a - First value to compare.
 * @param {*} b - Second value to compare.
 * @returns {boolean} True if both null/undefined or both finite and
 *   within tolerance.
 */
export function numbersEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(Number(a) - Number(b)) < Number.EPSILON * 1.5;
}
