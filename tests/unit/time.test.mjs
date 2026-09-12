import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureIsoString,
  normalizeUtcInput,
  nowUtc,
  toIsoOrNull,
  formatMinutes,
  formatDuration,
  formatUtc,
  describeRelativeTime
} from '../../src/utils/time.js';

test('ensureIsoString normalises non-ISO timestamps', () => {
  const iso = ensureIsoString('2025-01-01T00:00:00');
  assert.match(iso, /Z$/);
});

test('ensureIsoString returns fallback when value invalid', () => {
  const fallback = '2025-03-01T10:20:30Z';
  const iso = ensureIsoString('invalid', fallback);
  assert.equal(iso, fallback);
});

test('normalizeUtcInput enforces trailing Z', () => {
  assert.throws(() => normalizeUtcInput('2025-01-01T00:00:00'), /must end with Z/);
});

test('normalizeUtcInput validates timestamp format', () => {
  assert.throws(() => normalizeUtcInput('2025-13-01T00:00:00Z'), /Invalid timestamp/);
});

test('normalizeUtcInput rejects non-string and blank values', () => {
  assert.throws(() => normalizeUtcInput(null), /UTC timestamp required/);
  assert.throws(() => normalizeUtcInput('   '), /UTC timestamp required/);
});

test('normalizeUtcInput trims surrounding whitespace for valid timestamps', () => {
  assert.equal(
    normalizeUtcInput(' 2025-01-01T00:00:00Z '),
    '2025-01-01T00:00:00.000Z'
  );
});

test('nowUtc returns ISO timestamp with Z suffix', () => {
  const value = nowUtc();
  assert.match(value, /Z$/);
});

test('ensureIsoString rejects garbage strings ending in Z', () => {
  const result = ensureIsoString('not-a-dateZ');
  assert.match(result, /^\d{4}-\d{2}-\d{2}T/, 'should fall through to nowUtc for garbage input');
  assert.notEqual(result, 'not-a-dateZ');
});

test('ensureIsoString passes through valid ISO strings ending in Z', () => {
  const valid = '2025-06-15T08:30:00.000Z';
  assert.equal(ensureIsoString(valid), valid);
});

test('ensureIsoString rejects bare Z string', () => {
  const result = ensureIsoString('Z');
  assert.notEqual(result, 'Z');
});

test('ensureIsoString falls through invalid fallback values to current time', () => {
  const result = ensureIsoString('invalid', 'still-invalid');
  assert.match(result, /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(result, 'still-invalid');
});

test('toIsoOrNull returns null for invalid inputs', () => {
  assert.equal(toIsoOrNull('not-a-date'), null);
});

test('toIsoOrNull returns ISO string for valid input', () => {
  const result = toIsoOrNull('2025-04-05T12:30:45Z');
  assert.equal(result, '2025-04-05T12:30:45.000Z');
});

test('formatMinutes coerces invalid input to "0 min"', () => {
  assert.equal(formatMinutes(0), '0 min');
  assert.equal(formatMinutes(-1), '0 min');
  assert.equal(formatMinutes(NaN), '0 min');
});

test('formatMinutes rounds to whole minutes and pluralizes', () => {
  assert.equal(formatMinutes(1), '1 min'); // rounds to 0 -> shown as 1 min
  assert.equal(formatMinutes(60000), '1 min');
  assert.equal(formatMinutes(90000), '2 mins'); // 1.5 rounds up to 2
  assert.equal(formatMinutes(300000), '5 mins');
});

test('formatDuration coerces invalid input to "0s"', () => {
  assert.equal(formatDuration(-1), '0s');
  assert.equal(formatDuration(NaN), '0s');
});

test('formatDuration formats seconds, minutes, and hours', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45000), '45s');
  assert.equal(formatDuration(185000), '3m 5s');
  assert.equal(formatDuration(7800000), '2h 10m');
});

test('formatUtc renders a 24-hour UTC string', () => {
  const out = formatUtc('2025-06-15T08:30:00Z');
  assert.equal(typeof out, 'string');
  assert.match(out, /2025/);
  assert.doesNotMatch(out, /[AP]M/i);
});

test('describeRelativeTime returns "" for falsy or unparseable input', () => {
  assert.equal(describeRelativeTime(''), '');
  assert.equal(describeRelativeTime('not-a-date', Date.now()), '');
});

test('describeRelativeTime describes past and future relative to injected now', () => {
  const base = new Date('2025-01-01T00:00:00Z').getTime();
  assert.equal(describeRelativeTime('2025-01-01T00:00:00Z', base), 'just now');
  assert.equal(describeRelativeTime('2025-01-01T00:00:00Z', base + 5000), '5s ago');
  assert.equal(describeRelativeTime('2025-01-01T00:00:00Z', base - 10000), 'in 10s');
});
