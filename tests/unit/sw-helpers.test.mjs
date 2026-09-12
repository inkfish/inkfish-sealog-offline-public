import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePath,
  buildCacheKeys,
  isNetworkFirstAssetPath
} from '../../src/sw/helpers.js';

const PREFIXES = ['/sealog-a', '/sealog-b'];

test('normalizePath maps root and prefixes to index', () => {
  assert.equal(normalizePath('/', PREFIXES), '/index.html');
  assert.equal(normalizePath('/sealog-a', PREFIXES), '/index.html');
  assert.equal(normalizePath('/sealog-a/', PREFIXES), '/index.html');
  assert.equal(normalizePath('/sealog-a/app.js', PREFIXES), '/app.js');
  assert.equal(normalizePath('/unmatched/path.js', PREFIXES), '/unmatched/path.js');
});

test('buildCacheKeys includes search variant', () => {
  const keys = buildCacheKeys('/app.js', '?v=1');
  assert.deepEqual(keys.sort(), ['/app.js', '/app.js?v=1'].sort());
  assert.deepEqual(buildCacheKeys('/index.html', '?v=1'), ['/index.html']);
  assert.deepEqual(buildCacheKeys('', '?v=1'), []);
});

test('isNetworkFirstAssetPath marks app code as network-first', () => {
  assert.equal(isNetworkFirstAssetPath('/app.js'), true);
  assert.equal(isNetworkFirstAssetPath('/update-banner.js'), true);
  assert.equal(isNetworkFirstAssetPath('/src/config/constants.js'), true);
  assert.equal(isNetworkFirstAssetPath('/src/runtime/version-state.js'), true);
  assert.equal(isNetworkFirstAssetPath('/icons/icon-192.png'), false);
  assert.equal(isNetworkFirstAssetPath('/manifest.webmanifest'), false);
});
