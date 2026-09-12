/**
 * ASNAP coordinate backfill via linear time interpolation. Sets or replaces
 * coordinates on eligible local events using surrounding ASNAP
 * (Automatic Ship Navigation Acquisition Point) server events.
 * @module
 */

import { toNumberOrNull } from '../utils/numbers.js';
import { toIsoOrNull, nowUtc, ensureIsoString } from '../utils/time.js';
import {
  normalizeOptionKey,
  normalizeOptionValues,
  buildEventAuxDataPayload,
  syncEventPayload
} from '../events/event-transform.js';

/**
 * Check whether an option name represents latitude.
 * @param {string} name - Option name to evaluate.
 * @returns {boolean} True when the option name matches latitude semantics.
 */
function isLatitudeOption(name) {
  const normalized = normalizeOptionKey(name);
  return normalized === 'lat' || normalized.includes('latitude');
}

/**
 * Check whether an option name represents longitude.
 * @param {string} name - Option name to evaluate.
 * @returns {boolean} True when the option name matches longitude semantics.
 */
function isLongitudeOption(name) {
  const normalized = normalizeOptionKey(name);
  return normalized === 'lon' || normalized.includes('longitude');
}

/**
 * Check whether an option name represents device accuracy.
 * @param {string} name - Option name to evaluate.
 * @returns {boolean} True when the option name matches accuracy semantics.
 */
function isAccuracyOption(name) {
  const normalized = normalizeOptionKey(name);
  return (
    normalized.includes('accuracy') ||
    normalized === 'acc' ||
    normalized === 'acc m'
  );
}

/**
 * Check whether an option name represents depth.
 * @param {string} name - Option name to evaluate.
 * @returns {boolean} True when the option name matches depth semantics.
 */
export function isDepthOptionName(name) {
  const normalized = normalizeOptionKey(name);
  return /(?:^|\b)depth(?:\b|$)/.test(normalized);
}

/**
 * Extract the first numeric option value matching a selector function.
 * @param {Array} optionValues - Normalized option array.
 * @param {Function} selector - Predicate testing the option name.
 * @returns {number|null} First matching numeric option value, or null.
 */
function extractCoordinateFromOptions(optionValues, selector) {
  if (!Array.isArray(optionValues)) return null;
  for (const option of optionValues) {
    if (!option || !option.event_option_name) continue;
    if (!selector(option.event_option_name)) continue;
    const numeric = toNumberOrNull(option.event_option_value);
    if (numeric != null) return numeric;
  }
  return null;
}

function extractAuxDataNumber(auxItem, matcher) {
  if (!auxItem || !Array.isArray(auxItem.data_array)) return null;
  for (const entry of auxItem.data_array) {
    if (!entry || !matcher(entry.data_name)) continue;
    const numeric = toFiniteAuxNumber(entry.data_value);
    if (numeric != null) return numeric;
  }
  return null;
}

