import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLocalId, isSafeLocalId } from '../../src/utils/identifiers.js';

test('generateLocalId produces 16 character identifier', () => {
  const id = generateLocalId(1234567890123);
  assert.equal(id.length, 16);
});

test('generateLocalId entropy changes with different seeds', () => {
  const first = generateLocalId(1700000000000);
  const second = generateLocalId(1700000000001);
  assert.notEqual(first, second);
});

test('isSafeLocalId accepts every local ID format this app has generated', () => {
  for (const id of [
    generateLocalId(),
    '180043b8-a5e3-418c-b217-9465a38d372d',
    'evt-lx2k9f0a-4fzyo82b',
    'server-64f1c2a9e4b0a1b2c3d4e5f6',
    'server-note-1'
  ]) {
    assert.equal(isSafeLocalId(id), true, id);
  }
});

test('isSafeLocalId rejects markup, separators, empty, oversized, and non-string values', () => {
  for (const id of [
    'x"><img src=x onerror="alert(1)">', "a'b", 'a<b', 'a&b', 'a b', 'a.b', 'a/b', '^a$', 'é',
    '', 'a'.repeat(65), null, undefined, 42, {}
  ]) {
    assert.equal(isSafeLocalId(id), false, String(id));
  }
});
