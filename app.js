import { shouldShowBanner } from './update-banner.js';
import {
  CACHE_VERSION,
  GEO_OPTIONS,
  STALE_FIX_MAX_MS,
  BACKOFF_BASE_MS,
  EVENT_STORE,
  META_STORE,
  TEMPLATE_STORE,
  DEFAULT_API_ROOT,
  SUPPORTED_PATH_PREFIX_SET,
  META_LAST_TEMPLATE_SYNC,
  META_CURRENT_CRUISE_ID,
  META_CURRENT_CRUISE_START,
  META_CURRENT_CRUISE_STOP,
  SELECT_REBUILD_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  SYNC_STATE,
  EVENT_FILTERS,
  DEVICE_UTC_OPTION_NAME,
  DEVICE_ACCURACY_OPTION_NAME,
  DEVICE_UTC_KEY,
  DEVICE_ACCURACY_KEY,
  CLIENT_UUID_OPTION_KEY,
  SYNC_EVENT_SPACING_MS,
  VERIFY_MAX_ATTEMPTS,
  ASNAP_EVENT_VALUE,
  ASNAP_DEFAULT_INTERVAL_MS,
  ASNAP_MIN_INTERVAL_MS,
  ASNAP_MAX_INTERVAL_MS,
  GPS_ACCURACY_THRESHOLD_M,
  ASNAP_SYNC_DELAY_MS,
  GPS_WARMUP_INTERVAL_MS
} from './src/config/constants.js';
import { nowUtc, ensureIsoString, normalizeUtcInput, toIsoOrNull, formatMinutes, formatDuration, formatUtc, describeRelativeTime } from './src/utils/time.js';
import { toNumberOrNull, numbersEqual } from './src/utils/numbers.js';
import { generateLocalId } from './src/utils/identifiers.js';
import { sleep } from './src/utils/async.js';
import { truncateText } from './src/utils/strings.js';
import {
  normalizeOptionKey,
  normalizeOptionValues,
  formatOptionLabel,
  findOptionValue,
  findOptionValueByRegex,
  firstDisplayOption,
  optionMapFromArray,
  buildEventFreeText,
  buildEventAuxDataPayload,
  buildPostBody,
  buildPatchBody,
  syncEventPayload,
  isAsnapEvent,
  extractServerEventId,
  buildNormalizedOptionMap,
  findOptionNameByNormalizedKey,
  buildEventAuxUploadPayload
} from './src/events/event-transform.js';
import { exponentialBackoff } from './src/sync/backoff.js';
import { buildSyncStatus } from './src/sync/status-display.js';
import { earliestVerifyFrom, earliestRetryFrom } from './src/sync/scheduling.js';
import {
  markEventAsSynced,
  markEventAsVerifyPending,
  isEventSynced,
  isEventLocal,
  isEventPending,
  isEventSyncable
} from './src/sync/state.js';
import {
  parseBackfillAllowlist,
  eventMatchesBackfillAllowlist,
  hasRequiredBackfilledPositionAux,
  buildAsnapPointsFromAuxData,
  buildAsnapPointsFromByLoweringEvents,
  buildEventTimestampIndex,
  resolveInterpolatedAsnapPositionFromPoints,
  selectCurrentLowering,
  applyBackfilledCoordinatesToEvent,
  buildVesselPointsFromEventPoints,
  mergeAsnapPointSets
} from './src/sync/asnap-backfill.js';
import {
  buildAsnapBackfillDebugEndpoint,
  buildAsnapBackfillDebugSignature,
  trimAsnapBackfillSnapshotForServer
} from './src/sync/asnap-debug.js';
import {
  formatAppVersion,
  buildSwFallbackLabel,
  buildSwDisplayLabel,
  shouldWarnVersionMismatch
} from './src/runtime/version-state.js';
import { resolveGpsStatusDisplay, mapGeoError, evaluateGpsLoggingFix } from './src/runtime/gps-status.js';
import {
  resolveApiRoot as resolveApiRootUtil,
  buildAsnapVesselApiRootCandidates as buildAsnapVesselApiRootCandidatesUtil
} from './src/runtime/api-root.js';
import { findSummaryButtonFromTarget, toggleEventCardExpanded } from './src/runtime/event-accordion.js';
import { hideElement, showElement } from './src/ui/dom-utils.js';
import { escapeHtml, renderPhosphorIcon } from './src/ui/html-utils.js';
import {
  uniqueCategories,
  filterTemplatesByCategory,
  formatCategoryLabel,
  normalizeTemplate,
  hasCustomCoordinateOption,
  hasDeviceAccuracyOption,
  coordinateFromOptionMap
} from './src/templates/template-transform.js';
import { storeTransaction, getAll, get, put, putMany, del } from './src/db/indexed-db.js';
import {
  getAllEvents,
  getEvent,
  clearSyncedCachedEvents,
  recoverInterruptedSync
} from './src/events/store.js';
import {
  loadAutoFillRules,
  saveAutoFillRules,
  findTemplateEntry,
  applySourceValue,
  shouldApplyRule,
  classifyAutoType,
  describeAutoFillSource,
  autoFillSourceHintForOption,
  autoFillSourceOptionsHtml
} from './src/templates/auto-fill-rules.js';
const appPathPrefix = (() => {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const candidate = segments[0] || '';
  if (SUPPORTED_PATH_PREFIX_SET.has(candidate)) {
    return `/${candidate}`;
  }
  return '';
})();
let verifyInFlight = false;
let scheduledVerifyTimer = null;
const UTC_SUMMARY_FORMATTER = new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
const FALLBACK_TEMPLATES = [
  { id: 'fallback-ctd-start', event_name: 'CTD Start', event_value: 'CTD_START', template_categories: ['general'], event_options: [] },
  { id: 'fallback-ctd-bottom', event_name: 'CTD Bottom', event_value: 'CTD_BOTTOM', template_categories: ['general'], event_options: [] },
  { id: 'fallback-ctd-end', event_name: 'CTD End', event_value: 'CTD_END', template_categories: ['general'], event_options: [] },
  { id: 'fallback-sample', event_name: 'Sample Taken', event_value: 'SAMPLE_TAKEN', template_categories: ['general'], event_options: [] },
  { id: 'fallback-note', event_name: 'Freeform Note', event_value: 'NOTE', template_categories: ['general'], event_options: [] },
  {
    id: 'fallback-note-gps',
    event_name: 'Freeform Note (GPS)',
    event_value: 'NOTE_GPS',
    template_categories: ['general'],
    event_options: [
      {
        event_option_name: 'Latitude',
        event_option_label: 'Latitude',
        event_option_type: 'text',
        event_option_required: true
      },
      {
        event_option_name: 'Longitude',
        event_option_label: 'Longitude',
        event_option_type: 'text',
        event_option_required: true
      },
      {
        event_option_name: 'Device Accuracy (m)',
        event_option_label: 'Device Accuracy (m)',
        event_option_type: 'text',
        event_option_required: false
      }
    ]
  }
];

const userEl = document.getElementById('user');
const dom = {
  authStatus: document.getElementById('authStatus'),
  connectStatus: document.getElementById('connectStatus'),
  gpsStatus: document.getElementById('gpsStatus'),
  queueInfo: document.getElementById('queueInfo'),
  user: userEl,
  pass: document.getElementById('pass'),
  loginBtn: document.getElementById('loginBtn'),
  guestBtn: document.getElementById('guestBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  authSummary: document.getElementById('authSummary'),
  menuBtn: document.getElementById('menuBtn'),
  authPanel: document.getElementById('authPanel'),
  authCloseBtn: document.getElementById('authCloseBtn'),
  loginFields: document.getElementById('loginFields'),
  loginActions: document.getElementById('loginActions'),
  passwordField: document.getElementById('passwordField'),
  userField: userEl ? userEl.closest('label') : null,
  signedInActions: document.getElementById('signedInActions'),
  signedInAvatar: document.getElementById('signedInAvatar'),
  signedInUser: document.getElementById('signedInUser'),
  signedInMeta: document.getElementById('signedInMeta'),
  refreshTemplatesBtn: document.getElementById('refreshTemplatesBtn'),
  versionTag: document.getElementById('versionTag'),
  swVersionTag: document.getElementById('swVersionTag'),
  captureBtn: document.getElementById('captureBtn'),
  notes: document.getElementById('notes'),
  type: null,
  fixSummary: document.getElementById('fixSummary'),
  fixAge: document.getElementById('fixAge'),
  fixWarning: document.getElementById('fixWarning'),
  fixWarningAnnounce: document.getElementById('fixWarningAnnounce'),
  gpsLoggingWarning: document.getElementById('gpsLoggingWarning'),
  gpsLoggingPolicyWarning: document.getElementById('gpsLoggingPolicyWarning'),
  eventEditorGpsWarning: document.getElementById('eventEditorGpsWarning'),
  syncBtn: document.getElementById('syncBtn'),
  exportBtn: document.getElementById('exportBtn'),
  syncStatus: document.getElementById('syncStatus'),
  list: document.getElementById('list'),
  emptyState: document.getElementById('emptyState'),
  updateBanner: document.getElementById('updateBanner'),
  reloadBtn: document.getElementById('reloadBtn'),
  bannerText: document.getElementById('updateBannerText'),
  updateDismissBtn: document.getElementById('updateDismissBtn'),
  categorySelect: null,
  categoryLabel: document.getElementById('categoryLabel'),
  categoryField: document.getElementById('categoryField'),
  categoryMount: document.getElementById('categorySelectMount'),
  typeMount: document.getElementById('typeSelectMount'),
  optionFields: document.getElementById('optionFields'),
  clearSyncedBtn: document.getElementById('clearSyncedBtn'),
  loadServerEventsBtn: document.getElementById('loadServerEventsBtn'),
  asnapEnableToggle: document.getElementById('asnapEnableToggle'),
  asnapShowToggle: document.getElementById('asnapShowToggle'),
  gpsAllowPoorToggle: document.getElementById('gpsAllowPoorToggle'),
  asnapIntervalSelect: document.getElementById('asnapIntervalSelect'),
  asnapBackfillToggle: document.getElementById('asnapBackfillToggle'),
  asnapBackfillAllowlist: document.getElementById('asnapBackfillAllowlist'),
  asnapStatus: document.getElementById('asnapStatus'),
  backfillStatus: document.getElementById('backfillStatus'),
  eventFilterBar: document.getElementById('eventFilterBar'),
  confirmModal: document.getElementById('confirmModal'),
  confirmModalTitle: document.getElementById('confirmModalTitle'),
  confirmModalMessage: document.getElementById('confirmModalMessage'),
  confirmModalConfirm: document.getElementById('confirmModalConfirm'),
  confirmModalCancel: document.getElementById('confirmModalCancel'),
  eventEditor: document.getElementById('eventEditor'),
  eventEditorForm: document.getElementById('eventEditorForm'),
  eventEditorTimestamp: document.getElementById('eventEditorTimestamp'),
  eventEditorTimestampError: document.getElementById('eventEditorTimestampError'),
  eventEditorNotes: document.getElementById('eventEditorNotes'),
  eventEditorLat: document.getElementById('eventEditorLat'),
  eventEditorLon: document.getElementById('eventEditorLon'),
  eventEditorAcc: document.getElementById('eventEditorAcc'),
  eventEditorOptions: document.getElementById('eventEditorOptions'),
  eventEditorCancel: document.getElementById('eventEditorCancel'),
  autoFillRulesBtn: document.getElementById('autoFillRulesBtn'),
  autoFillRulesSummary: document.getElementById('autoFillRulesSummary'),
  autoFillRulesModal: document.getElementById('autoFillRulesModal'),
  autoFillRulesModalCloseBtn: document.getElementById('autoFillRulesModalCloseBtn'),
  autoFillTemplateSelect: document.getElementById('autoFillTemplateSelect'),
  autoFillStaleNotice: document.getElementById('autoFillStaleNotice'),
  autoFillFieldTableBody: document.getElementById('autoFillFieldTableBody'),
  autoFillFieldTableEmpty: document.getElementById('autoFillFieldTableEmpty'),
  autoFillRulesSaveBtn: document.getElementById('autoFillRulesSaveBtn'),
  autoFillRulesCancelBtn: document.getElementById('autoFillRulesCancelBtn'),
};

const filterChips = Array.from(dom.eventFilterBar?.querySelectorAll('.filter-chip') || []);
const defaultEmptyStateMessage = dom.emptyState?.textContent || '';

let lastFix = null;
let lastFixMessage = '';
let syncInFlight = false;
let startupComplete = false;
let scheduledSyncTimer = null;
let swRegistration;
let lastBannerVersion = null;
let lastKnownSwVersion = null;
let updateReadySwVersion = null;
let swMismatchWarned = false;
let authPanelOpen = false;
let authPanelDismissed = false;
let templatesCache = [];
let categoriesCache = [];
let selectedCategory = 'all';
let templateLookup = new Map();
let currentOptionDefinitions = [];
let currentOptionInputMap = new Map();
let currentOptionState = {};
let editingEvent = null;
let editingOptionDefinitions = [];
let editingOptionInputMap = new Map();
let editingOptionState = {};
let editingAutoOptionDefinitions = [];
let reloadOnControllerChange = false;
let lastTypeValue = null;
let categoryRebuildTimer = null;
let optionRebuildTimer = null;
let passiveUpdateNotified = false;
let updateCheckTimer = null;
let updateCheckRegistration = null;
let onlineUpdateListenerRegistered = false;
let lastSwUpdateCheckAt = 0;
let activeEventFilter = EVENT_FILTERS.LOCAL;
let currentCruiseId = null;
let currentCruiseStartUTC = null;
let currentCruiseStopUTC = null;
let currentUserId = localStorage.getItem('userId') || null;
let confirmModalFocusReturn = null;
let editorFocusReturn = null;
let modalLockCount = 0;
let modalViewportSyncBound = false;
let modalVisualViewportRef = null;

// Keep the existing saved preference key as its scope expands to all device GPS logging.
const GPS_ALLOW_POOR_ACCURACY_STORAGE_KEY = 'asnapAllowPoorAccuracy';
const ASNAP_STORAGE_KEYS = Object.freeze({
  enabled: 'asnapEnabled',
  showInList: 'asnapShowInList',
  intervalMs: 'asnapIntervalMs',
  lastCaptureMs: 'asnapLastCaptureMs',
  backfillEnabled: 'asnapBackfillEnabled',
  backfillAllowlist: 'asnapBackfillAllowlist'
});
const ASNAP_BACKFILL_INITIAL_ALLOWLIST = [
  'OBSERVATION',
  'SCIENCE'
].join('\n');

let asnapEnabled = localStorage.getItem(ASNAP_STORAGE_KEYS.enabled) === '1';
let asnapShowInList = localStorage.getItem(ASNAP_STORAGE_KEYS.showInList) !== '0';
let allowPoorGpsAccuracy = localStorage.getItem(GPS_ALLOW_POOR_ACCURACY_STORAGE_KEY) === '1';
let asnapIntervalMs = parseInt(localStorage.getItem(ASNAP_STORAGE_KEYS.intervalMs), 10);
if (!Number.isFinite(asnapIntervalMs) || asnapIntervalMs < ASNAP_MIN_INTERVAL_MS || asnapIntervalMs > ASNAP_MAX_INTERVAL_MS) {
  asnapIntervalMs = ASNAP_DEFAULT_INTERVAL_MS;
  persistSetting(ASNAP_STORAGE_KEYS.intervalMs, String(asnapIntervalMs));
}
let asnapLastCaptureMs = parseInt(localStorage.getItem(ASNAP_STORAGE_KEYS.lastCaptureMs), 10);
if (!Number.isFinite(asnapLastCaptureMs) || asnapLastCaptureMs < 0) {
  asnapLastCaptureMs = 0;
}
let asnapBackfillEnabled = localStorage.getItem(ASNAP_STORAGE_KEYS.backfillEnabled) === '1';
let asnapBackfillAllowlistRaw = localStorage.getItem(ASNAP_STORAGE_KEYS.backfillAllowlist);
if (typeof asnapBackfillAllowlistRaw !== 'string') {
  asnapBackfillAllowlistRaw = ASNAP_BACKFILL_INITIAL_ALLOWLIST;
  persistSetting(ASNAP_STORAGE_KEYS.backfillAllowlist, asnapBackfillAllowlistRaw);
}
let asnapBackfillAllowlist = parseBackfillAllowlist(asnapBackfillAllowlistRaw);
let asnapTimerId = null;
let asnapPauseReason = null;
let asnapNextCaptureMs = 0;
let hasAsnapEvents = false;
let asnapCaptureInFlight = false;

let asnapStatusIntervalId = null;

let gpsWarmupTimerId = null;
let gpsWarmupInFlight = false;
let gpsWarmupPermissionDenied = false;

const GPS_WARMUP_STALE_THRESHOLD_MS = Math.min(
  STALE_FIX_MAX_MS / 2,
  GPS_WARMUP_INTERVAL_MS
);
const ASNAP_BACKFILL_DIVE_QUERY_LIMIT = 5000;
const ASNAP_VESSEL_API_ROOT_STORAGE_KEY = 'asnapVesselApiRoot';
const ASNAP_BACKFILL_FALLBACK_PAD_MS = 2 * 60 * 60 * 1000;
const ASNAP_BACKFILL_DEBUG_STORAGE_KEY = 'asnapBackfillDebugSnapshot';
const ASNAP_BACKFILL_DEBUG_SAMPLE_LIMIT = 8;
const ASNAP_BACKFILL_DEBUG_POST_TIMEOUT_MS = 4000;
const ASNAP_BACKFILL_DEBUG_POST_MIN_INTERVAL_MS = 15000;
let asnapBackfillDebugLastPostedSignature = '';
let asnapBackfillDebugLastPostedAtMs = 0;

// Auto-fill rules are loaded from localStorage. The modal edits a draft so
// Save persists changes and Cancel discards them.
let autoFillRules = loadAutoFillRules();
let autoFillRulesDraft = null;
let autoFillRulesActiveTemplateId = null;

// Summarize configured templates in Settings on boot and after each Save.
function updateAutoFillRulesSummary() {
  const target = dom.autoFillRulesSummary;
  if (!target) return;
  const labels = Object.values(autoFillRules || {})
    .filter((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const logHas = entry.log && typeof entry.log === 'object' && Object.keys(entry.log).length > 0;
      const editHas = entry.edit && typeof entry.edit === 'object' && Object.keys(entry.edit).length > 0;
      return logHas || editHas;
    })
    .map((entry) => entry._label || entry._lastSeenEventValue || 'unnamed template')
    .sort();
  if (labels.length === 0) {
    target.textContent = 'No auto-fill rules configured.';
    return;
  }
  if (labels.length === 1) {
    target.textContent = `Configured for ${labels[0]}.`;
    return;
  }
  if (labels.length <= 3) {
    target.textContent = `Configured for ${labels.join(', ')}.`;
    return;
  }
  target.textContent = `Configured for ${labels.slice(0, 3).join(', ')} + ${labels.length - 3} more.`;
}

function setModalViewportCssVars(heightPx, topPx) {
  const rootStyle = document.documentElement.style;
  if (Number.isFinite(heightPx) && heightPx > 0) {
    rootStyle.setProperty('--modal-vvh', `${Math.round(heightPx)}px`);
  }
  if (Number.isFinite(topPx) && topPx >= 0) {
    rootStyle.setProperty('--modal-vv-top', `${Math.round(topPx)}px`);
  }
}

function clearModalViewportCssVars() {
  const rootStyle = document.documentElement.style;
  rootStyle.removeProperty('--modal-vvh');
  rootStyle.removeProperty('--modal-vv-top');
}

function readModalViewportMetrics() {
  const visualViewport = window.visualViewport;
  if (visualViewport && Number.isFinite(visualViewport.height) && visualViewport.height > 0) {
    return {
      height: visualViewport.height,
      top: Number.isFinite(visualViewport.offsetTop) ? visualViewport.offsetTop : 0
    };
  }
  return {
    height: window.innerHeight || document.documentElement?.clientHeight || 0,
    top: 0
  };
}

function applyModalViewportMetrics() {
  if (modalLockCount === 0) return;
  // Read viewport metrics on the next frame so body-scroll style writes
  // can flush without forcing a synchronous reflow.
  requestAnimationFrame(() => {
    if (modalLockCount === 0) return;
    const metrics = readModalViewportMetrics();
    setModalViewportCssVars(metrics.height, metrics.top);
  });
}

function handleModalViewportChange() {
  applyModalViewportMetrics();
}

function attachModalViewportSync() {
  if (modalViewportSyncBound) return;
  modalViewportSyncBound = true;
  window.addEventListener('resize', handleModalViewportChange, { passive: true });
  window.addEventListener('orientationchange', handleModalViewportChange, { passive: true });
  modalVisualViewportRef = window.visualViewport || null;
  if (modalVisualViewportRef) {
    modalVisualViewportRef.addEventListener('resize', handleModalViewportChange, { passive: true });
    modalVisualViewportRef.addEventListener('scroll', handleModalViewportChange, { passive: true });
  }
  applyModalViewportMetrics();
}

function detachModalViewportSync() {
  if (!modalViewportSyncBound) return;
  window.removeEventListener('resize', handleModalViewportChange);
  window.removeEventListener('orientationchange', handleModalViewportChange);
  if (modalVisualViewportRef) {
    modalVisualViewportRef.removeEventListener('resize', handleModalViewportChange);
    modalVisualViewportRef.removeEventListener('scroll', handleModalViewportChange);
  }
  modalVisualViewportRef = null;
  modalViewportSyncBound = false;
  clearModalViewportCssVars();
}

function lockBodyScroll() {
  if (modalLockCount === 0) {
    // Measure before changing body styles, then set viewport variables
    // synchronously so the first modal paint uses the visible viewport size.
    const metrics = readModalViewportMetrics();
    setModalViewportCssVars(metrics.height, metrics.top);

    const previousTop = document.body.style.top || '';
    const previousWidth = document.body.style.width || '';
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.dataset.scrollLockY = String(scrollY);
    document.body.dataset.scrollLockTop = previousTop;
    document.body.dataset.scrollLockWidth = previousWidth;
    document.body.style.top = `-${scrollY}px`;
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
    document.body.style.width = '100%';
    attachModalViewportSync();
  }
  modalLockCount += 1;
  applyModalViewportMetrics();
}

function unlockBodyScroll() {
  if (modalLockCount === 0) return;
  modalLockCount -= 1;
  if (modalLockCount === 0) {
    const stored = document.body.dataset.scrollLockY;
    const scrollY = stored ? Number(stored) : 0;
    const previousTop = document.body.dataset.scrollLockTop;
    const previousWidth = document.body.dataset.scrollLockWidth;
    detachModalViewportSync();
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    document.body.style.top = previousTop ?? '';
    document.body.style.width = previousWidth ?? '';
    delete document.body.dataset.scrollLockY;
    delete document.body.dataset.scrollLockTop;
    delete document.body.dataset.scrollLockWidth;
    window.scrollTo(0, scrollY);
  }
}

function releaseFocus(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.blur();
  });
}

function setServiceWorkerVersionLabel(text) {
  if (!dom.swVersionTag) return;
  dom.swVersionTag.textContent = text || 'unknown';
}

function requestServiceWorkerState(registration = null) {
  if (!('serviceWorker' in navigator)) return;
  const candidates = [
    registration?.active || null,
    navigator.serviceWorker.controller || null,
    registration?.waiting || null
  ].filter(Boolean);
  if (!candidates.length) return;
  const target = candidates[0];
  try {
    target.postMessage({ type: 'REQUEST_SW_STATE' });
  } catch {
    // ignore postMessage failures
  }
}

function refreshServiceWorkerVersionLabel() {
  const fallback = buildSwFallbackLabel({
    serviceWorkerSupported: 'serviceWorker' in navigator,
    hasController: !!navigator.serviceWorker?.controller,
    controllerState: navigator.serviceWorker?.controller?.state || 'unknown',
    controllerScriptUrl: navigator.serviceWorker?.controller?.scriptURL || ''
  });
  setServiceWorkerVersionLabel(buildSwDisplayLabel({
    knownVersion: lastKnownSwVersion,
    updateReadyVersion: updateReadySwVersion,
    fallbackLabel: fallback
  }));
}

function maybeWarnSwVersionMismatch() {
  if (swMismatchWarned) return;
  if (!shouldWarnVersionMismatch({
    appVersion: CACHE_VERSION,
    swVersion: lastKnownSwVersion,
    updateReadyVersion: updateReadySwVersion
  })) {
    return;
  }
  swMismatchWarned = true;
  status(
    dom.syncStatus,
    'warn',
    `App version ${CACHE_VERSION} differs from service worker ${lastKnownSwVersion}. Reload to align.`
  );
}

function attachSwStateListener(controller) {
  if (!controller) return;
  controller.addEventListener('statechange', () => {
    refreshServiceWorkerVersionLabel();
  });
}

function watchSwController() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    updateReadySwVersion = null;
    const controller = navigator.serviceWorker.controller;
    attachSwStateListener(controller);
    refreshServiceWorkerVersionLabel();
    requestServiceWorkerState();
  });
}

if (dom.versionTag) {
  dom.versionTag.textContent = formatAppVersion(CACHE_VERSION);
}

if (dom.swVersionTag) {
  dom.swVersionTag.textContent = 'detecting…';
  watchSwController();
  refreshServiceWorkerVersionLabel();
}

function blurActiveSelectBeforeInteraction(event) {
  const active = document.activeElement;
  if (!active) return;
  if (active === event.target) return;
  if (active.tagName !== 'SELECT') return;
  if (active.contains(event.target)) return;
  active.blur();
}

document.addEventListener('pointerdown', blurActiveSelectBeforeInteraction, { capture: true });
document.addEventListener('touchstart', blurActiveSelectBeforeInteraction, { capture: true });

filterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const filter = chip.dataset.filter || EVENT_FILTERS.ALL;
    setActiveFilter(filter);
  });
});

function initCaptureSelects() {
  if (dom.categoryMount) {
    dom.categoryMount.innerHTML = '';
    const select = document.createElement('select');
    select.id = 'categorySelect';
    select.setAttribute('aria-label', 'Category');
    dom.categoryMount.appendChild(select);
    dom.categorySelect = select;
  }
  if (dom.typeMount) {
    dom.typeMount.innerHTML = '';
    const select = document.createElement('select');
    select.id = 'type';
    select.setAttribute('aria-label', 'Event Type');
    dom.typeMount.appendChild(select);
    dom.type = select;
  }
}

initCaptureSelects();

