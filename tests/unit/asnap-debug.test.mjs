import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsnapBackfillDebugEndpoint,
  buildAsnapBackfillDebugSignature,
  trimAsnapBackfillSnapshotForServer
} from '../../src/sync/asnap-debug.js';

test('buildAsnapBackfillDebugEndpoint composes prefix and debug path', () => {
  assert.equal(
    buildAsnapBackfillDebugEndpoint('/sealog-c'),
    '/sealog-c/debug/asnap-backfill'
  );
  assert.equal(
    buildAsnapBackfillDebugEndpoint(''),
    '/debug/asnap-backfill'
  );
});

test('buildAsnapBackfillDebugSignature ignores timestamp-only differences', () => {
  const a = buildAsnapBackfillDebugSignature({
    capturedAtUtc: '2026-02-24T21:00:00.000Z',
    status: 'ok',
    reason: 'combined',
    lowering: { id: 'lowering-a' },
    counts: { mergedPoints: 12 },
    mergedPointSummary: { count: 12, withDepthCount: 12 }
  });
  const b = buildAsnapBackfillDebugSignature({
    capturedAtUtc: '2026-02-24T21:00:01.000Z',
    status: 'ok',
    reason: 'combined',
    lowering: { id: 'lowering-a' },
    counts: { mergedPoints: 12 },
    mergedPointSummary: { count: 12, withDepthCount: 12 }
  });
  assert.equal(a, b);
});

test('buildAsnapBackfillDebugSignature handles invalid and sparse snapshots', () => {
  assert.equal(buildAsnapBackfillDebugSignature(null), '');

  const signature = buildAsnapBackfillDebugSignature({
    status: '',
    reason: '',
    lowering: 'bad-shape'
  });
  assert.equal(
    signature,
    JSON.stringify({
      status: null,
      reason: null,
      loweringId: null,
      counts: null,
      eventPointSummary: null,
      fallbackWindowPointSummary: null,
      mergedPointSummary: null,
      vesselPointSummary: null
    })
  );
});

test('trimAsnapBackfillSnapshotForServer keeps summary and limits samples', () => {
  const snapshot = {
    capturedAtUtc: '2026-02-24T21:01:00.000Z',
    status: 'ok',
    reason: 'combined',
    counts: { mergedPoints: 100 },
    vesselApiRoots: ['/sealog-a/sealog-server', '/sealog-c/sealog-server'],
    lowering: {
      id: 'lowering-a',
      loweringId: 'DIVE0001',
      startTs: '2026-02-24T12:00:00.000Z',
      stopTs: '2026-02-24T22:00:00.000Z'
    },
    samples: {
      lowerings: {
        total: 1,
        head: [{
          id: 'lowering-a',
          loweringId: 'DIVE0001',
          startTs: '2026-02-24T12:00:00.000Z',
          stopTs: '2026-02-24T22:00:00.000Z'
        }],
        tail: []
      },
      mergedPoints: {
        total: 100,
        head: Array.from({ length: 12 }, (_, i) => ({ idx: i })),
        tail: Array.from({ length: 12 }, (_, i) => ({ idx: 100 + i }))
      }
    }
  };
  const trimmed = trimAsnapBackfillSnapshotForServer(snapshot, 5);
  assert.equal(trimmed.capturedAtUtc, '2026-02-24T21:01:00.000Z');
  assert.equal(trimmed.status, 'ok');
  assert.deepEqual(trimmed.lowering, snapshot.lowering);
  assert.deepEqual(trimmed.samples.lowerings.head, [snapshot.lowering]);
  assert.deepEqual(trimmed.vesselApiRoots, snapshot.vesselApiRoots);
  assert.equal(trimmed.counts.mergedPoints, 100);
  assert.equal(trimmed.samples.mergedPoints.total, 100);
  assert.equal(trimmed.samples.mergedPoints.head.length, 5);
  assert.equal(trimmed.samples.mergedPoints.tail.length, 5);
});
