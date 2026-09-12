import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOptionValues,
  buildPostBody,
  buildPatchBody,
  firstDisplayOption,
  findOptionValue,
  findOptionValueByRegex,
  optionMapFromArray,
  buildEventFreeText,
  buildEventAuxDataPayload,
  syncEventPayload,
  normalizeOptionKey,
  isAsnapEvent,
  extractServerEventId,
  buildNormalizedOptionMap,
  findOptionNameByNormalizedKey,
  buildEventAuxUploadPayload
} from '../../src/events/event-transform.js';
import { DEVICE_UTC_OPTION_NAME, ASNAP_EVENT_VALUE } from '../../src/config/constants.js';

test('normalizeOptionValues trims names and coerces values', () => {
  const result = normalizeOptionValues([
    { event_option_name: '  Latitude  ', event_option_value: '  -34.5 ' },
    { event_option_name: DEVICE_UTC_OPTION_NAME.toUpperCase(), event_option_value: 'value' }
  ]);
  assert.equal(result[0].event_option_name, 'Latitude');
  assert.equal(result[0].event_option_value.trim(), '-34.5');
  assert.equal(result[1].event_option_name, DEVICE_UTC_OPTION_NAME);
});

test('buildPostBody returns normalized payload', () => {
  const event = {
    type: 'CTD_START',
    notes: 'test',
    eventTimestampUTC: '2025-01-01T00:00:00.000Z',
    option_values: []
  };
  const body = buildPostBody({ ...event });
  assert.equal(body.event_value, 'CTD_START');
  assert.equal(body.event_free_text, 'test');
  assert.equal(body.ts, '2025-01-01T00:00:00.000Z');
});

test('buildPostBody excludes aux_data even when ASNAP backfill aux data exists', () => {
  const event = {
    localId: 'evt-aux-1',
    type: 'OBSERVATION',
    notes: 'test',
    eventTimestampUTC: '2025-01-01T00:00:00.000Z',
    option_values: [
      { event_option_name: 'Type', event_option_value: 'Special Interest' }
    ],
    payload: {
      backfilled_aux_data: [
        {
          data_source: 'vehiclePosition',
          data_array: [
            { data_name: 'latitude', data_value: '12.356789', data_uom: 'ddeg' },
            { data_name: 'longitude', data_value: '-69.162698', data_uom: 'ddeg' },
            { data_name: 'depth', data_value: '380.58', data_uom: 'm' }
          ]
        },
        {
          data_source: 'vesselPosition',
          data_array: [
            { data_name: 'heading', data_value: '77.5', data_uom: 'deg' },
            { data_name: 'latitude', data_value: '12.354683', data_uom: 'ddeg' },
            { data_name: 'longitude', data_value: '-69.163599', data_uom: 'ddeg' }
          ]
        }
      ]
    }
  };

  const body = buildPostBody({ ...event });
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'aux_data'), false);
});

test('buildPatchBody keeps event_value when present', () => {
  const event = {
    type: 'NOTE',
    notes: 'patched',
    eventTimestampUTC: '2025-02-02T12:00:00.000Z',
    option_values: []
  };
  const body = buildPatchBody({ ...event });
  assert.equal(body.event_value, 'NOTE');
  assert.equal(body.event_free_text, 'patched');
});

test('buildPatchBody excludes aux_data even when event has backfilled aux entries', () => {
  const event = {
    type: 'NOTE',
    notes: 'patched',
    eventTimestampUTC: '2025-02-02T12:00:00.000Z',
    option_values: [],
    aux_data: [
      {
        data_source: 'vehiclePosition',
        data_array: [
          { data_name: 'latitude', data_value: '12.1', data_uom: 'ddeg' },
          { data_name: 'longitude', data_value: '-69.1', data_uom: 'ddeg' }
        ]
      }
    ]
  };

  const body = buildPatchBody({ ...event });
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'aux_data'), false);
});

test('firstDisplayOption skips metadata options', () => {
  const option = firstDisplayOption([
    { event_option_name: 'device_accuracy', event_option_value: '5' },
    { event_option_name: 'Station', event_option_value: 'A12' }
  ]);
  assert.deepEqual(option, { label: 'Station', value: 'A12' });
});

