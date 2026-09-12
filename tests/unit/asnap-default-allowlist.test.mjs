import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('default ASNAP backfill allowlist seeds OBSERVATION and SCIENCE', async () => {
  const appPath = resolve(process.cwd(), 'app.js');
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /const ASNAP_BACKFILL_INITIAL_ALLOWLIST = \[\s*'OBSERVATION',\s*'SCIENCE'\s*\]\.join\('\\n'\);/m);
});
