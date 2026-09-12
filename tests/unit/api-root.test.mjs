import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeApiRoot,
  resolveApiRoot,
  buildAsnapVesselApiRootCandidates
} from '../../src/runtime/api-root.js';

test('uses stored value when available', () => {
  const value = computeApiRoot({ stored: 'https://example.com/base', defaultRoot: '/sealog-server' });
  assert.equal(value, 'https://example.com/base');
});

test('applies app path prefix to relative root', () => {
  const value = computeApiRoot({ stored: '/sealog-server', appPathPrefix: '/sealog-a', defaultRoot: '/sealog-server' });
  assert.equal(value, '/sealog-a/sealog-server');
});

test('handles protocol-relative URLs', () => {
  const value = computeApiRoot({ stored: '//example.test/sealog', locationProtocol: 'https:' });
  assert.equal(value, 'https://example.test/sealog');
});

test('normalizes bare hostname to http URL', () => {
  const value = computeApiRoot({ stored: '203.0.113.40:8000/sealog-server' });
  assert.equal(value, 'http://203.0.113.40:8000/sealog-server');
});

test('normalizes slash-prefixed ip roots to http URLs', () => {
  const value = computeApiRoot({ stored: '/203.0.113.40:8000/sealog-server' });
  assert.equal(value, 'http://203.0.113.40:8000/sealog-server');
});

test('resolveApiRoot reads from provided storage and window object', () => {
  const storage = { getItem: (key) => (key === 'apiRoot' ? 'https://override.example/sealog' : '') };
  const windowObject = { location: { protocol: 'https:' } };
  const resolved = resolveApiRoot({
    storage,
    windowObject,
    defaultRoot: '/sealog-server',
    appPathPrefix: '/sealog-a'
  });
  assert.equal(resolved, 'https://override.example/sealog');
});

test('buildAsnapVesselApiRootCandidates prioritizes the vessel-source route for relative roots', () => {
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: '/sealog-c/sealog-server',
    appPathPrefix: '/sealog-c'
  });
  assert.deepEqual(candidates, [
    '/sealog-a/sealog-server',
    '/sealog-c/sealog-server'
  ]);
});

test('buildAsnapVesselApiRootCandidates maps 8200 roots to 8000 roots', () => {
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: 'http://203.0.113.40:8200/sealog-server',
    appPathPrefix: '/sealog-c'
  });
  assert.deepEqual(candidates, [
    'http://203.0.113.40:8000/sealog-server',
    'http://203.0.113.40:8200/sealog-server'
  ]);
});

test('buildAsnapVesselApiRootCandidates maps 8300 roots to 8000 roots', () => {
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: 'http://203.0.113.50:8300/sealog-server',
    appPathPrefix: '/sealog-sub'
  });
  assert.deepEqual(candidates, [
    'http://203.0.113.50:8000/sealog-server',
    'http://203.0.113.50:8300/sealog-server'
  ]);
});

test('buildAsnapVesselApiRootCandidates maps 8400 roots to 8000 roots', () => {
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: 'http://203.0.113.60:8400/sealog-server',
    appPathPrefix: '/sealog-new'
  });
  assert.deepEqual(candidates, [
    'http://203.0.113.60:8000/sealog-server',
    'http://203.0.113.60:8400/sealog-server'
  ]);
});

test('buildAsnapVesselApiRootCandidates maps absolute prefixed path to the vessel-source route', () => {
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: 'https://203.0.113.44/sealog-c/sealog-server',
    appPathPrefix: '/sealog-c'
  });
  assert.deepEqual(candidates, [
    'https://203.0.113.44/sealog-a/sealog-server',
    'https://203.0.113.44/sealog-c/sealog-server'
  ]);
});

test('buildAsnapVesselApiRootCandidates keeps override first when provided', () => {
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: '/sealog-c/sealog-server',
    override: 'http://203.0.113.40:8000/sealog-server',
    appPathPrefix: '/sealog-c'
  });
  assert.deepEqual(candidates, [
    'http://203.0.113.40:8000/sealog-server',
    '/sealog-a/sealog-server',
    '/sealog-c/sealog-server'
  ]);
});

test('buildAsnapVesselApiRootCandidates preserves invalid absolute roots when parsing fails', () => {
  const invalidRoot = 'http://[::1';
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: invalidRoot,
    appPathPrefix: '/sealog-c'
  });
  assert.deepEqual(candidates, [invalidRoot]);
});

test('buildAsnapVesselApiRootCandidates preserves non-path relative roots unchanged', () => {
  const candidates = buildAsnapVesselApiRootCandidates({
    apiRoot: 'sealog-server'
  });
  assert.deepEqual(candidates, ['http://sealog-server']);
});

test('deployment prefixes preserve configured protocol-relative and IP hosts', () => {
  assert.equal(computeApiRoot({
    stored: '//example.test/sealog', locationProtocol: 'https:', appPathPrefix: '/sealog-c'
  }), 'https://example.test/sealog');
  assert.equal(computeApiRoot({
    stored: '/203.0.113.40:8000/sealog-server', appPathPrefix: '/sealog-c'
  }), 'http://203.0.113.40:8000/sealog-server');
});

test('an explicit vessel route remains intact across deployment prefixes', () => {
  assert.deepEqual(buildAsnapVesselApiRootCandidates({
    apiRoot: '/sealog-c/sealog-server',
    override: '/sealog-a/sealog-server',
    appPathPrefix: '/sealog-c'
  }), ['/sealog-a/sealog-server', '/sealog-c/sealog-server']);
});
