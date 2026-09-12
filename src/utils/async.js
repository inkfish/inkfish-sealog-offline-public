/**
 * Async timing helpers.
 * @module
 */

/**
 * Resolve after `ms` milliseconds. Non-finite or non-positive delays resolve
 * immediately on a microtask without scheduling a timer.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
