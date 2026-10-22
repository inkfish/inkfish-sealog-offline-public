import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_VERSION } from '../../src/config/constants.js';

const ORIGIN = 'https://sealog.test';
const CACHE_NAME = `sealog-offline-${CACHE_VERSION}`;
let workerInstance = 0;

/**
 * Build a same-origin network response as the worker sees it.
 * @param {string} body - Response body.
 * @param {object} [init] - Response status and headers.
 * @returns {Response} A response whose type is 'basic'.
 */
function basicResponse(body, init = { status: 200 }) {
  const response = new Response(body, init);
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

/**
 * Run the actual worker with in-memory browser APIs, including its imports.
 * @param {object} t - Node test context.
 * @returns {Promise<object>} Worker handlers and observed cache operations.
 */
async function loadWorker(t) {
  const listeners = new Map();
  const entries = new Map();
  const deletedCaches = [];
  const broadcasts = [];
  const fetches = [];
  const installedRequests = [];
  let claimed = false;
  let skippedWaiting = false;
  let offline = false;
  const NativeRequest = globalThis.Request;
  const originals = new Map(['self', 'caches', 'fetch', 'Request'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const keyFor = (request) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
  const cache = {
    addAll: async (requests) => { installedRequests.push(...requests); },
    put: async (request, response) => { entries.set(keyFor(request), response); },
    match: async (request) => entries.get(keyFor(request))
  };
  globalThis.Request = class extends NativeRequest {
    constructor(input, options) {
      super(typeof input === 'string' ? new URL(input, ORIGIN) : input, options);
    }
  };
  globalThis.caches = {
    open: async (name) => {
      assert.equal(name, CACHE_NAME);
      return cache;
    },
    match: cache.match,
    keys: async () => [CACHE_NAME, 'sealog-offline-previous', 'unrelated-cache'],
    delete: async (name) => { deletedCaches.push(name); return true; }
  };
  let respond = () => basicResponse('current asset');
  globalThis.fetch = async (request) => {
    fetches.push(request);
    if (offline) throw new TypeError('Network unavailable');
    return respond(request);
  };
  globalThis.self = {
    location: { origin: ORIGIN },
    registration: { active: {} },
    clients: {
      matchAll: async () => [{ postMessage: (message) => broadcasts.push(message) }],
      claim: async () => { claimed = true; }
    },
    skipWaiting: async () => { skippedWaiting = true; },
    addEventListener: (name, handler) => { listeners.set(name, handler); }
  };
  await import(`../../sw.js?test=${workerInstance++}`);
  return {
    listeners, entries, deletedCaches, broadcasts, fetches, installedRequests,
    setOffline: () => { offline = true; },
    setNetworkResponse: (handler) => { respond = handler; },
    isClaimed: () => claimed,
    isSkippedWaiting: () => skippedWaiting
  };
}

test('worker fetches current app code without HTTP cache and serves it offline', async (t) => {
  const worker = await loadWorker(t);
  const request = new Request(`${ORIGIN}/sealog-a/src/runtime/version-state.js?v=current`);
  const dispatchFetch = () => {
    let response;
    worker.listeners.get('fetch')({ request, respondWith: (pending) => { response = pending; } });
    return response;
  };

  assert.equal(await (await dispatchFetch()).text(), 'current asset');
  assert.equal(worker.fetches[0].cache, 'no-store');
  assert.ok(worker.entries.has(`${ORIGIN}/src/runtime/version-state.js?v=current`));
  assert.ok(worker.entries.has(`${ORIGIN}/src/runtime/version-state.js`));

  worker.setOffline();
  assert.equal(await (await dispatchFetch()).text(), 'current asset');
  assert.equal(worker.fetches.length, 2);
});

test('worker precaches the deployed shell and activates an update without deleting unrelated caches', async (t) => {
  const worker = await loadWorker(t);
  let installed;
  worker.listeners.get('install')({ waitUntil: (pending) => { installed = pending; } });
  await installed;
  assert.ok(worker.isSkippedWaiting());
  assert.ok(worker.installedRequests.every((request) => request.cache === 'reload'));
  for (const prefix of ['', '/sealog-a', '/sealog-b', '/sealog-c']) {
    for (const asset of ['/index.html', '/src/sw/helpers.js', '/app.js']) {
      assert.ok(worker.installedRequests.some((request) => request.url === `${ORIGIN}${prefix}${asset}`));
    }
    assert.ok(worker.installedRequests.some((request) => new URL(request.url).pathname === `${prefix}/icons/phosphor-sprite.svg`));
  }
  let activated;
  worker.listeners.get('activate')({ waitUntil: (pending) => { activated = pending; } });
  await activated;
  assert.deepEqual(worker.deletedCaches, ['sealog-offline-previous']);
  assert.ok(worker.isClaimed());
  assert.deepEqual(worker.broadcasts, [
    { type: 'SW_STATE', version: CACHE_VERSION, isUpdate: true },
    { type: 'SW_UPDATE_READY', version: CACHE_VERSION, isUpdate: true }
  ]);
});

test('only a successful HTML entry navigation replaces the offline shell for every deployment', async (t) => {
  const worker = await loadWorker(t);
  const navigate = (path) => {
    let response;
    const request = { method: 'GET', mode: 'navigate', url: `${ORIGIN}${path}` };
    worker.listeners.get('fetch')({ request, respondWith: (pending) => { response = pending; } });
    return response;
  };
  const shellKeys = ['/index.html', ...['/sealog-a', '/sealog-b', '/sealog-c']
    .flatMap((prefix) => [`${prefix}/`, `${prefix}/index.html`])]
    .map((key) => `${ORIGIN}${key}`);
  const html = { 'Content-Type': 'text/html; charset=utf-8', 'X-Shell': 'current' };

  worker.setNetworkResponse(() => basicResponse('shell', { status: 200, headers: html }));
  await navigate('/sealog-b/');
  assert.deepEqual(shellKeys.map((key) => worker.entries.get(key)?.headers.get('X-Shell')), shellKeys.map(() => 'current'));
  const shell = new Map(shellKeys.map((key) => [key, worker.entries.get(key)]));

  for (const [path, status, headers] of [
    ['/sealog-a/icons/icon-192.png', 200, { 'Content-Type': 'image/png' }],
    ['/sealog-a/app.js', 200, { 'Content-Type': 'application/javascript' }],
    ['/sealog-a/missing-route', 404, { 'Content-Type': 'text/html' }],
    ['/sealog-c/', 503, { 'Content-Type': 'text/html' }]
  ]) {
    worker.setNetworkResponse(() => basicResponse('not the app', { status, headers }));
    const response = await navigate(path);
    assert.equal(response.status, status);
    assert.equal(await response.text(), 'not the app');
    for (const key of shellKeys) assert.equal(worker.entries.get(key), shell.get(key), `${path} replaced ${key}`);
  }

  worker.setOffline();
  for (const path of ['/sealog-a/', '/sealog-b/index.html', '/sealog-c/']) {
    assert.equal((await navigate(path)).headers.get('X-Shell'), 'current');
  }
});
