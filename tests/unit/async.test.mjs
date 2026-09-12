import test from 'node:test';
import assert from 'node:assert/strict';
import { sleep } from '../../src/utils/async.js';

test('sleep resolves immediately for non-positive or non-finite delays', async () => {
  await sleep(0);
  await sleep(-50);
  await sleep(NaN);
  await sleep(Infinity);
  assert.ok(true, 'all resolved without hanging');
});

test('sleep returns a promise that resolves after the delay', async () => {
  const start = process.hrtime.bigint();
  await sleep(20);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs >= 15, `expected >= ~20ms, got ${elapsedMs}`);
});