function normalizeDataSourceToken(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isDataSourceMatch(value, expectedSource) {
  const expected = normalizeDataSourceToken(expectedSource);
  if (!expected) return false;
  return normalizeDataSourceToken(value) === expected;
}

function isVehiclePositionSource(value) {
  return isDataSourceMatch(value, 'vehiclePosition');
}

function isVesselPositionSource(value) {
  return isDataSourceMatch(value, 'vesselPosition');
}

function toFiniteAuxNumber(value) {
  const direct = toNumberOrNull(value);
  if (direct != null) return direct;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHeadingOption(name) {
  const normalized = normalizeOptionKey(name);
  return normalized.includes('heading');
}

function getVehiclePositionAuxPoint(serverEvent) {
  const auxData = Array.isArray(serverEvent?.aux_data) ? serverEvent.aux_data : [];
  const vehicle = auxData.find((item) => isVehiclePositionSource(item?.data_source));
  if (!vehicle) return null;
  const lat = extractAuxDataNumber(vehicle, isLatitudeOption);
  const lon = extractAuxDataNumber(vehicle, isLongitudeOption);
  if (lat == null || lon == null) return null;
  const depthM = extractAuxDataNumber(vehicle, isDepthOptionName);
  const accM = extractAuxDataNumber(vehicle, isAccuracyOption);
  return { lat, lon, depthM, accM };
}

function getVesselPositionAuxPoint(serverEvent) {
  const auxData = Array.isArray(serverEvent?.aux_data) ? serverEvent.aux_data : [];
  const vessel = auxData.find((item) => isVesselPositionSource(item?.data_source));
  if (!vessel) return null;
  const lat = extractAuxDataNumber(vessel, isLatitudeOption);
  const lon = extractAuxDataNumber(vessel, isLongitudeOption);
  if (lat == null || lon == null) return null;
  const headingDeg = extractAuxDataNumber(vessel, isHeadingOption);
  return { lat, lon, headingDeg };
}

/**
 * Uppercase and trim a backfill allowlist token. Null returns "".
 * @param {*} value - Allowlist token candidate.
 * @returns {string} Uppercased allowlist token.
 */
function normalizeBackfillToken(value) {
  if (value == null) return '';
  return String(value).trim().toUpperCase();
}

/**
 * Parse a comma-or-newline-separated backfill allowlist into a Set of
 * uppercased tokens.
 * @param {string} rawText - Raw allowlist text from the settings textarea.
 * @returns {Set<string>} Uppercased tokens. Non-string input returns empty Set.
 */
export function parseBackfillAllowlist(rawText) {
  if (typeof rawText !== 'string') return new Set();
  const tokens = rawText
    .split(/[\n,]+/g)
    .map((entry) => normalizeBackfillToken(entry))
    .filter(Boolean);
  return new Set(tokens);
}

/**
 * Check if an event's type or template ID is in the backfill allowlist.
 * Compares event.type and eventTemplateId (both uppercased) against the
 * allowlist set. An empty allowlist matches every event — this mirrors
 * the on-screen help text ("Leave empty to
 * backfill all").
 * @param {object} event - Local event record.
 * @param {Set<string>} allowlist - Uppercased tokens from parseBackfillAllowlist.
 * @returns {boolean} True when the event matches at least one allowlist token,
 *   or when the allowlist is empty (universal backfill).
 */
export function eventMatchesBackfillAllowlist(event, allowlist) {
  if (!event || !allowlist) return false;
  if (allowlist.size === 0) return true;
  const candidates = [
    event.type,
    event.eventTemplateId,
  ]
    .map((value) => normalizeBackfillToken(value))
    .filter(Boolean);
  return candidates.some((candidate) => allowlist.has(candidate));
}

/**
 * Validate that an event currently carries required backfilled ASNAP aux data.
 * Uses normalized aux payloads from event.aux_data and payload.backfilled_aux_data.
 * @param {object} event - Local event record.
 * @returns {boolean} True when the required aux-data sources are present.
 */
export function hasRequiredBackfilledPositionAux(event) {
  const auxEntries = buildEventAuxDataPayload(event);
  if (!auxEntries.length) return false;
  let hasVehicle = false;
  let hasVessel = false;
  auxEntries.forEach((entry) => {
    const source = normalizeDataSourceToken(entry?.data_source);
    if (source === 'vehicleposition') hasVehicle = true;
    if (source === 'vesselposition') hasVessel = true;
  });
  return hasVehicle && hasVessel;
}

/**
 * Extract a coordinate point from a server ASNAP event's auxiliary data.
 * @param {object} serverEvent - Server API event with id, ts, event_options,
 *   and aux_data.
 * @returns {{timestampIso: string, timestampMs: number, lat: number,
 *   lon: number, accM: number|null, depthM: number|null, vesselLat: number|null,
 *   vesselLon: number|null, vesselHeadingDeg: number|null, serverId: string|null}|null}
 *   Extracted point, or null if timestamp or coordinates are missing.
 */
export function extractAsnapPoint(serverEvent) {
  if (!serverEvent || typeof serverEvent !== 'object') return null;
  const timestampIso = toIsoOrNull(serverEvent.ts);
  if (!timestampIso) return null;
  const timestampMs = new Date(timestampIso).getTime();
  if (!Number.isFinite(timestampMs)) return null;

  const vehiclePoint = getVehiclePositionAuxPoint(serverEvent);
  if (!vehiclePoint) return null;

  const options = normalizeOptionValues(
    Array.isArray(serverEvent.event_options) ? serverEvent.event_options : []
  );
  const { lat, lon, depthM } = vehiclePoint;
  const vesselPoint = getVesselPositionAuxPoint(serverEvent);

  const accM = vehiclePoint.accM ?? extractCoordinateFromOptions(options, isAccuracyOption);

  return {
    timestampIso,
    timestampMs,
    lat,
    lon,
    accM,
    depthM,
    vesselLat: toNumberOrNull(vesselPoint?.lat),
    vesselLon: toNumberOrNull(vesselPoint?.lon),
    vesselHeadingDeg: toNumberOrNull(vesselPoint?.headingDeg),
    serverId: serverEvent.id || null,
  };
}

/**
 * Build a timestamp lookup map keyed by event id.
 * @param {Array} events - Sealog event records.
 * @returns {Map<string, string>} Map of event id -> ISO timestamp.
 */
export function buildEventTimestampIndex(events) {
  const index = new Map();
  if (!Array.isArray(events)) return index;
  events.forEach((event) => {
    const id = event?.id;
    if (!id) return;
    const timestampIso = toIsoOrNull(event.ts);
    if (!timestampIso) return;
    index.set(String(id), timestampIso);
  });
  return index;
}

/**
 * Build sorted ASNAP interpolation points from /events/bylowering payload.
 * @param {Array} events - Raw event records.
 * @returns {Array<object>} Sorted ASNAP points with vehicle coordinates.
 */
export function buildAsnapPointsFromByLoweringEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => normalizeBackfillToken(event?.event_value) === 'ASNAP')
    .map((event) => extractAsnapPoint(event))
    .filter(Boolean)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Build sorted ASNAP points from /event_aux_data/bylowering payload.
 * @param {Array} auxEntries - Aux payload records.
 * @param {object} [options] - Optional timestamp indexes and source selection.
 * @param {Map<string, string>} [options.eventTimestampById] - Event id timestamp
 *   lookup built from the event payload; aux rows carry no timestamp themselves.
 * @param {string} [options.dataSource] - Data source token
 *   to extract (for example vehiclePosition or vesselPosition).
 * @returns {Array<object>} Sorted ASNAP points extracted from aux-data rows.
 */
export function buildAsnapPointsFromAuxData(
  auxEntries,
  { eventTimestampById, dataSource = 'vehiclePosition' } = {}
) {
  if (!Array.isArray(auxEntries)) return [];
  const timestampIndex = eventTimestampById instanceof Map ? eventTimestampById : new Map();
  const normalizedSource = normalizeDataSourceToken(dataSource);
  if (!normalizedSource) return [];

  const points = [];
  auxEntries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (!isDataSourceMatch(entry.data_source, normalizedSource)) return;

    const eventId = entry.event_id;
    if (!eventId) return;
    const timestampIso = timestampIndex.get(String(eventId));
    if (!timestampIso) return;
    const timestampMs = new Date(timestampIso).getTime();
    if (!Number.isFinite(timestampMs)) return;

    const lat = extractAuxDataNumber(entry, isLatitudeOption);
    const lon = extractAuxDataNumber(entry, isLongitudeOption);
    if (lat == null || lon == null) return;
    const depthM = extractAuxDataNumber(entry, isDepthOptionName);
    const accM = extractAuxDataNumber(entry, isAccuracyOption);
    const headingDeg = extractAuxDataNumber(entry, isHeadingOption);

    points.push({
      timestampIso,
      timestampMs,
      lat,
      lon,
      accM,
      depthM,
      headingDeg,
      serverId: eventId,
    });
  });

  return points.sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Pick the current or most recently completed lowering.
 * @param {Array} lowerings - Raw lowerings payload.
 * @param {object} [options] - Optional timestamp selection input.
 * @param {string} [options.nowIso] - Timestamp used to determine "current".
 * @returns {{sealogId: string, loweringId: string|null, startIso: string|null,
 *   stopIso: string|null}|null}
 *   Active or fallback lowering record, or null when none can be resolved.
 */