function resolveApiRoot() {
  return resolveApiRootUtil({
    storage: localStorage,
    windowObject: window,
    defaultRoot: DEFAULT_API_ROOT,
    appPathPrefix
  });
}
async function fetchCurrentCruiseId({ showStatus = false, force = false } = {}) {
  const jwt = localStorage.getItem('jwt');
  if (!jwt) return null;
  if (currentCruiseId && !force) return currentCruiseId;
  try {
    const apiRoot = resolveApiRoot();
    const response = await fetch(`${apiRoot}/api/v1/cruises`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` }
    });
    if (response.status === 401) {
      localStorage.removeItem('jwt');
      if (showStatus) status(dom.authStatus, 'alert', 'Session expired while fetching cruises.');
      return null;
    }
    if (!response.ok) {
      throw new Error(`Cruises request failed (${response.status})`);
    }
    const cruises = await response.json();
    if (!Array.isArray(cruises) || !cruises.length) {
      if (showStatus) status(dom.syncStatus, 'warn', 'No cruises returned by server.');
      return null;
    }
    cruises.sort((a, b) => {
      const aTime = new Date(a.start_ts || 0).getTime();
      const bTime = new Date(b.start_ts || 0).getTime();
      return bTime - aTime;
    });
    const latest = cruises[0];
    const cruiseId = latest?.id || null;
    currentCruiseId = cruiseId || null;
    const candidateStart = toIsoOrNull(latest?.start_ts);
    const candidateStop = toIsoOrNull(latest?.stop_ts);
    currentCruiseStartUTC = candidateStart || currentCruiseStartUTC || null;
    currentCruiseStopUTC = candidateStop || currentCruiseStopUTC || null;
    await Promise.all([
      setMetaValue(META_CURRENT_CRUISE_ID, currentCruiseId),
      setMetaValue(META_CURRENT_CRUISE_START, currentCruiseStartUTC),
      setMetaValue(META_CURRENT_CRUISE_STOP, currentCruiseStopUTC)
    ]);
    return currentCruiseId;
  } catch (err) {
    if (showStatus) {
      status(dom.syncStatus, 'alert', `Cruise lookup failed: ${err.message}`);
    }
    return currentCruiseId;
  }
}

async function refreshServerEvents({ showStatus = true } = {}) {
  const result = { ok: false, imported: 0, total: 0, message: '', error: false, reason: null };
  const jwt = localStorage.getItem('jwt');
  if (!jwt) {
    result.message = 'Sign in to load Sealog events.';
    result.reason = 'no-auth';
    return result;
  }
  if (!currentUserId) {
    currentUserId = localStorage.getItem('userId') || null;
  }
  const usernameRaw = (localStorage.getItem('username') || '').trim();
  const username = usernameRaw.toLowerCase();
  await fetchCurrentCruiseId({ showStatus: false });
  if (!currentCruiseId) {
    const message = 'No active cruise to load server events.';
    if (showStatus) status(dom.syncStatus, 'warn', message);
    result.message = message;
    result.reason = 'no-cruise';
    return result;
  }

  const apiRoot = resolveApiRoot();
  const author = usernameRaw || username;
  if (!author) {
    const message = 'Cannot load server events without username.';
    if (showStatus) status(dom.syncStatus, 'warn', message);
    result.message = message;
    result.reason = 'no-username';
    return result;
  }
  if (!currentCruiseStartUTC) {
    const message = 'Cruise start time unavailable; unable to query events.';
    if (showStatus) status(dom.syncStatus, 'warn', message);
    result.message = message;
    result.reason = 'no-start';
    return result;
  }
  let stopTs = currentCruiseStopUTC;
  if (!stopTs) {
    stopTs = nowUtc();
  }
  const params = new URLSearchParams();
  params.set('author', author);
  params.set('startTS', currentCruiseStartUTC);
  params.set('stopTS', stopTs);

  let eventsData;
  try {
    const response = await fetch(`${apiRoot}/api/v1/events?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` }
    });
    if (response.status === 401) {
      localStorage.removeItem('jwt');
      status(dom.authStatus, 'alert', 'Session expired while fetching cruise events.');
      result.message = 'Session expired while fetching cruise events.';
      result.reason = 'unauthorized';
      result.error = true;
      return result;
    }
    if (response.status === 404) {
      const details = await response.json().catch(() => ({}));
      const message = typeof details?.message === 'string' && details.message.trim()
        ? details.message.trim()
        : 'No matching Sealog events were returned.';
      if (showStatus) status(dom.syncStatus, null, message);
      result.message = message;
      result.reason = 'no-records';
      result.total = 0;
      return result;
    }
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const errorMessage = typeof details?.message === 'string' && details.message
        ? details.message
        : `Events request failed (${response.status})`;
      throw new Error(errorMessage);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('Unexpected events payload');
    }
    eventsData = payload;
  } catch (err) {
    const message = err?.message || 'Cruise events fetch failed.';
    if (showStatus) {
      status(dom.syncStatus, 'alert', message);
    }
    result.message = message;
    result.reason = 'fetch-error';
    result.error = true;
    return result;
  }

  const localEvents = await getAllEvents();
  const byServerId = new Map();
  const byLocalId = new Map();
  localEvents.forEach((event) => {
    if (event.serverId) byServerId.set(String(event.serverId), event);
    byLocalId.set(event.localId, event);
  });

  let merged = 0;
  const pendingWrites = [];
  for (const serverEvent of eventsData) {
    const serverId = extractServerEventId(serverEvent);
    if (!serverId) continue;
    const serverIdStr = String(serverId);
    const serverIsAsnap = (serverEvent.event_value || '').toUpperCase() === ASNAP_EVENT_VALUE;

    const eventAuthor = (serverEvent.event_author || '').toLowerCase();
    const userMatches = !username || !eventAuthor || eventAuthor === username;
    if (!userMatches) continue;

    const serverCruiseId = serverEvent.cruise_id || null;
    if (serverCruiseId && String(serverCruiseId) !== String(currentCruiseId)) continue;

    const optionValues = normalizeOptionValues(serverEvent.event_options);
    const noteText = typeof serverEvent.event_free_text === 'string' ? serverEvent.event_free_text : '';
    const payloadObj = { notes: noteText, options: optionMapFromArray(optionValues) };

    const latOption = optionValues.find((opt) => /latitude/i.test(opt.event_option_name));
    const lonOption = optionValues.find((opt) => /longitude/i.test(opt.event_option_name));
    const accOption = optionValues.find((opt) => /(accuracy|acc[_\s]?m\b)/i.test(opt.event_option_name));

    const latFromOptions = toNumberOrNull(latOption ? latOption.event_option_value : null);
    const lonFromOptions = toNumberOrNull(lonOption ? lonOption.event_option_value : null);
    const accFromOptions = toNumberOrNull(accOption ? accOption.event_option_value : null);

    const eventTimestampIso = toIsoOrNull(serverEvent.ts);
    if (!eventTimestampIso) continue;

    const existing = byServerId.get(serverIdStr);
    if (existing) {
      const pending = existing.syncState !== SYNC_STATE.SYNCED;
      if (pending) continue;
      const preserveBackfill = existing.payload?.backfilled_from_asnap === true;
      const lat = latFromOptions ?? (preserveBackfill ? existing.lat : null);
      const lon = lonFromOptions ?? (preserveBackfill ? existing.lon : null);
      const acc = accFromOptions ?? (preserveBackfill ? existing.acc_m : null);
      const unchanged = existing.eventTimestampUTC === eventTimestampIso &&
        existing.notes === noteText && existing.type === serverEvent.event_value &&
        existing.lat === lat && existing.lon === lon && existing.acc_m === acc &&
        JSON.stringify(existing.option_values) === JSON.stringify(optionValues);
      if (unchanged) continue;
      const serverUpdatedMs = Date.now();

      const updatedEvent = { ...existing };
      if (eventTimestampIso) {
        updatedEvent.eventTimestampUTC = eventTimestampIso;
      }
      updatedEvent.originalTimestampUTC = existing.originalTimestampUTC || updatedEvent.eventTimestampUTC;
      updatedEvent.notes = noteText;
      updatedEvent.type = serverEvent.event_value;
      updatedEvent.lat = lat;
      updatedEvent.lon = lon;
      updatedEvent.acc_m = acc;
      updatedEvent.option_values = optionValues;
      updatedEvent.payload = {
        ...existing.payload,
        ...payloadObj,
        utc: updatedEvent.eventTimestampUTC,
        notes: updatedEvent.notes,
        lat: updatedEvent.lat,
        lon: updatedEvent.lon,
        acc_m: updatedEvent.acc_m,
        client_uuid: updatedEvent.localId,
        options: payloadObj.options
      };
      syncEventPayload(updatedEvent);
      updatedEvent.syncState = SYNC_STATE.SYNCED;
      if (serverIsAsnap) {
        updatedEvent.isAsnap = true;
        updatedEvent.source = 'asnap';
      }
      updatedEvent.lastSyncMs = serverUpdatedMs || Date.now();
      updatedEvent.lastSyncUTC = new Date(updatedEvent.lastSyncMs).toISOString();
      updatedEvent.updatedAtMs = updatedEvent.lastSyncMs;
      updatedEvent.updatedAtUTC = updatedEvent.lastSyncUTC;
      pendingWrites.push(updatedEvent);
      byServerId.set(serverIdStr, updatedEvent);
      byLocalId.set(updatedEvent.localId, updatedEvent);
      merged += 1;
      continue;
    }

    const localId = findOptionValue(optionValues, CLIENT_UUID_OPTION_KEY) || `server-${serverIdStr}`;
    if (byLocalId.has(localId)) continue;
    const createdMs = new Date(eventTimestampIso).getTime();
    const syncedMs = Date.now();
    const eventRecord = {
      localId,
      client_uuid: localId,
      serverId: serverIdStr,
      syncState: SYNC_STATE.SYNCED,
      type: serverEvent.event_value || 'EVENT',
      eventTemplateId: null,
      eventTemplateName: serverEvent.event_value || null,
      template_categories: [],
      eventTimestampUTC: eventTimestampIso || nowUtc(),
      originalTimestampUTC: eventTimestampIso,
      notes: noteText,
      lat: latFromOptions,
      lon: lonFromOptions,
      acc_m: accFromOptions,
      option_values: optionValues,
      payload: {},
      revisions: [],
      userId: currentUserId || null,
      cruiseId: serverCruiseId || currentCruiseId,
      createdAtMs: createdMs,
      createdAtUTC: new Date(createdMs).toISOString(),
      updatedAtMs: syncedMs,
      updatedAtUTC: new Date(syncedMs).toISOString(),
      lastSyncMs: syncedMs,
      lastSyncUTC: new Date(syncedMs).toISOString(),
      lastError: null,
      attemptCount: 0,
      verifyAttemptCount: 0,
      verifyNextAttemptMs: null,
      nextAttemptMs: null,
    };
    if (serverIsAsnap) {
      eventRecord.isAsnap = true;
      eventRecord.source = 'asnap';
    }
    eventRecord.payload = {
      ...payloadObj,
      utc: eventRecord.eventTimestampUTC,
      notes: eventRecord.notes,
      lat: eventRecord.lat,
      lon: eventRecord.lon,
      acc_m: eventRecord.acc_m,
      client_uuid: eventRecord.localId,
      options: payloadObj.options
    };
    syncEventPayload(eventRecord);
    pendingWrites.push(eventRecord);
    byLocalId.set(localId, eventRecord);
    byServerId.set(serverIdStr, eventRecord);
    localEvents.push(eventRecord);
    merged += 1;
  }

  if (pendingWrites.length) {
    await putMany(EVENT_STORE, pendingWrites);
  }

  const totalFetched = Array.isArray(eventsData) ? eventsData.length : 0;
  result.total = totalFetched;
  if (merged) {
    const summary = `Imported ${merged} server event${merged === 1 ? '' : 's'}.`;
    if (showStatus) {
      status(dom.syncStatus, null, summary);
    }
    await render();
    result.ok = true;
    result.imported = merged;
    result.message = summary;
    result.reason = 'imported';
  } else {
    const summary = 'No new server events for this cruise.';
    if (showStatus) {
      status(dom.syncStatus, null, summary);
    }
    result.message = summary;
    result.reason = 'no-new';
  }

  return result;
}

let confirmModalResolve = null;

function applyConfirmVariant(variant = 'primary') {
  if (!dom.confirmModalConfirm) return;
  dom.confirmModalConfirm.classList.remove('danger', 'secondary');
  if (variant === 'danger') {
    dom.confirmModalConfirm.classList.add('danger');
  } else if (variant === 'secondary') {
    dom.confirmModalConfirm.classList.add('secondary');
  }
}

function openConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  showCancel = true
} = {}) {
  if (!dom.confirmModal) return Promise.resolve(false);
  if (confirmModalResolve) {
    // If another confirm is active, resolve it as canceled before opening a new one.
    confirmModalResolve(false);
    confirmModalResolve = null;
  }
  dom.confirmModalTitle.textContent = title || 'Confirm';
  dom.confirmModalMessage.textContent = message || '';
  dom.confirmModalConfirm.textContent = confirmLabel || 'Confirm';
  if (dom.confirmModalCancel) {
    dom.confirmModalCancel.textContent = cancelLabel || 'Cancel';
    if (showCancel) {
      dom.confirmModalCancel.hidden = false;
      dom.confirmModalCancel.removeAttribute('hidden');
    } else {
      dom.confirmModalCancel.hidden = true;
      dom.confirmModalCancel.setAttribute('hidden', '');
    }
  }
  applyConfirmVariant(variant);
  confirmModalResolve = null;
  return new Promise((resolve) => {
    confirmModalResolve = resolve;
    confirmModalFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const wasHidden = dom.confirmModal.hidden;
    dom.confirmModal.hidden = false;
    if (wasHidden) {
      lockBodyScroll();
    }
    dom.confirmModalConfirm.focus();
  });
}

function closeConfirmModal(result = false) {
  if (dom.confirmModal) {
    dom.confirmModal.hidden = true;
  }
  unlockBodyScroll();
  if (confirmModalResolve) {
    confirmModalResolve(result);
  }
  confirmModalResolve = null;
  if (confirmModalFocusReturn && typeof confirmModalFocusReturn.focus === 'function') {
    confirmModalFocusReturn.focus();
  }
  confirmModalFocusReturn = null;
}

function updateFilterChips() {
  filterChips.forEach((chip) => {
    const filter = chip.dataset.filter || EVENT_FILTERS.ALL;
    const isActive = filter === activeEventFilter;
    if (filter === EVENT_FILTERS.ASNAP) {
      const shouldShow = asnapShowInList && (hasAsnapEvents || asnapEnabled);
      chip.hidden = !shouldShow;
      chip.style.display = shouldShow ? '' : 'none';
    }
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function setActiveFilter(filter) {
  const normalized = Object.values(EVENT_FILTERS).includes(filter) ? filter : EVENT_FILTERS.ALL;
  if (activeEventFilter === normalized) {
    updateFilterChips();
    return;
  }
  activeEventFilter = normalized;
  updateFilterChips();
  render();
}

function persistSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn('Failed to persist setting', key, err);
  }
}

function persistBoolSetting(key, value) {
  persistSetting(key, value ? '1' : '0');
}

function updateAsnapControls() {
  if (!dom.asnapEnableToggle) return;
  dom.asnapEnableToggle.checked = asnapEnabled;
  dom.asnapShowToggle.checked = asnapShowInList;
  if (dom.asnapBackfillToggle) {
    dom.asnapBackfillToggle.checked = asnapBackfillEnabled;
  }
  if (dom.asnapBackfillAllowlist && dom.asnapBackfillAllowlist.value !== asnapBackfillAllowlistRaw) {
    dom.asnapBackfillAllowlist.value = asnapBackfillAllowlistRaw;
  }
  if (dom.asnapIntervalSelect) {
    const rounded = Math.min(ASNAP_MAX_INTERVAL_MS, Math.max(ASNAP_MIN_INTERVAL_MS, asnapIntervalMs));
    let matched = false;
    Array.from(dom.asnapIntervalSelect.options).forEach((option) => {
      if (Number(option.value) === rounded) {
        option.selected = true;
        matched = true;
      }
    });
    if (!matched) {
      dom.asnapIntervalSelect.value = String(rounded);
    }
  }

  const signedIn = !!localStorage.getItem('jwt');
  const controls = [
    dom.asnapEnableToggle,
    dom.asnapIntervalSelect,
    dom.asnapBackfillToggle,
    dom.asnapBackfillAllowlist
  ];
  controls.forEach((el) => {
    if (!el) return;
    el.disabled = !signedIn;
  });
  if (dom.asnapShowToggle) {
    dom.asnapShowToggle.disabled = false;
  }
}

function gpsLoggingPolicy(fix = lastFix) {
  return evaluateGpsLoggingFix({
    fix,
    timestampMs: fix?.timestampMs,
    allowPoorAccuracy: allowPoorGpsAccuracy
  });
}

function gpsLoggingBlockedMessage(policy, fix = lastFix) {
  switch (policy.reason) {
    case 'accuracy':
      return `GPS accuracy is ${formatAccuracyMeters(fix?.acc_m)} (limit ${GPS_ACCURACY_THRESHOLD_M}m). Wait for a better fix or enable “Allow logging when GPS accuracy is poor” in GPS settings.`;
    case 'stale':
      return 'The GPS fix is stale or its measurement time is invalid. A fix no older than 5 minutes is required.';
    case 'unknown-accuracy':
      return 'GPS accuracy is unavailable or invalid. Wait for a fix with known accuracy.';
    default:
      return 'No valid GPS position is available. Wait for a valid fix.';
  }
}

function editorNeedsGpsFix() {
  return editingAutoOptionDefinitions.some((option) =>
    ['rule:lat', 'rule:lon', 'rule:acc'].includes(option._auto) &&
    shouldApplyRule(findOptionValue(editingEvent?.option_values, option.event_option_name))
  );
}

function updateGpsLoggingWarning() {
  if (dom.gpsAllowPoorToggle) dom.gpsAllowPoorToggle.checked = allowPoorGpsAccuracy;
  const policy = gpsLoggingPolicy();
  let message = '';
  if (allowPoorGpsAccuracy) {
    message = 'Poor-accuracy GPS logging is enabled for manual capture, GPS auto-fill, and ASNAP. Positions may be unreliable.';
    if (policy.warning) message += ` ${policy.warning}`;
    else if (!policy.allowed) message += ` ${gpsLoggingBlockedMessage(policy)}`;
  } else if (policy.reason === 'accuracy') {
    message = gpsLoggingBlockedMessage(policy);
  }
  [dom.gpsLoggingWarning, dom.gpsLoggingPolicyWarning, dom.eventEditorGpsWarning].forEach((el) => {
    if (!el) return;
    if (el.textContent !== message) el.textContent = message;
    el.hidden = !message || (el === dom.eventEditorGpsWarning && !editorNeedsGpsFix());
  });
}

async function getLoggingFix() {
  const fix = await getFix();
  const policy = gpsLoggingPolicy(fix);
  if (!policy.allowed) throw new Error(gpsLoggingBlockedMessage(policy, fix));
  if (policy.warning) setFixMessage(policy.warning);
  return fix;
}

function stopAsnapTimer() {
  if (asnapTimerId) {
    clearTimeout(asnapTimerId);
    asnapTimerId = null;
  }
  asnapNextCaptureMs = 0;
}

function scheduleAsnapCapture(delayMs) {
  stopAsnapTimer();
  const delay = Math.max(0, Number.isFinite(delayMs) ? delayMs : asnapIntervalMs);
  asnapNextCaptureMs = Date.now() + delay;
  asnapTimerId = setTimeout(runAsnapCapture, delay);
}

function formatAccuracyMeters(accM) {
  return Number.isFinite(accM) && accM >= 0 ? `±${accM}m` : 'unknown accuracy';
}

function updateAsnapStatus() {
  const statusTextEl = dom.asnapStatus;
  const statusTile = document.getElementById('asnapStatusTile');
  if (!statusTextEl && !statusTile) return;
  let message = '';
  const signedIn = !!localStorage.getItem('jwt');
  if (!asnapEnabled) {
    message = 'ASNAP logging is disabled.';
  } else if (!signedIn) {
    message = 'Sign in to run ASNAP logging.';
  } else if (asnapPauseReason === 'gps-policy') {
    const retrySuffix = asnapNextCaptureMs > Date.now()
      ? ` Retrying in ${formatDuration(asnapNextCaptureMs - Date.now())}.`
      : '';
    message = `ASNAP paused: ${gpsLoggingBlockedMessage(gpsLoggingPolicy())}${retrySuffix}`;
  } else if (asnapPauseReason === 'gps-error') {
    const retrySuffix = asnapNextCaptureMs > Date.now()
      ? ` Retrying in ${formatDuration(asnapNextCaptureMs - Date.now())}.`
      : '';
    message = `ASNAP paused: unable to obtain a GPS fix.${retrySuffix}`;
  } else if (asnapPauseReason === 'idle') {
    message = 'ASNAP paused. Enable logging or sign in to resume.';
  } else {
    const intervalText = formatMinutes(asnapIntervalMs);
    if (asnapNextCaptureMs > Date.now()) {
      const remaining = asnapNextCaptureMs - Date.now();
      message = `ASNAP logging every ${intervalText}. Next capture in ${formatDuration(remaining)}.`;
    } else {
      message = `ASNAP logging every ${intervalText}.`;
    }
  }
  if (statusTextEl) {
    statusTextEl.textContent = message;
  }
  if (statusTile) {
    if (!signedIn) {
      statusTile.dataset.state = 'alert';
      statusTile.textContent = 'ASNAP off (sign in)';
    } else if (!asnapEnabled) {
      statusTile.dataset.state = 'alert';
      statusTile.textContent = 'ASNAP off';
    } else if (asnapPauseReason === 'gps-policy') {
      statusTile.dataset.state = 'warn';
      statusTile.textContent = 'ASNAP paused (GPS)';
    } else if (asnapPauseReason === 'gps-error') {
      statusTile.dataset.state = 'alert';
      statusTile.textContent = 'ASNAP paused (GPS error)';
    } else {
      statusTile.dataset.state = allowPoorGpsAccuracy ? 'warn' : 'ok';
      statusTile.textContent = allowPoorGpsAccuracy ? 'ASNAP on (poor GPS ok)' : 'ASNAP on';
    }
  }
}

function ensureAsnapStatusTicker() {
  if (asnapStatusIntervalId) return;
  asnapStatusIntervalId = setInterval(() => {
    updateAsnapStatus();
  }, 1000);
}

function stopAsnapStatusTicker() {
  if (asnapStatusIntervalId) {
    clearInterval(asnapStatusIntervalId);
    asnapStatusIntervalId = null;
  }
}

function recomputeAsnapScheduler() {
  if (asnapCaptureInFlight) {
    updateAsnapStatus();
    return;
  }
  stopAsnapTimer();
  const signedIn = !!localStorage.getItem('jwt');
  if (!asnapEnabled || !signedIn) {
    asnapPauseReason = 'idle';
    stopAsnapStatusTicker();
    updateAsnapStatus();
    return;
  }

  if (!gpsLoggingPolicy().allowed) {
    asnapPauseReason = 'gps-policy';
    const retryDelay = Math.max(5000, Math.min(asnapIntervalMs, 30000));
    scheduleAsnapCapture(retryDelay);
    updateAsnapStatus();
    return;
  }

  asnapPauseReason = null;
  let delay = asnapIntervalMs;
  const now = Date.now();
  if (asnapLastCaptureMs > 0) {
    const elapsed = now - asnapLastCaptureMs;
    delay = Math.max(0, asnapIntervalMs - elapsed);
  } else {
    delay = Math.min(10000, asnapIntervalMs);
  }
  scheduleAsnapCapture(delay);
  updateAsnapStatus();
}

async function runAsnapCapture() {
  if (asnapCaptureInFlight) {
    return;
  }
  asnapCaptureInFlight = true;
  stopAsnapTimer();
  try {
    const signedIn = !!localStorage.getItem('jwt');
    if (!asnapEnabled || !signedIn) {
      asnapPauseReason = 'idle';
      updateAsnapStatus();
      return;
    }

    asnapPauseReason = null;
    updateAsnapStatus();

    let fix = null;
    try {
      fix = await getFix();
    } catch {
      // Report acquisition failure after checking whether logging is still enabled.
    }
    if (!asnapEnabled || !localStorage.getItem('jwt')) {
      asnapPauseReason = 'idle';
      updateAsnapStatus();
      return;
    }
    if (!fix) {
      asnapPauseReason = 'gps-error';
      updateAsnapStatus();
      scheduleAsnapCapture(Math.min(asnapIntervalMs, 60000));
      return;
    }

    if (!gpsLoggingPolicy(fix).allowed) {
      asnapPauseReason = 'gps-policy';
      const retryDelay = Math.max(5000, Math.min(asnapIntervalMs, 30000));
      scheduleAsnapCapture(retryDelay);
      updateAsnapStatus();
      return;
    }

    await createAsnapEvent(fix);
    asnapLastCaptureMs = Date.now();
    persistSetting(ASNAP_STORAGE_KEYS.lastCaptureMs, String(asnapLastCaptureMs));
    asnapPauseReason = null;
    scheduleAsnapCapture(asnapIntervalMs);
    updateAsnapStatus();
    render();
  } finally {
    asnapCaptureInFlight = false;
  }
}

function resetEventEditor() {
  editingOptionDefinitions = [];
  editingAutoOptionDefinitions = [];
  editingOptionInputMap = new Map();
  editingOptionState = {};
  if (dom.eventEditorTimestampError) {
    dom.eventEditorTimestampError.hidden = true;
    dom.eventEditorTimestampError.textContent = '';
  }
  if (dom.eventEditorOptions) {
    dom.eventEditorOptions.innerHTML = '';
    dom.eventEditorOptions.hidden = true;
  }
  if (dom.eventEditorForm) {
    dom.eventEditorForm.reset();
  }
}

function closeEventEditor() {
  if (dom.eventEditor) {
    dom.eventEditor.hidden = true;
  }
  unlockBodyScroll();
  resetEventEditor();
  editingEvent = null;
  if (editorFocusReturn && typeof editorFocusReturn.focus === 'function') {
    editorFocusReturn.focus();
  }
  editorFocusReturn = null;
}

function isRuleAuto(autoType) {
  return typeof autoType === 'string' && autoType.startsWith('rule:');
}

function renderEventEditorOptions(definitions, optionValues) {
  const container = dom.eventEditorOptions;
  if (!container) return;
  container.innerHTML = '';
  container.hidden = true;
  editingOptionInputMap = new Map();
  editingOptionState = {};
  editingOptionDefinitions = [];
  editingAutoOptionDefinitions = [];
  if (!definitions || !definitions.length) {
    return;
  }

  const autoDefs = [];
  const interactiveDefs = [];
  definitions.forEach((option) => {
    if (['phoneUtc', 'latitude', 'longitude', 'accuracy'].includes(option._auto)) {
      autoDefs.push(option);
    } else if (isRuleAuto(option._auto)) {
      // Rule-driven fields render in the read-only auto-fields list with
      // a hint string describing what will happen on save.
      autoDefs.push(option);
    } else {
      interactiveDefs.push(option);
    }
  });

const activeAutoDefs = autoDefs.filter((option) => {
    if (option._auto === 'phoneUtc') return true;
    // Rule-driven fields always render at edit time so the operator sees
    // the impending auto-fill even when the field is currently blank.
    if (isRuleAuto(option._auto)) return true;
    const value = findOptionValue(optionValues, option.event_option_name);
    return value != null && value !== '';
  });

  editingAutoOptionDefinitions = activeAutoDefs;
  editingOptionDefinitions = interactiveDefs;

  let renderedAny = false;

  activeAutoDefs.forEach((option) => {
    const autoValue = findOptionValue(optionValues, option.event_option_name);
    const isRuleDriven = isRuleAuto(option._auto);
    // Show blank rule-driven fields with their save-time hint. Inferred GPS
    // fields appear only when the stored event already has a value.
    if (!isRuleDriven && (autoValue == null || autoValue === '')) return;
    const field = document.createElement('div');
    field.className = 'option-field auto';
    const label = document.createElement('div');
    label.className = 'option-label';
    const displayName = option.event_option_label || formatOptionLabel(option.event_option_name);
    label.textContent = displayName + ' (auto)';
    const help = document.createElement('p');
    help.className = 'option-help';
    if (isRuleDriven) {
      help.textContent = `Will auto-fill on save (${describeAutoFillSource(option._auto.slice(5))}).`;
    } else if (option._auto === 'latitude') {
      help.textContent = 'Captured GPS latitude when the event was logged.';
    } else if (option._auto === 'longitude') {
      help.textContent = 'Captured GPS longitude when the event was logged.';
    } else if (option._auto === 'accuracy') {
      help.textContent = 'Captured GPS accuracy (meters) when the event was logged.';
    } else {
      help.textContent = 'Captured automatically when the event was logged.';
    }
    const valueDisplay = document.createElement('p');
    valueDisplay.className = 'option-value';
    valueDisplay.textContent = autoValue == null || autoValue === '' ? '—' : String(autoValue);
    field.appendChild(label);
    field.appendChild(help);
    field.appendChild(valueDisplay);
    container.appendChild(field);
    renderedAny = true;
  });

  interactiveDefs.forEach((option) => {
    const field = document.createElement('div');
    field.className = 'option-field';
    const label = document.createElement('div');
    label.className = 'option-label';
    const displayName = option.event_option_label || formatOptionLabel(option.event_option_name);
    label.textContent = displayName + (option.event_option_required ? ' *' : '');
    field.appendChild(label);

    const error = document.createElement('p');
    error.className = 'option-error';
    error.hidden = true;
    field.appendChild(error);

    const entry = {
      option,
      markInvalid(flag, message = 'Required field') {
        if (flag) {
          field.classList.add('invalid');
          error.textContent = message;
          error.hidden = false;
        } else {
          field.classList.remove('invalid');
          error.hidden = true;
        }
      },
      getValue: () => ''
    };

    const stateKey = option._id;
    const initialValue = findOptionValue(optionValues, option.event_option_name) ?? option.event_option_default_value ?? '';
    editingOptionState[stateKey] = initialValue ?? '';

    switch ((option.event_option_type || 'text').toLowerCase()) {
      case 'dropdown': {
        const select = document.createElement('select');
        const values = Array.isArray(option.event_option_values) ? option.event_option_values : [];
        if (!option.event_option_required) {
          const blank = document.createElement('option');
          blank.value = '';
          blank.textContent = '—';
          select.appendChild(blank);
        }
        values.forEach((raw) => {
          const optEl = document.createElement('option');
          if (raw && typeof raw === 'object') {
            const value = raw.value ?? raw.event_option_value ?? raw.name ?? raw.label ?? '';
            optEl.value = String(value ?? '');
            optEl.textContent = String(raw.label ?? value ?? '');
          } else {
            optEl.value = String(raw ?? '');
            optEl.textContent = String(raw ?? '');
          }
          select.appendChild(optEl);
        });
        select.value = String(initialValue ?? '');
        select.addEventListener('change', () => {
          editingOptionState[stateKey] = select.value;
        });
        entry.getValue = () => select.value;
        field.appendChild(select);
        break;
      }
      case 'textarea': {
        const textarea = document.createElement('textarea');
        textarea.rows = 3;
        textarea.value = initialValue ?? '';
        textarea.addEventListener('input', () => {
          editingOptionState[stateKey] = textarea.value;
        });
        entry.getValue = () => textarea.value.trim();
        field.appendChild(textarea);
        break;
      }
      default: {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = initialValue ?? '';
        input.addEventListener('input', () => {
          editingOptionState[stateKey] = input.value;
        });
        entry.getValue = () => input.value.trim();
        field.appendChild(input);
        break;
      }
    }
    editingOptionInputMap.set(stateKey, entry);
    container.appendChild(field);
    renderedAny = true;
  });

  container.hidden = !renderedAny;
}

function collectEditorOptionValues({ timestampIso, fix }) {
  const results = [];
  const missing = [];

  editingOptionDefinitions.forEach((option) => {
    const entry = editingOptionInputMap.get(option._id);
    if (!entry) return;
    let value = entry.getValue();
    if (Array.isArray(value)) {
      value = value
        .map((item) => (item == null ? '' : String(item)))
        .filter((item) => item.trim().length);
    }
    const isEmpty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
    if (option.event_option_required && isEmpty) {
      entry.markInvalid(true);
      missing.push(option.event_option_name);
      return;
    }
    entry.markInvalid(false);
    if (!isEmpty) {
      const normalized = Array.isArray(value) ? value.join(', ') : String(value);
      results.push({ event_option_name: option.event_option_name, event_option_value: normalized });
    }
  });

  if (missing.length) {
    throw new Error(`Fill required fields: ${missing.join(', ')}`);
  }

  const timestamp = timestampIso || nowUtc();

  editingAutoOptionDefinitions.forEach((option) => {
    if (option._auto === 'phoneUtc') {
      results.push({ event_option_name: option.event_option_name, event_option_value: timestamp });
    } else if (option._auto === 'latitude') {
      const latRaw = dom.eventEditorLat?.value?.trim();
      if (latRaw) {
        results.push({ event_option_name: option.event_option_name, event_option_value: latRaw });
      } else if (option.event_option_required) {
        missing.push(option.event_option_name);
      }
    } else if (option._auto === 'longitude') {
      const lonRaw = dom.eventEditorLon?.value?.trim();
      if (lonRaw) {
        results.push({ event_option_name: option.event_option_name, event_option_value: lonRaw });
      } else if (option.event_option_required) {
        missing.push(option.event_option_name);
      }
    } else if (option._auto === 'accuracy') {
      const accRaw = dom.eventEditorAcc?.value?.trim();
      if (accRaw) {
        results.push({ event_option_name: option.event_option_name, event_option_value: accRaw });
      } else if (option.event_option_required) {
        missing.push(option.event_option_name);
      }
    } else if (isRuleAuto(option._auto)) {
      // Edit rules fill only empty fields; existing event values stay intact.
      const source = option._auto.slice(5);
      const currentValue = findOptionValue(editingEvent?.option_values, option.event_option_name) ?? null;
      const nextValue = shouldApplyRule(currentValue)
        ? applySourceValue(source, { nowUtc: nowUtc(), fix }) : currentValue;
      if (nextValue != null && nextValue !== '') {
        results.push({ event_option_name: option.event_option_name, event_option_value: String(nextValue) });
      } else if (option.event_option_required) {
        missing.push(option.event_option_name);
      }
    }
  });

  if (!results.some((opt) => normalizeOptionKey(opt.event_option_name) === DEVICE_UTC_KEY)) {
    results.push({ event_option_name: DEVICE_UTC_OPTION_NAME, event_option_value: timestamp });
  }

  if (missing.length) {
    throw new Error(`Fill required fields: ${missing.join(', ')}`);
  }

  const normalizedResults = normalizeOptionValues(results);
  const normalizedMap = optionMapFromArray(normalizedResults);
  return { optionValues: normalizedResults, optionMap: normalizedMap };
}

async function createAsnapEvent(fix) {
  const nowIso = nowUtc();
  const localId = generateLocalId();
  const optionValues = [];
  if (fix && typeof fix.lat === 'number' && Number.isFinite(fix.lat)) {
    optionValues.push({ event_option_name: 'Latitude', event_option_value: Number(fix.lat).toFixed(6) });
  }
  if (fix && typeof fix.lon === 'number' && Number.isFinite(fix.lon)) {
    optionValues.push({ event_option_name: 'Longitude', event_option_value: Number(fix.lon).toFixed(6) });
  }
  if (fix && typeof fix.acc_m === 'number' && Number.isFinite(fix.acc_m)) {
    optionValues.push({ event_option_name: 'Device Accuracy (m)', event_option_value: Math.round(fix.acc_m) });
  }
  optionValues.push({ event_option_name: 'Device UTC', event_option_value: nowIso });

  const normalizedOptions = normalizeOptionValues(optionValues);
  const optionMap = optionMapFromArray(normalizedOptions);

  const event = {
    localId,
    client_uuid: localId,
    type: ASNAP_EVENT_VALUE,
    eventTemplateId: 'asnap',
    eventTemplateName: 'ASNAP',
    template_categories: ['system'],
    notes: '',
    originalTimestampUTC: nowIso,
    eventTimestampUTC: nowIso,
    payload: {
      utc: nowIso,
      notes: '',
      client_uuid: localId,
      options: optionMap
    },
    option_values: normalizedOptions,
    syncState: SYNC_STATE.UNSYNCED,
    isAsnap: true,
    source: 'asnap',
    serverId: null,
    attemptCount: 0,
    nextAttemptMs: Date.now(),
    lastError: null,
    verifyAttemptCount: 0,
    verifyNextAttemptMs: null,
    createdAtMs: Date.now(),
    createdAtUTC: nowIso,
    updatedAtMs: Date.now(),
    updatedAtUTC: nowIso,
    revisions: [],
    userId: currentUserId || localStorage.getItem('userId') || null,
    cruiseId: currentCruiseId,
  };

  if (fix && typeof fix.lat === 'number' && Number.isFinite(fix.lat)) {
    event.lat = Number(fix.lat);
    event.payload.lat = Number(fix.lat);
  }
  if (fix && typeof fix.lon === 'number' && Number.isFinite(fix.lon)) {
    event.lon = Number(fix.lon);
    event.payload.lon = Number(fix.lon);
  }
  if (fix && typeof fix.acc_m === 'number' && Number.isFinite(fix.acc_m)) {
    event.acc_m = Math.round(Number(fix.acc_m));
    event.payload.acc_m = Math.round(Number(fix.acc_m));
  }

  syncEventPayload(event);
  await put(EVENT_STORE, event);
  return event;
}

async function openEventEditor(localId) {
  try {
    const event = await getEvent(localId);
    if (!event) {
      status(dom.syncStatus, 'alert', 'Event not found.');
      return;
    }
    if (event.isAsnap) {
      status(dom.syncStatus, 'warn', 'ASNAP events cannot be edited on this device.');
      return;
    }
    editingEvent = event;
    const template = findTemplateForEvent(event);
    // ASNAP events do not receive edit-mode auto-fill rules.
    const editCtx = event.isAsnap
      ? null
      : { templateId: template?.id, eventValue: template?.event_value, mode: 'edit' };
    const baseDefinitions = template ? buildOptionDefinitions(template, editCtx) : [];
    const normalizedOptionValues = normalizeOptionValues(event.option_values);
    let definitions = augmentDefinitionsWithEventOptions(baseDefinitions, normalizedOptionValues, event);
    const hasLatOption = hasCustomCoordinateOption(normalizedOptionValues, 'lat');
    const hasLonOption = hasCustomCoordinateOption(normalizedOptionValues, 'lon');
    const hasAccOption = hasDeviceAccuracyOption(normalizedOptionValues);
    if (hasAccOption) {
      const hasAccuracyDefinition = definitions.some((def) => {
        if (!def) return false;
        if (def._auto === 'accuracy') return true;
        return normalizeOptionKey(def.event_option_name) === DEVICE_ACCURACY_KEY;
      });
      if (!hasAccuracyDefinition) {
        definitions = [
          ...definitions,
          {
            event_option_name: DEVICE_ACCURACY_OPTION_NAME,
            event_option_label: 'Device Accuracy (m)',
            event_option_type: 'text',
            event_option_required: false,
            event_option_allow_freeform: false,
            event_option_default_value: findOptionValueByRegex(event.option_values, /(accuracy|acc[_\s]?m\b)/i) ?? '',
            _auto: 'accuracy',
            _synthetic: true,
            _id: `device-accuracy-${event.localId || 'event'}`,
          },
        ];
      }
    }
    if (dom.eventEditorTimestamp) {
      dom.eventEditorTimestamp.value = event.eventTimestampUTC || '';
    }
    if (dom.eventEditorTimestampError) {
      dom.eventEditorTimestampError.hidden = true;
      dom.eventEditorTimestampError.textContent = '';
    }
    if (dom.eventEditorNotes) {
      dom.eventEditorNotes.value = event.notes ?? '';
    }
    const latOptionValue = findOptionValueByRegex(event.option_values, /latitude/i);
    const lonOptionValue = findOptionValueByRegex(event.option_values, /longitude/i);
    const accOptionValue = findOptionValueByRegex(event.option_values, /(accuracy|acc[_\s]?m\b)/i);

    const latField = dom.eventEditorLat?.closest('.form-field');
    const latInputEl = dom.eventEditorLat;
    const showLatField = !hasLatOption && (Number.isFinite(event.lat) || latOptionValue != null);
    if (latField) {
      if (showLatField) {
        latField.hidden = false;
        latField.style.display = '';
        if (latInputEl) {
          delete latInputEl.dataset.skip;
          latInputEl.value = latOptionValue != null ? String(latOptionValue) : Number.isFinite(event.lat) ? String(event.lat) : '';
        }
      } else {
        latField.hidden = true;
        latField.style.display = 'none';
        if (latInputEl) {
          latInputEl.dataset.skip = 'true';
          latInputEl.value = Number.isFinite(event.lat) ? String(event.lat) : latOptionValue != null ? String(latOptionValue) : '';
        }
      }
    }

    const lonField = dom.eventEditorLon?.closest('.form-field');
    const lonInputEl = dom.eventEditorLon;
    const showLonField = !hasLonOption && (Number.isFinite(event.lon) || lonOptionValue != null);
    if (lonField) {
      if (showLonField) {
        lonField.hidden = false;
        lonField.style.display = '';
        if (lonInputEl) {
          delete lonInputEl.dataset.skip;
          lonInputEl.value = lonOptionValue != null ? String(lonOptionValue) : Number.isFinite(event.lon) ? String(event.lon) : '';
        }
      } else {
        lonField.hidden = true;
        lonField.style.display = 'none';
        if (lonInputEl) {
          lonInputEl.dataset.skip = 'true';
          lonInputEl.value = Number.isFinite(event.lon) ? String(event.lon) : lonOptionValue != null ? String(lonOptionValue) : '';
        }
      }
    }

    const accField = dom.eventEditorAcc?.closest('.form-field');
    const accInputEl = dom.eventEditorAcc;
    const showAccField = !hasAccOption && (Number.isFinite(event.acc_m) || accOptionValue != null);
    if (accField) {
      const accValue = accOptionValue != null
        ? String(accOptionValue)
        : Number.isFinite(event.acc_m) ? String(event.acc_m) : '';
      if (showAccField) {
        accField.hidden = false;
        accField.style.display = '';
        if (accInputEl) {
          delete accInputEl.dataset.skip;
          accInputEl.value = accValue;
        }
      } else {
        accField.hidden = true;
        accField.style.display = 'none';
        if (accInputEl) {
          accInputEl.dataset.skip = 'true';
          accInputEl.value = accValue;
        }
      }
    }
    renderEventEditorOptions(definitions, event.option_values);
    updateGpsLoggingWarning();
    editorFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dom.eventEditor) {
      const wasHidden = dom.eventEditor.hidden;
      dom.eventEditor.hidden = false;
      if (wasHidden) {
        lockBodyScroll();
      }
    }
    if (dom.eventEditorTimestamp) {
      dom.eventEditorTimestamp.focus();
    }
  } catch (err) {
    status(dom.syncStatus, 'alert', `Unable to load event: ${err.message}`);
  }
}

async function handleEventEditorSubmit(ev) {
  ev.preventDefault();
  if (!editingEvent) return;
  const original = editingEvent;
  if (dom.eventEditorTimestampError) {
    dom.eventEditorTimestampError.hidden = true;
    dom.eventEditorTimestampError.textContent = '';
  }
  try {
    const timestampIso = normalizeUtcInput(dom.eventEditorTimestamp?.value ?? '');
    const notesValue = dom.eventEditorNotes?.value?.trim() ?? '';
    const latInputEl = dom.eventEditorLat;
    const lonInputEl = dom.eventEditorLon;
    const accInputEl = dom.eventEditorAcc;
    const skipLatInput = !!latInputEl?.dataset?.skip;
    const skipLonInput = !!lonInputEl?.dataset?.skip;
    const skipAccInput = !!accInputEl?.dataset?.skip;
    const latRaw = latInputEl?.value?.trim() ?? '';
    const lonRaw = lonInputEl?.value?.trim() ?? '';
    const accRaw = accInputEl?.value?.trim() ?? '';
    const latNumber = !skipLatInput && latRaw ? Number(latRaw) : null;
    if (!skipLatInput && latRaw && Number.isNaN(latNumber)) {
      throw new Error('Latitude must be a number');
    }
    const lonNumber = !skipLonInput && lonRaw ? Number(lonRaw) : null;
    if (!skipLonInput && lonRaw && Number.isNaN(lonNumber)) {
      throw new Error('Longitude must be a number');
    }
    const accNumberRaw = !skipAccInput && accRaw ? Number(accRaw) : null;
    if (!skipAccInput && accRaw && Number.isNaN(accNumberRaw)) {
      throw new Error('Accuracy must be a number');
    }
    const fix = editorNeedsGpsFix() ? await getLoggingFix() : null;
    // The user can close this editor and open another while GPS is pending.
    if (editingEvent !== original) return;
    const { optionValues, optionMap } = collectEditorOptionValues({ timestampIso, fix });
    const changes = {};
    let nextLat = skipLatInput ? original.lat : latNumber;
    let nextLon = skipLonInput ? original.lon : lonNumber;
    let nextAcc = skipAccInput ? original.acc_m : accNumberRaw;

    if (skipLatInput) {
      const latFromOptions = coordinateFromOptionMap(optionMap, 'lat');
      if (latFromOptions != null) {
        nextLat = latFromOptions;
      }
    }
    if (!skipLatInput && latNumber == null) {
      nextLat = null;
    }

    if (skipLonInput) {
      const lonFromOptions = coordinateFromOptionMap(optionMap, 'lon');
      if (lonFromOptions != null) {
        nextLon = lonFromOptions;
      }
    }
    if (!skipLonInput && lonNumber == null) {
      nextLon = null;
    }

    if (skipAccInput) {
      const accFromOptions = optionMap[DEVICE_ACCURACY_OPTION_NAME];
      const parsedAcc = toNumberOrNull(accFromOptions);
      if (parsedAcc != null) {
        nextAcc = parsedAcc;
      }
    } else {
      nextAcc = accNumberRaw != null ? accNumberRaw : null;
    }

    if (original.eventTimestampUTC !== timestampIso) changes.eventTimestampUTC = timestampIso;
    if ((original.notes ?? '') !== notesValue) changes.notes = notesValue;
    if (!numbersEqual(original.lat, nextLat)) changes.lat = nextLat;
    if (!numbersEqual(original.lon, nextLon)) changes.lon = nextLon;
    if (!numbersEqual(original.acc_m, nextAcc)) changes.acc_m = nextAcc;
    const oldOptionMap = optionMapFromArray(original.option_values);
    const normalizedOld = buildNormalizedOptionMap(oldOptionMap);
    const normalizedNew = buildNormalizedOptionMap(optionMap);
    const optionChanges = {};
    const allOptionKeys = new Set([...Object.keys(normalizedOld), ...Object.keys(normalizedNew)]);
    allOptionKeys.forEach((normalizedKey) => {
      const prev = normalizedOld[normalizedKey] ?? '';
      const next = normalizedNew[normalizedKey] ?? '';
      if (String(prev) === String(next)) return;
      const originalName =
        findOptionNameByNormalizedKey(optionMap, normalizedKey) ??
        findOptionNameByNormalizedKey(oldOptionMap, normalizedKey) ??
        normalizedKey;
      optionChanges[originalName] = next;
    });
    if (Object.keys(optionChanges).length) {
      changes.options = optionChanges;
    }
    if (Object.keys(changes).length === 0) {
      closeEventEditor();
      status(dom.syncStatus, null, 'No changes to apply.');
      return;
    }
    const requiresPatch = !!original.serverId;
    if (requiresPatch) {
      let editorWasVisible = false;
      if (dom.eventEditor && dom.eventEditor.hidden === false) {
        dom.eventEditor.hidden = true;
        editorWasVisible = true;
      }
      // Mention edit-mode auto-fill rules in the patch confirmation.
      const hasEditRules = editingAutoOptionDefinitions.some(
        (def) => isRuleAuto(def?._auto)
      );
      const patchMessage = hasEditRules
        ? 'This event is already synced. Apply changes to the server on next sync? Auto-fill rules will refresh on save.'
        : 'This event is already synced. Apply changes to the server on next sync?';
      const confirmed = await openConfirmModal({
        title: 'Patch Synced Event?',
        message: patchMessage,
        confirmLabel: 'Patch on Next Sync'
      });
      if (!confirmed) {
        if (editorWasVisible && dom.eventEditor) {
          dom.eventEditor.hidden = false;
          if (dom.eventEditorTimestamp) dom.eventEditorTimestamp.focus();
        }
        return;
      }
    }
    const updatedEvent = structuredClone(original);
    updatedEvent.eventTimestampUTC = timestampIso;
    updatedEvent.notes = notesValue;
    updatedEvent.lat = nextLat;
    updatedEvent.lon = nextLon;
    updatedEvent.acc_m = nextAcc;
    updatedEvent.option_values = optionValues;
    updatedEvent.payload = {
      ...(updatedEvent.payload || {}),
      utc: timestampIso,
      notes: notesValue,
      lat: nextLat,
      lon: nextLon,
      acc_m: nextAcc,
      client_uuid: updatedEvent.localId,
      options: optionMap
    };
    syncEventPayload(updatedEvent);
    updatedEvent.updatedAtMs = Date.now();
    updatedEvent.updatedAtUTC = new Date(updatedEvent.updatedAtMs).toISOString();
    const revision = {
      atUTC: updatedEvent.updatedAtUTC,
      changes,
      editorUserId: currentUserId || localStorage.getItem('userId') || 'unknown'
    };
    updatedEvent.revisions = Array.isArray(updatedEvent.revisions) ? updatedEvent.revisions : [];
    updatedEvent.revisions.push(revision);
    updatedEvent.lastError = null;
    updatedEvent.attemptCount = 0;
    updatedEvent.nextAttemptMs = Date.now();
    if (requiresPatch) {
      updatedEvent.syncState = SYNC_STATE.PATCH_PENDING;
    } else {
      updatedEvent.syncState = SYNC_STATE.UNSYNCED;
    }
    await put(EVENT_STORE, updatedEvent);
    editingEvent = updatedEvent;
    closeEventEditor();
    status(
      dom.syncStatus,
      null,
      requiresPatch ? 'Changes queued — will patch on next sync.' : 'Changes saved. Sync to upload.'
    );
    await render();
    scheduleNextSync(Date.now());
    if (navigator.onLine) {
      syncAll();
    }
  } catch (err) {
    if (editingEvent !== original) return;
    if (dom.eventEditorTimestampError && /UTC|timestamp/i.test(err.message || '')) {
      dom.eventEditorTimestampError.textContent = err.message;
      dom.eventEditorTimestampError.hidden = false;
      return;
    }
    alert(err.message || 'Failed to update event.');
  }
}

async function getMetaValue(key) {
  const record = await get(META_STORE, key);
  return record ? record.v : null;
}

async function setMetaValue(key, value) {
  await put(META_STORE, { k: key, v: value });
}

async function setTemplates(templates) {
  const store = await storeTransaction(TEMPLATE_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      const tx = store.transaction;
      const normalized = Array.isArray(templates)
        ? templates.map(normalizeTemplate).filter(Boolean)
        : [];
      normalized.forEach((tpl) => {
        store.put(tpl);
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    clearReq.onerror = () => reject(clearReq.error);
  });
}

async function getTemplatesFromDb() {
  return getAll(TEMPLATE_STORE);
}

function status(el, state, message) {
  if (!el) return;
  if (state) {
    el.dataset.state = state;
  }
  // A null/undefined state preserves the existing severity color so
  // callers can update text without clearing the indicator. To explicitly
  // clear, set el.removeAttribute('data-state') at the call site.
  el.textContent = message;
}

function setGpsStatus(state, message) {
  const display = resolveGpsStatusDisplay({
    state,
    message,
    asnapBackfillEnabled
  });
  status(dom.gpsStatus, display.state, display.message);
}

function setTemplateCaches(templates) {
  const normalized = Array.isArray(templates)
    ? templates.map(normalizeTemplate).filter(Boolean)
    : [];
  templatesCache = normalized
    .slice()
    .sort((a, b) => (a.event_name || '').localeCompare(b.event_name || ''));
  templateLookup = new Map();
  templatesCache.forEach((tpl) => {
    templateLookup.set(tpl.id, tpl);
  });
  categoriesCache = uniqueCategories(templatesCache);
  if (!categoriesCache.length) categoriesCache = ['uncategorized'];
  if (selectedCategory !== 'all' && !categoriesCache.includes(selectedCategory)) {
    selectedCategory = 'all';
  }
  currentOptionState = {};
  updateCategorySelect();
  updateTemplateSelect();
}

function detectAutoType(option, ctx = null) {
  // Runtime auto-fill requires an explicit rule. Name-based GPS inference
  // applies only to default seeding and display, where ctx is null.
  return classifyAutoType(option.event_option_name, ctx, autoFillRules);
}

function buildOptionDefinitions(template, ctx = null) {
  const defs = [];
  const baseOptions = Array.isArray(template?.event_options) ? template.event_options : [];
  let hasCoordinateAuto = false;
  let hasAccuracyAuto = false;
  baseOptions.forEach((opt, idx) => {
    const option = { ...opt };
    option.event_option_name = option.event_option_name || `Option ${idx + 1}`;
    option.event_option_type = option.event_option_type || 'text';
    option._auto = detectAutoType(option, ctx);
    option._id = `${template.id || 'tpl'}-${idx}-${option.event_option_name.replace(/\W+/g, '-').toLowerCase()}`;
    if (option._auto === 'latitude' || option._auto === 'longitude' || option._auto === 'rule:lat' || option._auto === 'rule:lon') {
      hasCoordinateAuto = true;
    }
    if (option._auto === 'accuracy' || option._auto === 'rule:acc') {
      hasAccuracyAuto = true;
    }
    defs.push(option);
  });
  if (hasCoordinateAuto && !hasAccuracyAuto) {
    defs.push({
      event_option_name: DEVICE_ACCURACY_OPTION_NAME,
      event_option_label: 'Device Accuracy (m)',
      event_option_type: 'text',
      event_option_required: false,
      event_option_allow_freeform: false,
      _auto: 'accuracy',
      _synthetic: true,
      _id: `device-accuracy-${template.id || 'fallback'}`
    });
  }
  defs.push({
    event_option_name: DEVICE_UTC_OPTION_NAME,
    event_option_label: 'Device UTC',
    event_option_type: 'text',
    event_option_required: false,
    event_option_allow_freeform: false,
    _auto: 'phoneUtc',
    _synthetic: true,
    _id: `device-utc-${template.id || 'fallback'}`
  });
  return defs;
}

function augmentDefinitionsWithEventOptions(definitions, optionValues, event = null) {
  const augmented = Array.isArray(definitions) ? [...definitions] : [];
  const known = new Set();
  augmented.forEach((def) => {
    if (!def || !def.event_option_name) return;
    known.add(normalizeOptionKey(def.event_option_name));
  });
  const normalizedOptions = normalizeOptionValues(optionValues);
  const idPrefix = event?.localId ? `loaded-${event.localId}` : 'loaded-option';
  normalizedOptions.forEach((opt, index) => {
    const normalizedName = normalizeOptionKey(opt.event_option_name);
    if (!normalizedName) return;
    if (normalizedName === DEVICE_UTC_KEY) return;
    if (normalizedName === DEVICE_ACCURACY_KEY) return;
    if (normalizedName === CLIENT_UUID_OPTION_KEY) return;
    if (known.has(normalizedName)) return;
    const synthetic = {
      event_option_name: opt.event_option_name,
      event_option_label: formatOptionLabel(opt.event_option_name),
      event_option_type: 'text',
      event_option_required: false,
      event_option_default_value: opt.event_option_value,
      _id: `${idPrefix}-${index}-${normalizedName}`,
      _synthetic: true,
    };
    augmented.push(synthetic);
    known.add(normalizedName);
  });
  return augmented;
}

function clearOptionInputs() {
  currentOptionDefinitions = [];
  currentOptionInputMap = new Map();
  if (dom.optionFields) {
    dom.optionFields.innerHTML = '';
    dom.optionFields.hidden = true;
  }
}

function getActiveTemplate() {
  const select = dom.type;
  if (!select) return null;
  const value = select.value;
  if (!value) return null;
  return templateLookup.get(value) || null;
}

function formatUtcSummary(iso) {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${UTC_SUMMARY_FORMATTER.format(date)} UTC`;
}

function collectOptionValues({ fix, eventUtc }) {
  const results = [];
  const missing = [];

  currentOptionDefinitions.forEach((option) => {
    const optionName = option.event_option_name || 'Option';
    let value;
    if (option._auto === 'latitude') {
      if (!fix || !Number.isFinite(fix.lat)) {
        value = null;
      } else {
        value = Number(fix.lat).toFixed(6);
      }
    } else if (option._auto === 'longitude') {
      if (!fix || !Number.isFinite(fix.lon)) {
        value = null;
      } else {
        value = Number(fix.lon).toFixed(6);
      }
    } else if (option._auto === 'accuracy') {
      if (!fix || !Number.isFinite(fix.acc_m)) {
        value = null;
      } else {
        value = Math.round(Number(fix.acc_m));
      }
    } else if (option._auto === 'phoneUtc') {
      value = eventUtc || nowUtc();
    } else if (isRuleAuto(option._auto)) {
      // Log-time rule fields have no editable input, so their current value
      // is null and fill-if-empty rules apply.
      const source = option._auto.slice(5);
      const ruleValue = applySourceValue(source, {
        nowUtc: nowUtc(),
        fix
      });
      const currentValue = null;
      value = shouldApplyRule(currentValue) ? ruleValue : currentValue;
    } else if ((option.event_option_type || '').toLowerCase() === 'static text') {
      value = option.event_option_default_value ?? (Array.isArray(option.event_option_values) ? option.event_option_values[0] : '') ?? '';
    } else {
      const entry = currentOptionInputMap.get(option._id);
      value = entry ? entry.getValue() : '';
      if (entry) entry.markInvalid(false);
    }

    const entryRef = currentOptionInputMap.get(option._id);
    const isMissing = option.event_option_required && (value == null || value === '' || (Array.isArray(value) && value.length === 0));
    if (isMissing) {
      missing.push(optionName);
      entryRef?.markInvalid(true);
    } else {
      entryRef?.markInvalid(false);
    }

    if (Array.isArray(value) && value.length === 0) {
      value = null;
    }

    if (value != null && value !== '') {
      let normalizedValue = value;
      if (Array.isArray(value)) {
        normalizedValue = value.map((item) => String(item)).join(', ');
      } else if (typeof value !== 'string') {
        normalizedValue = String(value);
      }
      results.push({
        event_option_name: optionName,
        event_option_value: normalizedValue
      });
    } else if (option._auto === 'phoneUtc') {
      results.push({
        event_option_name: optionName,
        event_option_value: eventUtc || nowUtc()
      });
    }
  });

  if (missing.length) {
    throw new Error(`Fill required fields: ${missing.join(', ')}`);
  }

  const hasDeviceUtc = results.some((opt) => normalizeOptionKey(opt.event_option_name) === DEVICE_UTC_KEY);
  if (!hasDeviceUtc) {
    results.push({
      event_option_name: DEVICE_UTC_OPTION_NAME,
      event_option_value: eventUtc || nowUtc()
    });
  }

  return {
    optionValues: results
  };
}

function updateOptionForm() {
  const container = dom.optionFields;
  if (!container) return;
  container.innerHTML = '';
  container.hidden = true;
  currentOptionInputMap = new Map();
  const template = getActiveTemplate();
  if (!template) {
    currentOptionDefinitions = [];
    return;
  }
  currentOptionDefinitions = buildOptionDefinitions(template, {
    templateId: template?.id,
    eventValue: template?.event_value,
    mode: 'log'
  });
  let hasInteractiveFields = false;
  currentOptionDefinitions.forEach((option) => {
    const autoType = option._auto;
    if (autoType === 'phoneUtc') {
      // Do not render; captured automatically
      return;
    }
    if (autoType === 'latitude' || autoType === 'longitude' || autoType === 'accuracy') {
      const field = document.createElement('div');
      field.className = 'option-field auto';
      const label = document.createElement('div');
      label.className = 'option-label';
      const displayName = option.event_option_label || formatOptionLabel(option.event_option_name);
      label.textContent = displayName + ' (auto)';
      const help = document.createElement('p');
      help.className = 'option-help';
      if (autoType === 'latitude') {
        help.textContent = 'Will capture GPS latitude when you log the event.';
      } else if (autoType === 'longitude') {
        help.textContent = 'Will capture GPS longitude when you log the event.';
      } else {
        help.textContent = 'Will capture GPS accuracy (meters) when you log the event.';
      }
      field.appendChild(label);
      field.appendChild(help);
      container.appendChild(field);
      container.hidden = false;
      return;
    }

    if (isRuleAuto(autoType)) {
      // Rule-driven log-time auto-fill. Render as a read-only auto field
      // so the operator sees what will happen on capture without an input.
      const field = document.createElement('div');
      field.className = 'option-field auto';
      const labelEl = document.createElement('div');
      labelEl.className = 'option-label';
      const displayName = option.event_option_label || formatOptionLabel(option.event_option_name);
      labelEl.textContent = displayName + ' (auto)';
      const help = document.createElement('p');
      help.className = 'option-help';
      help.textContent = `Will auto-fill on capture (${describeAutoFillSource(autoType.slice(5))}).`;
      field.appendChild(labelEl);
      field.appendChild(help);
      container.appendChild(field);
      container.hidden = false;
      return;
    }

    hasInteractiveFields = true;
    const field = document.createElement('div');
    field.className = 'option-field';
    const label = document.createElement('div');
    label.className = 'option-label';
    const displayName = option.event_option_label || formatOptionLabel(option.event_option_name);
    label.textContent = displayName + (option.event_option_required ? ' *' : '');
    field.appendChild(label);

    const error = document.createElement('p');
    error.className = 'option-error';
    error.hidden = true;
    field.appendChild(error);

    const entry = { option, markInvalid(flag, message = 'Required field') {
      if (flag) {
        field.classList.add('invalid');
        error.textContent = message;
        error.hidden = false;
      } else {
        field.classList.remove('invalid');
        error.hidden = true;
      }
    } };

    const stateKey = option._id;

    const setState = (value) => {
      currentOptionState[stateKey] = value;
    };

    switch ((option.event_option_type || 'text').toLowerCase()) {
      case 'dropdown': {
        const select = document.createElement('select');
        const values = Array.isArray(option.event_option_values) ? option.event_option_values : [];
        if (!values.length) {
          const optEl = document.createElement('option');
          optEl.value = '';
          optEl.textContent = 'No options defined';
          select.appendChild(optEl);
        } else {
          values.forEach((value) => {
            const optEl = document.createElement('option');
            optEl.value = value;
            optEl.textContent = value;
            select.appendChild(optEl);
          });
        }
        const defaultValue = currentOptionState[stateKey] ?? option.event_option_default_value ?? select.options[0]?.value ?? '';
        select.value = defaultValue;
        setState(defaultValue);
        select.addEventListener('change', () => setState(select.value));
        field.appendChild(select);
        let freeInput = null;
        if (option.event_option_allow_freeform) {
          freeInput = document.createElement('input');
          freeInput.type = 'text';
          freeInput.placeholder = 'Other (optional)';
          freeInput.value = currentOptionState[`${stateKey}-other`] || '';
          freeInput.addEventListener('input', () => {
            currentOptionState[`${stateKey}-other`] = freeInput.value.trim();
          });
          field.appendChild(freeInput);
        }
        entry.getValue = () => {
          const other = option.event_option_allow_freeform ? (freeInput?.value.trim() || '') : '';
          if (other) return other;
          return select.value.trim();
        };
        break;
      }
      case 'radio buttons': {
        const values = Array.isArray(option.event_option_values) ? option.event_option_values : [];
        const group = document.createElement('div');
        group.className = 'option-radio-group';
        const groupName = `${stateKey}-radio`;
        values.forEach((value) => {
          const wrapper = document.createElement('label');
          wrapper.className = 'option-radio';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = groupName;
          input.value = value;
          const span = document.createElement('span');
          span.textContent = value;
          wrapper.appendChild(input);
          wrapper.appendChild(span);
          group.appendChild(wrapper);
          input.addEventListener('change', () => setState(input.checked ? input.value : currentOptionState[stateKey]));
        });
        field.appendChild(group);
        const defaultValue = currentOptionState[stateKey] ?? option.event_option_default_value;
        if (defaultValue) {
          const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
          radios.forEach((input) => {
            input.checked = input.value === defaultValue;
          });
          setState(defaultValue);
        }
        let freeInput = null;
        if (option.event_option_allow_freeform) {
          freeInput = document.createElement('input');
          freeInput.type = 'text';
          freeInput.placeholder = 'Other (optional)';
          freeInput.value = currentOptionState[`${stateKey}-other`] || '';
          freeInput.addEventListener('input', () => {
            currentOptionState[`${stateKey}-other`] = freeInput.value.trim();
          });
          field.appendChild(freeInput);
        }
        entry.getValue = () => {
          if (option.event_option_allow_freeform) {
            const other = freeInput?.value.trim();
            if (other) return other;
          }
          const checked = group.querySelector('input:checked');
          return checked ? checked.value : '';
        };
        break;
      }
      case 'checkboxes': {
        const wrapper = document.createElement('div');
        wrapper.className = 'option-checkbox-group';
        const values = Array.isArray(option.event_option_values) ? option.event_option_values : [];
        const selected = new Set(Array.isArray(currentOptionState[stateKey]) ? currentOptionState[stateKey] : []);
        const defaultValues = currentOptionState[stateKey] == null ? option.event_option_default_value : null;
        if (Array.isArray(defaultValues)) {
          defaultValues.forEach((val) => selected.add(val));
        } else if (typeof defaultValues === 'string' && defaultValues) {
          selected.add(defaultValues);
        }
        values.forEach((value) => {
          const labelEl = document.createElement('label');
          labelEl.className = 'option-checkbox';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = value;
          if (selected.has(value)) {
            input.checked = true;
          }
          input.addEventListener('change', () => {
            if (input.checked) {
              selected.add(value);
            } else {
              selected.delete(value);
            }
            setState(Array.from(selected));
          });
          const span = document.createElement('span');
          span.textContent = value;
          labelEl.appendChild(input);
          labelEl.appendChild(span);
          wrapper.appendChild(labelEl);
        });
        let otherInput = null;
        if (option.event_option_allow_freeform) {
          otherInput = document.createElement('input');
          otherInput.type = 'text';
          otherInput.placeholder = 'Other (optional)';
          otherInput.value = currentOptionState[`${stateKey}-other`] || '';
          otherInput.addEventListener('input', () => {
            currentOptionState[`${stateKey}-other`] = otherInput.value.trim();
          });
          wrapper.appendChild(otherInput);
        }
        setState(Array.from(selected));
        field.appendChild(wrapper);
        entry.getValue = () => {
          const chosen = Array.from(selected);
          const otherValue = option.event_option_allow_freeform ? (otherInput?.value.trim() || '') : '';
          if (otherValue) chosen.push(otherValue);
          return chosen;
        };
        break;
      }
      case 'static text': {
        const value = option.event_option_default_value ?? (Array.isArray(option.event_option_values) ? option.event_option_values[0] : '') ?? '';
        const textNode = document.createElement('p');
        textNode.className = 'option-help';
        textNode.textContent = value || '(static text)';
        field.appendChild(textNode);
        entry.getValue = () => value;
        break;
      }
      case 'textarea': {
        const textarea = document.createElement('textarea');
        textarea.rows = 3;
        textarea.value = currentOptionState[stateKey] ?? option.event_option_default_value ?? '';
        textarea.addEventListener('input', () => setState(textarea.value));
        field.appendChild(textarea);
        entry.getValue = () => textarea.value.trim();
        break;
      }
      default: {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentOptionState[stateKey] ?? option.event_option_default_value ?? '';
        input.addEventListener('input', () => setState(input.value));
        field.appendChild(input);
        entry.getValue = () => input.value.trim();
        break;
      }
    }

    container.appendChild(field);
    container.hidden = false;
    entry.markInvalid(false);
    currentOptionInputMap.set(stateKey, entry);
  });

  if (!hasInteractiveFields && container.childElementCount === 0) {
    container.hidden = true;
  }
}

function findTemplateForEvent(event) {
  if (!event) return null;
  const candidates = [];
  if (event.eventTemplateId) candidates.push(event.eventTemplateId);
  if (event.eventTemplateName) candidates.push(event.eventTemplateName);
  if (event.type) candidates.push(event.type);
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (templateLookup.has(candidate)) return templateLookup.get(candidate);
  }
  return templatesCache.find((tpl) => {
    return (
      tpl.id === event.eventTemplateId ||
      tpl.event_value === event.type ||
      tpl.event_name === event.eventTemplateName
    );
  }) || null;
}

function useFallbackTemplates() {
  templatesCache = [];
  categoriesCache = [];
  selectedCategory = 'all';
  templateLookup = new Map();
  FALLBACK_TEMPLATES.forEach((tpl) => {
    templateLookup.set(tpl.id, tpl);
  });
  currentOptionState = {};
  updateCategorySelect();
  updateTemplateSelect();
}

function updateCategorySelect() {
  const selectEl = dom.categorySelect;
  const labelEl = dom.categoryLabel;
  const fieldEl = dom.categoryField;
  if (!selectEl || !labelEl) return;

  const categories = templatesCache.length ? ['all', ...categoriesCache] : ['all'];
  selectEl.innerHTML = '';

  categories.forEach((cat) => {
    const option = document.createElement('option');
    option.value = cat;
    const count = cat === 'all'
      ? (templatesCache.length || FALLBACK_TEMPLATES.length)
      : filterTemplatesByCategory(templatesCache, cat).length;
    option.textContent = `${formatCategoryLabel(cat)}${cat === 'all' ? '' : ` (${count})`}`;
    selectEl.appendChild(option);
  });

  if (!categories.includes(selectedCategory)) {
    selectedCategory = 'all';
  }
  selectEl.value = selectedCategory;

  const shouldHide = !templatesCache.length || categories.length <= 1;
  if (fieldEl) fieldEl.hidden = shouldHide;
  selectEl.hidden = shouldHide;
  labelEl.hidden = shouldHide;
}

function updateTemplateSelect() {
  const select = dom.type;
  if (!select) return;
  const previousValue = select.value;
  const previousTemplateId = select.selectedOptions.length ? select.selectedOptions[0].dataset.templateId : null;
  select.innerHTML = '';

  let sourceTemplates;
  if (templatesCache.length) {
    templateLookup = new Map();
    templatesCache.forEach((tpl) => {
      templateLookup.set(tpl.id, tpl);
    });
    sourceTemplates = filterTemplatesByCategory(templatesCache, selectedCategory);
  } else {
    templateLookup = new Map();
    FALLBACK_TEMPLATES.forEach((tpl) => templateLookup.set(tpl.id, tpl));
    sourceTemplates = FALLBACK_TEMPLATES;
  }

  let rulesChanged = false;
  templateLookup.forEach((template) => {
    if (seedDefaultAutoFillRules(template)) rulesChanged = true;
  });
  if (rulesChanged) {
    saveAutoFillRules(autoFillRules);
    updateAutoFillRulesSummary();
  }

  if (!sourceTemplates.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No templates in this category';
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
    currentOptionState = {};
    clearOptionInputs();
    return;
  }

  let newValue = null;
  sourceTemplates.forEach((tpl) => {
    const key = tpl.id;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = tpl.event_name || tpl.event_value || 'Unnamed template';
    option.dataset.eventValue = tpl.event_value || tpl.event_name || key;
    option.dataset.templateId = tpl.id || '';
    option.dataset.templateName = tpl.event_name || tpl.event_value || key;
    option.dataset.templateCategoryList = Array.isArray(tpl.template_categories) ? tpl.template_categories.join(',') : '';
    select.appendChild(option);
    if (key === previousValue || (tpl.id && tpl.id === previousTemplateId)) {
      newValue = key;
    }
  });

  if (!newValue) {
    newValue = sourceTemplates[0].id;
  }
  select.value = newValue;
  lastTypeValue = newValue;
  currentOptionState = {};
  updateOptionForm();
}

async function loadTemplatesFromDb() {
  try {
    const stored = await getTemplatesFromDb();
    if (stored && stored.length) {
      const filtered = stored.filter((tpl) => tpl.disabled !== true && tpl.admin_only !== true);
      if (filtered.length) {
        setTemplateCaches(filtered);
      } else {
        useFallbackTemplates();
      }
    } else {
      useFallbackTemplates();
    }
  } catch {
    useFallbackTemplates();
  }
}

async function refreshTemplatesFromServer({ showStatus = true } = {}) {
  const jwt = localStorage.getItem('jwt');
  if (!jwt) return false;
  try {
    const apiRoot = resolveApiRoot();
    const response = await fetch(`${apiRoot}/api/v1/event_templates`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${jwt}`
      }
    });
    if (response.status === 401) {
      localStorage.removeItem('jwt');
      localStorage.removeItem('username');
      updateAuthUI();
      status(dom.syncStatus, null, 'Session expired while updating templates. Please sign in again.');
      useFallbackTemplates();
      return false;
    }
    if (!response.ok) {
      throw new Error(`Template fetch failed (${response.status})`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Unexpected template payload');
    }
    const normalized = data.map(normalizeTemplate).filter(Boolean);
    const filtered = normalized.filter((tpl) => tpl.disabled !== true && tpl.admin_only !== true);
    await setTemplates(filtered);
    await setMetaValue(META_LAST_TEMPLATE_SYNC, Date.now());
    setTemplateCaches(filtered);
    if (showStatus) {
      status(dom.syncStatus, null, `Templates updated (${filtered.length})`);
    }
    return true;
  } catch (err) {
    if (showStatus) {
      status(dom.syncStatus, null, `Template update failed: ${err.message}`);
    }
    return false;
  }
}

function connectionState() {
  const online = navigator.onLine;
  status(dom.connectStatus, online ? 'ok' : 'alert', online ? 'Sealog Online' : 'Sealog Offline');
}

// Write fix-warning text to both the in-modal element AND the off-screen
// aria-live mirror so screen readers announce changes even when #gpsModal
// is closed (the modal subtree is display:none by default).
function writeFixWarning(text) {
  if (dom.fixWarning) dom.fixWarning.textContent = text;
  if (dom.fixWarningAnnounce) dom.fixWarningAnnounce.textContent = text;
}

function updateFixUI() {
  updateGpsLoggingWarning();
  const policy = gpsLoggingPolicy();
  dom.fixWarning.classList.remove('alert');
  if (!lastFix || policy.reason === 'missing') {
    dom.fixSummary.textContent = lastFix ? 'No valid GPS fix' : 'No GPS fix';
    dom.fixAge.textContent = '';
    writeFixWarning(lastFixMessage || '');
    setGpsStatus('warn', 'GPS idle');
  } else {
    const { lat, lon, acc_m } = lastFix;
    dom.fixSummary.textContent = `Fix: ${lat.toFixed(6)}, ${lon.toFixed(6)} ${formatAccuracyMeters(acc_m)}`;
    const ageMs = Date.now() - lastFix.timestampMs;
    dom.fixAge.textContent = Number.isFinite(ageMs) && ageMs >= 0
      ? `Last fix ${formatDuration(ageMs)} ago` : 'Fix time unavailable';
    if (!policy.allowed) {
      writeFixWarning(gpsLoggingBlockedMessage(policy));
      setGpsStatus('warn', 'GPS logging paused');
    } else if (policy.warning) {
      writeFixWarning(policy.warning);
      setGpsStatus('warn', 'GPS fix low accuracy');
    } else if (acc_m > 30) {
      writeFixWarning(`Accuracy is ±${Math.round(acc_m)}m — consider waiting for a tighter fix.`);
      setGpsStatus('warn', 'GPS fix low accuracy');
    } else {
      writeFixWarning(lastFixMessage);
      setGpsStatus('ok', 'GPS fix ready');
    }
  }
  if (asnapEnabled && asnapPauseReason === 'gps-policy' && policy.allowed) {
    recomputeAsnapScheduler();
  } else {
    updateAsnapStatus();
  }
}

function setFixMessage(message, level = 'warn') {
  lastFixMessage = message;
  if (message) {
    writeFixWarning(message);
    if (level === 'alert') {
      dom.fixWarning.classList.add('alert');
    } else {
      dom.fixWarning.classList.remove('alert');
    }
  } else {
    writeFixWarning('');
    dom.fixWarning.classList.remove('alert');
  }
}

function requestPassiveFix({ force = false } = {}) {
  if (!('geolocation' in navigator)) return;
  if (gpsWarmupInFlight) return;
  if (gpsWarmupPermissionDenied) return;
  if (document.visibilityState && document.visibilityState !== 'visible') return;

  const now = Date.now();
  const ageMs = now - lastFix?.timestampMs;
  if (
    !force &&
    lastFix?.timestampMs &&
    ageMs >= 0 &&
    ageMs < GPS_WARMUP_STALE_THRESHOLD_MS
  ) {
    return;
  }

  gpsWarmupInFlight = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsWarmupInFlight = false;
      const { latitude, longitude, accuracy } = pos.coords;
      lastFix = { lat: latitude, lon: longitude, acc_m: accuracy, timestampMs: pos.timestamp };
      lastFixMessage = '';
      updateFixUI();
      if (asnapEnabled) {
        recomputeAsnapScheduler();
      }
    },
    (err) => {
      gpsWarmupInFlight = false;
      if (err?.code === err?.PERMISSION_DENIED) {
        gpsWarmupPermissionDenied = true;
        stopGpsWarmup();
      }
      try {
        console.debug('[gps] Warm-up fix failed', err);
      } catch {
        // ignore console errors
      }
    },
    GEO_OPTIONS
  );
}

function startGpsWarmup({ immediate = true } = {}) {
  if (!('geolocation' in navigator)) return;
  if (gpsWarmupTimerId) return;
  if (gpsWarmupPermissionDenied) return;
  if (document.visibilityState && document.visibilityState !== 'visible') return;

  if (immediate) {
    requestPassiveFix({ force: true });
  }

  gpsWarmupTimerId = setInterval(() => {
    requestPassiveFix();
  }, GPS_WARMUP_INTERVAL_MS);
}

function stopGpsWarmup() {
  if (gpsWarmupTimerId) {
    clearInterval(gpsWarmupTimerId);
    gpsWarmupTimerId = null;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    startGpsWarmup({ immediate: true });
    triggerServiceWorkerUpdateCheck();
  } else {
    stopGpsWarmup();
  }
  updateAsnapStatus();
}

async function getFix() {
  setGpsStatus('warn', 'Requesting GPS fix…');
  setFixMessage('');
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      setFixMessage('Geolocation is not available on this device.', 'alert');
      setGpsStatus('alert', 'GPS unavailable');
      if (lastFix) {
        setFixMessage('Using last known fix — confirm coordinates before logging.', 'alert');
        updateFixUI();
        resolve(lastFix);
      } else {
        reject(new Error('Geolocation unsupported'));
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        lastFix = { lat: latitude, lon: longitude, acc_m: accuracy, timestampMs: pos.timestamp };
        lastFixMessage = '';
        updateFixUI();
        resolve(lastFix);
      },
      (err) => {
        const friendly = mapGeoError(err);
        if (lastFix) {
          const ageMs = Date.now() - lastFix.timestampMs;
          if (ageMs < STALE_FIX_MAX_MS * 6) {
            setFixMessage(`${friendly}. Using cached fix from ${formatDuration(ageMs)} ago.`, 'warn');
            updateFixUI();
            resolve(lastFix);
            return;
          }
        }
        setFixMessage(`${friendly}.`, 'alert');
        setGpsStatus('alert', 'GPS error');
        reject(new Error(friendly));
      },
      GEO_OPTIONS
    );
  });
}

function updateAuthUI() {
  const jwt = localStorage.getItem('jwt');
  const username = localStorage.getItem('username');
  if (jwt) {
    status(dom.authStatus, 'ok', username ? `Signed in as ${username}` : 'Signed in');
    const summary = username ? `Signed in as ${username}` : 'Signed in';
    if (dom.authSummary) {
      dom.authSummary.textContent = summary;
      dom.authSummary.hidden = false;
    }
    hideElement(dom.loginFields);
    hideElement(dom.loginActions);
    hideElement(dom.userField);
    hideElement(dom.userField?.querySelector('input'));
    hideElement(dom.passwordField);
    hideElement(dom.passwordField?.querySelector('input'));
    hideElement(dom.loginBtn);
    if (dom.signedInAvatar) {
      dom.signedInAvatar.textContent = username ? username.charAt(0).toUpperCase() : '?';
    }
    if (dom.signedInUser) {
      dom.signedInUser.textContent = username || 'Signed in';
    }
    if (dom.signedInMeta) {
      dom.signedInMeta.textContent = 'Signed in to Sealog';
    }
    showElement(dom.signedInActions);
    showElement(dom.signOutBtn);
  } else {
    status(dom.authStatus, 'alert', 'Signed out');
    if (dom.authSummary) {
      dom.authSummary.textContent = 'Sign in to sync events with Sealog.';
      dom.authSummary.hidden = false;
    }
    showElement(dom.loginFields);
    showElement(dom.loginActions);
    showElement(dom.userField);
    showElement(dom.userField?.querySelector('input'));
    showElement(dom.passwordField);
    showElement(dom.passwordField?.querySelector('input'));
    showElement(dom.loginBtn);
    hideElement(dom.signedInActions);
    hideElement(dom.signOutBtn);
  }
  dom.menuBtn?.setAttribute('aria-expanded', authPanelOpen ? 'true' : 'false');
  updateAsnapControls();
  recomputeAsnapScheduler();
  ensureAuthPanelForState();
}

function setAuthPanelOpen(open, { focusField = false, reason = 'manual' } = {}) {
  const wasOpen = authPanelOpen;
  authPanelOpen = open;
  if (!dom.authPanel) return;
  if (open) {
    showElement(dom.authPanel);
    dom.authPanel.setAttribute('data-open', 'true');
  } else {
    hideElement(dom.authPanel);
    dom.authPanel.setAttribute('data-open', 'false');
  }
  if (open && !wasOpen) {
    dom.authPanel.scrollTop = 0;
    lockBodyScroll();
  } else if (!open && wasOpen) {
    unlockBodyScroll();
  }
  if (dom.menuBtn) {
    dom.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (open) {
    authPanelDismissed = false;
    if (focusField && dom.user) {
      setTimeout(() => dom.user.focus(), 50);
    }
  } else if (reason === 'manual' && !localStorage.getItem('jwt')) {
    authPanelDismissed = true;
  }
}

function ensureAuthPanelForState() {
  const signedIn = !!localStorage.getItem('jwt');
  if (!signedIn && !authPanelOpen && !authPanelDismissed) {
    setAuthPanelOpen(true, { focusField: false, reason: 'auto' });
  }
}

async function login() {
  try {
    dom.loginBtn.disabled = true;
    status(dom.authStatus, 'warn', 'Signing in…');
    if (dom.authSummary) {
      dom.authSummary.textContent = 'Requesting token…';
      dom.authSummary.hidden = false;
    }
    const username = dom.user.value.trim();
    const password = dom.pass.value;
    const allowBlankPassword = username.toLowerCase() === 'guest';
    if (!username || (!password && !allowBlankPassword)) {
      throw new Error('Username and password required.');
    }
    const apiRoot = resolveApiRoot();
    const response = await fetch(`${apiRoot}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (response.status === 401) throw new Error('Invalid username or password.');
    if (!response.ok) throw new Error(`Login failed (${response.status}).`);
    const data = await response.json();
    if (!data || !data.token) throw new Error('Server did not return a token.');
    localStorage.setItem('jwt', data.token);
    localStorage.setItem('username', username);
    if (data.id) {
      localStorage.setItem('userId', data.id);
      currentUserId = data.id;
    } else {
      localStorage.removeItem('userId');
      currentUserId = null;
    }
    dom.pass.value = '';
    dom.user.value = '';
    status(dom.authStatus, 'ok', `Signed in as ${username}`);
    if (dom.authSummary) {
      dom.authSummary.textContent = 'Signed in. Tap Sync when network is available.';
      dom.authSummary.hidden = false;
    }
    setAuthPanelOpen(false, { reason: 'auto' });
    await refreshTemplatesFromServer({ showStatus: false });
    await render();
  } catch (err) {
    status(dom.authStatus, 'alert', 'Sign in failed');
    if (dom.authSummary) {
      dom.authSummary.textContent = err.message;
      dom.authSummary.hidden = false;
    }
  } finally {
    dom.loginBtn.disabled = false;
  }
}

async function guestLogin() {
  dom.user.value = 'guest';
  dom.pass.value = '';
  await login();
}

dom.loginBtn.addEventListener('click', (ev) => {
  ev.preventDefault();
  login();
});

dom.guestBtn?.addEventListener('click', (ev) => {
  ev.preventDefault();
  guestLogin().catch((err) => {
    status(dom.authStatus, 'alert', 'Guest login failed');
    if (dom.authSummary) {
      dom.authSummary.textContent = err.message;
      dom.authSummary.hidden = false;
    }
  });
});

dom.refreshTemplatesBtn?.addEventListener('click', async () => {
  if (dom.refreshTemplatesBtn.disabled) return;
  dom.refreshTemplatesBtn.disabled = true;
  const originalLabel = dom.refreshTemplatesBtn.textContent;
  dom.refreshTemplatesBtn.textContent = 'Refreshing…';
  try {
    const success = await refreshTemplatesFromServer({ showStatus: true });
    if (success) {
      const ts = new Date().toLocaleTimeString();
      status(dom.syncStatus, null, `Templates refreshed (${templatesCache.length}) at ${ts}`);
    }
    await render();
  } finally {
    dom.refreshTemplatesBtn.disabled = false;
    dom.refreshTemplatesBtn.textContent = originalLabel;
  }
});

if (dom.menuBtn) {
  dom.menuBtn.addEventListener('click', () => {
    const next = !authPanelOpen;
    updateAuthUI();
    setAuthPanelOpen(next, { focusField: next });
  });
}

if (dom.authCloseBtn) {
  dom.authCloseBtn.addEventListener('click', () => {
    setAuthPanelOpen(false, { reason: 'manual' });
  });
}

if (dom.categorySelect) {
  dom.categorySelect.addEventListener('change', () => {
    const category = dom.categorySelect.value || 'all';
    if (category === selectedCategory) return;
    selectedCategory = category;
    releaseFocus(dom.categorySelect);
    if (categoryRebuildTimer) clearTimeout(categoryRebuildTimer);
    categoryRebuildTimer = setTimeout(() => {
      updateTemplateSelect();
      categoryRebuildTimer = null;
    }, SELECT_REBUILD_DELAY_MS);
  });
}

if (dom.type) {
  dom.type.addEventListener('change', () => {
    const newValue = dom.type.value;
    if (newValue === lastTypeValue) return;
    lastTypeValue = newValue;
    releaseFocus(dom.type);
    if (optionRebuildTimer) clearTimeout(optionRebuildTimer);
    optionRebuildTimer = setTimeout(() => {
      currentOptionState = {};
      updateOptionForm();
      optionRebuildTimer = null;
    }, SELECT_REBUILD_DELAY_MS);
  });
}

dom.signOutBtn.addEventListener('click', async () => {
  localStorage.removeItem('jwt');
  localStorage.removeItem('username');
  localStorage.removeItem('userId');
  currentUserId = null;
  currentCruiseId = null;
  currentCruiseStartUTC = null;
  currentCruiseStopUTC = null;
  await Promise.all([
    setMetaValue(META_CURRENT_CRUISE_ID, null),
    setMetaValue(META_CURRENT_CRUISE_START, null),
    setMetaValue(META_CURRENT_CRUISE_STOP, null)
  ]);
  authPanelDismissed = false;
  useFallbackTemplates();
  updateAuthUI();
  status(dom.syncStatus, null, 'Signed out. Events stay stored offline.');
});

if (dom.clearSyncedBtn) {
  dom.clearSyncedBtn.addEventListener('click', async () => {
    const confirmed = await openConfirmModal({
      title: 'Clear Synced Cached Events',
      message: 'This removes only events that have been synced to Sealog. Any unsynced or pending events will stay on this device. Continue?',
      confirmLabel: 'Clear Synced Events',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      const removed = await clearSyncedCachedEvents();
      if (removed) {
        status(dom.syncStatus, null, `Removed ${removed} synced event${removed === 1 ? '' : 's'} from cache.`);
      } else {
        status(dom.syncStatus, null, 'No synced events to clear.');
      }
    } catch (err) {
      status(dom.syncStatus, 'alert', err?.message || 'Failed to clear cached events.');
    }
    await render();
  });
}

dom.loadServerEventsBtn?.addEventListener('click', async () => {
  dom.loadServerEventsBtn.disabled = true;
  const previousLabel = dom.loadServerEventsBtn.textContent;
  dom.loadServerEventsBtn.textContent = 'Loading…';
  try {
    const result = await refreshServerEvents({ showStatus: true });
    const message = result?.message || (result?.ok
      ? 'Imported the latest Sealog events.'
      : 'No new events were imported.');
    const variant = result?.error ? 'danger' : result?.ok ? 'primary' : 'secondary';
    await openConfirmModal({
      title: 'Load Sealog Events',
      message,
      confirmLabel: 'OK',
      variant,
      showCancel: false
    });
  } finally {
    dom.loadServerEventsBtn.disabled = false;
    dom.loadServerEventsBtn.textContent = previousLabel;
  }
});

dom.asnapEnableToggle?.addEventListener('change', () => {
  asnapEnabled = !!dom.asnapEnableToggle.checked;
  persistBoolSetting(ASNAP_STORAGE_KEYS.enabled, asnapEnabled);
  updateAsnapControls();
  updateFilterChips();
  recomputeAsnapScheduler();
});

dom.asnapShowToggle?.addEventListener('change', () => {
  asnapShowInList = !!dom.asnapShowToggle.checked;
  persistBoolSetting(ASNAP_STORAGE_KEYS.showInList, asnapShowInList);
  updateFilterChips();
  render();
});

dom.gpsAllowPoorToggle?.addEventListener('change', () => {
  allowPoorGpsAccuracy = !!dom.gpsAllowPoorToggle.checked;
  persistBoolSetting(GPS_ALLOW_POOR_ACCURACY_STORAGE_KEY, allowPoorGpsAccuracy);
  updateFixUI();
  recomputeAsnapScheduler();
});

dom.asnapIntervalSelect?.addEventListener('change', () => {
  const value = Number(dom.asnapIntervalSelect.value);
  if (Number.isFinite(value)) {
    asnapIntervalMs = Math.min(ASNAP_MAX_INTERVAL_MS, Math.max(ASNAP_MIN_INTERVAL_MS, value));
    persistSetting(ASNAP_STORAGE_KEYS.intervalMs, String(asnapIntervalMs));
    recomputeAsnapScheduler();
  }
});

dom.asnapBackfillToggle?.addEventListener('change', () => {
  asnapBackfillEnabled = !!dom.asnapBackfillToggle.checked;
  persistBoolSetting(ASNAP_STORAGE_KEYS.backfillEnabled, asnapBackfillEnabled);
  updateFixUI();
});

let asnapBackfillAllowlistPersistTimer = null;
dom.asnapBackfillAllowlist?.addEventListener('input', () => {
  asnapBackfillAllowlistRaw = dom.asnapBackfillAllowlist.value || '';
  // Parsing is cheap and is needed by every sync pass, so keep that synchronous.
  asnapBackfillAllowlist = parseBackfillAllowlist(asnapBackfillAllowlistRaw);
  // Debounce the synchronous localStorage write so rapid typing or paste
  // doesn't block the main thread per-keystroke on iOS Safari.
  if (asnapBackfillAllowlistPersistTimer) {
    clearTimeout(asnapBackfillAllowlistPersistTimer);
  }
  asnapBackfillAllowlistPersistTimer = setTimeout(() => {
    asnapBackfillAllowlistPersistTimer = null;
    persistSetting(ASNAP_STORAGE_KEYS.backfillAllowlist, asnapBackfillAllowlistRaw);
  }, 250);
});
// Flush the pending allowlist write when the field loses focus.
dom.asnapBackfillAllowlist?.addEventListener('blur', () => {
  if (asnapBackfillAllowlistPersistTimer) {
    clearTimeout(asnapBackfillAllowlistPersistTimer);
    asnapBackfillAllowlistPersistTimer = null;
  }
  persistSetting(ASNAP_STORAGE_KEYS.backfillAllowlist, asnapBackfillAllowlistRaw);
});

dom.confirmModalConfirm?.addEventListener('click', () => closeConfirmModal(true));
dom.confirmModalCancel?.addEventListener('click', () => closeConfirmModal(false));
dom.confirmModal?.addEventListener('click', (ev) => {
  if (ev.target === dom.confirmModal) {
    closeConfirmModal(false);
  }
});

dom.authPanel?.addEventListener('click', (ev) => {
  if (ev.target === dom.authPanel) {
    setAuthPanelOpen(false, { reason: 'manual' });
  }
});

dom.eventEditorCancel?.addEventListener('click', () => {
  closeEventEditor();
});

dom.eventEditor?.addEventListener('click', (ev) => {
  if (ev.target === dom.eventEditor) {
    closeEventEditor();
  }
});

dom.eventEditorForm?.addEventListener('submit', handleEventEditorSubmit);

// Auto-fill rules modal: edit a draft, persist on Save, and discard on Cancel.
// Template and field labels are escaped before insertion into the table.

function ensureAutoFillDraftEntry(templateId, template) {
  if (!autoFillRulesDraft || templateId == null) return null;
  let entry = findTemplateEntry(autoFillRulesDraft, templateId, template?.event_value);
  if (!entry || typeof entry !== 'object') {
    entry = { log: {}, edit: {}, _seededDefaults: true };
    autoFillRulesDraft[templateId] = entry;
  }
  if (!entry.log || typeof entry.log !== 'object') entry.log = {};
  if (!entry.edit || typeof entry.edit !== 'object') entry.edit = {};
  if (template) {
    if (template.event_name) entry._label = template.event_name;
    if (template.event_value) entry._lastSeenEventValue = template.event_value;
  }
  return entry;
}

function pruneEmptyAutoFillDraftEntry(templateId) {
  if (!autoFillRulesDraft || templateId == null) return;
  const entry = autoFillRulesDraft[templateId];
  if (!entry || typeof entry !== 'object') return;
  const logKeys = entry.log && typeof entry.log === 'object' ? Object.keys(entry.log) : [];
  const editKeys = entry.edit && typeof entry.edit === 'object' ? Object.keys(entry.edit) : [];
  if (logKeys.length === 0 && editKeys.length === 0) {
    // Preserve an empty configuration so cleared rules stay disabled
    // when templates are loaded again.
    entry.log = {};
    entry.edit = {};
    entry._seededDefaults = true;
  }
}

function getAutoFillTemplateForId(templateId) {
  if (templateId == null) return null;
  const templates = templatesCache.length ? templatesCache : FALLBACK_TEMPLATES;
  return templates.find((tpl) => tpl?.id === templateId) || null;
}

function buildAutoFillFieldOptions(template) {
  // Infer GPS labels without runtime context and exclude system-managed
  // fields from the configurable options.
  const definitions = buildOptionDefinitions(template, null);
  return definitions.filter((opt) => {
    if (!opt || !opt.event_option_name) return false;
    if (opt._synthetic) return false;
    const key = normalizeOptionKey(opt.event_option_name);
    if (!key) return false;
    if (key === DEVICE_UTC_KEY) return false;
    if (key === DEVICE_ACCURACY_KEY) return false;
    if (key === CLIENT_UUID_OPTION_KEY) return false;
    return true;
  });
}

function renderAutoFillFieldRow(option, draftEntry) {
  const fieldKey = normalizeOptionKey(option.event_option_name);
  const displayName = option.event_option_label || formatOptionLabel(option.event_option_name);
  const logRule = draftEntry?.log?.[fieldKey] || null;
  const editRule = draftEntry?.edit?.[fieldKey] || null;
  const logSelected = logRule?.source ? String(logRule.source) : '';
  const editSelected = editRule?.source ? String(editRule.source) : '';
  // A selected source disables the opposite mode. If both modes have
  // values, leave both controls enabled so either can be cleared.
  const logActive = !!logSelected;
  const editActive = !!editSelected;
  const bothActive = logActive && editActive;
  const logDisabled = editActive && !bothActive ? ' disabled' : '';
  const editDisabled = logActive && !bothActive ? ' disabled' : '';
  // Mark name-inferred GPS fields to explain their suggested defaults.
  const isGpsField = option._auto === 'latitude' || option._auto === 'longitude' || option._auto === 'accuracy';
  const badge = isGpsField ? '<span class="autofill-field-badge">GPS</span>' : '';
  // Hint drives domain-aware source filtering. Time-shaped names get only
  // the current-time source; GPS-shaped names get only their matching source.
  // Operators on uncategorized fields see the full set so they keep control.
  const sourceHint = autoFillSourceHintForOption(option);
  return `
    <div class="autofill-field-row" data-field-key="${escapeHtml(fieldKey)}" data-field-name="${escapeHtml(option.event_option_name)}">
      <div class="autofill-field-head">
        <span class="autofill-field-name">${escapeHtml(displayName)}</span>
        ${badge}
      </div>
      <div class="autofill-rule-line">
        <span class="label">On log</span>
        <select data-mode="log"${logDisabled} aria-label="Auto-fill source for ${escapeHtml(displayName)} on log">${autoFillSourceOptionsHtml(logSelected, sourceHint)}</select>
      </div>
      <div class="autofill-rule-line">
        <span class="label">On edit</span>
        <select data-mode="edit"${editDisabled} aria-label="Auto-fill source for ${escapeHtml(displayName)} on edit">${autoFillSourceOptionsHtml(editSelected, sourceHint)}</select>
      </div>
    </div>
  `;
}

function renderAutoFillStaleNotice(draftEntry, presentFieldKeys) {
  const notice = dom.autoFillStaleNotice;
  if (!notice) return;
  if (!draftEntry) {
    notice.hidden = true;
    notice.textContent = '';
    return;
  }
  const stale = [];
  const presentSet = new Set(presentFieldKeys);
  ['log', 'edit'].forEach((mode) => {
    const modeRules = draftEntry[mode];
    if (!modeRules || typeof modeRules !== 'object') return;
    Object.keys(modeRules).forEach((key) => {
      if (!presentSet.has(key) && !stale.includes(key)) {
        stale.push(key);
      }
    });
  });
  if (!stale.length) {
    notice.hidden = true;
    notice.textContent = '';
    return;
  }
  const labelList = stale.map((key) => `'${key}'`).join(', ');
  const noun = stale.length === 1 ? 'rule references a field' : 'rules reference fields';
  notice.textContent = `${stale.length} ${noun} that no longer ${stale.length === 1 ? 'exists' : 'exist'}: ${labelList}. These rules stay saved in case the fields return.`;
  notice.hidden = false;
}

function seedDefaultAutoFillRules(template) {
  if (!template?.id) return false;
  // An existing configuration is authoritative, including empty entries
  // and rules matched by event value after a template ID changes.
  if (findTemplateEntry(autoFillRules, template.id, template.event_value)) return false;

  const definitions = buildOptionDefinitions(template, null);
  const defaults = {};
  definitions.forEach((opt) => {
    if (!opt || opt._synthetic) return;
    const key = normalizeOptionKey(opt.event_option_name);
    if (!key || key === DEVICE_UTC_KEY || key === DEVICE_ACCURACY_KEY || key === CLIENT_UUID_OPTION_KEY) return;
    if (opt._auto === 'latitude') defaults[key] = { source: 'lat' };
    else if (opt._auto === 'longitude') defaults[key] = { source: 'lon' };
    else if (opt._auto === 'accuracy') defaults[key] = { source: 'acc' };
  });

  if (Object.keys(defaults).length === 0) return false;

  autoFillRules[template.id] = {
    _label: template.event_name || template.event_value || template.id,
    _lastSeenEventValue: template.event_value || null,
    log: defaults,
    edit: {},
    _seededDefaults: true
  };
  return true;
}

function renderAutoFillFieldTable(templateId) {
  const tbody = dom.autoFillFieldTableBody;
  const emptyMsg = dom.autoFillFieldTableEmpty;
  const notice = dom.autoFillStaleNotice;
  if (!tbody) return;
  autoFillRulesActiveTemplateId = templateId || null;
  if (!templateId) {
    tbody.replaceChildren();
    tbody.hidden = true;
    if (emptyMsg) {
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'Pick a template above to configure its fields.';
    }
    if (notice) {
      notice.hidden = true;
      notice.textContent = '';
    }
    return;
  }
  const template = getAutoFillTemplateForId(templateId);
  if (!template) {
    tbody.replaceChildren();
    tbody.hidden = true;
    if (emptyMsg) {
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'Template is not available locally. Refresh templates and try again.';
    }
    return;
  }
  const fieldOptions = buildAutoFillFieldOptions(template);
  const draftEntry = findTemplateEntry(autoFillRulesDraft, templateId, template.event_value);
  if (!fieldOptions.length) {
    tbody.replaceChildren();
    tbody.hidden = true;
    if (emptyMsg) {
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'This template has no configurable option fields.';
    }
    renderAutoFillStaleNotice(draftEntry, []);
    return;
  }
  // Rows are built from escaped values produced by escapeHtml, so the
  // innerHTML assignment is safe against template-name injection.
  tbody.innerHTML = fieldOptions.map((opt) => renderAutoFillFieldRow(opt, draftEntry)).join('');
  tbody.hidden = false;
  if (emptyMsg) emptyMsg.hidden = true;
  const presentKeys = fieldOptions.map((opt) => normalizeOptionKey(opt.event_option_name)).filter(Boolean);
  renderAutoFillStaleNotice(draftEntry, presentKeys);
}

function populateAutoFillTemplateSelect(preferredTemplateId) {
  const select = dom.autoFillTemplateSelect;
  if (!select) return;
  const sorted = (templatesCache.length ? templatesCache : FALLBACK_TEMPLATES)
    .slice()
    .filter((tpl) => tpl && tpl.id)
    .sort((a, b) => (a.event_name || '').localeCompare(b.event_name || ''));
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Select a template…';
  select.replaceChildren(placeholder);
  sorted.forEach((tpl) => {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = tpl.event_name || tpl.event_value || tpl.id;
    select.appendChild(opt);
  });
  if (preferredTemplateId && sorted.some((tpl) => tpl.id === preferredTemplateId)) {
    select.value = preferredTemplateId;
  } else {
    select.value = '';
  }
}

function openAutoFillRulesModal() {
  const modal = dom.autoFillRulesModal;
  if (!modal) return;
  autoFillRulesDraft = structuredClone(autoFillRules);
  const previousTemplateId = autoFillRulesActiveTemplateId;
  populateAutoFillTemplateSelect(previousTemplateId);
  if (dom.autoFillTemplateSelect?.value) {
    renderAutoFillFieldTable(dom.autoFillTemplateSelect.value);
  } else {
    renderAutoFillFieldTable(null);
  }
  const wasHidden = modal.hidden;
  modal.hidden = false;
  if (wasHidden) {
    lockBodyScroll();
  }
}

function closeAutoFillRulesModal({ persist = false } = {}) {
  const modal = dom.autoFillRulesModal;
  if (!modal) return;
  if (persist && autoFillRulesDraft) {
    Object.keys(autoFillRulesDraft).forEach((templateId) => {
      pruneEmptyAutoFillDraftEntry(templateId);
    });
    autoFillRules = autoFillRulesDraft;
    // A template refresh can add templates while the rules draft is open.
    templateLookup.forEach(seedDefaultAutoFillRules);
    saveAutoFillRules(autoFillRules);
    updateAutoFillRulesSummary();
    updateOptionForm();
  }
  autoFillRulesDraft = null;
  if (!modal.hidden) {
    modal.hidden = true;
    unlockBodyScroll();
  }
}

function handleAutoFillTableChange(ev) {
  const target = ev.target;
  if (!target) return;
  const row = target.closest('.autofill-field-row[data-field-key]');
  if (!row) return;
  const templateId = autoFillRulesActiveTemplateId;
  if (!templateId) return;
  const template = getAutoFillTemplateForId(templateId);
  const fieldKey = row.dataset.fieldKey;
  const entry = ensureAutoFillDraftEntry(templateId, template);
  if (!entry || !fieldKey) return;

  const mode = target.dataset.mode;
  if (!mode || (mode !== 'log' && mode !== 'edit')) return;
  const modeRules = entry[mode];

  if (target.matches('select[data-mode]')) {
    const newSource = String(target.value || '');
    if (!newSource) {
      delete modeRules[fieldKey];
    } else {
      // Fill empty fields on capture and preserve existing values on edit.
      modeRules[fieldKey] = { source: newSource };
    }
    if (template && entry._label !== template.event_name) entry._label = template.event_name;
    if (template && entry._lastSeenEventValue !== template.event_value) entry._lastSeenEventValue = template.event_value;
  }
  // Reflect the opposite mode’s disabled state immediately.
  renderAutoFillFieldTable(templateId);
}

function handleAutoFillModalClick(ev) {
  if (ev.target === dom.autoFillRulesModal) {
    closeAutoFillRulesModal({ persist: false });
  }
}

updateAutoFillRulesSummary();

dom.autoFillRulesBtn?.addEventListener('click', () => {
  openAutoFillRulesModal();
});

dom.autoFillRulesModalCloseBtn?.addEventListener('click', () => {
  closeAutoFillRulesModal({ persist: false });
});

dom.autoFillRulesCancelBtn?.addEventListener('click', () => {
  closeAutoFillRulesModal({ persist: false });
});

dom.autoFillRulesSaveBtn?.addEventListener('click', () => {
  closeAutoFillRulesModal({ persist: true });
});

dom.autoFillRulesModal?.addEventListener('click', handleAutoFillModalClick);

dom.autoFillTemplateSelect?.addEventListener('change', () => {
  const value = dom.autoFillTemplateSelect.value || '';
  renderAutoFillFieldTable(value || null);
});

dom.autoFillFieldTableBody?.addEventListener('change', handleAutoFillTableChange);

async function captureEvent() {
  try {
    dom.captureBtn.disabled = true;
    dom.captureBtn.textContent = 'Capturing…';
    const template = getActiveTemplate();
    if (template && !currentOptionDefinitions.length) {
      currentOptionDefinitions = buildOptionDefinitions(template, {
        templateId: template?.id,
        eventValue: template?.event_value,
        mode: 'log'
      });
    }
    const hasAutoLatitude = currentOptionDefinitions.some((opt) => opt._auto === 'latitude' || opt._auto === 'rule:lat');
    const hasAutoLongitude = currentOptionDefinitions.some((opt) => opt._auto === 'longitude' || opt._auto === 'rule:lon');
    const hasAutoAccuracy = currentOptionDefinitions.some((opt) => opt._auto === 'accuracy' || opt._auto === 'rule:acc');
    const captureNeedsGps = hasAutoLatitude || hasAutoLongitude || hasAutoAccuracy;
    const fix = captureNeedsGps ? await getLoggingFix() : null;
    const selectedOption = dom.type.options[dom.type.selectedIndex];
    if (!selectedOption || selectedOption.disabled) {
      throw new Error('Select an event type before capturing.');
    }
    const eventValue = selectedOption?.dataset?.eventValue || dom.type.value;
    const templateId = selectedOption?.dataset?.templateId || null;
    const templateName = selectedOption?.dataset?.templateName || selectedOption?.textContent || eventValue;
    const categoryList = selectedOption?.dataset?.templateCategoryList
      ? selectedOption.dataset.templateCategoryList.split(',').filter(Boolean)
      : [];
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const localId = generateLocalId();
    const { optionValues: rawOptionValues } = collectOptionValues({
      fix,
      eventUtc: nowIso
    });
    const optionValues = normalizeOptionValues(rawOptionValues);
    const optionMap = optionMapFromArray(optionValues);
    const lat = hasAutoLatitude && typeof fix?.lat === 'number' ? Number(fix.lat) : null;
    const lon = hasAutoLongitude && typeof fix?.lon === 'number' ? Number(fix.lon) : null;
    const acc = hasAutoAccuracy && typeof fix?.acc_m === 'number' ? Math.round(Number(fix.acc_m)) : null;
    const notes = dom.notes.value.trim();
    const userId = currentUserId || localStorage.getItem('userId') || null;
    const payload = {
      utc: nowIso,
      notes,
      client_uuid: localId,
      options: optionMap
    };
    if (hasAutoLatitude) payload.lat = lat;
    if (hasAutoLongitude) payload.lon = lon;
    if (hasAutoAccuracy) payload.acc_m = acc;
    const event = {
      localId,
      client_uuid: localId,
      type: eventValue,
      eventTemplateId: templateId,
      eventTemplateName: templateName,
      template_categories: categoryList,
      notes,
      originalTimestampUTC: nowIso,
      eventTimestampUTC: nowIso,
      payload,
      option_values: optionValues,
      lat: hasAutoLatitude ? lat : undefined,
      lon: hasAutoLongitude ? lon : undefined,
      acc_m: hasAutoAccuracy ? acc : undefined,
      syncState: SYNC_STATE.UNSYNCED,
      serverId: null,
      attemptCount: 0,
      nextAttemptMs: nowMs,
      lastError: null,
      verifyAttemptCount: 0,
      verifyNextAttemptMs: null,
      createdAtMs: nowMs,
      createdAtUTC: nowIso,
      updatedAtMs: nowMs,
      updatedAtUTC: nowIso,
      lastSyncMs: null,
      lastSyncUTC: null,
      revisions: [],
      userId,
      cruiseId: currentCruiseId,
    };
    if (!hasAutoLatitude) delete event.lat;
    if (!hasAutoLongitude) delete event.lon;
    if (!hasAutoAccuracy) delete event.acc_m;
    event.payload.client_uuid = localId;
    syncEventPayload(event);
    await put(EVENT_STORE, event);
    dom.notes.value = '';
    setFixMessage(fix ? (gpsLoggingPolicy(fix).warning || 'Captured with current fix.') : '');
    updateFixUI();
    currentOptionState = {};
    updateOptionForm();
    await render();
    if (navigator.onLine) {
      syncAll();
    } else {
      scheduleNextSync(Date.now() + BACKOFF_BASE_MS);
    }
  } catch (err) {
    alert(`Capture failed: ${err.message}`);
  } finally {
    dom.captureBtn.disabled = false;
    dom.captureBtn.textContent = 'Log Event';
  }
}

dom.captureBtn.addEventListener('click', (ev) => {
  ev.preventDefault();
  captureEvent();
});

function logSyncFallback(level, message, details = {}) {
  try {
    console[level](`[sync fallback] ${message}`, details);
  } catch {
    // ignore logging failures
  }
}

function summarizeAsnapPointForDebug(point) {
  if (!point || typeof point !== 'object') return null;
  return {
    timestampIso: point.timestampIso || null,
    lat: toNumberOrNull(point.lat),
    lon: toNumberOrNull(point.lon),
    depthM: toNumberOrNull(point.depthM),
    accM: toNumberOrNull(point.accM),
    serverId: point.serverId || null
  };
}

function summarizeAsnapPointsForDebug(points) {
  const list = Array.isArray(points) ? points : [];
  const first = list.length ? list[0] : null;
  const last = list.length ? list[list.length - 1] : null;
  return {
    count: list.length,
    withDepthCount: list.filter((point) => toNumberOrNull(point?.depthM) != null).length,
    firstIso: first?.timestampIso || null,
    lastIso: last?.timestampIso || null
  };
}

function summarizeLoweringForDebug(lowering) {
  if (!lowering || typeof lowering !== 'object') return null;
  return {
    id: lowering.sealogId || null,
    loweringId: lowering.loweringId || null,
    startTs: lowering.startIso || null,
    stopTs: lowering.stopIso || null
  };
}

function summarizeEventForAsnapDebug(event) {
  if (!event || typeof event !== 'object') return null;
  const auxData = Array.isArray(event.aux_data) ? event.aux_data : [];
  const auxSources = auxData
    .map((item) => item?.data_source)
    .filter(Boolean);
  return {
    id: event.id || null,
    ts: toIsoOrNull(event.ts),
    value: event.event_value || null,
    auxSources
  };
}

function summarizeAuxEntryForAsnapDebug(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const values = Array.isArray(entry.data_array) ? entry.data_array : [];
  const valueLookup = new Map();
  values.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const key = String(item.data_name || '').trim().toLowerCase();
    if (!key) return;
    valueLookup.set(key, item.data_value);
  });
  return {
    eventId: entry.event_id || null,
    dataSource: entry.data_source || null,
    latitude: valueLookup.get('latitude') ?? null,
    longitude: valueLookup.get('longitude') ?? null,
    depth: valueLookup.get('depth') ?? null
  };
}

function sampledListForAsnapDebug(items, mapper, maxEachSide = 40) {
  const list = Array.isArray(items) ? items : [];
  const head = list.slice(0, maxEachSide).map((item) => mapper(item)).filter(Boolean);
  const tail = list.length > maxEachSide
    ? list.slice(-maxEachSide).map((item) => mapper(item)).filter(Boolean)
    : [];
  return {
    total: list.length,
    head,
    tail
  };
}

function persistAsnapBackfillDebugSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const payload = {
    capturedAtUtc: ensureIsoString(snapshot.capturedAtUtc || nowUtc(), nowUtc()),
    ...snapshot
  };
  window.__asnapBackfillDebug = payload;
  try {
    localStorage.setItem(ASNAP_BACKFILL_DEBUG_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
  void postAsnapBackfillDebugSnapshot(payload);
}

async function postAsnapBackfillDebugSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const signature = buildAsnapBackfillDebugSignature(snapshot);
  const nowMs = Date.now();
  if (
    signature &&
    signature === asnapBackfillDebugLastPostedSignature &&
    nowMs - asnapBackfillDebugLastPostedAtMs < ASNAP_BACKFILL_DEBUG_POST_MIN_INTERVAL_MS
  ) {
    return;
  }

  const endpoint = buildAsnapBackfillDebugEndpoint(appPathPrefix);
  const payload = trimAsnapBackfillSnapshotForServer(
    snapshot,
    ASNAP_BACKFILL_DEBUG_SAMPLE_LIMIT
  );
  if (!endpoint || !payload) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ASNAP_BACKFILL_DEBUG_POST_TIMEOUT_MS);
  // Only commit the dedup signature once the forward actually succeeds —
  // otherwise a transient failure silently suppresses the next 15s of retries.
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      keepalive: true,
      signal: controller.signal
    });
    if (response && response.ok) {
      asnapBackfillDebugLastPostedSignature = signature;
      asnapBackfillDebugLastPostedAtMs = nowMs;
    }
  } catch {
    // ignore snapshot forwarding errors; do NOT update dedup state so the next
    // call still has a chance to forward.
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function computeAsnapFallbackWindow({
  targetStartIso = null,
  targetStopIso = null
} = {}) {
  const cruiseStartMs = currentCruiseStartUTC ? new Date(currentCruiseStartUTC).getTime() : null;
  const cruiseStopMs = currentCruiseStopUTC ? new Date(currentCruiseStopUTC).getTime() : null;
  const targetStartMs = targetStartIso ? new Date(targetStartIso).getTime() : null;
  const targetStopMs = targetStopIso ? new Date(targetStopIso).getTime() : null;

  let startMs = Number.isFinite(targetStartMs)
    ? targetStartMs - ASNAP_BACKFILL_FALLBACK_PAD_MS
    : Number.isFinite(cruiseStartMs)
      ? cruiseStartMs
      : Date.now() - ASNAP_BACKFILL_FALLBACK_PAD_MS;
  let stopMs = Number.isFinite(targetStopMs)
    ? targetStopMs + ASNAP_BACKFILL_FALLBACK_PAD_MS
    : Number.isFinite(cruiseStopMs)
      ? cruiseStopMs
      : Date.now();

  if (Number.isFinite(cruiseStartMs)) {
    startMs = Math.max(startMs, cruiseStartMs);
  }
  if (Number.isFinite(cruiseStopMs)) {
    stopMs = Math.min(stopMs, cruiseStopMs);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || startMs > stopMs) {
    return null;
  }

  return {
    startIso: new Date(startMs).toISOString(),
    stopIso: new Date(stopMs).toISOString()
  };
}

function resolveAsnapVesselApiRoots(apiRoot) {
  const override = (localStorage.getItem(ASNAP_VESSEL_API_ROOT_STORAGE_KEY) || '').trim();
  return buildAsnapVesselApiRootCandidatesUtil({
    apiRoot,
    override,
    appPathPrefix,
    locationProtocol: window.location.protocol
  });
}

async function fetchServerEventByClientUuid(apiRoot, jwt, clientUuid) {
  const escapedUuid = String(clientUuid).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const params = new URLSearchParams({ fulltext: `^${escapedUuid}$` });
  const response = await fetch(`${apiRoot}/api/v1/events?${params.toString()}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` }
  });
  if (response.status === 404) return null;
  if (response.status === 401) {
    localStorage.removeItem('jwt');
    updateAuthUI();
  }
  if (!response.ok) throw new Error(`Event verification failed (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('Event verification returned an invalid response.');
  const matches = payload.filter((item) =>
    findOptionValue(item?.event_options, CLIENT_UUID_OPTION_KEY) === clientUuid
  );
  if (matches.length > 1) {
    const error = new Error('Multiple server events have this client UUID. Review before re-posting.');
    error.verificationConflict = true;
    throw error;
  }
  if (matches.length && !extractServerEventId(matches[0])) {
    throw new Error('Event verification returned a record without an id.');
  }
  return matches[0] || null;
}

async function fetchLoweringsForBackfill({
  apiRoot,
  jwt
}) {
  try {
    const response = await fetch(`${apiRoot}/api/v1/lowerings`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${jwt}`
      }
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}`, lowerings: [] };
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return { ok: false, reason: 'unexpected-payload', lowerings: [] };
    }
    return { ok: true, reason: null, lowerings: payload };
  } catch (err) {
    return { ok: false, reason: err?.message || 'request-failed', lowerings: [] };
  }
}

async function fetchAsnapEventsByLowering({
  apiRoot,
  jwt,
  loweringSealogId
}) {
  if (!loweringSealogId) {
    return { ok: false, reason: 'missing-lowering-id', events: [] };
  }
  try {
    const params = new URLSearchParams();
    params.set('limit', String(ASNAP_BACKFILL_DIVE_QUERY_LIMIT));
    const path = `${apiRoot}/api/v1/events/bylowering/${encodeURIComponent(loweringSealogId)}?${params.toString()}`;
    const response = await fetch(path, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${jwt}`
      }
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}`, events: [] };
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return { ok: false, reason: 'unexpected-payload', events: [] };
    }
    return { ok: true, reason: null, events: payload };
  } catch (err) {
    return { ok: false, reason: err?.message || 'request-failed', events: [] };
  }
}

async function fetchVehicleAuxDataByLowering({
  apiRoot,
  jwt,
  loweringSealogId
}) {
  if (!loweringSealogId) {
    return { ok: false, reason: 'missing-lowering-id', entries: [] };
  }
  try {
    const params = new URLSearchParams();
    params.set('datasource', 'vehiclePosition');
    params.set('limit', String(ASNAP_BACKFILL_DIVE_QUERY_LIMIT));
    const path = `${apiRoot}/api/v1/event_aux_data/bylowering/${encodeURIComponent(loweringSealogId)}?${params.toString()}`;
    const response = await fetch(path, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${jwt}`
      }
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}`, entries: [] };
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return { ok: false, reason: 'unexpected-payload', entries: [] };
    }
    return { ok: true, reason: null, entries: payload };
  } catch (err) {
    return { ok: false, reason: err?.message || 'request-failed', entries: [] };
  }
}

async function fetchVesselAuxDataByCruise({
  apiRoot,
  jwt,
  cruiseId
}) {
  if (!cruiseId) {
    return { ok: false, reason: 'missing-cruise-id', entries: [], vesselApiRoot: null, vesselApiRoots: [] };
  }
  const vesselApiRoots = resolveAsnapVesselApiRoots(apiRoot);
  if (!vesselApiRoots.length) {
    return { ok: false, reason: 'missing-vessel-api-root', entries: [], vesselApiRoot: null, vesselApiRoots: [] };
  }

  let lastReason = 'request-failed';
  let attemptedRoot = vesselApiRoots[0];
  let emptyResult = null;
  for (const vesselApiRoot of vesselApiRoots) {
    attemptedRoot = vesselApiRoot;
    try {
      const params = new URLSearchParams();
      params.set('datasource', 'vesselPosition');
      params.set('limit', String(ASNAP_BACKFILL_DIVE_QUERY_LIMIT));
      const path = `${vesselApiRoot}/api/v1/event_aux_data/bycruise/${encodeURIComponent(cruiseId)}?${params.toString()}`;
      const response = await fetch(path, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${jwt}`
        }
      });
      if (!response.ok) {
        lastReason = `HTTP ${response.status}`;
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (!Array.isArray(payload)) {
        lastReason = 'unexpected-payload';
        continue;
      }
      if (!payload.length) {
        if (!emptyResult) {
          emptyResult = {
            ok: true,
            reason: 'empty-payload',
            entries: payload,
            vesselApiRoot,
            vesselApiRoots
          };
        }
        continue;
      }
      return { ok: true, reason: null, entries: payload, vesselApiRoot, vesselApiRoots };
    } catch (err) {
      lastReason = err?.message || 'request-failed';
    }
  }

  if (emptyResult) {
    return emptyResult;
  }

  return {
    ok: false,
    reason: lastReason,
    entries: [],
    vesselApiRoot: attemptedRoot,
    vesselApiRoots
  };
}

