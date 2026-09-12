import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGpsLoggingFix, resolveGpsStatusDisplay, mapGeoError } from '../../src/runtime/gps-status.js';
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
