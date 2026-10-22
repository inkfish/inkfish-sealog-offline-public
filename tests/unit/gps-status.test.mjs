import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGpsLoggingFix, fixFromPosition, resolveGpsStatusDisplay, mapGeoError,
  GPS_LOG_LIMIT, gpsLogFixEntry, gpsLogErrorEntry, appendGpsLogEntry, parseGpsLog, formatGpsLogEntry
} from '../../src/runtime/gps-status.js';
import { STALE_FIX_MAX_MS } from '../../src/config/constants.js';

const GEO_ERR = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
const geoError = (code, message) => ({ ...GEO_ERR, code, message });

const NOW = Date.parse('2026-09-12T12:00:00Z');
const GPS_FIX = { lat: 12.1, lon: -68.9, acc_m: 8 };
const gpsDecision = (overrides = {}) => evaluateGpsLoggingFix({
  fix: GPS_FIX,
  timestampMs: NOW - 1_000,
  nowMs: NOW,
  ...overrides
});

test('GPS logging accepts accurate fixes including the 50m and geographic boundaries', () => {
  for (const fix of [GPS_FIX, { lat: -90, lon: -180, acc_m: 0 }, { lat: 90, lon: 180, acc_m: 50 }]) {
    for (const allowPoorAccuracy of [false, true]) {
      assert.deepEqual(gpsDecision({ fix, allowPoorAccuracy }), {
        allowed: true, reason: null, warning: null
      });
    }
  }
});

test('GPS logging requires the override above 50m and warns with the measured accuracy', () => {
  const fix = { ...GPS_FIX, acc_m: 50.1 };
  assert.deepEqual(gpsDecision({ fix }), {
    allowed: false, reason: 'accuracy', warning: null
  });
  assert.deepEqual(gpsDecision({ fix, allowPoorAccuracy: true }), {
    allowed: true,
    reason: null,
    warning: 'GPS accuracy is ±50.1m; this position may be unreliable.'
  });
});

test('GPS logging rejects missing, nonfinite, and out-of-range coordinates even with the override', () => {
  const invalidFixes = [null, undefined, {},
    ...[NaN, Infinity, -Infinity, '12.1', null, undefined, -90.01, 90.01]
      .map((lat) => ({ ...GPS_FIX, lat })),
    ...[NaN, Infinity, -Infinity, '-68.9', null, undefined, -180.01, 180.01]
      .map((lon) => ({ ...GPS_FIX, lon }))];
  for (const fix of invalidFixes) {
    assert.deepEqual(gpsDecision({ fix, allowPoorAccuracy: true }), {
      allowed: false, reason: 'missing', warning: null
    });
  }
});

test('GPS logging rejects missing and invalid accuracy regardless of the override', () => {
  for (const acc_m of [undefined, null, NaN, Infinity, -Infinity, -1, '8']) {
    for (const allowPoorAccuracy of [false, true]) {
      assert.deepEqual(gpsDecision({ fix: { ...GPS_FIX, acc_m }, allowPoorAccuracy }), {
        allowed: false, reason: 'unknown-accuracy', warning: null
      });
    }
  }
});

test('GPS logging accepts a fix at the five-minute limit and rejects older fixes with the override', () => {
  assert.deepEqual(gpsDecision({ timestampMs: NOW - STALE_FIX_MAX_MS }), {
    allowed: true, reason: null, warning: null
  });
  assert.deepEqual(gpsDecision({
    fix: { ...GPS_FIX, acc_m: 100 },
    timestampMs: NOW - STALE_FIX_MAX_MS - 1,
    allowPoorAccuracy: true
  }), { allowed: false, reason: 'stale', warning: null });
});

test('GPS logging rejects absent, invalid, and future measurement timestamps with the override', () => {
  for (const timestampMs of [undefined, null, NaN, Infinity, -Infinity, 0, -1, String(NOW), NOW + 1]) {
    assert.deepEqual(gpsDecision({ timestampMs, allowPoorAccuracy: true }), {
      allowed: false, reason: 'stale', warning: null
    });
  }
  assert.deepEqual(gpsDecision({ nowMs: NaN, allowPoorAccuracy: true }), {
    allowed: false, reason: 'stale', warning: null
  });
});