async function fetchAsnapEventsByWindow({
  apiRoot,
  jwt,
  startIso,
  stopIso
}) {
  if (!startIso || !stopIso) {
    return { ok: false, reason: 'missing-window', events: [] };
  }
  try {
    const params = new URLSearchParams();
    params.set('value', ASNAP_EVENT_VALUE);
    params.set('startTS', startIso);
    params.set('stopTS', stopIso);
    params.set('limit', String(ASNAP_BACKFILL_DIVE_QUERY_LIMIT));
    const response = await fetch(`${apiRoot}/api/v1/events?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${jwt}`
      }
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}`, events: [] };
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return { ok: false, reason: 'unexpected-payload', events: [] };
    }
    return { ok: true, reason: null, events: payload };
  } catch (err) {
    return { ok: false, reason: err?.message || 'request-failed', events: [] };
  }
}

async function fetchAsnapEventsByCruise({
  apiRoot,
  jwt,
  cruiseId,
  startIso = null,
  stopIso = null
}) {
  if (!cruiseId) {
    return { ok: false, reason: 'missing-cruise-id', events: [] };
  }
  try {
    const params = new URLSearchParams();
    params.set('value', ASNAP_EVENT_VALUE);
    if (startIso && stopIso) {
      params.set('startTS', startIso);
      params.set('stopTS', stopIso);
    }
    params.set('limit', String(ASNAP_BACKFILL_DIVE_QUERY_LIMIT));
    const response = await fetch(
      `${apiRoot}/api/v1/events/bycruise/${encodeURIComponent(cruiseId)}?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${jwt}`
        }
      }
    );
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}`, events: [] };
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return { ok: false, reason: 'unexpected-payload', events: [] };
    }
    return { ok: true, reason: null, events: payload };
  } catch (err) {
    return { ok: false, reason: err?.message || 'request-failed', events: [] };
  }
}

