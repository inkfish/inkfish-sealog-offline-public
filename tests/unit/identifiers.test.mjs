import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLocalId } from '../../src/utils/identifiers.js';

test('generateLocalId produces 16 character identifier', () => {
  const id = generateLocalId(1234567890123);
  assert.equal(id.length, 16);
});

test('generateLocalId entropy changes with different seeds', () => {
  const first = generateLocalId(1700000000000);
  const second = generateLocalId(1700000000001);
  assert.notEqual(first, second);
});
