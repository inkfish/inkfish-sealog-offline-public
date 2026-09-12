/**
 * Helpers for ASNAP backfill debug snapshot forwarding.
 * @module
 */

const ASNAP_BACKFILL_DEBUG_ENDPOINT_SUFFIX = '/debug/asnap-backfill';

/**
 * Build the same-origin endpoint path used to forward ASNAP backfill snapshots.
 * @param {string} pathPrefix - Validated deployment prefix (e.g. /sealog-c), or empty for the landing page.
 * @returns {string} Same-origin endpoint path for ASNAP backfill debug forwarding.
 */
export function buildAsnapBackfillDebugEndpoint(pathPrefix = '') {
  return `${pathPrefix}${ASNAP_BACKFILL_DEBUG_ENDPOINT_SUFFIX}`;
}

/**
 * Build a stable signature for deduplicating snapshot POSTs.
 * @param {object} snapshot - Snapshot payload to fingerprint.
 * @returns {string} Stable deduplication signature.
 */
export function buildAsnapBackfillDebugSignature(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const lowering = snapshot.lowering && typeof snapshot.lowering === 'object'
    ? snapshot.lowering
    : {};
  return JSON.stringify({
    status: snapshot.status || null,
    reason: snapshot.reason || null,
    loweringId: lowering.id || null,
    counts: snapshot.counts || null,
    eventPointSummary: snapshot.eventPointSummary || null,
    fallbackWindowPointSummary: snapshot.fallbackWindowPointSummary || null,
    mergedPointSummary: snapshot.mergedPointSummary || null,
    vesselPointSummary: snapshot.vesselPointSummary || null
  });
}

function trimSnapshotSample(sample, sampleLimit) {
  const head = sample.head.slice(0, sampleLimit);
  const tail = sample.tail.slice(0, sampleLimit);
  return {
    total: sample.total,
    head,
    tail
  };
}

/**
 * Trim potentially-large snapshot payloads before server-side logging.
 * @param {object} snapshot - Snapshot payload to trim for server-side logging.
 * @param {number} sampleLimit - Max sample rows kept for each head/tail list.
 * @returns {object | null} Trimmed snapshot payload, or null for invalid input.
 */
export function trimAsnapBackfillSnapshotForServer(snapshot, sampleLimit = 8) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const trimmed = {
    capturedAtUtc: snapshot.capturedAtUtc || null,
    status: snapshot.status || null,
    reason: snapshot.reason || null,
    apiRoot: snapshot.apiRoot || null,
    vesselApiRoot: snapshot.vesselApiRoot || null,
    vesselApiRoots: snapshot.vesselApiRoots || [],
    cruiseId: snapshot.cruiseId || null,
    queryLimit: snapshot.queryLimit || null,
    lowering: snapshot.lowering || null,
    counts: snapshot.counts || null,
    eventPointSummary: snapshot.eventPointSummary || null,
    fallbackWindowPointSummary: snapshot.fallbackWindowPointSummary || null,
    mergedPointSummary: snapshot.mergedPointSummary || null,
    vesselPointSummary: snapshot.vesselPointSummary || null
  };
  if (snapshot.samples && typeof snapshot.samples === 'object') {
    const samples = {};
    Object.entries(snapshot.samples).forEach(([key, sample]) => {
      const trimmedSample = trimSnapshotSample(sample, sampleLimit);
      samples[key] = trimmedSample;
    });
    if (Object.keys(samples).length) {
      trimmed.samples = samples;
    }
  }
  return trimmed;
}
