import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBackfillAllowlist,
  eventMatchesBackfillAllowlist,
  isDepthOptionName,
  hasRequiredBackfilledPositionAux,
  extractAsnapPoint,
  buildAsnapPointsFromByLoweringEvents,
  buildAsnapPointsFromAuxData,
  buildEventTimestampIndex,
  selectCurrentLowering,
  selectSurroundingAsnapPair,
  interpolateCoordinates,
  resolveInterpolatedAsnapPositionFromPoints,
  applyBackfilledCoordinatesToEvent,
  buildVesselPointsFromEventPoints,
  mergeAsnapPointSets
} from '../../src/sync/asnap-backfill.js';

test('parseBackfillAllowlist normalizes comma/newline entries', () => {
  const allowlist = parseBackfillAllowlist('ctd_start, NOTE\ntemplate-123\n  ');
  assert.equal(allowlist.has('CTD_START'), true);
  assert.equal(allowlist.has('NOTE'), true);
  assert.equal(allowlist.has('TEMPLATE-123'), true);
  assert.equal(allowlist.size, 3);
});

test('eventMatchesBackfillAllowlist matches by type or template id', () => {
  const allowlist = parseBackfillAllowlist('CTD_START,template-123');
  assert.equal(
    eventMatchesBackfillAllowlist({ type: 'CTD_START', eventTemplateId: 'other' }, allowlist),
    true
  );
  assert.equal(
    eventMatchesBackfillAllowlist({ type: 'NOTE', eventTemplateId: 'template-123' }, allowlist),
    true
  );
  assert.equal(
    eventMatchesBackfillAllowlist({ type: 'NOTE', eventTemplateId: 'template-zzz' }, allowlist),
    false
  );
});

test('extractAsnapPoint parses vehiclePosition aux_data with depth', () => {
  const point = extractAsnapPoint({
    ts: '2026-02-24T12:00:00.000Z',
    aux_data: [
      {
        data_source: 'vehiclePosition',
        data_array: [
          { data_name: 'latitude', data_value: '-45.0001' },
          { data_name: 'longitude', data_value: '170.0002' },
          { data_name: 'depth', data_value: '229.26' },
        ]
      }
    ]
  });
  assert.ok(point);
  assert.equal(point.lat, -45.0001);
  assert.equal(point.lon, 170.0002);
  assert.equal(point.depthM, 229.26);
});

test('extractAsnapPoint requires vehiclePosition auxiliary coordinates', () => {
  const point = extractAsnapPoint({
    ts: '2026-02-24T12:00:00.000Z',
    event_options: [
      { event_option_name: 'Latitude', event_option_value: '-45.1' },
      { event_option_name: 'Longitude', event_option_value: '170.2' },
    ],
  });
  assert.equal(point, null);
});

test('extractAsnapPoint keeps vessel coordinates when heading is absent', () => {
  const point = extractAsnapPoint({
    ts: '2026-02-24T12:03:00.000Z',
    aux_data: [
      {
        data_source: 'vehiclePosition',
        data_array: [
          { data_name: 'latitude', data_value: '-45.3001' },
          { data_name: 'longitude', data_value: '170.3002' }
        ]
      },
      {
        data_source: 'vesselPosition',
        data_array: [
          { data_name: 'latitude', data_value: '-45.301' },
          { data_name: 'longitude', data_value: '170.301' }
        ]
      }
    ]
  });
  assert.ok(point);
  assert.equal(point.vesselLat, -45.301);
  assert.equal(point.vesselLon, 170.301);
  assert.equal(point.vesselHeadingDeg, null);
});

test('selectSurroundingAsnapPair and interpolateCoordinates are time-weighted (including depth)', () => {
  const points = [
    { timestampMs: Date.parse('2026-02-24T12:00:00.000Z'), lat: 0, lon: 0, accM: 10, depthM: 100 },
    { timestampMs: Date.parse('2026-02-24T12:00:10.000Z'), lat: 10, lon: 20, accM: 30, depthM: 200 },
  ];
  const targetMs = Date.parse('2026-02-24T12:00:02.000Z');
  const pair = selectSurroundingAsnapPair(points, targetMs);
  assert.ok(pair);
  const interpolated = interpolateCoordinates(pair.before, pair.after, targetMs);
  assert.equal(interpolated.lat, 2);
  assert.equal(interpolated.lon, 4);
  assert.equal(interpolated.accM, 14);
  assert.equal(interpolated.depthM, 120);
});

