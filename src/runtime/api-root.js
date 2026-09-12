/**
 * Resolves the Sealog server API root URL from localStorage, a window global,
 * or a default. Handles path-prefix prepending and protocol inference for
 * bare IP addresses.
 * @module
 */

/**
 * Compute the API root URL from the given inputs.
 *
 * Priority: stored > windowRoot > defaultRoot.
 * - Local paths starting with '/' get appPathPrefix prepended unless
 * already under that prefix or an explicitly selected /sealog-* deployment.
 * - Bare IP address paths (e.g. /203.0.113.10:8000/api) are detected and
 * converted to http:// URLs.
 * - Protocol-relative URLs (//...) get locationProtocol prepended.
 * @param {object} options - Candidate API root inputs.
 * @param {string} [options.stored] - Value from localStorage 'apiRoot'.
 * @param {string} [options.windowRoot] - Value from window.API_ROOT.
 * @param {string} [options.defaultRoot] - Fallback default (e.g. '/sealog-server').
 * @param {string} [options.appPathPrefix] - Deployment prefix (e.g. '/sealog-a').
 * @param {string} [options.locationProtocol] - Current page protocol.
 * @returns {string} Resolved API root URL.
 */
export function computeApiRoot({
  stored = '',
  windowRoot = '',
  defaultRoot = '',
  appPathPrefix = '',
  locationProtocol = 'http:'
} = {}) {
  let root = (stored || windowRoot || defaultRoot || '').trim();
  if (!root) {
    root = defaultRoot || '';
  }
  root = root.replace(/\/$/, '');
  const lower = root.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return root;
  }
  if (root.startsWith('//')) {
    return `${locationProtocol || 'http:'}${root}`;
  }
  if (root.startsWith('/')) {
    const ipMatch = root.match(/^\/(\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)(\/.*)?$/);
    if (ipMatch) {
      const [, host, path = ''] = ipMatch;
      return `http://${host}${path}`;
    }
    const prefix = appPathPrefix || '';
    if (prefix && !root.startsWith(`${prefix}/`) && !/^\/sealog-(?!server(?:\/|$))[^/]+(?:\/|$)/i.test(root)) {
      return `${prefix}/${root.replace(/^\/+/, '')}`;
    }
    return root;
  }
  if (!root) {
    return defaultRoot || '';
  }
  return `http://${root}`;
}

/**
 * Resolve the API root from a storage object and window context. Reads
 * 'apiRoot' from storage and API_ROOT from the window object, then
 * delegates to computeApiRoot.
 * @param {object} [options] - Resolution inputs from browser state.
 * @param {Storage} [options.storage] - localStorage-like object.
 * @param {Window} [options.windowObject] - Window object with API_ROOT
 *   and location.protocol.
 * @param {string} [options.defaultRoot] - Fallback default.
 * @param {string} [options.appPathPrefix] - Deployment prefix.
 * @returns {string} Resolved API root URL.
 */
export function resolveApiRoot({
  storage,
  windowObject,
  defaultRoot = '',
  appPathPrefix = ''
} = {}) {
  const stored = typeof storage?.getItem === 'function' ? (storage.getItem('apiRoot') || '').trim() : '';
  const windowRoot =
    windowObject && typeof windowObject.API_ROOT === 'string' ? windowObject.API_ROOT.trim() : '';
  const protocol =
    windowObject && windowObject.location && typeof windowObject.location.protocol === 'string'
      ? windowObject.location.protocol
      : 'http:';
  return computeApiRoot({
    stored,
    windowRoot,
    defaultRoot,
    appPathPrefix,
    locationProtocol: protocol
  });
}

/**
 * Build ordered candidates for cruise-level ASNAP vesselPosition API lookups.
 *
 * Priority:
 * 1. Explicit override (if provided)
 * 2. Current API root mapped to the example vessel source (Deployment A / port 8000)
 * 3. Current API root as a fallback
 * @param {object} options - Inputs used to derive vessel API root candidates.
 * @param {string} [options.apiRoot] - Base API root.
 * @param {string} [options.override] - Explicit vessel API root override.
 * @param {string} [options.appPathPrefix] - Deployment prefix.
 * @param {string} [options.locationProtocol] - Current protocol.
 * @returns {string[]} Ordered unique root candidates.
 */
export function buildAsnapVesselApiRootCandidates({
  apiRoot = '',
  override = '',
  appPathPrefix = '',
  locationProtocol = 'http:'
} = {}) {
  const normalizedBase = computeApiRoot({
    stored: apiRoot,
    windowRoot: '',
    defaultRoot: apiRoot || '/sealog-server',
    appPathPrefix,
    locationProtocol
  }).replace(/\/$/, '');
  const normalizedOverride = computeApiRoot({
    stored: override,
    windowRoot: '',
    defaultRoot: '',
    appPathPrefix,
    locationProtocol
  }).replace(/\/$/, '');
  const mapVesselSourcePath = (pathname) => {
    if (typeof pathname !== 'string') return pathname;
    return pathname.replace(
      /^\/sealog-[^/]+\/sealog-server(\/.*)?$/i,
      '/sealog-a/sealog-server$1'
    );
  };
  const deriveVesselSourcePathRoot = (root) => {
    if (!root) return '';
    if (/^https?:\/\//i.test(root)) {
      try {
        const parsed = new URL(root);
        parsed.pathname = mapVesselSourcePath(parsed.pathname);
        return parsed.toString().replace(/\/$/, '');
      } catch {
        return root;
      }
    }
    if (root.startsWith('/')) {
      return mapVesselSourcePath(root).replace(/\/$/, '');
    }
    return root;
  };
  const deriveVesselPortRoot = (root) => {
    if (!root) return '';
    try {
      const parsed = new URL(root, 'http://localhost');
      const isAbsolute = /^https?:\/\//i.test(root);
      if (!isAbsolute) {
        return root;
      }
      const portNumber = Number.parseInt(parsed.port, 10);
      const activePort = Number.isFinite(portNumber) && portNumber >= 8100 && portNumber < 9000;
      if (activePort) {
        parsed.port = '8000';
      }
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return root;
    }
  };
  const vesselSourcePathBase = deriveVesselSourcePathRoot(normalizedBase);
  const mappedVesselSourcePathBase = deriveVesselPortRoot(vesselSourcePathBase);
  const mappedBase = deriveVesselPortRoot(normalizedBase);

  /** @type {string[]} */
  const candidates = [];
  const seen = new Set();
  const pushUnique = (value) => {
    const trimmed = typeof value === 'string' ? value.trim().replace(/\/$/, '') : '';
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  if (normalizedOverride) {
    pushUnique(normalizedOverride);
  }
  if (vesselSourcePathBase && vesselSourcePathBase !== normalizedBase) {
    pushUnique(vesselSourcePathBase);
  }
  if (mappedVesselSourcePathBase && mappedVesselSourcePathBase !== vesselSourcePathBase) {
    pushUnique(mappedVesselSourcePathBase);
  }
  pushUnique(mappedBase);
  pushUnique(normalizedBase);

  return candidates;
}
