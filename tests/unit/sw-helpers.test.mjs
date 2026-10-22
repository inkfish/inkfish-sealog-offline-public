import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePath,
  buildCacheKeys,
  isNetworkFirstAssetPath,
  isAppShellResponse
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

test('isAppShellResponse accepts only a successful same-origin HTML entry response', () => {
  const response = ({ status = 200, type = 'basic', contentType = 'text/html; charset=utf-8' } = {}) => {
    const res = new Response('shell', { status, headers: contentType ? { 'Content-Type': contentType } : {} });
    Object.defineProperty(res, 'type', { value: type });
    return res;
  };
  assert.equal(isAppShellResponse('/index.html', response()), true);
  assert.equal(isAppShellResponse('/index.html', response({ contentType: 'Text/HTML' })), true);
  for (const path of ['/icons/icon-192.png', '/app.js', '/missing-route', '/index.html/', '', undefined]) {
    assert.equal(isAppShellResponse(path, response()), false);
  }
  for (const overrides of [
    { status: 203 }, { status: 404 }, { status: 503 },
    { type: 'opaqueredirect' }, { type: 'cors' }, { type: 'opaque' },
    { contentType: 'image/png' }, { contentType: 'application/javascript' },
    { contentType: 'text/htmlx' }, { contentType: null }
  ]) {
    assert.equal(isAppShellResponse('/index.html', response(overrides)), false);
  }
  assert.equal(isAppShellResponse('/index.html', undefined), false);
});
