import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateText } from '../../src/utils/strings.js';

test('truncateText returns "" for falsy or blank input', () => {
  assert.equal(truncateText(''), '');
  assert.equal(truncateText(null), '');
  assert.equal(truncateText(undefined), '');
  assert.equal(truncateText('   '), '');
});

test('truncateText trims and passes through short text unchanged', () => {
  assert.equal(truncateText('  hello  '), 'hello');
  assert.equal(truncateText('hello', 5), 'hello');
});

test('truncateText clamps long text to max chars with an ellipsis', () => {
  assert.equal(truncateText('abcdef', 3), 'ab…');
  assert.equal(truncateText('the quick brown fox', 10), 'the quick…');
});

test('truncateText coerces non-strings before truncating', () => {
  assert.equal(truncateText(12345, 3), '12…');
});
