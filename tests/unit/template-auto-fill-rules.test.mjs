import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_FILL_RULES_STORAGE_KEY,
  AUTO_FILL_SOURCES,
  loadAutoFillRules,
  saveAutoFillRules,
  resolveFieldRule,
  applySourceValue,
  shouldApplyRule,
  classifyAutoType,
  describeAutoFillSource,
  autoFillSourceHintForOption,
  autoFillSourceOptionsHtml
} from '../../src/templates/auto-fill-rules.js';

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); }
  };
}

function withStorage(initial, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(initial), configurable: true, writable: true });
  try {
    return fn(globalThis.localStorage);
  } finally {
    if (original === undefined) {
      delete globalThis.localStorage;
    } else {
      Object.defineProperty(globalThis, 'localStorage', original);
    }
  }
}

test('AUTO_FILL_RULES_STORAGE_KEY is the documented key', () => {
  assert.equal(AUTO_FILL_RULES_STORAGE_KEY, 'templateAutoFillRules');
});

test('AUTO_FILL_SOURCES enumerates the supported source tokens', () => {
  assert.deepEqual([...AUTO_FILL_SOURCES], ['now_utc', 'lat', 'lon', 'acc']);
});

test('loadAutoFillRules returns {} when key is missing', () => {
  withStorage({}, () => {
    assert.deepEqual(loadAutoFillRules(), {});
  });
});

test('loadAutoFillRules returns {} when value is malformed JSON', () => {
  withStorage({ [AUTO_FILL_RULES_STORAGE_KEY]: 'invalid-json' }, () => {
    assert.deepEqual(loadAutoFillRules(), {});
  });
});

test('loadAutoFillRules returns {} when stored value is the literal "null"', () => {
  withStorage({ [AUTO_FILL_RULES_STORAGE_KEY]: 'null' }, () => {
    assert.deepEqual(loadAutoFillRules(), {});
  });
});

test('loadAutoFillRules returns {} when stored value is a non-object JSON', () => {
  withStorage({ [AUTO_FILL_RULES_STORAGE_KEY]: '"not-an-object"' }, () => {
    assert.deepEqual(loadAutoFillRules(), {});
  });
  withStorage({ [AUTO_FILL_RULES_STORAGE_KEY]: '42' }, () => {
    assert.deepEqual(loadAutoFillRules(), {});
  });
  withStorage({ [AUTO_FILL_RULES_STORAGE_KEY]: '[1,2,3]' }, () => {
    assert.deepEqual(loadAutoFillRules(), {});
  });
});

test('loadAutoFillRules parses a valid rules object', () => {
  const rules = {
    'tpl-1': {
      _label: 'BRUV',
      _lastSeenEventValue: 'BRUV',
      log: { 'time in': { source: 'now_utc' } }
    }
  };
  withStorage({ [AUTO_FILL_RULES_STORAGE_KEY]: JSON.stringify(rules) }, () => {
    assert.deepEqual(loadAutoFillRules(), rules);
  });
});

test('loadAutoFillRules returns {} when localStorage is undefined', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  delete globalThis.localStorage;
  try {
    assert.deepEqual(loadAutoFillRules(), {});
  } finally {
    if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
  }
});

test('saveAutoFillRules writes JSON to the storage key', () => {
  const rules = {
    'tpl-1': {
      _label: 'BRUV',
      log: { 'time in': { source: 'now_utc' } }
    }
  };
  withStorage({}, (storage) => {
    saveAutoFillRules(rules);
    const written = storage.getItem(AUTO_FILL_RULES_STORAGE_KEY);
    assert.equal(written, JSON.stringify(rules));
    assert.deepEqual(JSON.parse(written), rules);
  });
});

test('saveAutoFillRules is a no-op when localStorage is undefined', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  delete globalThis.localStorage;
  try {
    // should not throw
    saveAutoFillRules({ 'tpl-1': {} });
  } finally {
    if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
  }
});

function fixtureRules() {
  return {
    'tpl-bruv': {
      _label: 'BRUV',
      _lastSeenEventValue: 'BRUV',
      log: {
        'time in': { source: 'now_utc' },
        latitude: { source: 'lat' }
      },
      edit: {
        'time out': { source: 'now_utc' }
      }
    },
    'tpl-other': {
      _label: 'Other',
      _lastSeenEventValue: 'OTHER',
      log: {
        note: { source: 'now_utc' }
      }
    }
  };
}

test('resolveFieldRule returns the matching rule by templateId', () => {
  const rule = resolveFieldRule(
    fixtureRules(),
    { templateId: 'tpl-bruv', eventValue: 'BRUV', mode: 'log' },
    'time in'
  );
  assert.deepEqual(rule, { source: 'now_utc' });
});

test('resolveFieldRule returns null when no template matches', () => {
  const rule = resolveFieldRule(
    fixtureRules(),
    { templateId: 'tpl-missing', eventValue: 'UNKNOWN', mode: 'log' },
    'time in'
  );
  assert.equal(rule, null);
});

