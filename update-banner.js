/**
 * Update banner decision logic for service worker version messages.
 * @module
 */

/**
 * Decide whether to surface the update banner for a service worker message.
 * Avoids re-notifying for the same version to keep the banner from sticking
 * around after a successful reload.
 * @param {string} currentVersion - Currently running app version (CACHE_VERSION).
 * @param {string} messageVersion - Version reported by the SW update message.
 * @param {string} lastNotifiedVersion - Version the user was last notified about.
 * @returns {boolean} True if the banner should be shown.
 */
export function shouldShowBanner(currentVersion, messageVersion, lastNotifiedVersion) {
  if (!messageVersion) return false;
  if (!currentVersion) return true;
  if (messageVersion === currentVersion) return false;
  if (lastNotifiedVersion && messageVersion === lastNotifiedVersion) return false;
  return true;
}