export function selectCurrentLowering(
  lowerings,
  { nowIso } = {}
) {
  if (!Array.isArray(lowerings) || !lowerings.length) return null;
  const nowMs = new Date(ensureIsoString(nowIso || nowUtc(), nowUtc())).getTime();
  if (!Number.isFinite(nowMs)) return null;

  const normalized = lowerings
    .map((lowering) => {
      if (!lowering || typeof lowering !== 'object') return null;
      const sealogId = lowering.id || null;
      if (!sealogId) return null;

      const startIso = toIsoOrNull(lowering.start_ts);
      const stopIso = toIsoOrNull(lowering.stop_ts);
      if (!startIso || (lowering.stop_ts && !stopIso)) return null;
      const startMs = startIso ? new Date(startIso).getTime() : null;
      const stopMs = stopIso ? new Date(stopIso).getTime() : null;
      if (startMs != null && !Number.isFinite(startMs)) return null;
      if (stopMs != null && !Number.isFinite(stopMs)) return null;

      return {
        sealogId: String(sealogId),
        loweringId: lowering.lowering_id || null,
        startIso: startIso || null,
        stopIso: stopIso || null,
        startMs: startMs == null ? null : startMs,
        stopMs: stopMs == null ? null : stopMs,
      };
    })
    .filter(Boolean);

  if (!normalized.length) return null;

  const active = normalized
    .filter((item) => {
      if (item.startMs == null) return false;
      if (item.stopMs == null) return item.startMs <= nowMs;
      return item.startMs <= nowMs && nowMs <= item.stopMs;
    })
    .sort((a, b) => (b.startMs ?? -Infinity) - (a.startMs ?? -Infinity))[0];

  const completed = normalized
    .filter((item) => item.stopMs != null && item.stopMs <= nowMs)
    .sort((a, b) => (b.stopMs ?? -Infinity) - (a.stopMs ?? -Infinity))[0];

  const earliest = normalized
    .slice()
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity))[0];
  const selected = active || completed || earliest;
  if (!selected) return null;
  return {
    sealogId: selected.sealogId,
    loweringId: selected.loweringId,
    startIso: selected.startIso,
    stopIso: selected.stopIso
  };
}

