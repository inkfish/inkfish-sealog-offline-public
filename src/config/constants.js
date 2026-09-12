/**
 * Application-wide constants: cache versioning, IndexedDB schema, sync states,
 * timing, ASNAP defaults, and UI config. Imported by nearly every module.
 * @module
 */

/** Semver-ish tag used as the Cache API key suffix and displayed as the app version. */
export const CACHE_VERSION = 'v1.2.0.9';

/** Options passed to navigator.geolocation.getCurrentPosition. Timeout 10 s. */
export const GEO_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
});

/** Maximum age of a GPS fix before it is considered stale (5 min, ms). */
export const STALE_FIX_MAX_MS = 5 * 60 * 1000;
/** Base delay for sync retry exponential backoff (5 s, ms). */
export const BACKOFF_BASE_MS = 5000;
/** Maximum delay for sync retry exponential backoff (5 min, ms). */
export const BACKOFF_MAX_MS = 5 * 60 * 1000;

/** IndexedDB database name. */
export const DB_NAME = 'sealog-offline';
/** IndexedDB schema version. Version 3 adds the templates store. */
export const DB_VERSION = 3;
/** Object store for captured events, keyed by client_uuid. */
export const EVENT_STORE = 'events';
/** Object store for housekeeping metadata, keyed by 'k'. */
export const META_STORE = 'meta';
/** Object store for cached server templates, keyed by 'id'. */
export const TEMPLATE_STORE = 'templates';

/** Default relative path to the Sealog server API, proxied through nginx. */
export const DEFAULT_API_ROOT = '/sealog-server';

/** Example deployment path segments for nginx routing (e.g. /sealog-a). */
const SUPPORTED_PATH_PREFIXES = Object.freeze(['sealog-a', 'sealog-b', 'sealog-c']);
/** Set variant of SUPPORTED_PATH_PREFIXES for O(1) lookup. */
export const SUPPORTED_PATH_PREFIX_SET = new Set(SUPPORTED_PATH_PREFIXES);

/** @type {string} Meta store key for last template sync timestamp. */
export const META_LAST_TEMPLATE_SYNC = 'lastTemplateSync';
/** @type {string} Meta store key for active cruise ID. */
export const META_CURRENT_CRUISE_ID = 'currentCruiseId';
/** @type {string} Meta store key for cruise start timestamp. */
export const META_CURRENT_CRUISE_START = 'currentCruiseStartUTC';
/** @type {string} Meta store key for cruise stop timestamp. */
export const META_CURRENT_CRUISE_STOP = 'currentCruiseStopUTC';

/** Debounce delay before rebuilding category/type selects (ms). */
export const SELECT_REBUILD_DELAY_MS = 240;

/** Interval between service worker update checks (5 min, ms). */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Finite state machine values for the event sync lifecycle. */
export const SYNC_STATE = Object.freeze({
  UNSYNCED: 'unsynced',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  VERIFY_PENDING: 'verify-pending',
  VERIFY_FAILED: 'verify-failed',
  PATCH_PENDING: 'patch-pending',
  PATCHING: 'patching',
  PATCH_FAILED: 'patch-failed'
});

/** UI filter tab identifiers for the event list. */
export const EVENT_FILTERS = Object.freeze({
  ALL: 'all',
  LOCAL: 'local',
  SYNCED: 'synced',
  PENDING: 'pending',
  ASNAP: 'asnap'
});

/**
 * Option name constants in two forms:
 * - _OPTION_NAME: canonical wire-format name sent to the server.
 * - _KEY: normalized lowercase key used for case-insensitive comparison.
 */
export const DEVICE_UTC_OPTION_NAME = 'device_utc';
export const DEVICE_ACCURACY_OPTION_NAME = 'device_accuracy';
export const CLIENT_UUID_OPTION_NAME = 'client_uuid';

export const DEVICE_UTC_KEY = 'device utc';
export const DEVICE_ACCURACY_KEY = 'device accuracy';
export const CLIENT_UUID_OPTION_KEY = 'client uuid';

/** Minimum pause between sequential sync POST/PATCH calls (ms). */
export const SYNC_EVENT_SPACING_MS = 150;
/** Initial delay before the first verification attempt (5 s, ms). */
export const VERIFY_INITIAL_DELAY_MS = 5000;
/** Maximum number of verification retries before giving up. */
export const VERIFY_MAX_ATTEMPTS = 6;
/** Cap on verification backoff delay (60 s, ms). */
export const VERIFY_MAX_DELAY_MS = 60 * 1000;

/**
 * ASNAP (Automatic Ship Navigation Acquisition Point) configuration.
 * Automated GPS snapshots captured at a user-configured interval.
 */
/** Event value string that identifies an ASNAP capture. */
export const ASNAP_EVENT_VALUE = 'ASNAP';
/** Default capture interval (5 min, ms). */
export const ASNAP_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** Minimum allowed capture interval (1 min, ms). */
export const ASNAP_MIN_INTERVAL_MS = 60 * 1000;
/** Maximum allowed capture interval (30 min, ms). */
export const ASNAP_MAX_INTERVAL_MS = 30 * 60 * 1000;
/** Default device GPS accuracy limit in metres; the poor-accuracy override relaxes this limit. */
export const GPS_ACCURACY_THRESHOLD_M = 50;
/** Delay after ASNAP capture before triggering a sync attempt (ms). */
export const ASNAP_SYNC_DELAY_MS = 250;

/** Background GPS warm-up ping interval while the app is foregrounded (60 s, ms). */
export const GPS_WARMUP_INTERVAL_MS = 60 * 1000;
