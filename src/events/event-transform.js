/**
 * Event normalization, option manipulation, and payload construction for the
 * Sealog event model. Transforms between the local IndexedDB record shape and
 * the Sealog server API shapes (POST/PATCH bodies).
 *
 * Functions that mutate their arguments are marked explicitly.
 * @module
 */

import {
  DEVICE_UTC_OPTION_NAME,
  CLIENT_UUID_OPTION_NAME,
  DEVICE_UTC_KEY,
  DEVICE_ACCURACY_KEY,
  CLIENT_UUID_OPTION_KEY,
  ASNAP_EVENT_VALUE
} from '../config/constants.js';
import { ensureIsoString, nowUtc } from '../utils/time.js';
import { toNumberOrNull } from '../utils/numbers.js';
import { generateLocalId } from '../utils/identifiers.js';

/**
 * Normalize an option name to a lowercase, single-space-separated key
 * for case-insensitive comparison.
 * @param {*} name - Option name. Null/undefined returns "".
 * @returns {string} Lowercased key with underscores, dashes, and runs
 *   of whitespace collapsed to single spaces.
 */
export function normalizeOptionKey(name) {
  if (name == null) return '';
  return String(name)
    .replace(/[_\-\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normalize an array of event option objects. Skips entries without a name.
 * Collapses array values to comma-separated strings. Renames device_utc
 * variants to the canonical DEVICE_UTC_OPTION_NAME.
 * @param {Array<{event_option_name: string, event_option_value: *}>} optionValues - Raw option objects to normalize.
 * @returns {Array<{event_option_name: string, event_option_value: string}>}
 *   New array with normalized copies.
 */
export function normalizeOptionValues(optionValues) {
  if (!Array.isArray(optionValues)) return [];
  const normalized = [];
  optionValues.forEach((opt) => {
    if (!opt || !opt.event_option_name) return;
    let name = String(opt.event_option_name).trim();
    if (normalizeOptionKey(name) === DEVICE_UTC_KEY) {
      name = DEVICE_UTC_OPTION_NAME;
    }
    if (!name) return;
    let value = opt.event_option_value;
    if (Array.isArray(value)) {
      value = value.map((item) => (item == null ? '' : String(item))).join(', ');
    }
    if (value === undefined || value === null) {
      value = '';
    }
    value = String(value);
    normalized.push({ event_option_name: name, event_option_value: value });
  });
  return normalized;
}

/**
 * Coerce a value to a "present" form or null. Returns null for nullish,
 * empty strings, "null", "undefined", "n/a", "na", and non-finite numbers.
 * @param {*} value - Candidate option value.
 * @returns {*|null} The trimmed string, finite number, or original value.
 *   Null when the value is considered absent.
 */
function normalizeOptionPresence(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a' || lowered === 'na') {
      return null;
    }
    return trimmed;
  }
  return value;
}

/**
 * Return a normalized copy of optionValues with a client_uuid option
 * guaranteed present. Uses event.localId as the value.
 * @param {Array} optionValues - Raw option array.
 * @param {object} event - Event with localId.
 * @returns {Array} New normalized array with client_uuid included.
 */
function ensureClientUuidOption(optionValues, event) {
  const normalized = normalizeOptionValues(optionValues);
  const uuid = event?.localId || null;
  if (!uuid) return normalized;
  const uuidValue = String(uuid);
  let found = false;
  normalized.forEach((opt) => {
    if (normalizeOptionKey(opt.event_option_name) === CLIENT_UUID_OPTION_KEY) {
      opt.event_option_name = CLIENT_UUID_OPTION_NAME;
      opt.event_option_value = uuidValue;
      found = true;
    }
  });
  if (!found) {
    normalized.push({ event_option_name: CLIENT_UUID_OPTION_NAME, event_option_value: uuidValue });
  }
  return normalizeOptionValues(normalized);
}

/**
 * Convert a key-value map to a normalized option array. Skips null values
 * and values that are empty after trimming.
 * @param {{[key: string]: string|string[]|null}} map - Option name-value pairs.
 * @returns {Array<{event_option_name: string, event_option_value: string}>} Normalized option entries.
 */
function optionArrayFromMap(map) {
  const entries = [];
  if (!map || typeof map !== 'object') return entries;
  for (const [name, rawValue] of Object.entries(map)) {
    if (!name) continue;
    if (rawValue == null) continue;
    const value = Array.isArray(rawValue)
      ? rawValue.map((item) => (item == null ? '' : String(item))).join(', ')
      : String(rawValue);
    if (!value.trim()) continue;
    entries.push({ event_option_name: name, event_option_value: value });
  }
  return normalizeOptionValues(entries);
}

/**
 * Convert a normalized option array to a de-duplicated map. Later entries
 * with the same normalized key overwrite earlier ones.
 * @param {Array} optionValues - Option array (will be normalized internally).
 * @returns {{[key: string]: string}} Map from option name to value.
 */
export function optionMapFromArray(optionValues) {
  const map = {};
  normalizeOptionValues(optionValues).forEach((opt) => {
    const normalizedName = normalizeOptionKey(opt.event_option_name);
    for (const existingName of Object.keys(map)) {
      if (normalizeOptionKey(existingName) === normalizedName) {
        delete map[existingName];
        break;
      }
    }
    map[opt.event_option_name] = opt.event_option_value;
  });
  return map;
}

/**
 * Build the merged local metadata payload used by persistence and CSV export.
 * Combines event.payload, option_values, timestamps, coordinates, and
 * identifiers. Does not mutate the input event.
 * @param {object} event - Local event record.
 * @returns {object} Payload object with utc, original_utc, notes,
 *   client_uuid, options, lat, lon, acc_m, and optional template/cruise/user IDs.
 */
export function buildEventFreeText(event) {
  const base = structuredClone(event?.payload || {});
  if (typeof base !== 'object' || base === null) {
    return {
      utc: event?.eventTimestampUTC ?? nowUtc(),
      original_utc: event?.originalTimestampUTC ?? event?.eventTimestampUTC ?? nowUtc(),
      notes: event?.notes ?? '',
      client_uuid: event?.localId ?? generateLocalId(),
      options: optionMapFromArray(event?.option_values || [])
    };
  }
  if (typeof base.options !== 'object' || base.options === null) {
    base.options = {};
  }
  base.options = { ...base.options, ...optionMapFromArray(event?.option_values || []) };
  base.utc = event?.eventTimestampUTC ?? ensureIsoString(base.utc, nowUtc());
  base.original_utc = event?.originalTimestampUTC ?? base.original_utc ?? base.utc;
  base.notes = event?.notes ?? base.notes ?? '';
  base.client_uuid = event?.localId ?? generateLocalId();
  const lat = toNumberOrNull(event?.lat ?? base.lat);
  const lon = toNumberOrNull(event?.lon ?? base.lon);
  const acc = toNumberOrNull(event?.acc_m ?? base.acc_m);
  base.lat = lat;
  base.lon = lon;
  base.acc_m = acc;
  if (event?.eventTemplateId && !base.template_id) {
    base.template_id = event.eventTemplateId;
  }
  if (event?.cruiseId && !base.cruise_id) {
    base.cruise_id = event.cruiseId;
  }
  if (event?.userId && !base.user_id) {
    base.user_id = event.userId;
  }
  return base;
}

function normalizeAuxDataValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  const text = String(value).trim();
  return text || null;
}

