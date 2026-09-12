import test from 'node:test';
import assert from 'node:assert/strict';
import { exponentialBackoff, verificationBackoff } from '../../src/sync/backoff.js';
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, VERIFY_INITIAL_DELAY_MS, VERIFY_MAX_DELAY_MS } from '../../src/config/constants.js';

test('exponentialBackoff starts at BASE and doubles until cap', () => {
  const first = exponentialBackoff(0);
  const second = exponentialBackoff(1);
  const capped = exponentialBackoff(8);
  assert.equal(first, BACKOFF_BASE_MS);
  assert.equal(second, BACKOFF_BASE_MS * 2);
  assert.equal(capped, BACKOFF_MAX_MS);
});

test('verificationBackoff applies exponential delay with cap', () => {
  const first = verificationBackoff(0);
  const second = verificationBackoff(1);
  const capped = verificationBackoff(10);
  assert.equal(first, VERIFY_INITIAL_DELAY_MS);
  assert.equal(second, VERIFY_INITIAL_DELAY_MS * 2);
  assert.equal(capped, VERIFY_MAX_DELAY_MS);
});