test('interpolateCoordinates reuses single finite values when one side is missing', () => {
  const interpolated = interpolateCoordinates(
    {
      timestampMs: 0,
      lat: 0,
      lon: 0,
      accM: 5,
      depthM: null,
    },
    {
      timestampMs: 10,
      lat: 10,
      lon: 20,
      accM: null,
      depthM: 200,
    },
    5
  );

  assert.equal(interpolated.accM, 5);
  assert.equal(interpolated.depthM, 200);
});

test('selectSurroundingAsnapPair falls back to edge pairs when target is outside series', () => {
  const points = [
    { timestampMs: Date.parse('2026-02-24T12:00:00.000Z'), lat: 0, lon: 0 },
    { timestampMs: Date.parse('2026-02-24T12:00:10.000Z'), lat: 10, lon: 10 },
    { timestampMs: Date.parse('2026-02-24T12:00:20.000Z'), lat: 20, lon: 20 }
  ];

  const beforeSeries = selectSurroundingAsnapPair(
    points,
    Date.parse('2026-02-24T11:59:00.000Z')
  );
  assert.ok(beforeSeries);
  assert.equal(beforeSeries.before.timestampMs, points[0].timestampMs);
  assert.equal(beforeSeries.after.timestampMs, points[1].timestampMs);

  const afterSeries = selectSurroundingAsnapPair(
    points,
    Date.parse('2026-02-24T12:40:00.000Z')
  );
  assert.ok(afterSeries);
  assert.equal(afterSeries.before.timestampMs, points[1].timestampMs);
  assert.equal(afterSeries.after.timestampMs, points[2].timestampMs);
});

test('selectSurroundingAsnapPair ignores invalid points while finding brackets', () => {
  const pair = selectSurroundingAsnapPair(
    [
      null,
      { timestampMs: Number.NaN, lat: 0, lon: 0 },
      { timestampMs: Date.parse('2026-02-24T12:00:00.000Z'), lat: 0, lon: 0 },
      { timestampMs: Date.parse('2026-02-24T12:00:10.000Z'), lat: 10, lon: 10 }
    ],
    Date.parse('2026-02-24T12:00:05.000Z')
  );

  assert.ok(pair);
  assert.equal(pair.before.timestampMs, Date.parse('2026-02-24T12:00:00.000Z'));
  assert.equal(pair.after.timestampMs, Date.parse('2026-02-24T12:00:10.000Z'));
});

test('interpolateCoordinates rejects invalid inputs', () => {
  assert.equal(interpolateCoordinates(null, {}, 5), null);
  assert.equal(
    interpolateCoordinates(
      { lat: 0, lon: 0, timestampMs: Number.NaN },
      { lat: 1, lon: 1, timestampMs: 5 },
      3
    ),
    null
  );
  assert.equal(
    interpolateCoordinates(
      { lat: Number.NaN, lon: 0, timestampMs: 1 },
      { lat: 1, lon: 1, timestampMs: 5 },
      3
    ),
    null
  );
  assert.equal(
    interpolateCoordinates(
      { lat: 0, lon: 0, timestampMs: 1 },
      { lat: 1, lon: Number.NaN, timestampMs: 5 },
      3
    ),
    null
  );
});

test('isDepthOptionName recognizes depth variants', () => {
  assert.equal(isDepthOptionName('Depth'), true);
  assert.equal(isDepthOptionName('Vehicle Depth (m)'), true);
  assert.equal(isDepthOptionName('depth_m'), true);
  assert.equal(isDepthOptionName('Altitude'), false);
});

