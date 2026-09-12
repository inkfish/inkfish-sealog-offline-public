/**
 * Service worker path normalization and caching strategy helpers.
 * @module
 */

/**
 * Strip a deployment path prefix from a URL pathname and normalize
 * root paths to '/index.html'.
 * @param {string} pathname - URL pathname (e.g. "/sealog-a/app.js").
 * @param {string[]} [prefixes] - Deployment prefixes to strip
 *   (e.g. ["/sealog-a", "/sealog-b"]).
 * @returns {string} Normalized path. Root and prefix-only paths return
 *   "/index.html". Sub-paths have the prefix stripped.
 */
export function normalizePath(pathname, prefixes = []) {
  if (!pathname || pathname === '/') {
    return '/index.html';
  }
  for (const prefix of prefixes) {
    if (pathname === prefix || pathname === `${prefix}/`) {
      return '/index.html';
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length);
    }
  }
  return pathname;
}

/**
 * Build an array of Cache API lookup keys for a normalized path.
 *
 * For '/index.html' returns a single key. For other paths returns both
 * the path-with-search and path-without-search variants.
 * @param {string} normalizedPath - Already normalized via normalizePath.
 * @param {string} [search] - URL search string including leading '?'.
 * @returns {string[]} Cache lookup keys (1-2 entries).
 */
export function buildCacheKeys(normalizedPath, search = '') {
  const keys = new Set();
  if (!normalizedPath) return Array.from(keys);
  if (normalizedPath === '/index.html') {
    keys.add('/index.html');
  } else {
    const withSearch = `${normalizedPath}${search}`;
    keys.add(withSearch);
    keys.add(normalizedPath);
  }
  return Array.from(keys);
}

/** Paths that bypass cache-first to get fresh code on reload. */
const NETWORK_FIRST_STATIC_PATHS = new Set([
  '/app.js',
  '/update-banner.js'
]);

/**
 * Determine whether a normalized path should use network-first caching.
 *
 * Returns true for paths in NETWORK_FIRST_STATIC_PATHS (/app.js,
 * /update-banner.js) and any .js or .mjs file under /src/.
 * @param {string} normalizedPath - Already normalized via normalizePath.
 * @returns {boolean} True when the path should bypass cache-first handling.
 */
export function isNetworkFirstAssetPath(normalizedPath) {
  if (!normalizedPath || typeof normalizedPath !== 'string') return false;
  if (NETWORK_FIRST_STATIC_PATHS.has(normalizedPath)) return true;
  if (!normalizedPath.startsWith('/src/')) return false;
  return normalizedPath.endsWith('.js') || normalizedPath.endsWith('.mjs');
}
