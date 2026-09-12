/**
 * Per-template auto-fill rules. Pure logic for resolving which template
 * option fields should be auto-populated at log time and at edit time,
 * keyed by template id with fallback matching by last-seen event value.
 *
 * Storage helpers persist rules to localStorage; resolvers take the rules
 * object directly.
 * @module
 */

import { normalizeOptionKey } from '../events/event-transform.js';
import { escapeHtml } from '../ui/html-utils.js';

/** localStorage key under which the rules object is persisted. */
export const AUTO_FILL_RULES_STORAGE_KEY = 'templateAutoFillRules';

/** Source tokens recognized by {@link applySourceValue}. */
export const AUTO_FILL_SOURCES = Object.freeze(['now_utc', 'lat', 'lon', 'acc']);

const VALID_MODES = new Set(['log', 'edit']);

/**
 * Read and parse the auto-fill rules object from localStorage. Returns
 * an empty object when the key is missing, the stored value is not valid
 * JSON, or the parsed value is not a plain object (including null, arrays,
 * and JSON primitives).
 * @returns {object} Parsed rules object keyed by template id. Empty when
 *   missing or malformed.
 */
export function loadAutoFillRules() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return {};
    const raw = localStorage.getItem(AUTO_FILL_RULES_STORAGE_KEY);
    if (raw == null || raw === '') return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Persist the auto-fill rules object to localStorage as JSON. No-op when
 * localStorage is unavailable.
 * @param {object} rules - Rules object keyed by template id.
 */
export function saveAutoFillRules(rules) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(AUTO_FILL_RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Storage or serialization failures leave the saved rules unchanged.
  }
}

/**
 * Compare two event-value strings case-insensitively after trimming. Both
 * arguments must be non-empty strings; returns false otherwise.
 * @param {string} a - Candidate value.
 * @param {string} b - Candidate value.
 * @returns {boolean} True when the strings match ignoring case and surrounding whitespace.
 */
function eventValueMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aNorm = a.trim().toLowerCase();
  const bNorm = b.trim().toLowerCase();
  if (!aNorm || !bNorm) return false;
  return aNorm === bNorm;
}

/**
 * Return the rule entry for a template. Looks up by templateId first; when
 * absent, falls back to matching any entry whose `_lastSeenEventValue`
 * equals `eventValue` (case-insensitive). Returns null when neither
 * strategy finds an entry.
 * @param {object} rules - Full rules object.
 * @param {string|null} templateId - Template id to look up.
 * @param {string|null} eventValue - Fallback event-value token for matching
 *   when templateId is missing or absent from the rules.
 * @returns {object|null} The matched template rule entry, or null.
 */
export function findTemplateEntry(rules, templateId, eventValue) {
  if (!rules || typeof rules !== 'object') return null;
  if (templateId != null) {
    const direct = rules[templateId];
    if (direct && typeof direct === 'object') return direct;
  }
  if (eventValue == null) return null;
  for (const key of Object.keys(rules)) {
    const entry = rules[key];
    if (!entry || typeof entry !== 'object') continue;
    if (eventValueMatches(entry._lastSeenEventValue, eventValue)) {
      return entry;
    }
  }
  return null;
}

/**
 * Resolve a single field auto-fill rule for the given template and mode.
 * The field name is normalized via `normalizeOptionKey` before lookup so
 * stored keys can be matched regardless of casing or whitespace in the
 * caller's raw `option_name`.
 *
 * Template matching prefers `ctx.templateId`; when that key is missing
 * from the rules object, falls back to matching any rule entry whose
 * `_lastSeenEventValue` equals `ctx.eventValue` (case-insensitive). This
 * keeps rules functional after IndexedDB is wiped and templates are
 * re-pulled with fresh ids.
 * @param {object} rules - Full rules object.
 * @param {{templateId?: string, eventValue?: string, mode?: string}} ctx -
 *   Context identifying the template and lifecycle mode.
 * @param {string} fieldName - Raw option name (will be normalized).
 * @returns {{source: string}|null} The matched rule,
 *   or null when no rule matches.
 */
export function resolveFieldRule(rules, ctx, fieldName) {
  if (!rules || typeof rules !== 'object') return null;
  if (!ctx || typeof ctx !== 'object') return null;
  const mode = ctx.mode;
  if (!VALID_MODES.has(mode)) return null;
  const entry = findTemplateEntry(rules, ctx.templateId ?? null, ctx.eventValue ?? null);
  if (!entry) return null;
  const modeRules = entry[mode];
  if (!modeRules || typeof modeRules !== 'object') return null;
  const normalizedKey = normalizeOptionKey(fieldName);
  if (!normalizedKey) return null;
  const rule = modeRules[normalizedKey];
  if (!rule || typeof rule !== 'object') return null;
  const source = typeof rule.source === 'string' ? rule.source : null;
  if (!AUTO_FILL_SOURCES.includes(source)) return null;
  return { source };
}

/**
 * Resolve a field's auto-type from its explicit rule when ctx is present.
 * Without ctx, infer GPS defaults from the field name for initialization and display.
 * @param {string} optionName - Raw option name.
 * @param {{templateId?: string, eventValue?: string, mode?: string}|null} ctx -
 *   Runtime context, or null for the seeding/display path.
 * @param {object} rules - Full rules object.
 * @returns {string|null} The auto-type is `rule:<source>` for an explicit rule, `latitude`/`longitude`/
 *   `accuracy` for name-inferred GPS (seeding path only), or null.
 */