function defaultAuxDataUnit(name) {
  const normalized = normalizeOptionKey(name);
  if (normalized === 'latitude' || normalized === 'longitude') return 'ddeg';
  if (normalized === 'depth') return 'm';
  if (normalized === 'heading') return 'deg';
  return null;
}

function normalizeAuxDataEntries(rawAuxData) {
  if (!Array.isArray(rawAuxData)) return [];
  const entries = [];
  rawAuxData.forEach((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') return;
    const source = rawEntry.data_source;
    if (!source) return;
    const dataArrayRaw = Array.isArray(rawEntry.data_array) ? rawEntry.data_array : [];
    const dataArray = [];
    dataArrayRaw.forEach((rawData) => {
      if (!rawData || typeof rawData !== 'object') return;
      const dataName = rawData.data_name;
      if (!dataName) return;
      const dataValue = normalizeAuxDataValue(rawData.data_value);
      if (dataValue == null) return;
      const dataUom = normalizeAuxDataValue(rawData.data_uom ?? defaultAuxDataUnit(dataName));
      const entry = {
        data_name: String(dataName),
        data_value: dataValue
      };
      if (dataUom != null) {
        entry.data_uom = dataUom;
      }
      dataArray.push(entry);
    });
    if (!dataArray.length) return;
    entries.push({
      data_source: String(source),
      data_array: dataArray
    });
  });
  return entries;
}

