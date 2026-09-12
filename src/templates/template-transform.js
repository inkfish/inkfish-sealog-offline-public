/**
 * Pure transforms over Sealog template definitions: category derivation,
 * template normalization/keying, and coordinate-option detection.
 * @module
 */

import { DEVICE_ACCURACY_KEY } from '../config/constants.js';
import { normalizeOptionKey } from '../events/event-transform.js';
import { toNumberOrNull } from '../utils/numbers.js';

/**
 * Collect the sorted set of category names across templates, appending
 * "uncategorized" when any template has no categories.
 * @param {Array<object>} templates - Template definitions.
 * @returns {Array<string>} Sorted category names.
 */
export function uniqueCategories(templates) {
  const set = new Set();
  let hasUncategorized = false;
  templates.forEach((tpl) => {
    if (Array.isArray(tpl.template_categories) && tpl.template_categories.length) {
      tpl.template_categories.forEach((cat) => set.add(cat));
    } else {
      hasUncategorized = true;
    }
  });
  const list = Array.from(set).sort((a, b) => a.localeCompare(b));
  if (hasUncategorized) list.push('uncategorized');
  return list;
}

/**
 * Filter templates to those in a category. "all" (or falsy) returns all templates;
 * templates with no categories are treated as "uncategorized".
 * @param {Array<object>} templates - Template definitions.
 * @param {string} category - Category to match, or "all".
 * @returns {Array<object>} Matching templates.
 */
export function filterTemplatesByCategory(templates, category) {
  if (!category || category === 'all') return templates;
  return templates.filter((tpl) => {
    const catList = Array.isArray(tpl.template_categories) && tpl.template_categories.length
      ? tpl.template_categories
      : ['uncategorized'];
    return catList.includes(category);
  });
}

/**
 * Build a display label for a category key.
 * @param {string} category - Category key, "all", or "uncategorized".
 * @returns {string} Title-cased label.
 */
export function formatCategoryLabel(category) {
  if (!category || category === 'all') return 'All';
  if (category === 'uncategorized') return 'Uncategorized';
  return category
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Return a shallow copy of a template with its required id and array-typed
 * `template_categories`/`event_options` guaranteed present.
 * @param {object} tpl - Template definition.
 * @returns {object|null} Normalized template copy, or null when its id is missing.
 */
export function normalizeTemplate(tpl) {
  if (!tpl || typeof tpl.id !== 'string' || !tpl.id.trim()) return null;
  const copy = { ...tpl };
  if (!Array.isArray(copy.template_categories)) {
    copy.template_categories = [];
  }
  if (!Array.isArray(copy.event_options)) {
    copy.event_options = [];
  }
  return copy;
}

/**
 * True when the option values include a non-device latitude/longitude option.
 * @param {Array<object>} optionValues - Event option values.
 * @param {'lat'|'lon'} axis - Coordinate axis to look for.
 * @returns {boolean} True when a matching non-device coordinate option exists.
 */
export function hasCustomCoordinateOption(optionValues, axis) {
  if (!Array.isArray(optionValues)) return false;
  const normalizedTarget = axis === 'lon' ? 'longitude' : 'latitude';
  return optionValues.some((opt) => {
    if (!opt || !opt.event_option_name) return false;
    const key = normalizeOptionKey(opt.event_option_name);
    if (!key) return false;
    return key.includes(normalizedTarget);
  });
}

/**
 * True when the option values include the device-accuracy option.
 * @param {Array<object>} optionValues - Event option values.
 * @returns {boolean} True when a device-accuracy option is present.
 */
export function hasDeviceAccuracyOption(optionValues) {
  if (!Array.isArray(optionValues)) return false;
  return optionValues.some((opt) => normalizeOptionKey(opt.event_option_name) === DEVICE_ACCURACY_KEY);
}

/**
 * Read a numeric coordinate for an axis from an option map, skipping device
 * options and non-numeric values.
 * @param {object|null} optionMap - Map of option name to value.
 * @param {'lat'|'lon'} axis - Coordinate axis to read.
 * @returns {number|null} The coordinate, or null when not found.
 */
export function coordinateFromOptionMap(optionMap, axis) {
  if (!optionMap) return null;
  const normalizedTarget = axis === 'lon' ? 'longitude' : 'latitude';
  for (const [name, value] of Object.entries(optionMap)) {
    const key = normalizeOptionKey(name);
    if (!key) continue;
    if (!key.includes(normalizedTarget)) continue;
    const numeric = toNumberOrNull(value);
    if (numeric != null) return numeric;
  }
  return null;
}
