import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsnapPointsFromByLoweringEvents,
  buildVesselPointsFromEventPoints,
  resolveInterpolatedAsnapPositionFromPoints,
  applyBackfilledCoordinatesToEvent,
} from '../../src/sync/asnap-backfill.js';
import { buildPostBody, normalizeOptionValues } from '../../src/events/event-transform.js';

test('applies interpolated ASNAP backfill to event payload and POST options', () => {
  const targetIso = '2026-02-24T12:00:02.000Z';
  const event = {
    localId: 'evt-123',
    client_uuid: 'evt-123',
    type: 'CTD_START',
    eventTemplateId: 'template-123',
    eventTimestampUTC: targetIso,
    notes: 'captured below decks',
    option_values: normalizeOptionValues([
      { event_option_name: 'Device UTC', event_option_value: targetIso },
      { event_option_name: 'Depth', event_option_value: '' },
    ]),
    payload: {
      utc: targetIso,
      notes: 'captured below decks',
      client_uuid: 'evt-123',
      options: {}
    },
  };

  const points = buildAsnapPointsFromByLoweringEvents([
      {
        id: 'asnap-before',
        event_value: 'ASNAP',
        ts: '2026-02-24T12:00:00.000Z',
        aux_data: [
          {
            data_source: 'vehiclePosition',
            data_array: [
              { data_name: 'latitude', data_value: '-45.0' },
              { data_name: 'longitude', data_value: '170.0' },
              { data_name: 'depth', data_value: '220.0' },
            ]
          },
          {
            data_source: 'vesselPosition',
            data_array: [
              { data_name: 'heading', data_value: '80.0' },
              { data_name: 'latitude', data_value: '-45.1' },
              { data_name: 'longitude', data_value: '169.9' },
            ]
          }
        ]
      },
      {
        id: 'asnap-after',
        event_value: 'ASNAP',
        ts: '2026-02-24T12:00:10.000Z',
        aux_data: [
          {
            data_source: 'vehiclePosition',
            data_array: [
              { data_name: 'latitude', data_value: '-44.0' },
              { data_name: 'longitude', data_value: '171.0' },
              { data_name: 'depth', data_value: '230.0' },
            ]
          },
          {
            data_source: 'vesselPosition',
            data_array: [
              { data_name: 'heading', data_value: '100.0' },
              { data_name: 'latitude', data_value: '-44.9' },
              { data_name: 'longitude', data_value: '170.1' },
            ]
          }
        ]
      },
    ]);
  const backfill = resolveInterpolatedAsnapPositionFromPoints({ targetIso, points });
  const vessel = resolveInterpolatedAsnapPositionFromPoints({
    targetIso,
    points: buildVesselPointsFromEventPoints(points)
  });
  assert.ok(backfill);
  assert.ok(vessel);
  backfill.vesselLat = vessel.lat;
  backfill.vesselLon = vessel.lon;
  backfill.vesselHeadingDeg = vessel.headingDeg;
  const changed = applyBackfilledCoordinatesToEvent(event, backfill, {
    backfilledAtUtc: '2026-02-24T13:00:00.000Z'
  });

  assert.equal(changed, true);
  assert.equal(event.lat, -44.8);
  assert.equal(event.lon, 170.2);
  assert.equal(event.acc_m, null);
  assert.equal(event.payload.backfilled_from_asnap, true);
  assert.equal(event.payload.backfilled_method, 'linear-time');
  assert.equal(event.payload.backfilled_source, 'server-asnap-vehicle');
  assert.equal(event.payload.backfilled_at_utc, '2026-02-24T13:00:00.000Z');
  assert.equal(event.payload.backfilled_depth_from_asnap, undefined);
  assert.equal(event.payload.depth_m, undefined);

  const postBody = buildPostBody(event);
  const latitudeOpt = postBody.event_options.find((opt) => opt.event_option_name === 'Latitude');
  const longitudeOpt = postBody.event_options.find((opt) => opt.event_option_name === 'Longitude');
  const depthOpt = postBody.event_options.find(
    (opt) => opt.event_option_name === 'Depth'
  );
  const backfilledAux = Array.isArray(event.payload.backfilled_aux_data)
    ? event.payload.backfilled_aux_data
    : [];
  const vehicleAux = backfilledAux
    ? backfilledAux.find((entry) => entry.data_source === 'vehiclePosition')
    : null;
  const vesselAux = backfilledAux
    ? backfilledAux.find((entry) => entry.data_source === 'vesselPosition')
    : null;

  assert.equal(latitudeOpt, undefined);
  assert.equal(longitudeOpt, undefined);
  assert.equal(depthOpt, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(postBody, 'aux_data'), false);
  assert.ok(vehicleAux);
  const vehicleValues = new Map(vehicleAux.data_array.map((entry) => [entry.data_name, entry.data_value]));
  assert.equal(vehicleValues.get('latitude'), '-44.8');
  assert.equal(vehicleValues.get('longitude'), '170.2');
  assert.equal(vehicleValues.get('depth'), '222');
  assert.ok(vesselAux);
  const vesselValues = new Map(vesselAux.data_array.map((entry) => [entry.data_name, entry.data_value]));
  assert.equal(vesselValues.get('latitude'), '-45.06');
  assert.equal(vesselValues.get('longitude'), '169.94');
  assert.equal(vesselValues.get('heading'), '84');
});