test('GPS logging uses the current time when no explicit clock is supplied', (t) => {
  t.mock.method(Date, 'now', () => NOW);
  assert.deepEqual(evaluateGpsLoggingFix({ fix: GPS_FIX, timestampMs: NOW }), {
    allowed: true, reason: null, warning: null
  });
});

test('a device fix keeps its measurement time but is never measured after it arrived', (t) => {
  const position = (timestamp) => ({ coords: { latitude: 12.1, longitude: -68.9, accuracy: 8 }, timestamp });
  assert.deepEqual(fixFromPosition(position(NOW - 1_000), NOW), { ...GPS_FIX, timestampMs: NOW - 1_000 });
  assert.deepEqual(fixFromPosition(position(NOW + 30_000), NOW), { ...GPS_FIX, timestampMs: NOW });
  assert.deepEqual(gpsDecision({ timestampMs: fixFromPosition(position(NOW + 30_000), NOW).timestampMs }), {
    allowed: true, reason: null, warning: null
  });
  for (const timestamp of [undefined, null, NaN]) {
    assert.equal(gpsDecision({ timestampMs: fixFromPosition(position(timestamp), NOW).timestampMs }).reason, 'stale');
  }
  t.mock.method(Date, 'now', () => NOW);
  assert.equal(fixFromPosition(position(NOW + 30_000)).timestampMs, NOW);
});

const devicePosition = (overrides = {}) => ({
  coords: { latitude: 12.1, longitude: -68.9, accuracy: 5, ...overrides.coords },
  timestamp: NOW - 400,
  ...overrides.position
});
const USABLE = { allowed: true, reason: null, warning: null };

test('the GPS log records the device fix time against the phone clock and the logging decision', () => {
  const entry = gpsLogFixEntry({ position: devicePosition(), receivedAtMs: NOW, trigger: 'ASNAP', decision: USABLE });
  assert.deepEqual(entry, { at: NOW, trigger: 'ASNAP', fixTime: NOW - 400, acc: 5, result: 'usable' });
  assert.equal(formatGpsLogEntry(entry), '2026-09-12 12:00:00Z ASNAP: ±5m, fix 0.4 s old, usable');

  const ahead = gpsLogFixEntry({
    position: devicePosition({ position: { timestamp: NOW + 30_000 } }), receivedAtMs: NOW, trigger: 'capture', decision: USABLE
  });
  assert.equal(formatGpsLogEntry(ahead), '2026-09-12 12:00:00Z capture: ±5m, fix time 30.0 s ahead of phone clock, usable');

  const old = gpsLogFixEntry({
    position: devicePosition({ position: { timestamp: NOW - 600_000 } }), receivedAtMs: NOW, trigger: 'warm-up',
    decision: { allowed: false, reason: 'stale', warning: null }
  });
  assert.equal(formatGpsLogEntry(old), '2026-09-12 12:00:00Z warm-up: ±5m, fix 10m 0s old, rejected: stale fix');
});

test('the GPS log labels accuracy outcomes and missing fix data', () => {
  const poor = gpsLogFixEntry({
    position: devicePosition({ coords: { accuracy: 80.4 } }), receivedAtMs: NOW, trigger: 'capture',
    decision: { allowed: false, reason: 'accuracy', warning: null }
  });
  assert.equal(formatGpsLogEntry(poor), '2026-09-12 12:00:00Z capture: ±80m, fix 0.4 s old, rejected: accuracy over limit');
  const allowed = gpsLogFixEntry({
    position: devicePosition({ coords: { accuracy: 80 } }), receivedAtMs: NOW, trigger: 'capture',
    decision: { allowed: true, reason: null, warning: 'GPS accuracy is ±80m; this position may be unreliable.' }
  });
  assert.match(formatGpsLogEntry(allowed), /usable \(poor accuracy allowed\)$/);
  const unknown = gpsLogFixEntry({
    position: devicePosition({ coords: { accuracy: null }, position: { timestamp: undefined } }), receivedAtMs: NOW,
    trigger: 'edit', decision: { allowed: false, reason: 'stale', warning: null }
  });
  assert.equal(formatGpsLogEntry(unknown), '2026-09-12 12:00:00Z edit: accuracy unknown, fix time missing, rejected: stale fix');
});

