/**
 * Exponential backoff delay calculators for event sync and verification retries.
 * @module
 */

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  VERIFY_INITIAL_DELAY_MS,
  VERIFY_MAX_DELAY_MS
} from '../config/constants.js';

/**
 * Calculate the sync retry delay using exponential backoff.
 *
 * Formula: min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2^retries).
 * Range: 5 000 ms to 300 000 ms (5 s to 5 min).
 * @param {number} retries - Number of previous attempts (0-based).
 * @returns {number} Delay in milliseconds.
 */
export function exponentialBackoff(retries) {
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, retries)));
  return delay;
}

/**
 * Calculate the verification retry delay using exponential backoff.
 *
 * Formula: min(VERIFY_MAX_DELAY_MS, VERIFY_INITIAL_DELAY_MS * 2^attempts).
 * Range: 5 000 ms to 60 000 ms (5 s to 1 min).
 * @param {number} attempts - Number of previous verification attempts (0-based).
 * @returns {number} Delay in milliseconds.
 */
export function verificationBackoff(attempts) {
  const delay = Math.min(VERIFY_MAX_DELAY_MS, VERIFY_INITIAL_DELAY_MS * Math.pow(2, Math.max(0, attempts)));
  return delay;
}