test('resolveFieldRule falls back to _lastSeenEventValue when templateId lookup misses', () => {
  const rule = resolveFieldRule(
    fixtureRules(),
    { templateId: 'tpl-renamed-after-resync', eventValue: 'BRUV', mode: 'log' },
    'time in'
  );
  assert.deepEqual(rule, { source: 'now_utc' });
});

test('resolveFieldRule fallback matching is case-insensitive on _lastSeenEventValue', () => {
  const rule = resolveFieldRule(
    fixtureRules(),
    { templateId: null, eventValue: '  bruv  ', mode: 'log' },
    'time in'
  );
  assert.deepEqual(rule, { source: 'now_utc' });
});

test('resolveFieldRule normalizes the field name argument', () => {
  const rules = fixtureRules();
  const variants = ['Time In', 'time in ', 'TIME IN', 'time_in', 'time-in', '  Time   In  '];
  for (const variant of variants) {
    const rule = resolveFieldRule(
      rules,
      { templateId: 'tpl-bruv', eventValue: 'BRUV', mode: 'log' },
      variant
    );
    assert.deepEqual(
      rule,
      { source: 'now_utc' },
      `expected variant ${JSON.stringify(variant)} to resolve to the time-in rule`
    );
  }
});

test('resolveFieldRule returns null when the mode is not log or edit', () => {
  const rules = fixtureRules();
  assert.equal(
    resolveFieldRule(rules, { templateId: 'tpl-bruv', eventValue: 'BRUV', mode: 'view' }, 'time in'),
    null
  );
  assert.equal(
    resolveFieldRule(rules, { templateId: 'tpl-bruv', eventValue: 'BRUV', mode: '' }, 'time in'),
    null
  );
  assert.equal(
    resolveFieldRule(rules, { templateId: 'tpl-bruv', eventValue: 'BRUV' }, 'time in'),
    null
  );
});

test('resolveFieldRule respects mode partitioning (log vs edit)', () => {
  const rules = fixtureRules();
  assert.equal(
    resolveFieldRule(rules, { templateId: 'tpl-bruv', eventValue: 'BRUV', mode: 'log' }, 'time out'),
    null
  );
  assert.deepEqual(
    resolveFieldRule(rules, { templateId: 'tpl-bruv', eventValue: 'BRUV', mode: 'edit' }, 'time out'),
    { source: 'now_utc' }
  );
});

test('resolveFieldRule returns null on missing inputs without throwing', () => {
  assert.equal(resolveFieldRule(null, { templateId: 'x', mode: 'log' }, 'name'), null);
  assert.equal(resolveFieldRule({}, null, 'name'), null);
  assert.equal(resolveFieldRule({ tpl: { log: {} } }, { templateId: 'tpl', mode: 'log' }, ''), null);
  assert.equal(resolveFieldRule({ tpl: { log: {} } }, { templateId: 'tpl', mode: 'log' }, null), null);
});

test('resolveFieldRule ignores entries with missing/invalid source', () => {
  const rules = {
    tpl: {
      _label: 'X',
      log: {
        bad: {},
        unknown: { source: 'unknown' },
        ok: { source: 'now_utc' }
      }
    }
  };
  assert.equal(
    resolveFieldRule(rules, { templateId: 'tpl', mode: 'log' }, 'bad'),
    null
  );
  assert.equal(
    resolveFieldRule(rules, { templateId: 'tpl', mode: 'log' }, 'unknown'),
    null
  );
  assert.deepEqual(
    resolveFieldRule(rules, { templateId: 'tpl', mode: 'log' }, 'ok'),
    { source: 'now_utc' }
  );
});

test('applySourceValue returns the nowUtc for now_utc', () => {
  assert.equal(
    applySourceValue('now_utc', { nowUtc: '2026-05-24T13:30:00.000Z' }),
    '2026-05-24T13:30:00.000Z'
  );
});

test('applySourceValue returns null for now_utc without nowUtc', () => {
  assert.equal(applySourceValue('now_utc', {}), null);
  assert.equal(applySourceValue('now_utc', { nowUtc: '' }), null);
});

test('applySourceValue formats lat to 6 decimal places as a string', () => {
  const value = applySourceValue('lat', { fix: { lat: -45.0001 } });
  assert.equal(value, '-45.000100');
  assert.equal(typeof value, 'string');
});

test('applySourceValue formats lon to 6 decimal places as a string', () => {
  const value = applySourceValue('lon', { fix: { lon: 170.1234567 } });
  assert.equal(value, '170.123457');
});

test('applySourceValue rounds acc with Math.round (returns a number)', () => {
  assert.equal(applySourceValue('acc', { fix: { acc_m: 12.4 } }), 12);
  assert.equal(applySourceValue('acc', { fix: { acc_m: 12.5 } }), 13);
  assert.equal(typeof applySourceValue('acc', { fix: { acc_m: 8 } }), 'number');
});

test('applySourceValue returns null for GPS sources when fix is missing', () => {
  for (const source of ['lat', 'lon', 'acc']) {
    assert.equal(applySourceValue(source, { fix: null }), null, `${source} should be null with fix:null`);
    assert.equal(applySourceValue(source, {}), null, `${source} should be null with no fix`);
    assert.equal(applySourceValue(source, { fix: undefined }), null, `${source} should be null with fix:undefined`);
  }
});

