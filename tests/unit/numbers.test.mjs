import test from 'node:test';
import assert from 'node:assert/strict';
import { toNumberOrNull, numbersEqual } from '../../src/utils/numbers.js';

test('toNumberOrNull converts numeric strings', () => {
  assert.equal(toNumberOrNull('42'), 42);
  assert.equal(toNumberOrNull('abc'), null);
});

test('numbersEqual compares with epsilon tolerance', () => {
  assert.equal(numbersEqual(1, 1), true);
  assert.equal(numbersEqual(0.1 + 0.2, 0.3), true);
  assert.equal(numbersEqual(1, 2), false);
});

test('numbersEqual handles nullish and non-finite values', () => {
  assert.equal(numbersEqual(null, undefined), true);
  assert.equal(numbersEqual(null, 0), false);
  assert.equal(numbersEqual(Number.POSITIVE_INFINITY, 1), false);
  assert.equal(numbersEqual(1, Number.NaN), false);
});