async function loadAsnapBackfillContext({
  apiRoot,
  jwt,
  targetStartIso = null,
  targetStopIso = null
}) {
  const cruiseId = currentCruiseId || await fetchCurrentCruiseId({ showStatus: false });
  let lowerings = [];
  let lowering = null;
  let byLoweringEvents = [];
  let auxEntries = [];
  let vesselAuxEntries = [];
  let vesselCruiseEventsByCruise = [];
  let vesselCruiseEventsByWindow = [];
  let fallbackWindowEvents = [];
  let eventPoints = [];
  let auxPoints = [];
  let vesselAuxPoints = [];
  let fallbackWindowPoints = [];
  let mergedPoints = [];
  let vesselPoints = [];
  let vesselTimestampIndexSize = 0;
  let vesselTimestampIndexSource = 'none';
  let vesselApiRoot = null;
  let vesselApiRoots = [];
  const makeSnapshot = ({
    status,
    reason
  }) => ({
    capturedAtUtc: nowUtc(),
    apiRoot,
    vesselApiRoot,
    vesselApiRoots,
    cruiseId: cruiseId || null,
    queryLimit: ASNAP_BACKFILL_DIVE_QUERY_LIMIT,
    status,
    reason: reason || null,
    lowering: summarizeLoweringForDebug(lowering),
    counts: {
      lowerings: lowerings.length,
      byLoweringEvents: byLoweringEvents.length,
      auxEntries: auxEntries.length,
      vesselAuxEntries: vesselAuxEntries.length,
      vesselCruiseEventsByCruise: vesselCruiseEventsByCruise.length,
      vesselCruiseEventsByWindow: vesselCruiseEventsByWindow.length,
      fallbackWindowEvents: fallbackWindowEvents.length,
      eventPoints: eventPoints.length,
      auxPoints: auxPoints.length,
      vesselAuxPoints: vesselAuxPoints.length,
      fallbackWindowPoints: fallbackWindowPoints.length,
      mergedPoints: mergedPoints.length,
      vesselPoints: vesselPoints.length,
      vesselTimestampIndexSize,
      vesselTimestampIndexSource
    },
    eventPointSummary: summarizeAsnapPointsForDebug(eventPoints),
    fallbackWindowPointSummary: summarizeAsnapPointsForDebug(fallbackWindowPoints),
    mergedPointSummary: summarizeAsnapPointsForDebug(mergedPoints),
    vesselPointSummary: summarizeAsnapPointsForDebug(vesselPoints),
    samples: {
      lowerings: sampledListForAsnapDebug(lowerings, (record) => summarizeLoweringForDebug({
        sealogId: record?.id,
        loweringId: record?.lowering_id,
        startIso: record?.start_ts,
        stopIso: record?.stop_ts
      })),
      byLoweringEvents: sampledListForAsnapDebug(byLoweringEvents, summarizeEventForAsnapDebug),
      auxEntries: sampledListForAsnapDebug(auxEntries, summarizeAuxEntryForAsnapDebug),
      vesselAuxEntries: sampledListForAsnapDebug(vesselAuxEntries, summarizeAuxEntryForAsnapDebug),
      vesselCruiseEventsByCruise: sampledListForAsnapDebug(
        vesselCruiseEventsByCruise,
        summarizeEventForAsnapDebug
      ),
      vesselCruiseEventsByWindow: sampledListForAsnapDebug(
        vesselCruiseEventsByWindow,
        summarizeEventForAsnapDebug
      ),
      fallbackWindowEvents: sampledListForAsnapDebug(fallbackWindowEvents, summarizeEventForAsnapDebug),
      eventPoints: sampledListForAsnapDebug(eventPoints, summarizeAsnapPointForDebug),
      auxPoints: sampledListForAsnapDebug(auxPoints, summarizeAsnapPointForDebug),
      vesselAuxPoints: sampledListForAsnapDebug(vesselAuxPoints, summarizeAsnapPointForDebug),
      fallbackWindowPoints: sampledListForAsnapDebug(fallbackWindowPoints, summarizeAsnapPointForDebug),
      mergedPoints: sampledListForAsnapDebug(mergedPoints, summarizeAsnapPointForDebug),
      vesselPoints: sampledListForAsnapDebug(vesselPoints, summarizeAsnapPointForDebug)
    }
  });

  const tryWindowFallback = async (baseReason) => {
    const fallbackWindow = computeAsnapFallbackWindow({ targetStartIso, targetStopIso });
    if (!fallbackWindow) {
      return {
        ok: false,
        reason: `${baseReason}-fallback-window-unavailable`,
        points: [],
        vesselPoints: []
      };
    }
    const fallbackResult = await fetchAsnapEventsByWindow({
      apiRoot,
      jwt,
      startIso: fallbackWindow.startIso,
      stopIso: fallbackWindow.stopIso
    });
    if (!fallbackResult.ok) {
      return {
        ok: false,
        reason: `${baseReason}-fallback-window-${fallbackResult.reason || 'failed'}`,
        points: [],
        vesselPoints: []
      };
    }
    fallbackWindowEvents = Array.isArray(fallbackResult.events) ? fallbackResult.events : [];
    fallbackWindowPoints = buildAsnapPointsFromByLoweringEvents(fallbackWindowEvents);
    const fallbackVesselPoints = buildVesselPointsFromEventPoints(fallbackWindowPoints);
    vesselPoints = fallbackVesselPoints;
    if (fallbackWindowPoints.length < 2) {
      return {
        ok: false,
        reason: `${baseReason}-fallback-window-insufficient-points`,
        points: fallbackWindowPoints,
        vesselPoints: fallbackVesselPoints
      };
    }
    mergedPoints = fallbackWindowPoints;
    return {
      ok: true,
      reason: `${baseReason}-fallback-window`,
      points: fallbackWindowPoints,
      vesselPoints: fallbackVesselPoints,
      source: 'events-window-fallback'
    };
  };

  const loweringsResult = await fetchLoweringsForBackfill({ apiRoot, jwt });
  if (!loweringsResult.ok) {
    const fallback = await tryWindowFallback(`lowerings-${loweringsResult.reason || 'failed'}`);
    if (fallback.ok) {
      const snapshot = makeSnapshot({
        status: 'ok',
        reason: fallback.reason
      });
      persistAsnapBackfillDebugSnapshot(snapshot);
      logSyncFallback('info', 'ASNAP backfill context loaded via fallback window.', {
        reason: snapshot.reason,
        counts: snapshot.counts,
        mergedPointSummary: snapshot.mergedPointSummary
      });
      return {
        ok: true,
        reason: null,
        points: fallback.points,
        vesselPoints: fallback.vesselPoints || [],
        source: fallback.source
      };
    }
    const snapshot = makeSnapshot({
      status: 'error',
      reason: fallback.reason || `lowerings-${loweringsResult.reason || 'failed'}`
    });
    persistAsnapBackfillDebugSnapshot(snapshot);
    return {
      ok: false,
      reason: snapshot.reason,
      points: []
    };
  }
  lowerings = Array.isArray(loweringsResult.lowerings) ? loweringsResult.lowerings : [];

  lowering = selectCurrentLowering(lowerings, {
    nowIso: nowUtc()
  });
  if (!lowering || !lowering.sealogId) {
    const fallback = await tryWindowFallback('no-current-lowering');
    if (fallback.ok) {
      const snapshot = makeSnapshot({
        status: 'ok',
        reason: fallback.reason
      });
      persistAsnapBackfillDebugSnapshot(snapshot);
      logSyncFallback('info', 'ASNAP backfill context loaded via fallback window.', {
        reason: snapshot.reason,
        counts: snapshot.counts,
        mergedPointSummary: snapshot.mergedPointSummary
      });
      return {
        ok: true,
        reason: null,
        points: fallback.points,
        vesselPoints: fallback.vesselPoints || [],
        source: fallback.source
      };
    }
    const snapshot = makeSnapshot({
      status: 'error',
      reason: fallback.reason || 'no-current-lowering'
    });
    persistAsnapBackfillDebugSnapshot(snapshot);
    return { ok: false, reason: snapshot.reason, points: [] };
  }

  const byLoweringResult = await fetchAsnapEventsByLowering({
    apiRoot,
    jwt,
    loweringSealogId: lowering.sealogId
  });
  if (!byLoweringResult.ok) {
    const fallback = await tryWindowFallback(`events-bylowering-${byLoweringResult.reason || 'failed'}`);
    if (fallback.ok) {
      const snapshot = makeSnapshot({
        status: 'ok',
        reason: fallback.reason
      });
      persistAsnapBackfillDebugSnapshot(snapshot);
      logSyncFallback('info', 'ASNAP backfill context loaded via fallback window.', {
        reason: snapshot.reason,
        counts: snapshot.counts,
        mergedPointSummary: snapshot.mergedPointSummary
      });
      return {
        ok: true,
        reason: null,
        points: fallback.points,
        vesselPoints: fallback.vesselPoints || [],
        lowering,
        source: fallback.source
      };
    }
    const snapshot = makeSnapshot({
      status: 'error',
      reason: fallback.reason || `events-bylowering-${byLoweringResult.reason || 'failed'}`
    });
    persistAsnapBackfillDebugSnapshot(snapshot);
    return {
      ok: false,
      reason: snapshot.reason,
      points: [],
      lowering
    };
  }
  byLoweringEvents = Array.isArray(byLoweringResult.events) ? byLoweringResult.events : [];

  const timestampIndex = buildEventTimestampIndex(byLoweringEvents);
  eventPoints = buildAsnapPointsFromByLoweringEvents(byLoweringEvents);
  const eventPointsIncludeDepth = eventPoints.some((point) => Number.isFinite(point.depthM));
  const shouldFetchAuxPoints = eventPoints.length < 2 || !eventPointsIncludeDepth;
  let points = eventPoints;
  if (shouldFetchAuxPoints) {
    const auxResult = await fetchVehicleAuxDataByLowering({
      apiRoot,
      jwt,
      loweringSealogId: lowering.sealogId
    });
    if (!auxResult.ok) {
      if (eventPoints.length < 2) {
        const fallback = await tryWindowFallback(`event-aux-${auxResult.reason || 'failed'}`);
        if (fallback.ok) {
          const snapshot = makeSnapshot({
            status: 'ok',
            reason: fallback.reason
          });
          persistAsnapBackfillDebugSnapshot(snapshot);
          logSyncFallback('info', 'ASNAP backfill context loaded via fallback window.', {
            reason: snapshot.reason,
            counts: snapshot.counts,
            mergedPointSummary: snapshot.mergedPointSummary
          });
          return {
            ok: true,
            reason: null,
            points: fallback.points,
            vesselPoints: fallback.vesselPoints || [],
            lowering,
            source: fallback.source
          };
        }
        const snapshot = makeSnapshot({
          status: 'error',
          reason: fallback.reason || `event-aux-${auxResult.reason || 'failed'}`
        });
        persistAsnapBackfillDebugSnapshot(snapshot);
        return {
          ok: false,
          reason: snapshot.reason,
          points: eventPoints,
          vesselPoints: [],
          lowering,
          source: 'events-bylowering'
        };
      }
    } else {
      auxEntries = Array.isArray(auxResult.entries) ? auxResult.entries : [];
      auxPoints = buildAsnapPointsFromAuxData(auxEntries, {
        eventTimestampById: timestampIndex
      });
      points = mergeAsnapPointSets(eventPoints, auxPoints);
      if (points.length < 2) {
        const fallback = await tryWindowFallback('insufficient-points');
        if (fallback.ok) {
          const snapshot = makeSnapshot({
            status: 'ok',
            reason: fallback.reason
          });
          persistAsnapBackfillDebugSnapshot(snapshot);
          logSyncFallback('info', 'ASNAP backfill context loaded via fallback window.', {
            reason: snapshot.reason,
            counts: snapshot.counts,
            mergedPointSummary: snapshot.mergedPointSummary
          });
          return {
            ok: true,
            reason: null,
            points: fallback.points,
            vesselPoints: fallback.vesselPoints || [],
            lowering,
            source: fallback.source
          };
        }
        const snapshot = makeSnapshot({
          status: 'error',
          reason: fallback.reason || 'insufficient-points'
        });
        persistAsnapBackfillDebugSnapshot(snapshot);
        return {
          ok: false,
          reason: snapshot.reason,
          points,
          vesselPoints: [],
          lowering,
          source: 'combined'
        };
      }
    }
  }

  mergedPoints = points;
  vesselPoints = buildVesselPointsFromEventPoints(points);
  const vesselResult = await fetchVesselAuxDataByCruise({
    apiRoot,
    jwt,
    cruiseId: cruiseId || lowering?.cruiseId || null
  });
  vesselApiRoot = vesselResult.vesselApiRoot || null;
  vesselApiRoots = Array.isArray(vesselResult.vesselApiRoots) ? vesselResult.vesselApiRoots : [];
  if (vesselResult.ok) {
    vesselAuxEntries = Array.isArray(vesselResult.entries) ? vesselResult.entries : [];
    let vesselTimestampIndex = timestampIndex;
    if (vesselAuxEntries.length) {
      const cruiseIdForVessel = cruiseId || lowering?.cruiseId || null;
      let vesselCruiseIndex = new Map();
      if (vesselApiRoot && cruiseIdForVessel) {
        const vesselCruiseEventsResult = await fetchAsnapEventsByCruise({
          apiRoot: vesselApiRoot,
          jwt,
          cruiseId: cruiseIdForVessel
        });
        if (vesselCruiseEventsResult.ok) {
          vesselCruiseEventsByCruise = Array.isArray(vesselCruiseEventsResult.events)
            ? vesselCruiseEventsResult.events
            : [];
          vesselCruiseIndex = buildEventTimestampIndex(vesselCruiseEventsByCruise);
        } else if (vesselCruiseEventsResult.reason) {
          logSyncFallback('warn', 'ASNAP vessel bycruise event lookup for timestamp indexing failed.', {
            reason: vesselCruiseEventsResult.reason,
            apiRoot: vesselApiRoot
          });
        }
      }

      let vesselWindowIndex = new Map();
      if (!vesselCruiseIndex.size) {
        let vesselQueryWindow = computeAsnapFallbackWindow({ targetStartIso, targetStopIso });
        if (!vesselQueryWindow && points.length) {
          vesselQueryWindow = computeAsnapFallbackWindow({
            targetStartIso: points[0]?.timestampIso || null,
            targetStopIso: points[points.length - 1]?.timestampIso || null
          });
        }
        if (vesselApiRoot && vesselQueryWindow?.startIso && vesselQueryWindow?.stopIso) {
          const vesselEventsResult = await fetchAsnapEventsByWindow({
            apiRoot: vesselApiRoot,
            jwt,
            startIso: vesselQueryWindow.startIso,
            stopIso: vesselQueryWindow.stopIso
          });
          if (vesselEventsResult.ok) {
            vesselCruiseEventsByWindow = Array.isArray(vesselEventsResult.events)
              ? vesselEventsResult.events
              : [];
            vesselWindowIndex = buildEventTimestampIndex(vesselCruiseEventsByWindow);
          } else if (vesselEventsResult.reason) {
            logSyncFallback('warn', 'ASNAP vessel event lookup for timestamp indexing failed.', {
              reason: vesselEventsResult.reason,
              apiRoot: vesselApiRoot
            });
          }
        }
      }

      const mergedVesselTimestampIndex = new Map();
      [vesselCruiseIndex, vesselWindowIndex, timestampIndex].forEach((indexMap) => {
        if (!(indexMap instanceof Map)) return;
        indexMap.forEach((value, key) => {
          const normalizedKey = String(key);
          if (!mergedVesselTimestampIndex.has(normalizedKey)) {
            mergedVesselTimestampIndex.set(normalizedKey, value);
          }
        });
      });
      if (mergedVesselTimestampIndex.size) {
        vesselTimestampIndex = mergedVesselTimestampIndex;
      }
      vesselTimestampIndexSize = vesselTimestampIndex.size;
      vesselTimestampIndexSource = vesselCruiseIndex.size
        ? 'bycruise'
        : vesselWindowIndex.size
          ? 'window'
          : timestampIndex.size
            ? 'bylowering'
            : 'none';
    }
    vesselAuxPoints = buildAsnapPointsFromAuxData(vesselAuxEntries, {
      eventTimestampById: vesselTimestampIndex,
      dataSource: 'vesselPosition'
    });
    vesselPoints = mergeAsnapPointSets(vesselPoints, vesselAuxPoints);
  } else if (vesselResult.reason) {
    vesselTimestampIndexSize = 0;
    vesselTimestampIndexSource = 'unavailable';
    logSyncFallback('warn', 'ASNAP vesselPosition lookup unavailable for current dive.', {
      reason: vesselResult.reason,
      apiRoot: vesselResult.vesselApiRoot || null,
      candidateApiRoots: Array.isArray(vesselResult.vesselApiRoots)
        ? vesselResult.vesselApiRoots
        : []
    });
  }

  const snapshot = makeSnapshot({
    status: 'ok',
    reason: auxPoints.length ? 'combined' : 'events-bylowering'
  });
  persistAsnapBackfillDebugSnapshot(snapshot);
  logSyncFallback('info', 'ASNAP backfill context loaded.', {
    reason: snapshot.reason,
    counts: snapshot.counts,
    mergedPointSummary: snapshot.mergedPointSummary
  });
  return {
    ok: true,
    reason: null,
    points,
    vesselPoints,
    lowering,
    source: auxPoints.length ? 'combined' : 'events-bylowering'
  };
}