test('isDepthOptionName rejects unrelated names containing depth substring', () => {
  assert.equal(isDepthOptionName('bit depth'), true, 'bit depth contains word depth');
  assert.equal(isDepthOptionName('colordepth'), false, 'colordepth is not a word boundary match');
  assert.equal(isDepthOptionName('indepth'), false, 'indepth is not a word boundary match');
});

test('applyBackfilledCoordinatesToEvent keeps depth in aux data only', () => {
  const event = {
    payload: {},
    option_values: []
  };
  const changed = applyBackfilledCoordinatesToEvent(
    event,
    {
      lat: -44.8,
      lon: 170.2,
      accM: 24,
      depthM: 229.26,
      vesselLat: -44.81,
      vesselLon: 170.22,
      vesselHeadingDeg: 78.3
    },
    {
      backfilledAtUtc: '2026-02-24T13:00:00.000Z'
    }
  );

  assert.equal(changed, true);
  assert.equal(event.payload.depth_m, undefined);
  assert.equal(event.payload.backfilled_depth_from_asnap, undefined);
  assert.deepEqual(event.option_values, []);
  const backfilledAux = Array.isArray(event.payload.backfilled_aux_data)
    ? event.payload.backfilled_aux_data
    : [];
  const vehicle = backfilledAux.find((entry) => entry.data_source === 'vehiclePosition');
  const vessel = backfilledAux.find((entry) => entry.data_source === 'vesselPosition');
  assert.ok(vehicle);
  assert.ok(vessel);
  const vehicleValues = new Map(vehicle.data_array.map((entry) => [entry.data_name, entry.data_value]));
  assert.equal(vehicleValues.get('latitude'), '-44.8');
  assert.equal(vehicleValues.get('longitude'), '170.2');
  assert.equal(vehicleValues.get('depth'), '229.26');
  const vesselValues = new Map(vessel.data_array.map((entry) => [entry.data_name, entry.data_value]));
  assert.equal(vesselValues.get('latitude'), '-44.81');
  assert.equal(vesselValues.get('longitude'), '170.22');
  assert.equal(vesselValues.get('heading'), '78.3');
});

test('applyBackfilledCoordinatesToEvent requires vessel coordinates', () => {
  const event = {
    payload: {},
    option_values: []
  };
  const changed = applyBackfilledCoordinatesToEvent(
    event,
    {
      lat: -44.8,
      lon: 170.2,
      accM: 24,
      depthM: 229.26
    },
    {
      backfilledAtUtc: '2026-02-24T13:00:00.000Z'
    }
  );

  assert.equal(changed, false);
  assert.equal(event.payload.backfilled_aux_data, undefined);
  assert.equal(event.lat, undefined);
  assert.equal(event.lon, undefined);
});

test('applyBackfilledCoordinatesToEvent rejects missing records and invalid coordinates', () => {
  assert.equal(applyBackfilledCoordinatesToEvent(null, { lat: 1, lon: 2 }), false);
  assert.equal(applyBackfilledCoordinatesToEvent({}, null), false);
  assert.equal(
    applyBackfilledCoordinatesToEvent({}, { lat: 'bad', lon: 170, vesselLat: 1, vesselLon: 2 }),
    false
  );
});

test('applyBackfilledCoordinatesToEvent rebuilds non-object payloads and omits optional depth and heading', () => {
  const event = {
    payload: 'bad-payload',
    option_values: []
  };

  const changed = applyBackfilledCoordinatesToEvent(
    event,
    {
      lat: -44.8,
      lon: 170.2,
      accM: null,
      depthM: null,
      vesselLat: -44.81,
      vesselLon: 170.22,
      vesselHeadingDeg: null
    },
    {
      backfilledAtUtc: '2026-02-24T13:00:00.000Z'
    }
  );

  assert.equal(changed, true);
  assert.equal(typeof event.payload, 'object');
  const vehicle = event.payload.backfilled_aux_data.find((entry) => entry.data_source === 'vehiclePosition');
  const vessel = event.payload.backfilled_aux_data.find((entry) => entry.data_source === 'vesselPosition');
  assert.equal(vehicle.data_array.some((entry) => entry.data_name === 'depth'), false);
  assert.equal(vessel.data_array.some((entry) => entry.data_name === 'heading'), false);
  assert.match(event.payload.backfilled_at_utc, /^\d{4}-\d{2}-\d{2}T/);
});

