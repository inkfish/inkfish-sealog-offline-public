/**
 * Local event identifier generation.
 * @module
 */

/**
 * Generate a 16-character base-36 local ID combining a time component
 * and a cryptographically-random component. Suitable for client-side
 * deduplication keys; the time prefix keeps IDs roughly sortable by
 * creation order, while the random portion uses crypto.getRandomValues
 * so it can't be predicted by an attacker who sees prior IDs.
 * @param {number} [now] - Epoch milliseconds for the time portion.
 * @returns {string} 16-character alphanumeric string.
 */
export function generateLocalId(now = Date.now()) {
  const nowPart = now.toString(36).slice(-8);
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // Combine two 32-bit values without exceeding JavaScript's 53-bit integer precision.
  const random = (buf[0] * 0x200000) + (buf[1] >>> 11);
  const randomPart = random.toString(36).slice(0, 8).padEnd(8, '0');
  return `${nowPart}${randomPart}`.slice(0, 16);
}