function isAsnapBackfillRequiredForEvent(event) {
  if (!asnapBackfillEnabled) return false;
  if (!event) return false;
  const eventType = String(event.type || '').toUpperCase();
  if (event.isAsnap || eventType === ASNAP_EVENT_VALUE) return false;
  return eventMatchesBackfillAllowlist(event, asnapBackfillAllowlist);
}

async function maybeBackfillEventFromAsnap({
  event,
  loadAsnapContext
}) {
  const defaultResult = {
    attempted: false,
    applied: false,
    reason: null,
    warning: null
  };
  if (!isAsnapBackfillRequiredForEvent(event)) return defaultResult;
  if (hasRequiredBackfilledPositionAux(event)) return defaultResult;

  const targetIso = ensureIsoString(event.eventTimestampUTC || nowUtc());
  const backfilledAtUtc = nowUtc();
  const context = await loadAsnapContext();
  if (!context || !context.ok) {
    const reason = context?.reason || 'context-unavailable';
    const detailReason = reason ? ` (reason: ${reason})` : '';
    return {
      attempted: true,
      applied: false,
      reason,
      warning: `ASNAP position backfill pending${detailReason}; waiting for interpolation context.`
    };
  }

  const resolved = resolveInterpolatedAsnapPositionFromPoints({
    targetIso,
    points: context.points
  });
  if (!resolved) {
    return {
      attempted: true,
      applied: false,
      reason: 'vehicle-no-surrounding-pair',
      warning: 'ASNAP position backfill pending; vehiclePosition interpolation unavailable.'
    };
  }
  const vesselResolved = resolveInterpolatedAsnapPositionFromPoints({
    targetIso,
    points: context.vesselPoints
  });
  if (!vesselResolved) {
    return {
      attempted: true,
      applied: false,
      reason: 'vessel-no-surrounding-pair',
      warning: 'ASNAP position backfill pending; vesselPosition interpolation unavailable.'
    };
  }
  resolved.vesselLat = toNumberOrNull(vesselResolved.lat);
  resolved.vesselLon = toNumberOrNull(vesselResolved.lon);
  resolved.vesselHeadingDeg = toNumberOrNull(vesselResolved.headingDeg);

  const applied = applyBackfilledCoordinatesToEvent(event, resolved, {
    backfilledAtUtc
  });
  if (!applied || !hasRequiredBackfilledPositionAux(event)) {
    return {
      attempted: true,
      applied: false,
      reason: 'apply-failed',
      warning: 'ASNAP position backfill pending; required vehiclePosition and vesselPosition were not produced.'
    };
  }

  return {
    attempted: true,
    applied: true,
    reason: null,
    warning: null
  };
}

