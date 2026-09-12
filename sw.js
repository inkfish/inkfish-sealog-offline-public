/**
 * Service worker entry point. Caches the app shell on install, clears old
 * caches on activate, and intercepts fetch requests with cache-first (static
 * assets) or network-first (JS source) strategies.
 */

import { normalizePath, buildCacheKeys, isNetworkFirstAssetPath } from './src/sw/helpers.js';

const CACHE_VERSION = 'v1.2.0.9';
/** @type {string} Full cache key combining the prefix and version. */
const CACHE_NAME = `sealog-offline-${CACHE_VERSION}`;
/** Example deployment path prefixes for nginx routing. */
const PATH_PREFIXES = ['/sealog-a', '/sealog-b', '/sealog-c'];

/** Root-relative paths for the app shell precache. */
const BASE_APP_SHELL = [
  '/index.html',
  '/app.js',
  '/update-banner.js',
  '/sw.js',
  '/src/sw/helpers.js',
  '/src/config/constants.js',
  '/src/utils/time.js',
  '/src/utils/numbers.js',
  '/src/utils/identifiers.js',
  '/src/utils/async.js',
  '/src/utils/strings.js',
  '/src/events/event-transform.js',
  '/src/events/store.js',
  '/src/runtime/api-root.js',
  '/src/runtime/event-accordion.js',
  '/src/runtime/gps-status.js',
  '/src/runtime/version-state.js',
  '/src/sync/asnap-backfill.js',
  '/src/sync/asnap-debug.js',
  '/src/sync/backoff.js',
  '/src/sync/state.js',
  '/src/sync/status-display.js',
  '/src/sync/scheduling.js',
  '/src/db/indexed-db.js',
  '/src/ui/dom-utils.js',
  '/src/ui/html-utils.js',
  '/src/templates/template-transform.js',
  '/src/templates/auto-fill-rules.js',
  '/manifest.webmanifest',
  '/favicon.ico?v=sealog-1',
  '/icons/favicon-32x32.png?v=sealog-1',
  '/icons/favicon-16x16.png?v=sealog-1',
  '/icons/phosphor-sprite.svg?v=2b75f3ad12b4',
  '/icons/phosphor-caret-down-light.svg?v=2b75f3ad12b4',
  '/icons/phosphor-caret-down-dark.svg?v=2b75f3ad12b4',
  '/icons/phosphor-caret-right.svg?v=2b75f3ad12b4',
  '/icons/phosphor-warning-circle.svg?v=2b75f3ad12b4',
  '/icons/icon-192.png?v=sealog-1',
  '/icons/icon-512.png?v=sealog-1',
  '/icons/apple-touch-icon.png?v=sealog-1'
];

/** Expanded app shell with prefix variants for all deployments. */
const APP_SHELL = Array.from(
  new Set([
    ...BASE_APP_SHELL,
    ...PATH_PREFIXES.flatMap((prefix) => {
      const items = [`${prefix}/`, `${prefix}/index.html`];
      BASE_APP_SHELL.forEach((path) => {
        if (path === '/') {
          items.push(`${prefix}/index.html`);
          return;
        }
        items.push(`${prefix}${path}`);
      });
      return items;
    })
  ])
);

/** Set during install if a previous version was active. Reset on activate. */
let isUpdate = false;

/**
 * Post a message to all open window clients. Swallows errors silently.
 * @param {string} type - Message type identifier.
 * @param {object} [payload] - Additional message fields.
 * @returns {Promise<void>}
 */
async function broadcast(type, payload = {}) {
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type, ...payload });
    }
  } catch {
    // swallow broadcast errors to avoid noisy logs
  }
}

/**
 * Install: cache the full app shell and call skipWaiting to activate
 * immediately. Detects whether this is a first install or an update.
 */
self.addEventListener('install', (event) => {
  isUpdate = !!self.registration.active;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // A new worker must not repopulate its cache from year-long HTTP icon caches.
      await cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

/**
 * Activate: delete old sealog-offline-* caches, claim all clients, and
 * broadcast SW_STATE (always) and SW_UPDATE_READY (on updates only).
 */
self.addEventListener('activate', (event) => {
  const updateTriggered = isUpdate;
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('sealog-offline-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      await broadcast('SW_STATE', { version: CACHE_VERSION, isUpdate: updateTriggered });
      if (updateTriggered) {
        await broadcast('SW_UPDATE_READY', { version: CACHE_VERSION, isUpdate: updateTriggered });
      }
      isUpdate = false;
    })()
  );
});

/**
 * Message handler: SKIP_WAITING forces activation. REQUEST_SW_STATE
 * replies with the current version.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'REQUEST_SW_STATE') {
    const payload = { type: 'SW_STATE', version: CACHE_VERSION, isUpdate: false };
    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage(payload);
    } else {
      broadcast('SW_STATE', { version: CACHE_VERSION, isUpdate: false });
    }
  }
});

/**
 * Handle a navigation request with network-first strategy. On success,
 * caches the response under all index.html variants. On failure, cascades
 * through cache candidates and returns a 503 as a last resort.
 * @param {Request} request - Original navigation request from the fetch event.
 * @param {string} normalizedPath - Normalized request pathname.
 * @param {URL} url - Parsed request URL used to derive cache fallbacks.
 * @returns {Promise<Response>} Fresh, cached, or synthetic offline response.
 */