/**
 * Build normalized event aux_data entries from the event object. Priority:
 * 1) event.aux_data
 * 2) event.payload.backfilled_aux_data
 * @param {object} event - Local event record.
 * @returns {Array<object>} Normalized aux entries ready for /event_aux_data POSTs.
 */
export function buildEventAuxDataPayload(event) {
  const fromEvent = normalizeAuxDataEntries(event?.aux_data);
  if (fromEvent.length) return fromEvent;
  const fromPayload = normalizeAuxDataEntries(event?.payload?.backfilled_aux_data);
  if (fromPayload.length) return fromPayload;
  return [];
}

/**
 * Build the POST body for the Sealog /api/v1/events endpoint.
 *
 * Mutates event.option_values to inject the client_uuid option.
 * @param {object} event - Local event record with type, notes,
 *   eventTimestampUTC, and option_values.
 * @returns {{event_value: string, event_free_text: string, ts: string,
 *   event_options: Array}} Server POST payload.
 */
export function buildPostBody(event) {
  const timestamp = ensureIsoString(event.eventTimestampUTC || nowUtc());
  const freeText = typeof event.notes === 'string' ? event.notes : event.notes == null ? '' : String(event.notes);
  const optionsWithUuid = ensureClientUuidOption(event.option_values, event);
  event.option_values = optionsWithUuid;
  return {
    event_value: event.type,
    event_free_text: freeText,
    ts: timestamp,
    event_options: optionsWithUuid
  };
}

/**
 * Build the PATCH body for updating an existing server event.
 * Same shape as buildPostBody but event_value is only included when
 * event.type is truthy.
 *
 * Mutates event.option_values to inject the client_uuid option.
 * @param {object} event - Local event record.
 * @returns {object} Server PATCH payload.
 */
export function buildPatchBody(event) {
  const timestamp = ensureIsoString(event.eventTimestampUTC || nowUtc());
  const freeText = typeof event.notes === 'string' ? event.notes : event.notes == null ? '' : String(event.notes);
  const optionsWithUuid = ensureClientUuidOption(event.option_values, event);
  event.option_values = optionsWithUuid;
  const body = {
    event_free_text: freeText,
    ts: timestamp,
    event_options: optionsWithUuid
  };
  if (event.type) body.event_value = event.type;
  return body;
}

/**
 * Synchronize fields between an event's top-level properties and its
 * nested payload object. Ensures options, notes, coordinates, timestamps,
 * and identifiers are consistent in both locations.
 *
 * Mutates event and event.payload in place.
 * @param {object} event - Event record to synchronize.
 * @returns {void}
 */