test('applySourceValue returns null for GPS sources when fix lacks the field', () => {
  assert.equal(applySourceValue('lat', { fix: { lon: 170, acc_m: 5 } }), null);
  assert.equal(applySourceValue('lon', { fix: { lat: -45, acc_m: 5 } }), null);
  assert.equal(applySourceValue('acc', { fix: { lat: -45, lon: 170 } }), null);
});

test('applySourceValue returns null for GPS sources when values are not finite', () => {
  assert.equal(applySourceValue('lat', { fix: { lat: Number.NaN } }), null);
  assert.equal(applySourceValue('lon', { fix: { lon: Infinity } }), null);
  assert.equal(applySourceValue('acc', { fix: { acc_m: Number.NaN } }), null);
});

test('applySourceValue returns null for unknown source tokens', () => {
  assert.equal(applySourceValue('mystery', { nowUtc: '2026-05-24T12:00:00.000Z' }), null);
  assert.equal(applySourceValue('', {}), null);
  assert.equal(applySourceValue(undefined, {}), null);
  assert.equal(applySourceValue(null, {}), null);
});

test('applySourceValue tolerates missing context entirely', () => {
  assert.equal(applySourceValue('now_utc'), null);
  assert.equal(applySourceValue('lat'), null);
});

test('shouldApplyRule honors empty/null/undefined/whitespace', () => {
  assert.equal(shouldApplyRule(null), true);
  assert.equal(shouldApplyRule(undefined), true);
  assert.equal(shouldApplyRule(''), true);
  assert.equal(shouldApplyRule('   '), true);
  assert.equal(shouldApplyRule('\t\n'), true);
});

test('shouldApplyRule preserves non-empty values', () => {
  assert.equal(shouldApplyRule('value'), false);
  assert.equal(shouldApplyRule('  value  '), false);
  assert.equal(shouldApplyRule(0), false);
  assert.equal(shouldApplyRule(42), false);
});

test('classifyAutoType requires an explicit rule when runtime context is present', () => {
  // Runtime auto-fill requires an explicit rule in the requested mode.
  assert.deepEqual(classifyAutoType('Latitude', { templateId: 't1', mode: 'log' }, {}), null);
  assert.deepEqual(classifyAutoType('Longitude', { templateId: 't1', mode: 'log' }, {}), null);
  assert.deepEqual(classifyAutoType('Device Accuracy', { templateId: 't1', mode: 'log' }, {}), null);
  assert.deepEqual(classifyAutoType('Latitude', { templateId: 't1', mode: 'edit' }, {}), null);
  // Explicit rule -> classified as a rule.
  const rules = { t1: { log: { latitude: { source: 'lat' } }, edit: {} } };
  assert.deepEqual(
    classifyAutoType('Latitude', { templateId: 't1', mode: 'log' }, rules),
    'rule:lat'
  );
});

test('classifyAutoType infers GPS defaults by name when runtime context is absent', () => {
  assert.deepEqual(classifyAutoType('Latitude', null, {}), 'latitude');
  assert.deepEqual(classifyAutoType('Longitude', null, {}), 'longitude');
  assert.deepEqual(classifyAutoType('Device Accuracy', null, {}), 'accuracy');
  assert.deepEqual(classifyAutoType('Notes', null, {}), null);
});

test('describeAutoFillSource labels the supported sources', () => {
  assert.equal(describeAutoFillSource('now_utc'), 'current time');
  assert.equal(describeAutoFillSource('lat'), 'GPS latitude');
  assert.equal(describeAutoFillSource('lon'), 'GPS longitude');
  assert.equal(describeAutoFillSource('acc'), 'GPS accuracy');
});

test('autoFillSourceHintForOption classifies time/GPS fields', () => {
  assert.equal(autoFillSourceHintForOption(null), null);
  assert.equal(autoFillSourceHintForOption({ _auto: 'latitude' }), 'lat');
  assert.equal(autoFillSourceHintForOption({ _auto: 'longitude' }), 'lon');
  assert.equal(autoFillSourceHintForOption({ _auto: 'accuracy' }), 'acc');
  assert.equal(autoFillSourceHintForOption({ event_option_name: 'Time In' }), 'time');
  assert.equal(autoFillSourceHintForOption({ event_option_name: 'Bottom UTC' }), 'time');
  assert.equal(autoFillSourceHintForOption({ event_option_name: 'Comments' }), null);
});

test('autoFillSourceOptionsHtml builds options for the hinted group with a selection', () => {
  const html = autoFillSourceOptionsHtml('now_utc', 'time');
  assert.match(html, /<option value="now_utc" selected>Current time<\/option>/);
  assert.ok(!html.includes('value="lat"'), 'time group excludes lat');
});

test('autoFillSourceOptionsHtml preserves an off-group saved selection as flagged', () => {
  const html = autoFillSourceOptionsHtml('lat', 'time');
  assert.match(html, /<option value="lat" selected>Latitude \(unusual for this field\)<\/option>/);
});