test('applyBackfilledCoordinatesToEvent stamps current time when backfilledAtUtc is absent', () => {
  const event = {
    payload: {},
    option_values: []
  };

  const changed = applyBackfilledCoordinatesToEvent(event, {
    lat: -44.8,
    lon: 170.2,
    vesselLat: -44.81,
    vesselLon: 170.22
  });

  assert.equal(changed, true);
  assert.match(event.payload.backfilled_at_utc, /^\d{4}-\d{2}-\d{2}T/);
});

test('selectSurroundingAsnapPair rejects invalid target timestamps', () => {
  assert.equal(selectSurroundingAsnapPair([], Number.NaN), null);
});

test('buildEventTimestampIndex indexes valid event timestamps', () => {
  const index = buildEventTimestampIndex([
    { id: 'bad', ts: 'not-a-date' },
    { id: 'good', ts: '2026-02-24T12:00:00.000Z' }
  ]);
  assert.equal(index.has('bad'), false);
  assert.equal(index.get('good'), '2026-02-24T12:00:00.000Z');
});

test('hasRequiredBackfilledPositionAux requires both vehicle and vessel entries', () => {
  const event = {
    payload: {
      backfilled_aux_data: [
        {
          data_source: 'vehiclePosition',
          data_array: [
            { data_name: 'latitude', data_value: '12.35', data_uom: 'ddeg' },
            { data_name: 'longitude', data_value: '-69.16', data_uom: 'ddeg' }
          ]
        }
      ]
    }
  };

  assert.equal(hasRequiredBackfilledPositionAux(event), false);

  event.payload.backfilled_aux_data.push({
    data_source: 'vesselPosition',
    data_array: [
      { data_name: 'latitude', data_value: '12.36', data_uom: 'ddeg' },
      { data_name: 'longitude', data_value: '-69.17', data_uom: 'ddeg' }
    ]
  });
  assert.equal(hasRequiredBackfilledPositionAux(event), true);
});

test('selectCurrentLowering prefers an active lowering at the sync timestamp', () => {
  const selection = selectCurrentLowering(
    [
      {
        id: 'old',
        lowering_id: 'DIVE0001',
        start_ts: '2026-02-24T10:00:00.000Z',
        stop_ts: '2026-02-24T11:00:00.000Z',
      },
      {
        id: 'active',
        lowering_id: 'DIVE0002',
        start_ts: '2026-02-24T12:00:00.000Z',
        stop_ts: '2026-02-24T15:00:00.000Z',
      },
      {
        id: 'future',
        lowering_id: 'DIVE0003',
        start_ts: '2026-02-24T16:00:00.000Z',
        stop_ts: '2026-02-24T18:00:00.000Z',
      }
    ],
    { nowIso: '2026-02-24T13:00:00.000Z' }
  );
  assert.ok(selection);
  assert.equal(selection.sealogId, 'active');
  assert.equal(selection.loweringId, 'DIVE0002');
});

test('selectCurrentLowering falls back to most recent completed lowering', () => {
  const selection = selectCurrentLowering(
    [
      {
        id: 'older',
        lowering_id: 'DIVE0005',
        start_ts: '2026-02-24T08:00:00.000Z',
        stop_ts: '2026-02-24T09:00:00.000Z',
      },
      {
        id: 'latest',
        lowering_id: 'DIVE0006',
        start_ts: '2026-02-24T10:00:00.000Z',
        stop_ts: '2026-02-24T11:30:00.000Z',
      }
    ],
    { nowIso: '2026-02-24T13:00:00.000Z' }
  );
  assert.ok(selection);
  assert.equal(selection.sealogId, 'latest');
  assert.equal(selection.loweringId, 'DIVE0006');
});