function markBackfilledAuxUploadState(event, uploaded) {
  if (!event || typeof event !== 'object') return;
  const payload = event && typeof event.payload === 'object' && event.payload !== null
    ? { ...event.payload }
    : {};
  payload.backfilled_aux_uploaded = !!uploaded;
  event.payload = payload;
}

async function postEventAuxDataEntries({
  apiRoot,
  jwt,
  eventId,
  auxEntries
}) {
  if (!eventId) return;
  const list = Array.isArray(auxEntries) ? auxEntries : [];
  if (!list.length) return;
  const endpoint = `${apiRoot}/api/v1/event_aux_data`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${jwt}`
  };
  for (const entry of list) {
    if (!entry || !entry.data_source || !Array.isArray(entry.data_array) || !entry.data_array.length) {
      continue;
    }
    const payload = buildEventAuxUploadPayload(eventId, entry);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (response.status === 401) {
      throw new Error('401 Unauthorized');
    }
    if (!response.ok && response.status !== 409) {
      const details = await response.text().catch(() => '');
      throw new Error(
        `Aux data sync failed for ${entry.data_source} (HTTP ${response.status}${details ? ` — ${details}` : ''})`
      );
    }
  }
}

async function uploadBackfilledAuxDataIfNeeded({
  apiRoot,
  jwt,
  event
}) {
  if (!event || typeof event !== 'object') return false;
  const auxEntries = buildEventAuxDataPayload(event);
  if (!auxEntries.length) return false;
  if (event?.payload?.backfilled_aux_uploaded === true) return false;
  const eventId = event.serverId || null;
  if (!eventId) {
    throw new Error('Cannot upload aux data without a server event id.');
  }
  await postEventAuxDataEntries({
    apiRoot,
    jwt,
    eventId,
    auxEntries
  });
  markBackfilledAuxUploadState(event, true);
  return true;
}

function serverEventMatchesLocal(event, serverRecord) {
  const expected = buildPatchBody({ ...event });
  const expectedOptions = buildNormalizedOptionMap(optionMapFromArray(expected.event_options));
  const actualOptions = buildNormalizedOptionMap(optionMapFromArray(serverRecord.event_options));
  return expected.event_value === serverRecord.event_value &&
    expected.event_free_text === (serverRecord.event_free_text || '') &&
    expected.ts === toIsoOrNull(serverRecord.ts) &&
    Object.keys(expectedOptions).length === Object.keys(actualOptions).length &&
    Object.entries(expectedOptions).every(([key, value]) => actualOptions[key] === value);
}

async function completeEventSync({ apiRoot, jwt, event, serverId, serverRecord = null, baseUpdatedAtMs }) {
  const current = await getEvent(event.localId);
  if (!current) return false;
  current.serverId = serverId;
  const queueNewerChanges = async (record) => {
    record.serverId = serverId;
    record.syncState = SYNC_STATE.PATCH_PENDING;
    record.lastError = null;
    record.nextAttemptMs = Date.now();
    await put(EVENT_STORE, record);
    scheduleNextSync(record.nextAttemptMs);
  };
  if (current.updatedAtMs > baseUpdatedAtMs || (serverRecord && !serverEventMatchesLocal(current, serverRecord))) {
    await queueNewerChanges(current);
    return false;
  }
  // Save the resolved id before auxiliary upload so an interruption cannot
  // turn the next attempt into another POST.
  await put(EVENT_STORE, current);
  await uploadBackfilledAuxDataIfNeeded({ apiRoot, jwt, event: current });
  const latest = await getEvent(event.localId);
  if (!latest) return false;
  if (latest.updatedAtMs > baseUpdatedAtMs) {
    await queueNewerChanges(latest);
    return false;
  }
  markEventAsSynced(current, serverId);
  await put(EVENT_STORE, current);
  return true;
}

function scheduleNextVerify(targetMs) {
  if (scheduledVerifyTimer) clearTimeout(scheduledVerifyTimer);
  if (!targetMs) {
    scheduledVerifyTimer = null;
    return;
  }
  const delay = Math.max(0, targetMs - Date.now());
  scheduledVerifyTimer = setTimeout(() => {
    verifyPendingEvents().catch(() => {
      // suppress unhandled rejections; errors are surfaced via status/logging.
    });
  }, delay);
}

function scheduleNextSync(targetMs) {
  if (scheduledSyncTimer) clearTimeout(scheduledSyncTimer);
  if (!targetMs) return;
  const delay = Math.max(0, targetMs - Date.now());
  scheduledSyncTimer = setTimeout(() => {
    syncAll();
  }, delay);
}

async function syncAll({ manual = false } = {}) {
  if (!startupComplete) return;
  if (syncInFlight) return;
  const jwt = localStorage.getItem('jwt');
  if (!jwt) {
    status(dom.syncStatus, null, 'Sign in to sync.');
    return;
  }

  const events = await getAllEvents();

  if (!navigator.onLine) {
    const nextRetry = earliestRetryFrom(events);
    scheduleNextSync(nextRetry);
    const offlineMessage = manual
      ? 'Offline — connect to complete manual sync.'
      : 'Offline — waiting for connection to sync.';
    status(dom.syncStatus, null, offlineMessage);
    return;
  }

  try {
    syncInFlight = true;
    dom.syncBtn.disabled = true;
    status(dom.syncStatus, null, manual ? 'Manual sync in progress…' : 'Checking queued work…');

    const apiRoot = resolveApiRoot();
    const now = Date.now();
    const pendingMeta = events
      .filter(isEventSyncable)
      .filter((event) => manual || !event.nextAttemptMs || event.nextAttemptMs <= now)
      .map((event) => ({
        localId: event.localId,
        createdAtMs: event.createdAtMs ?? 0,
        targetIso: ensureIsoString(event.eventTimestampUTC || null)
      }))
      .filter((item) => item.localId)
      .sort((a, b) => a.createdAtMs - b.createdAtMs);

    if (!pendingMeta.length) {
      const nextRetry = earliestRetryFrom(events);
      const awaitingVerification = events.filter((event) => event.syncState === SYNC_STATE.VERIFY_PENDING);
      const verificationFailed = events.some((event) => event.syncState === SYNC_STATE.VERIFY_FAILED);
      const nextVerify = awaitingVerification.reduce(
        (earliest, event) => Math.min(earliest, event.verifyNextAttemptMs || now),
        Infinity
      );
      scheduleNextSync(nextRetry);
      scheduleNextVerify(awaitingVerification.length ? nextVerify : null);
      const messages = [];
      if (nextRetry) messages.push('Awaiting next retry window.');
      if (awaitingVerification.length) messages.push('Awaiting server confirmation.');
      if (verificationFailed) messages.push('Verification stalled — review before re-posting.');
      status(dom.syncStatus, verificationFailed ? 'warn' : null, messages.join(' ') || 'All caught up.');
      return;
    }

    let posted = 0;
    let patched = 0;
    let backfilled = 0;
    let backfillHolds = 0;
    const pendingTargetTimes = pendingMeta
      .map((item) => item.targetIso)
      .filter(Boolean)
      .map((iso) => new Date(iso).getTime())
      .filter((ms) => Number.isFinite(ms));
    // Reduce avoids the argument-count limit of Math.min/max(...events)
    // when long offline sessions produce large pending-event arrays.
    const pendingTargetStartIso = pendingTargetTimes.length
      ? new Date(pendingTargetTimes.reduce((a, b) => (a < b ? a : b))).toISOString()
      : null;
    const pendingTargetStopIso = pendingTargetTimes.length
      ? new Date(pendingTargetTimes.reduce((a, b) => (a > b ? a : b))).toISOString()
      : null;
    let asnapContextPromise = null;
    const loadAsnapContext = async () => {
      if (!asnapContextPromise) {
        asnapContextPromise = loadAsnapBackfillContext({
          apiRoot,
          jwt,
          targetStartIso: pendingTargetStartIso,
          targetStopIso: pendingTargetStopIso
        })
          .catch((err) => ({
            ok: false,
            reason: err?.message || 'context-load-failed',
            points: []
          }));
      }
      return asnapContextPromise;
    };

    for (const item of pendingMeta) {
      const localId = item.localId;
      const event = await getEvent(localId);
      if (!event) continue;
      if (isEventSynced(event)) continue;
      if (!isEventSyncable(event)) continue;

      const baseUpdatedAtMs = event.updatedAtMs ?? 0;
      const isPatch = !!event.serverId && (
        event.syncState === SYNC_STATE.PATCH_PENDING ||
        event.syncState === SYNC_STATE.PATCH_FAILED
      );
      const backfillRequired = isAsnapBackfillRequiredForEvent(event);

      const workState = isPatch ? SYNC_STATE.PATCHING : SYNC_STATE.SYNCING;
      event.syncState = workState;
      // Track backfill holds separately from POST/PATCH attempts so waiting
      // for position data increases backoff without counting a server call.
      event.nextAttemptMs = null;
      event.lastError = null;
      await put(EVENT_STORE, event);

      let postedThisRun = false;
      let patchedThisRun = false;
      const holdForAsnapBackfill = async (message) => {
        const latest = await getEvent(localId);
        const target = latest ? { ...latest } : event;
        const holdCount = (target.backfillHoldCount ?? 0) + 1;
        const backoffAttempt = Math.max(target.attemptCount ?? 0, holdCount, 1);
        const delay = exponentialBackoff(backoffAttempt);
        // Don't bump attemptCount here — no server call was made.
        target.backfillHoldCount = holdCount;
        target.nextAttemptMs = Date.now() + delay;
        target.lastError = message;
        target.syncState = target.serverId ? SYNC_STATE.PATCH_PENDING : SYNC_STATE.UNSYNCED;
        await put(EVENT_STORE, target);
      };

      if (backfillRequired && !hasRequiredBackfilledPositionAux(event)) {
        const backfillResult = await maybeBackfillEventFromAsnap({
          event,
          loadAsnapContext
        });
        if (backfillResult.applied) {
          backfilled += 1;
          await put(EVENT_STORE, event);
          logSyncFallback('info', 'Applied ASNAP backfill prior to POST.', {
            localId,
            eventType: event.type
          });
        } else if (backfillResult.attempted) {
          backfillHolds += 1;
          logSyncFallback('warn', 'ASNAP backfill skipped for event.', {
            localId,
            reason: backfillResult.reason || 'unknown'
          });
          await holdForAsnapBackfill(
            backfillResult.warning ||
            'ASNAP position backfill pending; required interpolation data is unavailable.'
          );
          await sleep(SYNC_EVENT_SPACING_MS);
          continue;
        }
      }

      // Count the server attempt and clear the backfill-hold counter.
      event.attemptCount = (event.attemptCount ?? 0) + 1;
      event.backfillHoldCount = 0;
      await put(EVENT_STORE, event);

      if (backfillRequired && !hasRequiredBackfilledPositionAux(event)) {
        backfillHolds += 1;
        await holdForAsnapBackfill(
          'ASNAP position backfill pending; required vehiclePosition and vesselPosition are missing.'
        );
        await sleep(SYNC_EVENT_SPACING_MS);
        continue;
      }

      try {
        if (!isPatch) {
          const preflightRecord = await fetchServerEventByClientUuid(apiRoot, jwt, event.localId);
          const preflightId = extractServerEventId(preflightRecord);
          if (preflightId) {
            postedThisRun = await completeEventSync({
              apiRoot, jwt, event, serverId: preflightId, serverRecord: preflightRecord, baseUpdatedAtMs
            });
            continue;
          }
        }
        const headers = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${jwt}`
        };
        const body = isPatch ? buildPatchBody(event) : buildPostBody(event);
        const url = isPatch
          ? `${apiRoot}/api/v1/events/${encodeURIComponent(event.serverId)}`
          : `${apiRoot}/api/v1/events`;

        const response = await fetch(url, {
          method: isPatch ? 'PATCH' : 'POST',
          headers,
          body: JSON.stringify(body)
        });

        if (response.status === 401) {
          localStorage.removeItem('jwt');
          status(dom.authStatus, 'alert', 'Session expired');
          if (dom.authSummary) {
            dom.authSummary.textContent = 'Sign in again to resume syncing.';
            dom.authSummary.hidden = false;
          }
          status(dom.syncStatus, null, 'Server rejected token (401). Please sign in again.');
          const latest = await getEvent(localId);
          const target = latest ? { ...latest } : event;
          target.syncState = isPatch ? SYNC_STATE.PATCH_FAILED : SYNC_STATE.UNSYNCED;
          target.lastError = '401 Unauthorized';
          target.attemptCount = Math.max(0, (event.attemptCount ?? 1) - 1);
          target.nextAttemptMs = Date.now() + BACKOFF_BASE_MS;
          await put(EVENT_STORE, target);
          break;
        }

        if (!isPatch && response.status === 409) {
          const latest = await getEvent(localId);
          if (!latest) continue;
          const nextVerify = markEventAsVerifyPending(latest, {
            reason: 'Server reported a conflict; awaiting UUID confirmation.',
            resetAttempts: true
          });
          await put(EVENT_STORE, latest);
          scheduleNextVerify(nextVerify);
          const existingRecord = await fetchServerEventByClientUuid(apiRoot, jwt, event.localId);
          const existingId = extractServerEventId(existingRecord);
          if (existingId) {
            postedThisRun = await completeEventSync({
              apiRoot, jwt, event, serverId: existingId, serverRecord: existingRecord, baseUpdatedAtMs
            });
          }
          continue;
        }

        if (!response.ok) {
          let details = '';
          try {
            details = await response.text();
          } catch (readErr) {
            details = readErr.message;
          }
          throw new Error(`Sync failed (${response.status})${details ? ` — ${details}` : ''}`);
        }

        if (!isPatch) {
          const payload = await response.json().catch(() => null);
          let serverId = payload?.insertedId || null;
          let serverRecord = null;
          if (!serverId) {
            const latest = await getEvent(localId);
            if (!latest) continue;
            const nextVerify = markEventAsVerifyPending(latest, {
              reason: 'Awaiting server confirmation',
              resetAttempts: true
            });
            await put(EVENT_STORE, latest);
            scheduleNextVerify(nextVerify);
            serverRecord = await fetchServerEventByClientUuid(apiRoot, jwt, event.localId);
            serverId = extractServerEventId(serverRecord);
          }
          if (!serverId) continue;
          postedThisRun = await completeEventSync({ apiRoot, jwt, event, serverId, serverRecord, baseUpdatedAtMs });
        } else {
          patchedThisRun = await completeEventSync({ apiRoot, jwt, event, serverId: event.serverId, baseUpdatedAtMs });
        }
        await render();

        if (event.isAsnap) {
          await sleep(ASNAP_SYNC_DELAY_MS);
        }
      } catch (err) {
        const attempts = event.attemptCount ?? 1;
        const delay = exponentialBackoff(attempts);
        const latest = await getEvent(localId);
        const target = latest ? { ...latest } : event;
        if (!target.serverId && event.serverId) {
          target.serverId = event.serverId;
        }
        const mergedAttempts = Math.max(event.attemptCount ?? 0, target.attemptCount ?? 0);
        target.attemptCount = mergedAttempts;
        target.nextAttemptMs = Date.now() + delay;
        target.lastError = err.message;
        if (err.verificationConflict) {
          target.syncState = SYNC_STATE.VERIFY_FAILED;
          target.verifyNextAttemptMs = null;
          target.nextAttemptMs = null;
        } else if (target.syncState === SYNC_STATE.VERIFY_PENDING) {
          target.nextAttemptMs = null;
          scheduleNextVerify(target.verifyNextAttemptMs);
        } else if (isPatch) {
          if (target.syncState !== SYNC_STATE.PATCH_PENDING) {
            target.syncState = SYNC_STATE.PATCH_FAILED;
          }
        } else {
          target.syncState = target.serverId ? SYNC_STATE.PATCH_PENDING : SYNC_STATE.UNSYNCED;
        }
        await put(EVENT_STORE, target);
      } finally {
        if (postedThisRun) posted += 1;
        if (patchedThisRun) patched += 1;
        await sleep(SYNC_EVENT_SPACING_MS);
      }
    }

    if (posted || patched) {
      const parts = [];
      if (posted) parts.push(`${posted} created`);
      if (patched) parts.push(`${patched} updated`);
      if (backfilled > 0) {
        parts.push(`${backfilled} ASNAP-backfilled`);
      }
      let message = `Synced ${parts.join(' & ')}.`;
      if (backfillHolds > 0) {
        message += ` ${backfillHolds} event${backfillHolds === 1 ? '' : 's'} held for ASNAP backfill.`;
      }
      status(dom.syncStatus, backfillHolds > 0 ? 'warn' : null, message);
    } else if (!manual) {
      status(dom.syncStatus, null, 'Awaiting next retry window.');
    }

    // Surface backfill summary inside the ASNAP modal's #backfillStatus line.
    if (dom.backfillStatus) {
      const parts = [];
      if (backfilled > 0) parts.push(`Backfilled ${backfilled} event${backfilled === 1 ? '' : 's'}`);
      if (backfillHolds > 0) parts.push(`${backfillHolds} held for context`);
      if (parts.length) {
        status(dom.backfillStatus, backfillHolds > 0 ? 'warn' : null, `${parts.join(' · ')}.`);
      } else if (asnapBackfillEnabled) {
        status(dom.backfillStatus, null, 'No backfill activity this sync.');
      } else {
        status(dom.backfillStatus, null, '');
      }
    }

    const latestEvents = await getAllEvents();
    const nextRetry = earliestRetryFrom(latestEvents);
    scheduleNextSync(nextRetry);
    const nextVerify = earliestVerifyFrom(latestEvents);
    scheduleNextVerify(nextVerify);
  } finally {
    syncInFlight = false;
    dom.syncBtn.disabled = verifyInFlight;
    // Render BEFORE updateAuthUI so a throw in updateAuthUI can't skip
    // the UI refresh that reflects the final sync state.
    await render();
    try { updateAuthUI(); } catch { /* ignore */ }
  }
}

