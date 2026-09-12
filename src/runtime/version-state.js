/**
 * Version display and mismatch detection for the service worker update UI.
 * @module
 */

/**
 * Extract the last path segment from a URL string.
 * @param {string} url - Script URL.
 * @returns {string} Last segment, or 'controller' if empty.
 */
function baseNameFromUrl(url) {
  if (!url || typeof url !== 'string') return 'controller';
  const parts = url.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'controller';
}

/**
 * Format a CACHE_VERSION value for display. Returns 'unknown' if falsy.
 * @param {string} cacheVersion - Raw cache version value.
 * @returns {string} Display-safe application version label.
 */
export function formatAppVersion(cacheVersion) {
  if (!cacheVersion) return 'unknown';
  return String(cacheVersion);
}

/**
 * Build a human-readable SW status label for display when the actual
 * version is not yet known. Returns 'unsupported', 'inactive',
 * 'active (awaiting version)', or '<state> (<script>)'.
 * @param {object} [options] - Current service worker controller state.
 * @param {boolean} [options.serviceWorkerSupported] - Whether the browser supports service workers.
 * @param {boolean} [options.hasController] - Whether a controller is currently active.
 * @param {string} [options.controllerState] - Current controller lifecycle state.
 * @param {string} [options.controllerScriptUrl] - Script URL for the active controller.
 * @returns {string} Fallback label shown until a version string is known.
 */
export function buildSwFallbackLabel({
  serviceWorkerSupported = true,
  hasController = false,
  controllerState = 'unknown',
  controllerScriptUrl = ''
} = {}) {
  if (!serviceWorkerSupported) return 'unsupported';
  if (!hasController) return 'inactive';
  if (controllerState === 'activated') return 'active (awaiting version)';
  return `${controllerState || 'unknown'} (${baseNameFromUrl(controllerScriptUrl)})`;
}

/**
 * Build the final display label for the service worker version.
 * Priority: updateReadyVersion (with ' (update ready)' suffix),
 * then knownVersion, then fallbackLabel.
 * @param {object} [options] - Known and pending service worker version values.
 * @param {string|null} [options.knownVersion] - Current active service worker version.
 * @param {string|null} [options.updateReadyVersion] - Pending service worker version awaiting reload.
 * @param {string} [options.fallbackLabel] - Fallback text when no version is known.
 * @returns {string} Service worker label shown in the UI.
 */
export function buildSwDisplayLabel({
  knownVersion = null,
  updateReadyVersion = null,
  fallbackLabel = 'unknown'
} = {}) {
  if (updateReadyVersion) {
    return `${updateReadyVersion} (update ready)`;
  }
  if (knownVersion) {
    return knownVersion;
  }
  return fallbackLabel || 'unknown';
}

/**
 * Determine whether to warn the user about a version mismatch between
 * the app JS and the active service worker. Returns true only when both
 * versions are known, differ, and no update is already pending.
 * @param {object} [options] - Version values to compare.
 * @param {string|null} [options.appVersion] - Current app/runtime version.
 * @param {string|null} [options.swVersion] - Current service worker version.
 * @param {string|null} [options.updateReadyVersion] - Pending worker version, if any.
 * @returns {boolean} True when the app and worker versions differ without a pending update.
 */
export function shouldWarnVersionMismatch({
  appVersion = null,
  swVersion = null,
  updateReadyVersion = null
} = {}) {
  if (!appVersion || !swVersion) return false;
  if (updateReadyVersion) return false;
  return String(appVersion) !== String(swVersion);
}