/**
 * Resolve interpolated coordinates from a prebuilt ASNAP point set.
 * @param {object} options - Target timestamp and point set to interpolate from.
 * @param {string} options.targetIso - ISO timestamp of the event needing coordinates.
 * @param {Array<object>} options.points - Prebuilt, optionally unsorted points.
 * @returns {{lat: number, lon: number, accM: number|null, depthM: number|null, headingDeg: number|null}|null}
 *   Interpolated coordinates, or null when interpolation fails.
 */
export function resolveInterpolatedAsnapPositionFromPoints({ targetIso, points } = {}) {
  const targetMs = new Date(targetIso || '').getTime();
  if (!Number.isFinite(targetMs)) return null;
  const pair = selectSurroundingAsnapPair(points, targetMs);
  return pair ? interpolateCoordinates(pair.before, pair.after, targetMs) : null;
}

/**
 * Find the closest ASNAP points on each side of a target timestamp.
 * A point exactly at targetMs qualifies for both before and after.
 * @param {Array} points - Array of extracted ASNAP points (any order).
 * @param {number} targetMs - Target timestamp in ms since epoch.
 * @returns {{before: object, after: object} | null} The surrounding pair,
 *   or the nearest edge pair when the target falls outside the series.
 */
export function selectSurroundingAsnapPair(points, targetMs) {
  if (!Array.isArray(points) || !Number.isFinite(targetMs)) return null;
  let before = null;
  let after = null;
  const sortedPoints = points
    .filter((point) => point && Number.isFinite(point.timestampMs))
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs);
  points.forEach((point) => {
    if (!point || !Number.isFinite(point.timestampMs)) return;
    if (point.timestampMs <= targetMs) {
      if (!before || point.timestampMs > before.timestampMs) {
        before = point;
      }
    }
    if (point.timestampMs >= targetMs) {
      if (!after || point.timestampMs < after.timestampMs) {
        after = point;
      }
    }
  });
  if (!before || !after) {
    if (sortedPoints.length < 2) return null;
    if (!before) {
      return { before: sortedPoints[0], after: sortedPoints[1] };
    }
    if (!after) {
      return {
        before: sortedPoints[sortedPoints.length - 2],
        after: sortedPoints[sortedPoints.length - 1]
      };
    }
  }
  return { before, after };
}