async function verifyPendingEvents({ manual = false } = {}) {
  if (!startupComplete) return;
  if (verifyInFlight) return;
  const jwt = localStorage.getItem('jwt');
  if (!jwt) return;
  const events = await getAllEvents();

  if (!navigator.onLine) {
    const next = earliestVerifyFrom(events);
    if (next) scheduleNextVerify(next);
    return;
  }

  const now = Date.now();
  const pending = events
    .filter((event) => {
      if (!event) return false;
      if (event.syncState === SYNC_STATE.VERIFY_PENDING) return true;
      if (event.syncState === SYNC_STATE.VERIFY_FAILED) return manual;
      return false;
    })
    .filter((event) => {
      if (event.syncState === SYNC_STATE.VERIFY_PENDING) {
        return manual || !event.verifyNextAttemptMs || event.verifyNextAttemptMs <= now;
      }
      return true;
    })
    .map((event) => ({
      localId: event.localId,
      nextAttemptMs: event.verifyNextAttemptMs ?? 0
    }))
    .filter((item) => item.localId)
    .sort((a, b) => a.nextAttemptMs - b.nextAttemptMs);

  if (!pending.length) {
    const next = earliestVerifyFrom(events);
    scheduleNextVerify(next);
    return;
  }

  const apiRoot = resolveApiRoot();
  try {
    verifyInFlight = true;
    dom.syncBtn.disabled = true;
    for (const item of pending) {
      const current = await getEvent(item.localId);
      if (!current) continue;
      if (current.syncState !== SYNC_STATE.VERIFY_PENDING && current.syncState !== SYNC_STATE.VERIFY_FAILED) continue;
      if (!manual && current.verifyNextAttemptMs && current.verifyNextAttemptMs > Date.now()) continue;

      let failure = 'Awaiting server confirmation';
      let conflict = false;
      try {
        const uuidRecord = await fetchServerEventByClientUuid(apiRoot, jwt, current.localId);
        const resolvedId = extractServerEventId(uuidRecord);
        if (resolvedId) {
          await completeEventSync({
            apiRoot, jwt, event: current, serverId: resolvedId, serverRecord: uuidRecord, baseUpdatedAtMs: current.updatedAtMs
          });
          continue;
        }
      } catch (err) {
        failure = err.message;
        conflict = err.verificationConflict === true;
      }
      const latest = await getEvent(current.localId);
      if (!latest) continue;
      if (latest.syncState !== SYNC_STATE.VERIFY_PENDING && latest.syncState !== SYNC_STATE.VERIFY_FAILED) continue;
      latest.verifyAttemptCount += 1;
      if (conflict || latest.verifyAttemptCount >= VERIFY_MAX_ATTEMPTS) {
        latest.syncState = SYNC_STATE.VERIFY_FAILED;
        latest.verifyNextAttemptMs = null;
        latest.lastError = conflict ? failure : `Unable to confirm event with server. ${failure}`;
        status(dom.syncStatus, 'warn', 'Verification stalled — review before re-posting.');
      } else {
        markEventAsVerifyPending(latest, { reason: failure });
      }
      await put(EVENT_STORE, latest);

      await sleep(SYNC_EVENT_SPACING_MS);
    }
  } finally {
    verifyInFlight = false;
    dom.syncBtn.disabled = syncInFlight;
    await render();
    const latestEvents = await getAllEvents();
    const next = earliestVerifyFrom(latestEvents);
    scheduleNextVerify(next);
  }
}