export function syncEventPayload(event) {
  const payload = event && typeof event.payload === 'object' && event.payload !== null ? { ...event.payload } : {};
  const normalizedOptionsArray = normalizeOptionValues(event.option_values);
  const normalizedOptionsMap = optionMapFromArray(normalizedOptionsArray);
  if (JSON.stringify(event.option_values || []) !== JSON.stringify(normalizedOptionsArray)) {
    event.option_values = normalizedOptionsArray;
  }
  const payloadOptionsArray = optionArrayFromMap(payload.options && typeof payload.options === 'object' ? payload.options : {});
  if (JSON.stringify(payloadOptionsArray) !== JSON.stringify(normalizedOptionsArray)) {
    payload.options = { ...normalizedOptionsMap };
  }

  const notes = typeof event.notes === 'string' ? event.notes : payload.notes ?? '';
  if ((payload.notes ?? '') !== notes) {
    payload.notes = notes;
  }
  if ((event.notes ?? '') !== notes) {
    event.notes = notes;
  }

  if (payload.client_uuid !== event.localId) {
    payload.client_uuid = event.localId;
  }
  if (event.eventTemplateId && payload.template_id !== event.eventTemplateId) {
    payload.template_id = event.eventTemplateId;
  }
  if (event.cruiseId && payload.cruise_id !== event.cruiseId) {
    payload.cruise_id = event.cruiseId;
  }
  if (event.userId && payload.user_id !== event.userId) {
    payload.user_id = event.userId;
  }

  const lat = toNumberOrNull(payload.lat ?? event.lat);
  if (lat !== null) {
    if (payload.lat !== lat) {
      payload.lat = lat;
    }
    if (event.lat !== lat) {
      event.lat = lat;
    }
  } else {
    if (payload.lat != null) {
      payload.lat = null;
    }
    if (event.lat != null) {
      event.lat = null;
    }
  }

  const lon = toNumberOrNull(payload.lon ?? event.lon);
  if (lon !== null) {
    if (payload.lon !== lon) {
      payload.lon = lon;
    }
    if (event.lon !== lon) {
      event.lon = lon;
    }
  } else {
    if (payload.lon != null) {
      payload.lon = null;
    }
    if (event.lon != null) {
      event.lon = null;
    }
  }

  const acc = toNumberOrNull(payload.acc_m ?? event.acc_m);
  if (acc !== null) {
    if (payload.acc_m !== acc) {
      payload.acc_m = acc;
    }
    if (event.acc_m !== acc) {
      event.acc_m = acc;
    }
  } else {
    if (payload.acc_m != null) {
      payload.acc_m = null;
    }
    if (event.acc_m != null) {
      event.acc_m = null;
    }
  }

  const timestamp = ensureIsoString(event.eventTimestampUTC || payload.utc || nowUtc());
  if (payload.utc !== timestamp) {
    payload.utc = timestamp;
  }
  if (event.eventTimestampUTC !== timestamp) {
    event.eventTimestampUTC = timestamp;
  }

  const optionEntries = optionArrayFromMap(payload.options);
  if (JSON.stringify(event.option_values || []) !== JSON.stringify(optionEntries)) {
    event.option_values = optionEntries;
  }

  event.payload = payload;
}

/**
 * Convert an option name to a title-cased display label. Special cases
 * device_utc and device_accuracy to readable forms.
 * @param {string} name - Raw option name.
 * @returns {string} Human-readable label.
 */
export function formatOptionLabel(name) {
  if (!name) return '';
  const normalized = normalizeOptionKey(name);
  if (normalized === DEVICE_UTC_KEY) return 'Device UTC';
  if (normalized === DEVICE_ACCURACY_KEY) return 'Device Accuracy (m)';
  const spaced = String(name)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced.replace(/\b([a-z])/gi, (match) => match.toUpperCase());
}

/**
 * Find the first option value matching a name (case-insensitive).
 * @param {Array} optionValues - Option array.
 * @param {string} name - Option name to search for.
 * @returns {*|undefined} The normalized-presence value, or undefined
 *   if no match is found.
 */
export function findOptionValue(optionValues, name) {
  const normalizedName = normalizeOptionKey(name);
  const list = normalizeOptionValues(optionValues);
  for (const opt of list) {
    if (normalizeOptionKey(opt.event_option_name) === normalizedName) {
      return normalizeOptionPresence(opt.event_option_value);
    }
  }
  return undefined;
}