test('findOptionValue returns normalized values and undefined for misses', () => {
  const optionValues = [
    { event_option_name: ' Station ', event_option_value: ' A12 ' },
    { event_option_name: 'Depth', event_option_value: ' 250 ' }
  ];

  assert.equal(findOptionValue(optionValues, 'station'), 'A12');
  assert.equal(findOptionValue(optionValues, 'missing'), undefined);
});

test('findOptionValueByRegex skips invalid entries and returns first normalized match', () => {
  const optionValues = [
    null,
    { event_option_name: '', event_option_value: 'ignore' },
    { event_option_name: 'Depth', event_option_value: ' 250 ' },
    { event_option_name: 'Depth secondary', event_option_value: ' 260 ' }
  ];

  assert.equal(findOptionValueByRegex(optionValues, /^Depth/), '250');
  assert.equal(findOptionValueByRegex(optionValues, /^Temperature/), null);
  assert.equal(findOptionValueByRegex(null, /^Depth/), null);
});

test('firstDisplayOption returns null when only metadata or empty values exist', () => {
  const option = firstDisplayOption([
    { event_option_name: 'device_utc', event_option_value: '2025-01-01T00:00:00.000Z' },
    { event_option_name: 'Latitude', event_option_value: '-45.0' },
    { event_option_name: 'Station', event_option_value: '   ' }
  ]);
  assert.equal(option, null);
});

test('optionMapFromArray preserves normalized option labels and values', () => {
  const reconstructed = optionMapFromArray([
    { event_option_name: ' Latitude ', event_option_value: '-45.0' },
    { event_option_name: 'Longitude', event_option_value: '170.0' }
  ]);
  assert.deepEqual(reconstructed, { Latitude: '-45.0', Longitude: '170.0' });
});

test('buildEventFreeText merges payload and event fields', () => {
  const event = {
    localId: 'abc',
    eventTimestampUTC: '2025-03-04T00:00:00.000Z',
    payload: { notes: 'hello', options: { Depth: '100' } },
    option_values: [{ event_option_name: 'Temperature', event_option_value: '5' }]
  };
  const payload = buildEventFreeText(event);
  assert.equal(payload.notes, 'hello');
  assert.equal(payload.options.Temperature, '5');
  assert.equal(payload.client_uuid, 'abc');
});

test('syncEventPayload clears invalid accuracy and syncs option map back to option_values', () => {
  const event = {
    localId: 'evt-1',
    payload: {
      acc_m: 'bad'
    },
    option_values: [
      { event_option_name: 'Depth', event_option_value: '' }
    ],
    eventTimestampUTC: '2025-03-04T00:00:00.000Z',
    acc_m: 'still-bad'
  };

  syncEventPayload(event);
  assert.equal(event.acc_m, null);
  assert.equal(event.payload.acc_m, null);
  assert.deepEqual(event.option_values, []);
});

test('syncEventPayload propagates finite accuracy values to event and payload', () => {
  const event = {
    localId: 'evt-2',
    payload: {
      options: {},
      acc_m: '12.4'
    },
    option_values: [],
    eventTimestampUTC: '2025-03-04T00:00:00.000Z',
    acc_m: null
  };

  syncEventPayload(event);
  assert.equal(event.acc_m, 12.4);
  assert.equal(event.payload.acc_m, 12.4);
});

test('buildEventFreeText rebuilds payload when stored payload is not an object', () => {
  const payload = buildEventFreeText({
    payload: 'not-an-object',
    eventTimestampUTC: '2025-03-04T00:00:00.000Z',
    originalTimestampUTC: '2025-03-04T00:00:05.000Z',
    notes: 'fallback',
    localId: 'evt-payload',
    option_values: [{ event_option_name: 'Depth', event_option_value: '100' }]
  });

  assert.deepEqual(payload, {
    utc: '2025-03-04T00:00:00.000Z',
    original_utc: '2025-03-04T00:00:05.000Z',
    notes: 'fallback',
    client_uuid: 'evt-payload',
    options: { Depth: '100' }
  });
});