export function classifyAutoType(optionName, ctx, rules) {
  if (ctx && typeof ctx === 'object') {
    const rule = resolveFieldRule(rules, ctx, optionName);
    return rule ? `rule:${rule.source}` : null;
  }
  const name = (optionName || '').toLowerCase();
  if (name.includes('latitude') || name.includes(' lat')) return 'latitude';
  if (name.includes('longitude') || name.includes(' lon')) return 'longitude';
  if (name.includes('accuracy') || name.includes(' acc')) return 'accuracy';
  return null;
}

/**
 * Resolve a source token to a concrete value at submit time. Returns null
 * when the source is unknown or the supporting context is unavailable
 * (for example, GPS sources when `ctx.fix` is missing).
 *
 * GPS sources are formatted to match the collectOptionValues path
 * in app.js: lat/lon are stringified via `Number(v).toFixed(6)`, and
 * accuracy is rounded with `Math.round`.
 * @param {string} source - One of {@link AUTO_FILL_SOURCES}.
 * @param {{nowUtc?: string, fix?: {lat?: number, lon?: number, acc_m?: number}|null}} ctx -
 *   Resolution context with timestamps and an optional GPS fix.
 * @returns {string|number|null} The resolved value, or null when unresolvable.
 */
export function applySourceValue(source, ctx) {
  const context = ctx && typeof ctx === 'object' ? ctx : {};
  switch (source) {
    case 'now_utc': {
      const value = context.nowUtc;
      return typeof value === 'string' && value ? value : null;
    }
    case 'lat': {
      const fix = context.fix;
      if (!fix || !Number.isFinite(fix.lat)) return null;
      return fix.lat.toFixed(6);
    }
    case 'lon': {
      const fix = context.fix;
      if (!fix || !Number.isFinite(fix.lon)) return null;
      return fix.lon.toFixed(6);
    }
    case 'acc': {
      const fix = context.fix;
      if (!fix || !Number.isFinite(fix.acc_m)) return null;
      return Math.round(fix.acc_m);
    }
    default:
      return null;
  }
}

/**
 * Apply auto-fill only when the current field is null/undefined, an empty
 * string, or whitespace-only. Existing values always take precedence.
 * @param {*} currentValue - Current value of the target option field.
 * @returns {boolean} True when the rule should be applied.
 */
export function shouldApplyRule(currentValue) {
  if (currentValue == null) return true;
  if (typeof currentValue === 'string') {
    return currentValue.trim() === '';
  }
  return false;
}

// "Current time" uses the clock when the rule's log or edit action runs.
const AUTO_FILL_SOURCE_LABELS = Object.freeze({
  now_utc: 'current time',
  lat: 'GPS latitude',
  lon: 'GPS longitude',
  acc: 'GPS accuracy'
});

const AUTO_FILL_SOURCE_OPTION_LABELS = Object.freeze({
  now_utc: 'Current time',
  lat: 'Latitude',
  lon: 'Longitude',
  acc: 'Accuracy'
});

const AUTO_FILL_SOURCE_GROUPS = Object.freeze({
  time: ['now_utc'],
  lat: ['lat'],
  lon: ['lon'],
  acc: ['acc'],
  all: ['now_utc', 'lat', 'lon', 'acc']
});

/**
 * Short human label for an auto-fill source token.
 * @param {string} source - Source token (e.g. "now_utc").
 * @returns {string} The label for a supported auto-fill source.
 */
export function describeAutoFillSource(source) {
  return AUTO_FILL_SOURCE_LABELS[source];
}

/**
 * Decide which sources are sensible for a given option field. Time-shaped names
 * (Time In/Out, Start/Bottom UTC) get the timestamp sources; GPS-shaped names
 * get their matching source; unclassifiable fields return null (full set).
 * @param {object|null} option - Option definition (reads _auto, event_option_name).
 * @returns {string|null} A source-group key ("time"/"lat"/"lon"/"acc"), or null.
 */
export function autoFillSourceHintForOption(option) {
  if (!option) return null;
  if (option._auto === 'latitude') return 'lat';
  if (option._auto === 'longitude') return 'lon';
  if (option._auto === 'accuracy') return 'acc';
  const name = (option.event_option_name || '').toLowerCase();
  if (/\btime\b|\butc\b/.test(name)) return 'time';
  return null;
}

/**
 * Build the `<option>` markup for the auto-fill source dropdown, restricted to
 * the hint's group. A supported saved source outside the group is preserved as
 * a flagged option so the operator's selection remains editable.
 * @param {string} selected - Currently-selected source value.
 * @param {string|null} [hint] - Source-group key from {@link autoFillSourceHintForOption}.
 * @returns {string} HTML `<option>` elements.
 */
export function autoFillSourceOptionsHtml(selected, hint = null) {
  const sources = AUTO_FILL_SOURCE_GROUPS[hint] || AUTO_FILL_SOURCE_GROUPS.all;
  const opts = [{ value: '', label: '—' }];
  sources.forEach((value) => {
    opts.push({ value, label: AUTO_FILL_SOURCE_OPTION_LABELS[value] });
  });
  // Preserve out-of-group sources as flagged options so saved selections remain editable.
  if (AUTO_FILL_SOURCES.includes(selected) && !opts.some((opt) => opt.value === selected)) {
    const baseLabel = AUTO_FILL_SOURCE_OPTION_LABELS[selected];
    opts.push({ value: selected, label: `${baseLabel} (unusual for this field)` });
  }
  return opts
    .map((opt) => {
      const isSelected = opt.value === selected;
      return `<option value="${escapeHtml(opt.value)}"${isSelected ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`;
    })
    .join('');
}