/**
 * Find the first option value whose name matches a regex pattern.
 * @param {Array} optionValues - Option array.
 * @param {RegExp} regex - Pattern to test against event_option_name.
 * @returns {*|null} The normalized-presence value, or null if no match.
 */
export function findOptionValueByRegex(optionValues, regex) {
  if (!Array.isArray(optionValues)) return null;
  for (const opt of optionValues) {
    if (!opt || !opt.event_option_name) continue;
    if (!regex.test(opt.event_option_name)) continue;
    const normalized = normalizeOptionPresence(opt.event_option_value);
    if (normalized != null) return normalized;
  }
  return null;
}

/**
 * Return the first option suitable for UI display in event cards. Skips
 * device_utc, device_accuracy, client_uuid, latitude, and longitude options.
 * @param {Array} optionValues - Option array.
 * @returns {{label: string, value: string}|null} Display-friendly label
 *   and value, or null if no displayable option exists.
 */
export function firstDisplayOption(optionValues) {
  if (!Array.isArray(optionValues)) return null;
  for (const opt of optionValues) {
    if (!opt || !opt.event_option_name) continue;
    const key = normalizeOptionKey(opt.event_option_name);
    if (!key) continue;
    if (key === DEVICE_UTC_KEY || key === DEVICE_ACCURACY_KEY || key === CLIENT_UUID_OPTION_KEY) continue;
    if (/latitude|longitude/.test(key)) continue;
    const valueRaw = Array.isArray(opt.event_option_value)
      ? opt.event_option_value.join(', ')
      : opt.event_option_value;
    const value = typeof valueRaw === 'string' ? valueRaw.trim() : valueRaw;
    if (value == null || value === '') continue;
    return {
      label: formatOptionLabel(opt.event_option_name),
      value: String(value)
    };
  }
  return null;
}

/**
 * True when an event is an ASNAP capture (by flag or by event value).
 * @param {object|null} event - Event record.
 * @returns {boolean} True when the event is an ASNAP capture.
 */
export function isAsnapEvent(event) {
  if (!event) return false;
  if (event.isAsnap === true) return true;
  const type = (event.type || '').toUpperCase();
  return type === ASNAP_EVENT_VALUE;
}

/**
 * Read the server-assigned event identifier from a Sealog API record.
 * @param {object|null} serverEvent - Server event payload.
 * @returns {string|null} The id, or null when absent.
 */
export function extractServerEventId(serverEvent) {
  return serverEvent?.id || null;
}

/**
 * Build a copy of an option map keyed by normalized option keys.
 * @param {object|null} optionMap - Map of raw option name to value.
 * @returns {object} Map keyed by {@link normalizeOptionKey}.
 */
export function buildNormalizedOptionMap(optionMap) {
  const normalized = {};
  if (!optionMap) return normalized;
  Object.entries(optionMap).forEach(([key, value]) => {
    normalized[normalizeOptionKey(key)] = value;
  });
  return normalized;
}

/**
 * Find the original option-map key whose normalized form matches `normalizedKey`.
 * @param {object|null} optionMap - Map of raw option name to value.
 * @param {string} normalizedKey - Normalized key to match against.
 * @returns {string|null} The matching raw key, or null when none match.
 */
export function findOptionNameByNormalizedKey(optionMap, normalizedKey) {
  if (!optionMap) return null;
  for (const key of Object.keys(optionMap)) {
    if (normalizeOptionKey(key) === normalizedKey) {
      return key;
    }
  }
  return null;
}

/**
 * Build the POST body for Sealog's /event_aux_data endpoint.
 * @param {string|number} eventId - Server event id.
 * @param {{data_source: string, data_array: Array}} entry - Aux-data entry.
 * @returns {object} Aux-data upload payload.
 */
export function buildEventAuxUploadPayload(eventId, entry) {
  return {
    event_id: String(eventId),
    data_source: entry.data_source,
    data_array: entry.data_array
  };
}