test('selectCurrentLowering falls back to earliest future lowering when none have started', () => {
  const selection = selectCurrentLowering(
    [
      {
        id: 'future-b',
        lowering_id: 'DIVE0010',
        start_ts: '2026-02-24T15:00:00.000Z',
        stop_ts: '2026-02-24T17:00:00.000Z',
      },
      {
        id: 'future-a',
        lowering_id: 'DIVE0009',
        start_ts: '2026-02-24T14:00:00.000Z',
        stop_ts: '2026-02-24T16:00:00.000Z',
      }
    ],
    { nowIso: '2026-02-24T13:00:00.000Z' }
  );
  assert.ok(selection);
  assert.equal(selection.sealogId, 'future-a');
  assert.equal(selection.loweringId, 'DIVE0009');
});

test('selectCurrentLowering ignores entries with missing or invalid timestamps', () => {
  assert.equal(selectCurrentLowering([
    { id: 'missing' },
    { id: 'invalid', start_ts: 'not-a-date' }
  ], { nowIso: '2026-02-24T13:00:00.000Z' }), null);
});

test('buildAsnapPointsFromByLoweringEvents only keeps ASNAP records with vehicle coordinates', () => {
  const points = buildAsnapPointsFromByLoweringEvents([
    {
      id: 'asnap-1',
      event_value: 'ASNAP',
      ts: '2026-02-24T12:00:00.000Z',
      aux_data: [
        {
          data_source: 'vehiclePosition',
          data_array: [
            { data_name: 'latitude', data_value: '-45.1' },
            { data_name: 'longitude', data_value: '170.1' },
            { data_name: 'depth', data_value: '220.0' }
          ]
        }
      ]
    },
    {
      id: 'note-1',
      event_value: 'NOTE',
      ts: '2026-02-24T12:01:00.000Z',
      aux_data: []
    },
    {
      id: 'asnap-bad',
      event_value: 'ASNAP',
      ts: '2026-02-24T12:02:00.000Z',
      aux_data: [
        {
          data_source: 'vesselPosition',
          data_array: [{ data_name: 'latitude', data_value: '-45.0' }]
        }
      ]
    }
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].lat, -45.1);
  assert.equal(points[0].lon, 170.1);
  assert.equal(points[0].depthM, 220);
});

test('buildAsnapPointsFromAuxData uses event_id timestamp mapping from bylowering events', () => {
  const eventTimestampById = buildEventTimestampIndex([
    {
      id: 'asnap-aux-1',
      ts: '2026-02-24T12:05:00.000Z'
    }
  ]);
  const points = buildAsnapPointsFromAuxData(
    [
      {
        event_id: 'asnap-aux-1',
        data_source: 'vehiclePosition',
        data_array: [
          { data_name: 'latitude', data_value: '-44.9' },
          { data_name: 'longitude', data_value: '170.2' },
          { data_name: 'depth', data_value: '230.5' }
        ]
      }
    ],
    { eventTimestampById }
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].timestampIso, '2026-02-24T12:05:00.000Z');
  assert.equal(points[0].lat, -44.9);
  assert.equal(points[0].lon, 170.2);
  assert.equal(points[0].depthM, 230.5);
});

test('buildAsnapPointsFromAuxData accepts vehicle position source variants and unit-suffixed depth', () => {
  const eventTimestampById = buildEventTimestampIndex([
    {
      id: 'asnap-aux-2',
      ts: '2026-02-24T12:06:00.000Z'
    }
  ]);
  const points = buildAsnapPointsFromAuxData(
    [
      {
        event_id: 'asnap-aux-2',
        data_source: 'vehicle position',
        data_array: [
          { data_name: 'latitude', data_value: '-44.8' },
          { data_name: 'longitude', data_value: '170.3' },
          { data_name: 'depth', data_value: '229.26 m' }
        ]
      }
    ],
    { eventTimestampById }
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].lat, -44.8);
  assert.equal(points[0].lon, 170.3);
  assert.equal(points[0].depthM, 229.26);
});