async function handleNavigationRequest(request, normalizedPath, url) {
  try {
    const response = await fetch(request);
    if (!response || response.type === 'opaqueredirect') {
      return response;
    }
    const copy = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put('/index.html', copy.clone());
    await Promise.all(
      PATH_PREFIXES.map(async (prefix) => {
        await cache.put(`${prefix}/index.html`, copy.clone());
        await cache.put(`${prefix}/`, copy.clone());
      })
    );
    return response;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const candidates = [];
    candidates.push(request);
    if (normalizedPath) {
      candidates.push(normalizedPath);
    }
    if (url) {
      PATH_PREFIXES.forEach((prefix) => {
        if (url.pathname === prefix || url.pathname === `${prefix}/`) {
          candidates.push(`${prefix}/index.html`);
          candidates.push(`${prefix}/`);
        }
        if (url.pathname.startsWith(`${prefix}/`)) {
          candidates.push(`${prefix}/index.html`);
          candidates.push(`${prefix}/`);
        }
      });
    }
    candidates.push('/index.html');
    for (const key of candidates) {
      const match = await cache.match(key);
      if (match) return match;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Look up an asset in the cache by request and then by each cache key.
 * Optionally falls back to /index.html.
 * @param {Request} request - Original request used for the first cache lookup.
 * @param {string[]} cacheKeys - Alternate normalized cache keys to try next.
 * @param {boolean} [includeIndexFallback] - Whether to try `/index.html` last.
 * @returns {Promise<Response|undefined>} Cached response when found.
 */
async function readAssetFromCache(request, cacheKeys, includeIndexFallback = false) {
  let cached = await caches.match(request);
  for (let i = 0; !cached && i < cacheKeys.length; i += 1) {
    cached = await caches.match(cacheKeys[i]);
  }
  if (!cached && includeIndexFallback) {
    cached = await caches.match('/index.html');
  }
  return cached;
}

/**
 * Store a successful response in the cache under the request and all keys.
 * Only caches status-200 basic responses.
 * @param {Cache} cache - Cache instance opened for the active cache version.
 * @param {Request} request - Original request key for the cache entry.
 * @param {string[]} cacheKeys - Additional normalized keys for the same asset.
 * @param {Response} response - Network response candidate to store.
 * @returns {Promise<boolean>} True if the response was cached.
 */
async function cacheAssetResponse(cache, request, cacheKeys, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return false;
  }
  const copy = response.clone();
  await cache.put(request, copy.clone());
  await Promise.all(cacheKeys.map((key) => cache.put(key, copy.clone())));
  return true;
}

/**
 * Clone a request with cache: 'no-store' to bypass the HTTP cache.
 * @param {Request} request - Request to clone for a network-first fetch.
 * @returns {Request} Request configured to bypass the HTTP cache when possible.
 */
function buildNetworkFirstRequest(request) {
  try {
    return new Request(request, { cache: 'no-store' });
  } catch {
    return request;
  }
}

/**
 * Handle a static asset request with cache-first strategy. Returns the
 * cached response if available, otherwise fetches and caches. Falls back
 * to cache (including /index.html) on network failure.
 * @param {Request} request - Original asset request from the fetch event.
 * @param {string} normalizedPath - Normalized request pathname.
 * @param {string} search - Request query string preserved in cache keys.
 * @returns {Promise<Response>} Cached or freshly fetched asset response.
 */
async function handleCacheFirstAssetRequest(request, normalizedPath, search) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKeys = buildCacheKeys(normalizedPath, search);
  const cached = await readAssetFromCache(request, cacheKeys);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    await cacheAssetResponse(cache, request, cacheKeys, response);
    return response;
  } catch (error) {
    const fallback = await readAssetFromCache(request, cacheKeys, true);
    if (fallback) return fallback;
    throw error;
  }
}

/**
 * Handle a JS source asset request with network-first strategy. Fetches
 * with cache: 'no-store' and caches the response. Falls back to cache
 * on network failure.
 * @param {Request} request - Original source asset request from the fetch event.
 * @param {string} normalizedPath - Normalized request pathname.
 * @param {string} search - Request query string preserved in cache keys.
 * @returns {Promise<Response>} Network response or cached fallback response.
 */
async function handleNetworkFirstAssetRequest(request, normalizedPath, search) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKeys = buildCacheKeys(normalizedPath, search);
  try {
    const response = await fetch(buildNetworkFirstRequest(request));
    await cacheAssetResponse(cache, request, cacheKeys, response);
    return response;
  } catch (error) {
    const cached = await readAssetFromCache(request, cacheKeys);
    if (cached) return cached;
    throw error;
  }
}

/**
 * Fetch interceptor for same-origin GET requests. Ignores non-GET,
 * cross-origin, and /sealog-server/ API paths. Routes to navigation,
 * network-first, or cache-first handlers based on the request type
 * and path.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const normalizedPath = normalizePath(url.pathname, PATH_PREFIXES);
  if (normalizedPath.startsWith('/sealog-server/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request, normalizedPath, url));
    return;
  }

  if (isNetworkFirstAssetPath(normalizedPath)) {
    event.respondWith(handleNetworkFirstAssetRequest(request, normalizedPath, url.search));
    return;
  }

  event.respondWith(handleCacheFirstAssetRequest(request, normalizedPath, url.search));
});
