import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowBanner } from '../../update-banner.js';

test('no message version -> no banner', () => {
  assert.equal(shouldShowBanner('v1', undefined), false);
});

test('no current version -> banner shows on message version', () => {
  assert.equal(shouldShowBanner(undefined, 'v2'), true);
});

test('same version -> no banner', () => {
  assert.equal(shouldShowBanner('v3', 'v3'), false);
});

test('different version -> banner shows', () => {
  assert.equal(shouldShowBanner('v3', 'v4'), true);
});