test('buildAsnapPointsFromAuxData parses vesselPosition when requested', () => {
  const eventTimestampById = buildEventTimestampIndex([
    {
      id: 'asnap-vessel-1',
      ts: '2026-02-24T12:06:00.000Z'
    }
  ]);
  const points = buildAsnapPointsFromAuxData(
    [
      {
        event_id: 'asnap-vessel-1',
        data_source: 'vesselPosition',
        data_array: [
          { data_name: 'latitude', data_value: '-44.75' },
          { data_name: 'longitude', data_value: '170.31' },
          { data_name: 'heading', data_value: '92.4' }
        ]
      }
    ],
    { eventTimestampById, dataSource: 'vesselPosition' }
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].lat, -44.75);
  assert.equal(points[0].lon, 170.31);
  assert.equal(points[0].headingDeg, 92.4);
});

test('buildAsnapPointsFromAuxData prefers event_id over aux row id for timestamp lookup', () => {
  const eventTimestampById = buildEventTimestampIndex([
    {
      id: 'asnap-aux-linked',
      ts: '2026-02-24T12:07:00.000Z'
    }
  ]);
  const points = buildAsnapPointsFromAuxData(
    [
      {
        id: 'aux-row-id-only',
        event_id: 'asnap-aux-linked',
        data_source: 'vehiclePosition',
        data_array: [
          { data_name: 'latitude', data_value: '-44.7' },
          { data_name: 'longitude', data_value: '170.4' },
          { data_name: 'depth', data_value: '231.1' }
        ]
      }
    ],
    { eventTimestampById }
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].timestampIso, '2026-02-24T12:07:00.000Z');
  assert.equal(points[0].lat, -44.7);
  assert.equal(points[0].lon, 170.4);
  assert.equal(points[0].depthM, 231.1);
});

test('resolveInterpolatedAsnapPositionFromPoints interpolates from prebuilt point set', () => {
  const points = [
    {
      timestampIso: '2026-02-24T12:00:00.000Z',
      timestampMs: Date.parse('2026-02-24T12:00:00.000Z'),
      lat: -45.0,
      lon: 170.0,
      accM: 10,
      depthM: 200,
    },
    {
      timestampIso: '2026-02-24T12:00:10.000Z',
      timestampMs: Date.parse('2026-02-24T12:00:10.000Z'),
      lat: -44.0,
      lon: 171.0,
      accM: 20,
      depthM: 220,
    }
  ];
  const result = resolveInterpolatedAsnapPositionFromPoints({
    targetIso: '2026-02-24T12:00:05.000Z',
    points
  });
  assert.ok(result);
  assert.equal(result.lat, -44.5);
  assert.equal(result.lon, 170.5);
  assert.equal(result.accM, 15);
  assert.equal(result.depthM, 210);
});

test('resolveInterpolatedAsnapPositionFromPoints rejects invalid targets and interpolation failures', () => {
  assert.equal(
    resolveInterpolatedAsnapPositionFromPoints({
      targetIso: 'bad-target',
      points: []
    }),
    null
  );

  assert.equal(
    resolveInterpolatedAsnapPositionFromPoints({
      targetIso: '2026-02-24T12:00:05.000Z',
      points: null
    }),
    null
  );

  assert.equal(
    resolveInterpolatedAsnapPositionFromPoints({
      targetIso: '2026-02-24T12:00:05.000Z',
      points: [
        {
          timestampIso: '2026-02-24T12:00:00.000Z',
          timestampMs: 0,
          lat: Number.NaN,
          lon: 0
        },
        {
          timestampIso: '2026-02-24T12:00:10.000Z',
          timestampMs: 10,
          lat: 1,
          lon: 1
        }
      ]
    }),
    null
  );
});

test('interpolateCoordinates interpolates headingDeg for vessel-source points', () => {
  const before = {
    timestampMs: Date.parse('2026-02-24T12:00:00.000Z'),
    lat: -44.0, lon: 170.0, headingDeg: 80
  };
  const after = {
    timestampMs: Date.parse('2026-02-24T12:00:10.000Z'),
    lat: -44.1, lon: 170.1, headingDeg: 100
  };
  const targetMs = Date.parse('2026-02-24T12:00:05.000Z');
  const result = interpolateCoordinates(before, after, targetMs);
  assert.ok(result);
  assert.equal(result.headingDeg, 90);
});