/**
 * Linearly interpolate coordinates between two points at a target time.
 *
 * When before.timestampMs === after.timestampMs, returns the before point's
 * coordinates (no division by zero). The interpolation ratio is clamped
 * to [0, 1].
 * @param {object} before - Point with lat, lon, accM, timestampMs.
 * @param {object} after - Point with the same shape.
 * @param {number} targetMs - Target timestamp in ms since epoch.
 * @returns {{lat: number, lon: number, accM: number|null, depthM: number|null, headingDeg: number|null}|null}
 *   Interpolated coordinates, or null if inputs have invalid numbers.
 */
export function interpolateCoordinates(before, after, targetMs) {
  if (!before || !after || !Number.isFinite(targetMs)) return null;
  if (!Number.isFinite(before.lat) || !Number.isFinite(before.lon)) return null;
  if (!Number.isFinite(after.lat) || !Number.isFinite(after.lon)) return null;

  const start = before.timestampMs;
  const stop = after.timestampMs;
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return null;

  const interpolateFiniteValue = (beforeValue, afterValue, ratio) => {
    if (Number.isFinite(beforeValue) && Number.isFinite(afterValue)) {
      return beforeValue + (afterValue - beforeValue) * ratio;
    }
    if (Number.isFinite(beforeValue)) return beforeValue;
    if (Number.isFinite(afterValue)) return afterValue;
    return null;
  };

  if (start === stop) {
    return {
      lat: before.lat,
      lon: before.lon,
      accM: interpolateFiniteValue(before.accM, after.accM, 0),
      depthM: interpolateFiniteValue(before.depthM, after.depthM, 0),
      headingDeg: interpolateFiniteValue(before.headingDeg, after.headingDeg, 0)
    };
  }

  const rawRatio = (targetMs - start) / (stop - start);
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const lat = before.lat + (after.lat - before.lat) * ratio;
  const lon = before.lon + (after.lon - before.lon) * ratio;
  const accM = interpolateFiniteValue(before.accM, after.accM, ratio);
  const depthM = interpolateFiniteValue(before.depthM, after.depthM, ratio);
  const headingDeg = interpolateFiniteValue(before.headingDeg, after.headingDeg, ratio);
  return { lat, lon, accM, depthM, headingDeg };
}

/**
 * Apply interpolated ASNAP coordinates to a local event. Sets lat, lon,
 * acc_m on the event and its payload, adds backfill metadata to the payload,
 * and builds vehicle/vessel auxiliary telemetry entries.
 *
 * Mutates event in place. Calls syncEventPayload after applying changes.
 * @param {object} event - Local event record to mutate.
 * @param {object} backfill - Result from resolveInterpolatedAsnapPositionFromPoints.
 * @param {object} [options] - Optional metadata overrides for the backfill operation.
 * @param {string} [options.backfilledAtUtc] - Override for the backfill
 *   timestamp; defaults to nowUtc().
 * @returns {boolean} True if coordinates were applied. False if the event
 *   or backfill is absent, or vehicle/vessel latitude or longitude is invalid.
 */