test('the GPS log records acquisition errors and any saved fix used instead', () => {
  const timeout = geoError(GEO_ERR.TIMEOUT);
  const plain = gpsLogErrorEntry({ error: timeout, receivedAtMs: NOW, trigger: 'warm-up' });
  assert.deepEqual(plain, { at: NOW, trigger: 'warm-up', error: 'Timed out waiting for GPS' });
  assert.equal(formatGpsLogEntry(plain), '2026-09-12 12:00:00Z warm-up: error: Timed out waiting for GPS');

  const fallback = gpsLogErrorEntry({
    error: timeout, receivedAtMs: NOW, trigger: 'capture', savedFixAgeMs: 422_000,
    decision: { allowed: false, reason: 'stale', warning: null }
  });
  assert.equal(formatGpsLogEntry(fallback),
    '2026-09-12 12:00:00Z capture: error: Timed out waiting for GPS; used saved fix from 7m 2s ago, rejected: stale fix');
});

test('the GPS log keeps the newest entries and survives damaged storage', () => {
  const entries = Array.from({ length: GPS_LOG_LIMIT }, (_, i) => ({ at: NOW + i, trigger: 'warm-up', error: 'x' }));
  const next = appendGpsLogEntry(entries, { at: NOW + GPS_LOG_LIMIT, trigger: 'ASNAP', error: 'y' });
  assert.equal(next.length, GPS_LOG_LIMIT);
  assert.equal(next[0].at, NOW + 1);
  assert.equal(next.at(-1).at, NOW + GPS_LOG_LIMIT);
  assert.equal(entries.length, GPS_LOG_LIMIT);
  assert.deepEqual(appendGpsLogEntry([], next[0], 1), [next[0]]);

  assert.deepEqual(parseGpsLog(JSON.stringify(next)), next);
  for (const raw of [null, '', 'not json', '{}', '"text"']) {
    assert.deepEqual(parseGpsLog(raw), []);
  }
  assert.deepEqual(parseGpsLog(JSON.stringify([null, 'x', { at: 'soon' }, next[0]])), [next[0]]);
  assert.equal(formatGpsLogEntry({ at: NaN, trigger: 'ASNAP', error: 'x' }), 'time unknown ASNAP: error: x');
});

test('resolveGpsStatusDisplay overlays GPS tile when ASNAP backfill is enabled', () => {
  const result = resolveGpsStatusDisplay({
    state: 'ok',
    message: 'GPS fix ready',
    asnapBackfillEnabled: true
  });
  assert.deepEqual(result, {
    state: 'warn',
    message: 'GPS backfill on (phone GPS ignored)'
  });
});

test('resolveGpsStatusDisplay keeps original state when ASNAP backfill is disabled', () => {
  const result = resolveGpsStatusDisplay({
    state: 'ok',
    message: 'GPS fix ready',
    asnapBackfillEnabled: false
  });
  assert.deepEqual(result, {
    state: 'ok',
    message: 'GPS fix ready'
  });
});

test('mapGeoError returns a generic message for null', () => {
  assert.equal(mapGeoError(null), 'Unknown GPS error');
});

test('mapGeoError maps the standard geolocation error codes', () => {
  assert.equal(mapGeoError(geoError(GEO_ERR.PERMISSION_DENIED)), 'Location permission denied');
  assert.equal(mapGeoError(geoError(GEO_ERR.POSITION_UNAVAILABLE)), 'Unable to determine location');
  assert.equal(mapGeoError(geoError(GEO_ERR.TIMEOUT)), 'Timed out waiting for GPS');
});

test('mapGeoError falls back to the error message then a generic label', () => {
  assert.equal(mapGeoError(geoError(99, 'weird failure')), 'weird failure');
  assert.equal(mapGeoError(geoError(99, '')), 'Unknown GPS error');
});