test('interpolateCoordinates returns null headingDeg when points lack it', () => {
  const before = {
    timestampMs: Date.parse('2026-02-24T12:00:00.000Z'),
    lat: 0, lon: 0
  };
  const after = {
    timestampMs: Date.parse('2026-02-24T12:00:10.000Z'),
    lat: 10, lon: 10
  };
  const targetMs = Date.parse('2026-02-24T12:00:05.000Z');
  const result = interpolateCoordinates(before, after, targetMs);
  assert.ok(result);
  assert.equal(result.headingDeg, null);
});

test('interpolateCoordinates returns direct values when timestamps are identical', () => {
  const timestampMs = Date.parse('2026-02-24T12:00:00.000Z');
  const before = {
    timestampMs,
    lat: -44.0,
    lon: 170.0,
    accM: 6,
    depthM: 210,
    headingDeg: 82,
  };
  const after = {
    timestampMs,
    lat: -43.0,
    lon: 171.0,
    accM: 8,
    depthM: 215,
    headingDeg: 88,
  };

  const result = interpolateCoordinates(before, after, timestampMs);
  assert.ok(result);
  assert.equal(result.lat, -44.0);
  assert.equal(result.lon, 170.0);
  assert.equal(result.accM, 6);
  assert.equal(result.depthM, 210);
  assert.equal(result.headingDeg, 82);
});

test('vessel points round-trip headingDeg through resolveInterpolatedAsnapPositionFromPoints', () => {
  const points = [
    {
      timestampMs: Date.parse('2026-02-24T12:00:00.000Z'),
      timestampIso: '2026-02-24T12:00:00.000Z',
      lat: -44.0, lon: 170.0, headingDeg: 80
    },
    {
      timestampMs: Date.parse('2026-02-24T12:00:10.000Z'),
      timestampIso: '2026-02-24T12:00:10.000Z',
      lat: -44.1, lon: 170.1, headingDeg: 100
    }
  ];
  const result = resolveInterpolatedAsnapPositionFromPoints({
    targetIso: '2026-02-24T12:00:05.000Z',
    points
  });
  assert.ok(result);
  assert.equal(result.headingDeg, 90);
});

test('buildVesselPointsFromEventPoints filters non-finite coords, maps, and sorts by time', () => {
  const out = buildVesselPointsFromEventPoints([
    { timestampMs: 200, timestampIso: 'b', vesselLat: 1, vesselLon: 2, vesselHeadingDeg: 90, serverId: 's2' },
    { timestampMs: 100, timestampIso: 'a', vesselLat: 3, vesselLon: 4 },
    { timestampMs: 150, vesselLat: NaN, vesselLon: 5 } // dropped: non-finite lat
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((p) => p.timestampMs), [100, 200]);
  assert.deepEqual(out[1], { timestampIso: 'b', timestampMs: 200, lat: 1, lon: 2, headingDeg: 90, serverId: 's2' });
  assert.equal(out[0].headingDeg, null); // missing heading -> null
  assert.equal(out[0].serverId, null);
  assert.deepEqual(buildVesselPointsFromEventPoints(null), []);
});

test('mergeAsnapPointSets de-duplicates by id/time/coords and sorts by time', () => {
  const a = [{ timestampMs: 100, lat: 1.0, lon: 2.0, serverId: 'x' }];
  const b = [
    { timestampMs: 100, lat: 1.0, lon: 2.0, serverId: 'x' }, // duplicate of a[0]
    { timestampMs: 50, lat: 5.0, lon: 6.0, serverId: 'y' }
  ];
  const merged = mergeAsnapPointSets(a, b);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((p) => p.timestampMs), [50, 100]);
  assert.deepEqual(mergeAsnapPointSets(null, null), []);
  // points without a finite timestamp are dropped
  assert.deepEqual(mergeAsnapPointSets([{ lat: 1, lon: 2 }], []), []);
});