export function applyBackfilledCoordinatesToEvent(
  event,
  backfill,
  { backfilledAtUtc } = {}
) {
  if (!event || !backfill) return false;
  const lat = toNumberOrNull(backfill.lat);
  const lon = toNumberOrNull(backfill.lon);
  if (lat == null || lon == null) return false;
  const accRaw = toNumberOrNull(backfill.accM);
  const acc = accRaw == null ? null : Math.round(accRaw);
  const depthRaw = toNumberOrNull(backfill.depthM);
  const depthM = depthRaw == null ? null : depthRaw;
  const vesselLat = toNumberOrNull(backfill.vesselLat);
  const vesselLon = toNumberOrNull(backfill.vesselLon);
  const vesselHeadingDeg = toNumberOrNull(backfill.vesselHeadingDeg);
  if (vesselLat == null || vesselLon == null) return false;

  event.lat = lat;
  event.lon = lon;
  event.acc_m = acc;

  const payload = event && typeof event.payload === 'object' && event.payload !== null
    ? { ...event.payload }
    : {};
  payload.lat = lat;
  payload.lon = lon;
  payload.acc_m = acc;
  payload.backfilled_from_asnap = true;
  payload.backfilled_vessel_from_asnap = true;
  payload.backfilled_at_utc = ensureIsoString(backfilledAtUtc || nowUtc(), nowUtc());
  payload.backfilled_method = 'linear-time';
  payload.backfilled_source = 'server-asnap-vehicle';
  const backfilledAuxData = [
    {
      data_source: 'vehiclePosition',
      data_array: [
        {
          data_name: 'latitude',
          data_value: String(Number(lat.toFixed(6))),
          data_uom: 'ddeg'
        },
        {
          data_name: 'longitude',
          data_value: String(Number(lon.toFixed(6))),
          data_uom: 'ddeg'
        },
        ...(depthM == null
          ? []
          : [{
            data_name: 'depth',
            data_value: String(Number(depthM.toFixed(2))),
            data_uom: 'm'
          }])
      ]
    },
    {
      data_source: 'vesselPosition',
      data_array: [
        {
          data_name: 'latitude',
          data_value: String(Number(vesselLat.toFixed(6))),
          data_uom: 'ddeg'
        },
        {
          data_name: 'longitude',
          data_value: String(Number(vesselLon.toFixed(6))),
          data_uom: 'ddeg'
        },
        ...(vesselHeadingDeg == null
          ? []
          : [{
            data_name: 'heading',
            data_value: String(Number(vesselHeadingDeg.toFixed(1))),
            data_uom: 'deg'
          }])
      ]
    }
  ];
  payload.backfilled_aux_data = backfilledAuxData;
  payload.backfilled_aux_uploaded = false;
  event.aux_data = backfilledAuxData;
  event.payload = payload;

  syncEventPayload(event);
  return true;
}

/**
 * Project raw ASNAP server points (vesselLat/vesselLon shape) into the
 * interpolation point shape, dropping points without finite coordinates and
 * sorting ascending by timestamp.
 * @param {Array<object>} points - Raw points with vesselLat/vesselLon/vesselHeadingDeg.
 * @returns {Array<object>} Normalized, time-sorted interpolation points.
 */
export function buildVesselPointsFromEventPoints(points) {
  return (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(point?.vesselLat) && Number.isFinite(point?.vesselLon))
    .map((point) => ({
      timestampIso: point.timestampIso,
      timestampMs: point.timestampMs,
      lat: point.vesselLat,
      lon: point.vesselLon,
      headingDeg: point.vesselHeadingDeg ?? null,
      serverId: point.serverId || null
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Merge two sets of ASNAP interpolation points, de-duplicating by
 * serverId/timestamp/lat/lon and returning them sorted ascending by timestamp.
 * @param {Array<object>} primaryPoints - First point set.
 * @param {Array<object>} secondaryPoints - Second point set.
 * @returns {Array<object>} Merged, de-duplicated, time-sorted points.
 */
export function mergeAsnapPointSets(primaryPoints, secondaryPoints) {
  const seen = new Set();
  const merged = [];
  const pushUnique = (point) => {
    if (!point || !Number.isFinite(point.timestampMs)) return;
    const latKey = Number.isFinite(point.lat) ? point.lat.toFixed(7) : 'nan';
    const lonKey = Number.isFinite(point.lon) ? point.lon.toFixed(7) : 'nan';
    const key = `${point.serverId || ''}|${point.timestampMs}|${latKey}|${lonKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(point);
  };
  (Array.isArray(primaryPoints) ? primaryPoints : []).forEach(pushUnique);
  (Array.isArray(secondaryPoints) ? secondaryPoints : []).forEach(pushUnique);
  return merged.sort((a, b) => a.timestampMs - b.timestampMs);
}