dom.syncBtn.addEventListener('click', async () => {
  await syncAll({ manual: true });
  await verifyPendingEvents({ manual: true });
});

window.addEventListener('online', () => {
  connectionState();
  syncAll();
  verifyPendingEvents();
  refreshTemplatesFromServer({ showStatus: false });
  // Load Sealog Events imports server records on demand.
});
window.addEventListener('offline', connectionState);
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('pageshow', () => {
  startGpsWarmup({ immediate: true });
  triggerServiceWorkerUpdateCheck();
});
window.addEventListener('pagehide', stopGpsWarmup);
window.addEventListener('beforeunload', stopGpsWarmup);
window.addEventListener('focus', () => {
  requestPassiveFix();
  triggerServiceWorkerUpdateCheck();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (dom.confirmModal && !dom.confirmModal.hidden) {
      closeConfirmModal(false);
      ev.preventDefault();
      return;
    }
    if (dom.authPanel && !dom.authPanel.hidden) {
      setAuthPanelOpen(false, { reason: 'manual' });
      ev.preventDefault();
      return;
    }
    if (dom.eventEditor && !dom.eventEditor.hidden) {
      closeEventEditor();
      ev.preventDefault();
    }
  }
});

verifyPendingEvents();

async function exportCsv() {
  const events = await getAllEvents();
  const header = [
    'localId',
    'serverId',
    'type',
    'eventTemplateId',
    'eventTemplateName',
    'eventTimestampUTC',
    'originalTimestampUTC',
    'lat',
    'lon',
    'acc_m',
    'notes',
    'syncState',
    'attemptCount',
    'nextAttemptMs',
    'verifyAttemptCount',
    'verifyNextAttemptMs',
    'lastError',
    'lastSyncUTC',
    'revisions',
    'payload'
  ];
  const rows = [header.join(',')];
  for (const event of events) {
    const row = header.map((key) => {
      let value = event[key];
      if (key === 'revisions') {
        value = JSON.stringify(event.revisions || []);
      } else if (key === 'payload') {
        value = JSON.stringify(buildEventFreeText(event));
      } else if (key === 'nextAttemptMs' && event.nextAttemptMs == null) {
        value = '';
      } else if (key === 'verifyNextAttemptMs') {
        value = event.verifyNextAttemptMs ?? '';
      } else if (key === 'verifyAttemptCount') {
        value = event.verifyAttemptCount ?? 0;
      } else if (key === 'lastError') {
        value = event.lastError ?? '';
      } else if (Array.isArray(value)) {
        value = value.join('|');
      } else if (value == null) {
        value = '';
      }
      return `"${String(value).replace(/"/g, '""')}"`;
    });
    rows.push(row.join(','));
  }
  const blob = new Blob([rows.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sealog_offline_export.csv';
  a.click();
  URL.revokeObjectURL(url);
  status(dom.syncStatus, null, 'Export complete. Copy CSV to laptop if needed.');
}

dom.exportBtn.addEventListener('click', exportCsv);

async function forceRepostEvent(localId) {
  const event = await getEvent(localId);
  if (!event) {
    status(dom.syncStatus, null, 'Event not found.');
    return;
  }
  if (event.syncState !== SYNC_STATE.VERIFY_FAILED) {
    status(dom.syncStatus, null, 'Event is not awaiting verification.');
    return;
  }
  const confirmed = await openConfirmModal({
    title: 'Force Re-Post?',
    message: 'This will re-send the event to Sealog and may create duplicates. Continue?',
    confirmLabel: 'Re-Post Anyway',
    variant: 'danger'
  });
  if (!confirmed) return;
  event.syncState = SYNC_STATE.UNSYNCED;
  event.verifyAttemptCount = 0;
  event.verifyNextAttemptMs = null;
  event.nextAttemptMs = Date.now();
  event.lastError = 'Manual re-post requested';
  await put(EVENT_STORE, event);
  status(dom.syncStatus, 'warn', 'Event queued for manual re-post. Duplicates may occur.');
  scheduleNextSync(Date.now());
  await render();
}

async function deleteEventById(localId) {
  const event = await getEvent(localId);
  if (!event) {
    status(dom.syncStatus, null, 'Event already removed.');
    return;
  }
  if (event.serverId) {
    alert('Synced events cannot be deleted from this device. Use Clear Synced Cached Events instead.');
    return;
  }
  await del(EVENT_STORE, localId);
  status(dom.syncStatus, null, 'Event deleted.');
  await render();
}

dom.list.addEventListener('click', async (ev) => {
  const summaryButton = findSummaryButtonFromTarget(ev.target);
  if (summaryButton) {
    ev.preventDefault();
    toggleEventCardExpanded(summaryButton);
    return;
  }
  const target = ev.target instanceof Element ? ev.target : null;
  if (!target) return;
  const editButton = target.closest('button.edit-event');
  if (editButton) {
    ev.preventDefault();
    ev.stopPropagation();
    const id = editButton.dataset.id;
    if (!id) return;
    openEventEditor(id);
    return;
  }
  const forceButton = target.closest('button.force-repost');
  if (forceButton) {
    ev.preventDefault();
    ev.stopPropagation();
    const id = forceButton.dataset.id;
    if (!id) return;
    forceButton.blur();
    forceRepostEvent(id);
    return;
  }
  const deleteButton = target.closest('button.delete-event');
  if (!deleteButton) return;
  ev.preventDefault();
  ev.stopPropagation();
  const id = deleteButton.dataset.id;
  if (!id) return;
  deleteButton.blur();
  if (!confirm('Delete this unsynced event?')) return;
  try {
    await deleteEventById(id);
  } catch (error) {
    alert(`Failed to delete event: ${error.message}`);
  }
});

function renderEvent(event) {
  const isAsnap = isAsnapEvent(event);
  const displayName = isAsnap ? 'ASNAP' : (event.eventTemplateName || event.type);
  const timestampUtc = event.eventTimestampUTC;
  const statusInfo = buildSyncStatus(event);
  const summaryTime = formatUtcSummary(timestampUtc);
  const relativeLabel = describeRelativeTime(timestampUtc);
  const notesPreview = truncateText(event.notes || '', 70);
  const latOptionValue = findOptionValueByRegex(event.option_values, /latitude/i);
  const lonOptionValue = findOptionValueByRegex(event.option_values, /longitude/i);
  const accOptionValue = findOptionValueByRegex(event.option_values, /(accuracy|acc[_\s]?m\b)/i);
  const primaryOption = firstDisplayOption(event.option_values);

  const detailRows = [];
  if (isAsnap) {
    detailRows.push({ label: 'ASNAP', value: 'Automated GPS snapshot logged by the device.' });
  }
  detailRows.push({ label: 'Status', value: statusInfo.description });
  detailRows.push({ label: 'Event Type', value: event.type || displayName || 'Event' });
  if (event.syncState === SYNC_STATE.VERIFY_PENDING) {
    const retryMs = event.verifyNextAttemptMs && event.verifyNextAttemptMs > Date.now()
      ? `Next check in ${formatDuration(event.verifyNextAttemptMs - Date.now())}.`
      : 'Checking with Sealog shortly.';
    detailRows.push({ label: 'Verification', value: retryMs });
  } else if (event.syncState === SYNC_STATE.VERIFY_FAILED) {
    const message = event.lastError || 'Unable to confirm event with Sealog.';
    detailRows.push({ label: 'Verification', value: message });
  }
  const timestampDetail = `${formatUtc(timestampUtc)} UTC`;
  detailRows.push({
    label: 'Timestamp',
    value: relativeLabel ? `${timestampDetail} (${relativeLabel})` : timestampDetail,
    mono: true
  });
  if (event.originalTimestampUTC && event.originalTimestampUTC !== timestampUtc) {
    detailRows.push({
      label: 'Original Timestamp',
      value: `${formatUtc(event.originalTimestampUTC)} UTC`,
      mono: true
    });
  }
  if (Number.isFinite(event.lat) && Number.isFinite(event.lon)) {
    const accuracy = Number.isFinite(event.acc_m) ? ` (±${event.acc_m}m)` : '';
    detailRows.push({
      label: 'Location',
      value: `${event.lat.toFixed(5)}, ${event.lon.toFixed(5)}${accuracy}`,
      mono: true
    });
  } else if (latOptionValue || lonOptionValue) {
    const latText = latOptionValue != null ? String(latOptionValue) : '—';
    const lonText = lonOptionValue != null ? String(lonOptionValue) : '—';
    const accText = accOptionValue != null ? ` (±${accOptionValue}m)` : '';
    detailRows.push({
      label: 'Location (captured)',
      value: `${latText}, ${lonText}${accText}`,
      mono: true
    });
  }
  if (Array.isArray(event.template_categories) && event.template_categories.length) {
    detailRows.push({ label: 'Categories', value: event.template_categories.join(', ') });
  }
  if (Array.isArray(event.option_values) && event.option_values.length) {
    event.option_values.forEach((opt) => {
      if (!opt || !opt.event_option_name) return;
      const key = normalizeOptionKey(opt.event_option_name);
      if (key === DEVICE_UTC_KEY || key === DEVICE_ACCURACY_KEY || key === CLIENT_UUID_OPTION_KEY) return;
      if (/latitude|longitude/.test(key)) return;
      const value = Array.isArray(opt.event_option_value)
        ? opt.event_option_value.join(', ')
        : opt.event_option_value;
      if (value == null || value === '') return;
      const optionLabel = formatOptionLabel(opt.event_option_name);
      detailRows.push({ label: optionLabel, value: String(value) });
    });
  }
  if (event.notes) {
    detailRows.push({ label: 'Notes', value: event.notes });
  }

  const deletable = !event.serverId && !isAsnap && event.syncState !== SYNC_STATE.SYNCED;
  const canForceRepost = event.syncState === SYNC_STATE.VERIFY_FAILED;
  const detailHtml = detailRows.map((row) => {
    const valueClass = row.mono ? 'event-detail-value mono' : 'event-detail-value';
    return `<div class="event-detail-row">`
      + `<dt class="event-detail-label">${escapeHtml(row.label)}</dt>`
      + `<dd class="${valueClass}">${escapeHtml(row.value)}</dd>`
      + `</div>`;
  }).join('');
  let actions = '';
  if (isAsnap) {
    actions = '<p class="help muted">ASNAP events are read-only and cannot be edited from this device.</p>';
  } else {
    const buttons = [
      `<button type="button" class="secondary small edit-event" data-id="${event.localId}">Edit</button>`
    ];
    if (deletable) {
      buttons.push(`<button type="button" class="danger small delete-event" data-id="${event.localId}">Delete</button>`);
    }
    if (canForceRepost) {
      buttons.push(`<button type="button" class="danger small force-repost" data-id="${event.localId}">Force Re-Post</button>`);
    }
    actions = `<div class="event-actions">${buttons.join('')}</div>`;
  }

  const statusChip = `<span class="event-status-chip ${statusInfo.className}">` +
    (statusInfo.icon ? renderPhosphorIcon(statusInfo.icon, 'ui-icon status-icon') : '') +
    `<span>${statusInfo.label}</span>` +
    `</span>`;

  const summaryMetaParts = [
    primaryOption ? `<span class="event-primary">${escapeHtml(`${primaryOption.label}: ${primaryOption.value}`)}</span>` : '',
    summaryTime ? `<span class="event-time">${escapeHtml(summaryTime)}</span>` : '',
    relativeLabel ? `<span class="event-relative">${escapeHtml(relativeLabel)}</span>` : '',
    notesPreview ? `<span class="event-note" title="${escapeHtml(event.notes || '')}">${escapeHtml(notesPreview)}</span>` : ''
  ].filter(Boolean);

  const summaryMetaHtml = summaryMetaParts.length
    ? `<div class="event-summary-meta">${summaryMetaParts.join('')}</div>`
    : '';

  const eventClass = isAsnap ? 'event-card asnap' : 'event-card';

  return (
    `<li class="${eventClass}" data-id="${event.localId}" data-sync-state="${event.syncState}" data-expanded="false">
      <button type="button" class="event-summary" data-id="${event.localId}" aria-expanded="false">
        <div class="event-summary-main">
          <div class="event-summary-top">
            <span class="event-title">${escapeHtml(displayName || 'Event')}</span>
            ${statusChip}
          </div>
          ${summaryMetaHtml}
        </div>
        <span class="event-chevron" aria-hidden="true">${renderPhosphorIcon('caret-down', 'ui-icon event-chevron-icon')}</span>
      </button>
      <div class="event-detail" hidden>
        <dl class="event-detail-list">${detailHtml}</dl>
        ${actions}
      </div>
    </li>`
  ).trim();
}

async function render() {
  updateAuthUI();
  connectionState();
  updateFixUI();
  const events = await getAllEvents();
  hasAsnapEvents = events.some((event) => isAsnapEvent(event));
  const asnapVisible = asnapShowInList && (hasAsnapEvents || asnapEnabled);
  if (!asnapVisible && activeEventFilter === EVENT_FILTERS.ASNAP) {
    activeEventFilter = EVENT_FILTERS.LOCAL;
  }
  updateFilterChips();
  const sorted = events
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a.eventTimestampUTC || a.createdAtUTC || 0).getTime();
      const bTime = new Date(b.eventTimestampUTC || b.createdAtUTC || 0).getTime();
      return bTime - aTime;
    });
  const filtered = sorted.filter((event) => {
    const asnapEvent = isAsnapEvent(event);
    if (!asnapShowInList && asnapEvent) return false;
    switch (activeEventFilter) {
      case EVENT_FILTERS.LOCAL:
        return !asnapEvent && (isEventLocal(event) || !event.serverId);
      case EVENT_FILTERS.SYNCED:
        return isEventSynced(event);
      case EVENT_FILTERS.PENDING:
        return isEventPending(event);
      case EVENT_FILTERS.ASNAP:
        return asnapShowInList && asnapEvent;
      case EVENT_FILTERS.ALL:
      default:
        return asnapEvent ? asnapShowInList : true;
    }
  });
  dom.list.innerHTML = filtered.map(renderEvent).join('');
  if (!sorted.length) {
    dom.emptyState.textContent = defaultEmptyStateMessage;
    dom.emptyState.style.display = 'block';
  } else if (!filtered.length) {
    dom.emptyState.textContent = 'No events match this filter.';
    dom.emptyState.style.display = 'block';
  } else {
    dom.emptyState.textContent = defaultEmptyStateMessage;
    dom.emptyState.style.display = 'none';
  }
  const pendingCount = events.filter((event) => isEventPending(event)).length;
  const total = events.length;
  const hasErrors = events.some((event) => event.lastError && !isEventSynced(event) || event.syncState === SYNC_STATE.PATCH_FAILED);
  const queueState = hasErrors ? 'alert' : pendingCount ? 'warn' : 'ok';
  const queueMessage = hasErrors
    ? `${pendingCount} pending / ${total} total (check errors)`
    : `${pendingCount} pending / ${total} total`;
  status(dom.queueInfo, queueState, queueMessage);
}

setInterval(() => {
  if (lastFix) updateFixUI();
}, 5000);

let updateBannerLocked = false;

function hideUpdateBanner({ resetVersion = true } = {}) {
  const wasOpen = !dom.updateBanner.hidden;
  dom.updateBanner.hidden = true;
  dom.reloadBtn.disabled = false;
  dom.reloadBtn.textContent = 'Reload now';
  if (dom.reloadBtn.onclick) dom.reloadBtn.onclick = null;
  if (resetVersion) {
    lastBannerVersion = null;
    updateReadySwVersion = null;
    passiveUpdateNotified = false;
  }
  if (wasOpen && updateBannerLocked) {
    updateBannerLocked = false;
    unlockBodyScroll();
  }
  refreshServiceWorkerVersionLabel();
}

// Retain the dismissed version to suppress repeat prompts in this session.
// A different reported version can show a new banner.
function dismissUpdateBanner() {
  hideUpdateBanner({ resetVersion: false });
}

function showUpdateBanner(version) {
  lastBannerVersion = version || null;
  if (dom.bannerText) {
    dom.bannerText.textContent = version
      ? `Version ${version} is ready. Reload to update.`
      : 'A newer version of Sealog Offline is ready. Reload to update.';
  }
  const wasHidden = dom.updateBanner.hidden;
  dom.updateBanner.hidden = false;
  if (wasHidden && !updateBannerLocked) {
    updateBannerLocked = true;
    lockBodyScroll();
  }
  dom.reloadBtn.disabled = false;
  dom.reloadBtn.textContent = 'Reload now';
  dom.reloadBtn.onclick = () => {
    dom.reloadBtn.disabled = true;
    dom.reloadBtn.textContent = 'Reloading…';
    reloadOnControllerChange = true;
    navigator.serviceWorker.getRegistration()
      .then((registration) => {
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          reloadOnControllerChange = false;
          requestServiceWorkerState(registration);
          window.location.reload();
        }
      })
      .catch(() => {
        reloadOnControllerChange = false;
        window.location.reload();
      });
  };
}

// Wire the dismiss button (#updateDismissBtn) once at module init.
dom.updateDismissBtn?.addEventListener('click', dismissUpdateBanner);

function monitorRegistrationForUpdates(registration) {
  if (!registration) return;
  if (registration.__monitoringUpdates) return;
  registration.__monitoringUpdates = true;

  const notifyUpdate = (versionHint = null) => {
    if (versionHint) {
      if (shouldShowBanner(CACHE_VERSION, versionHint, lastBannerVersion)) {
        showUpdateBanner(versionHint);
      }
      return;
    }
    if (!passiveUpdateNotified) {
      passiveUpdateNotified = true;
      // Let a racing SW_UPDATE_READY message show the version first.
      // Use a versionless banner only if that message has not arrived.
      setTimeout(() => {
        if (lastBannerVersion) return;
        if (dom.updateBanner && !dom.updateBanner.hidden) return;
        showUpdateBanner(null);
      }, 800);
    }
  };

  const handleWaitingWorker = () => {
    if (!registration.waiting) return;
    notifyUpdate(null);
  };

  if (registration.waiting) {
    handleWaitingWorker();
  }

  const trackInstalling = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && registration.waiting) {
        handleWaitingWorker();
      }
    });
  };

  if (registration.installing) {
    trackInstalling(registration.installing);
  }

  registration.addEventListener('updatefound', () => {
    trackInstalling(registration.installing);
  });
}

function triggerServiceWorkerUpdateCheck() {
  if (!updateCheckRegistration) return;
  if (!navigator.onLine) return;
  const now = Date.now();
  // Throttle: foregrounding can fire visibilitychange + focus back-to-back.
  if (now - lastSwUpdateCheckAt < 10000) return;
  lastSwUpdateCheckAt = now;
  updateCheckRegistration.update().catch(() => null);
}

function ensurePeriodicUpdateChecks(registration) {
  if (!registration) return;
  updateCheckRegistration = registration;

  if (!updateCheckTimer) {
    updateCheckTimer = setInterval(triggerServiceWorkerUpdateCheck, UPDATE_CHECK_INTERVAL_MS);
  }

  if (!onlineUpdateListenerRegistered) {
    window.addEventListener('online', triggerServiceWorkerUpdateCheck);
    onlineUpdateListenerRegistered = true;
  }
  triggerServiceWorkerUpdateCheck();
}

async function logServiceWorkerRegistrations() {
  if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return [];
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const summary = registrations.map((reg) => ({
      scope: reg.scope,
      active: reg.active?.scriptURL || null,
      waiting: reg.waiting?.scriptURL || null,
      installing: reg.installing?.scriptURL || null,
    }));
    return summary;
  } catch {
    return [];
  }
}

function handleServiceWorkerMessage(event) {
  const data = event.data;
  if (!data || !data.type) return;
  const { type, version } = data;

  if (type === 'SW_STATE') {
    if (version) {
      lastKnownSwVersion = version;
    }
    updateReadySwVersion = null;
    const controller = navigator.serviceWorker.controller;
    const controllerInfo = controller ? controller.scriptURL : 'none';
    status(
      dom.syncStatus,
      null,
      `Service worker active (version ${version || 'unknown'}; controller: ${controllerInfo})`
    );
    refreshServiceWorkerVersionLabel();
    if (version === CACHE_VERSION) {
      hideUpdateBanner();
      // Versions aligned — clear any stale 'differs from SW' banner so the user
      // doesn't see a permanent reload-to-align warning after a transient
      // race during activation.
      if (swMismatchWarned) {
        swMismatchWarned = false;
      }
    } else {
      maybeWarnSwVersionMismatch();
    }
    return;
  }

  if (type === 'SW_UPDATE_READY') {
    if (version) {
      updateReadySwVersion = version;
    }
    status(
      dom.syncStatus,
      null,
      `Update ready: worker ${version || 'unknown'} vs app ${CACHE_VERSION}`
    );
    refreshServiceWorkerVersionLabel();
    if (shouldShowBanner(CACHE_VERSION, version, lastBannerVersion)) {
      showUpdateBanner(version);
    } else if (version === CACHE_VERSION) {
      hideUpdateBanner();
    }
    return;
  }

  if (type === 'SW_LOG') {
    return;
  }

  return;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setServiceWorkerVersionLabel('unsupported');
    return;
  }
  const hasPrefix = Boolean(appPathPrefix);
  const swPath = hasPrefix ? `${appPathPrefix}/sw.js` : '/sw.js';
  if (!hasPrefix) {
    status(dom.syncStatus, null, 'Service worker inactive on landing page.');
    setServiceWorkerVersionLabel('inactive');
    return;
  }

  try {
    status(dom.syncStatus, null, 'Registering service worker…');
    setServiceWorkerVersionLabel('registering…');
    const scope = `${appPathPrefix}/`;
    swRegistration = await navigator.serviceWorker.register(swPath, {
      scope,
      type: 'module',
      updateViaCache: 'none'
    });
    status(
      dom.syncStatus,
      null,
      `Service worker registered (scope: ${swRegistration.scope}; app ${CACHE_VERSION})`
    );
    monitorRegistrationForUpdates(swRegistration);
    ensurePeriodicUpdateChecks(swRegistration);
    requestServiceWorkerState(swRegistration);
    logServiceWorkerRegistrations();
    navigator.serviceWorker.ready
      .then(() => {
        const controller = navigator.serviceWorker.controller;
        const controllerInfo = controller ? controller.scriptURL : 'none';
        status(
          dom.syncStatus,
          null,
          `Service worker ready (controller: ${controllerInfo}; app ${CACHE_VERSION})`
        );
        attachSwStateListener(controller);
        refreshServiceWorkerVersionLabel();
        requestServiceWorkerState(swRegistration);
      })
      .catch((err) => {
        status(dom.syncStatus, null, `Service worker ready wait failed: ${err.message}`);
        setServiceWorkerVersionLabel('ready wait failed');
      });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const controller = navigator.serviceWorker.controller;
      const controllerInfo = controller ? controller.scriptURL : 'none';
      status(
        dom.syncStatus,
        null,
        `Service worker controller changed (controller: ${controllerInfo})`
      );
      logServiceWorkerRegistrations();
      navigator.serviceWorker.getRegistration()
        .then((registration) => {
          monitorRegistrationForUpdates(registration);
          ensurePeriodicUpdateChecks(registration);
          requestServiceWorkerState(registration);
          return null;
        })
        .catch(() => null);
      if (reloadOnControllerChange) {
        reloadOnControllerChange = false;
        window.location.reload();
      }
    });
  } catch (err) {
    const details = err?.message || String(err);
    status(dom.syncStatus, null, `Service worker registration failed: ${details}`);
    setServiceWorkerVersionLabel('registration failed');
  }
}

registerServiceWorker();
if ('serviceWorker' in navigator && appPathPrefix) {
  navigator.serviceWorker.ready
    .then((registration) => {
      monitorRegistrationForUpdates(registration);
      ensurePeriodicUpdateChecks(registration);
      requestServiceWorkerState(registration);
      return null;
    })
    .catch(() => null);
}
hideUpdateBanner();
setTimeout(() => {
  maybeWarnSwVersionMismatch();
}, 6000);
async function bootstrap() {
  useFallbackTemplates();
  const storedCruiseId = await getMetaValue(META_CURRENT_CRUISE_ID);
  if (storedCruiseId) {
    currentCruiseId = storedCruiseId;
  }
  const storedCruiseStart = await getMetaValue(META_CURRENT_CRUISE_START);
  const storedCruiseStop = await getMetaValue(META_CURRENT_CRUISE_STOP);
  currentCruiseStartUTC = storedCruiseStart || null;
  currentCruiseStopUTC = storedCruiseStop || null;
  updateAsnapControls();
  recomputeAsnapScheduler();
  ensureAsnapStatusTicker();
  await recoverInterruptedSync();
  await loadTemplatesFromDb();
  updateAsnapStatus();
  startGpsWarmup({ immediate: true });
  startupComplete = true;
  await render();
  if (navigator.onLine) {
    syncAll();
    refreshTemplatesFromServer({ showStatus: false });
  }
}

bootstrap().catch((err) => {
  status(dom.syncStatus, null, `Startup failed: ${err.message}`);
});

// Diagnostic panels share the application's scroll-lock state.
function setDiagnosticPanelOpen(panel, open) {
  if (panel.hidden === !open) return;
  panel.hidden = !open;
  if (open) lockBodyScroll();
  else unlockBodyScroll();
}

document.addEventListener('click', (event) => {
  const opener = event.target.closest('#gpsStatus, #asnapStatusTile');
  if (opener) {
    setDiagnosticPanelOpen(document.getElementById(opener.getAttribute('aria-controls')), true);
    return;
  }
  const closer = event.target.closest('#gpsModalCloseBtn, #asnapModalCloseBtn');
  if (closer) {
    setDiagnosticPanelOpen(document.getElementById(closer.id === 'gpsModalCloseBtn' ? 'gpsModal' : 'asnapModal'), false);
    return;
  }
  if (event.target.matches('#gpsModal, #asnapModal')) {
    setDiagnosticPanelOpen(event.target, false);
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === 'username' || event.key === 'jwt') updateAuthUI();
});
