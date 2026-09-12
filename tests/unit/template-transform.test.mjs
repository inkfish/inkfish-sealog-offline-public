import test from 'node:test';
import assert from 'node:assert/strict';
import {
  uniqueCategories,
  filterTemplatesByCategory,
  formatCategoryLabel,
  normalizeTemplate,
  hasCustomCoordinateOption,
  hasDeviceAccuracyOption,
  coordinateFromOptionMap
} from '../../src/templates/template-transform.js';

const T = (extra) => ({ event_name: 'x', ...extra });

test('uniqueCategories sorts categories and appends uncategorized when needed', () => {
  assert.deepEqual(uniqueCategories([T({ template_categories: ['beta', 'alpha'] }), T({})]), ['alpha', 'beta', 'uncategorized']);
  assert.deepEqual(uniqueCategories([T({ template_categories: ['alpha'] })]), ['alpha']);
  assert.deepEqual(uniqueCategories([]), []);
});

test('filterTemplatesByCategory returns all for "all"/falsy and treats empty as uncategorized', () => {
  const list = [T({ id: 'a', template_categories: ['x'] }), T({ id: 'b' })];
  assert.equal(filterTemplatesByCategory(list, 'all'), list);
  assert.equal(filterTemplatesByCategory(list, ''), list);
  assert.deepEqual(filterTemplatesByCategory(list, 'x').map((t) => t.id), ['a']);
  assert.deepEqual(filterTemplatesByCategory(list, 'uncategorized').map((t) => t.id), ['b']);
});

test('formatCategoryLabel title-cases keys and handles all/uncategorized', () => {
  assert.equal(formatCategoryLabel('all'), 'All');
  assert.equal(formatCategoryLabel(''), 'All');
  assert.equal(formatCategoryLabel('uncategorized'), 'Uncategorized');
  assert.equal(formatCategoryLabel('ctd_casts'), 'Ctd Casts');
  assert.equal(formatCategoryLabel('water sampling'), 'Water Sampling');
});

test('normalizeTemplate preserves id and fills array fields without mutating input', () => {
  const input = { id: 'ctd-template', event_value: 'CTD' };
  const out = normalizeTemplate(input);
  assert.equal(out.id, 'ctd-template');
  assert.deepEqual(out.template_categories, []);
  assert.deepEqual(out.event_options, []);
  assert.equal(input.event_options, undefined, 'input not mutated');
  // Existing arrays are preserved.
  const out2 = normalizeTemplate({ id: 'k', template_categories: ['a'], event_options: [{}] });
  assert.deepEqual(out2.template_categories, ['a']);
  assert.equal(out2.event_options.length, 1);
});

test('normalizeTemplate ignores entries without a current template id', () => {
  for (const invalid of [null, {}, { id: '' }, { id: '   ' }]) {
    assert.equal(normalizeTemplate(invalid), null);
  }
});

test('hasCustomCoordinateOption detects lat/lon options', () => {
  assert.equal(hasCustomCoordinateOption([{ event_option_name: 'Latitude' }], 'lat'), true);
  assert.equal(hasCustomCoordinateOption([{ event_option_name: 'Longitude' }], 'lon'), true);
  assert.equal(hasCustomCoordinateOption([{ event_option_name: 'Notes' }], 'lat'), false);
  assert.equal(hasCustomCoordinateOption(null, 'lat'), false);
  // Coordinate detection matches any option name containing "latitude".
  assert.equal(hasCustomCoordinateOption([{ event_option_name: 'Device Latitude' }], 'lat'), true);
});

test('hasDeviceAccuracyOption detects the device-accuracy option', () => {
  assert.equal(hasDeviceAccuracyOption([{ event_option_name: 'Device Accuracy' }]), true);
  assert.equal(hasDeviceAccuracyOption([{ event_option_name: 'device_accuracy' }]), true);
  assert.equal(hasDeviceAccuracyOption([{ event_option_name: 'Latitude' }]), false);
  assert.equal(hasDeviceAccuracyOption('nope'), false);
});

test('coordinateFromOptionMap reads numeric coordinates from the option map', () => {
  assert.equal(coordinateFromOptionMap({ Latitude: '-34.5' }, 'lat'), -34.5);
  assert.equal(coordinateFromOptionMap({ Longitude: '18.42' }, 'lon'), 18.42);
  assert.equal(coordinateFromOptionMap({ Latitude: 'not-a-number' }, 'lat'), null);
  assert.equal(coordinateFromOptionMap(null, 'lat'), null);
  // Device coordinates use the same name matching as other coordinate options.
  assert.equal(coordinateFromOptionMap({ 'Device Latitude': '1.0' }, 'lat'), 1);
});