test('buildEventFreeText populates options and identifier fields onto payload objects', () => {
  const payload = buildEventFreeText({
    localId: 'evt-1',
    eventTimestampUTC: '2025-03-04T00:00:00.000Z',
    notes: 'merged',
    eventTemplateId: 'template-1',
    cruiseId: 'cruise-1',
    userId: 'user-1',
    payload: null,
    option_values: [{ event_option_name: 'Type', event_option_value: 'BRUV' }]
  });

  assert.equal(payload.client_uuid, 'evt-1');
  assert.equal(payload.options.Type, 'BRUV');
  assert.equal(payload.template_id, 'template-1');
  assert.equal(payload.cruise_id, 'cruise-1');
  assert.equal(payload.user_id, 'user-1');
});

test('buildEventAuxDataPayload falls back to payload aux data and infers units', () => {
  const auxData = buildEventAuxDataPayload({
    payload: {
      backfilled_aux_data: [
        {
          data_source: 'vehiclePosition',
          data_array: [
            { data_name: 'latitude', data_value: 12.345678 },
            { data_name: 'longitude', data_value: '-69.123456' },
            { data_name: 'depth', data_value: '228.5m' },
            { data_name: 'heading', data_value: '98.4' },
            { data_name: 'ignored', data_value: '   ' }
          ]
        }
      ]
    }
  });

  assert.deepEqual(auxData, [
    {
      data_source: 'vehiclePosition',
      data_array: [
        { data_name: 'latitude', data_value: '12.345678', data_uom: 'ddeg' },
        { data_name: 'longitude', data_value: '-69.123456', data_uom: 'ddeg' },
        { data_name: 'depth', data_value: '228.5m', data_uom: 'm' },
        { data_name: 'heading', data_value: '98.4', data_uom: 'deg' }
      ]
    }
  ]);
});

test('buildEventAuxDataPayload prefers event aux_data over payload aux data', () => {
  const auxData = buildEventAuxDataPayload({
    aux_data: [
      {
        data_source: 'vehiclePosition',
        data_array: [
          { data_name: 'latitude', data_value: '1', data_uom: 'ddeg' }
        ]
      }
    ],
    payload: {
      backfilled_aux_data: [
        {
          data_source: 'vesselPosition',
          data_array: [
            { data_name: 'latitude', data_value: '2', data_uom: 'ddeg' }
          ]
        }
      ]
    }
  });

  assert.equal(auxData.length, 1);
  assert.equal(auxData[0].data_source, 'vehiclePosition');
});

test('isAsnapEvent detects ASNAP by flag or by event value', () => {
  assert.equal(isAsnapEvent(null), false);
  assert.equal(isAsnapEvent({ isAsnap: true }), true);
  assert.equal(isAsnapEvent({ type: ASNAP_EVENT_VALUE.toLowerCase() }), true);
  assert.equal(isAsnapEvent({ type: 'CTD_START' }), false);
});

test('extractServerEventId reads the Sealog event id', () => {
  assert.equal(extractServerEventId({ id: 'server-event' }), 'server-event');
  assert.equal(extractServerEventId({}), null);
  assert.equal(extractServerEventId(null), null);
});

test('buildNormalizedOptionMap rekeys by normalized option key', () => {
  const out = buildNormalizedOptionMap({ 'Time In': 'x', 'Bottom_UTC': 'y' });
  assert.equal(out[normalizeOptionKey('Time In')], 'x');
  assert.equal(out[normalizeOptionKey('Bottom UTC')], 'y');
  assert.deepEqual(buildNormalizedOptionMap(null), {});
});

test('findOptionNameByNormalizedKey resolves the original key', () => {
  const map = { 'Time In': 'x' };
  assert.equal(findOptionNameByNormalizedKey(map, normalizeOptionKey('time   in')), 'Time In');
  assert.equal(findOptionNameByNormalizedKey(map, 'missing'), null);
  assert.equal(findOptionNameByNormalizedKey(null, 'x'), null);
});

test('buildEventAuxUploadPayload uses the Sealog aux data schema', () => {
  const entry = {
    data_source: 'vehiclePosition',
    data_array: [{ data_name: 'latitude', data_value: '12.3', data_uom: 'ddeg' }]
  };
  assert.deepEqual(buildEventAuxUploadPayload(42, entry), {
    event_id: '42',
    data_source: entry.data_source,
    data_array: entry.data_array
  });
});
