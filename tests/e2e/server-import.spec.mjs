import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};
let server;
let baseURL;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filePath = join(ROOT, pathname === '/' ? '/index.html' : pathname);
    try {
      const body = await readFile(filePath);
      res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClosed) => server.close(resolveClosed));
});

test('Load Sealog Events preserves server notes and refreshes the same event after reload', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const eventQueries = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const timestamp = '2026-09-08T12:00:00.000Z';
  const cruiseStart = '2026-09-08T00:00:00.000Z';
  const clientUuid = '180043b8-a5e3-418c-b217-9465a38d372d';
  const jsonNote = '{"notes":"Keep this JSON as written","lat":99}';
  let serverNote = jsonNote;
  let includeCoordinateOptions = true;
  await page.clock.setFixedTime(new Date('2026-09-08T12:05:00.000Z'));
  await page.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'test-jwt');
    localStorage.setItem('userId', 'user-tester');
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let body = [];
    if (url.pathname.endsWith('/cruises')) {
      body = [{ id: 'cruise-current', start_ts: cruiseStart, stop_ts: null }];
    } else if (url.pathname.endsWith('/events')) {
      eventQueries.push(Object.fromEntries(url.searchParams));
      body = [{
        id: 'server-note-1',
        ts: timestamp,
        event_value: 'NOTE',
        event_author: 'tester',
        cruise_id: 'cruise-current',
        event_free_text: serverNote,
        event_options: [
          { event_option_name: 'client_uuid', event_option_value: clientUuid },
          ...(includeCoordinateOptions ? [
            { event_option_name: 'Latitude', event_option_value: '12.12345' },
            { event_option_name: 'Longitude', event_option_value: '-68.98765' },
            { event_option_name: 'Device Accuracy (m)', event_option_value: '4' }
          ] : [])
        ]
      }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const readEvents = () => page.evaluate(async () => {
    const { getAll } = await import(new URL('/src/db/indexed-db.js', location.href).href);
    return getAll('events');
  });
  const loadServerEvents = async () => {
    await page.locator('#menuBtn').click();
    await page.getByRole('button', { name: 'Load Sealog Events', exact: true }).click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await expect(page.locator('#confirmModal')).toContainText('Imported 1 server event.');
    await page.locator('#confirmModalConfirm').click();
    await page.locator('#authCloseBtn').click();
  };

  try {
    await page.goto(baseURL);
    await page.locator('button.filter-chip[data-filter="all"]').click();
    await loadServerEvents();
    const card = page.locator('#list .event-card');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-id', clientUuid);
    await expect(card.locator('.event-note')).toHaveAttribute('title', jsonNote);
    const [imported] = await readEvents();
    expect(imported).toMatchObject({
      localId: clientUuid,
      client_uuid: clientUuid,
      serverId: 'server-note-1',
      eventTimestampUTC: timestamp,
      type: 'NOTE',
      syncState: 'synced',
      notes: jsonNote,
      lat: 12.12345,
      lon: -68.98765,
      acc_m: 4,
      payload: { notes: jsonNote, utc: timestamp, client_uuid: clientUuid }
    });
    expect(eventQueries[0]).toMatchObject({ author: 'tester', startTS: cruiseStart });
    expect(eventQueries[0].stopTS).toBeTruthy();

    await page.reload();
    await page.locator('button.filter-chip[data-filter="all"]').click();
    await expect(card).toHaveCount(1);
    await expect(card.locator('.event-note')).toHaveAttribute('title', jsonNote);
    expect((await readEvents())[0].notes).toBe(jsonNote);

    // A completed ASNAP backfill stores position in auxiliary telemetry rather
    // than requiring matching server event_options. Refresh must retain it.
    const backfilled = await page.evaluate(async () => {
      const { getAll, put } = await import(new URL('/src/db/indexed-db.js', location.href).href);
      const { applyBackfilledCoordinatesToEvent } = await import(new URL('/src/sync/asnap-backfill.js', location.href).href);
      const [event] = await getAll('events');
      applyBackfilledCoordinatesToEvent(event, {
        lat: 12.5, lon: -68.5, accM: 3,
        vesselLat: 12.6, vesselLon: -68.6, vesselHeadingDeg: 90
      });
      event.payload.backfilled_aux_uploaded = true;
      await put('events', event);
      return event;
    });
    expect(backfilled.payload.backfilled_from_asnap).toBe(true);
    includeCoordinateOptions = false;
    serverNote = 'Server corrected the note without changing the event time.';
    await loadServerEvents();
    await expect(card).toHaveCount(1);
    await expect(card.locator('.event-note')).toHaveAttribute('title', serverNote);
    const refreshed = await readEvents();
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      localId: clientUuid,
      serverId: 'server-note-1',
      eventTimestampUTC: timestamp,
      syncState: 'synced',
      notes: serverNote,
      lat: 12.5,
      lon: -68.5,
      acc_m: 3,
      payload: {
        notes: serverNote,
        utc: timestamp,
        lat: 12.5,
        lon: -68.5,
        acc_m: 3,
        backfilled_from_asnap: true,
        backfilled_aux_uploaded: true,
        backfilled_aux_data: backfilled.payload.backfilled_aux_data
      },
      aux_data: backfilled.aux_data
    });
    expect(eventQueries).toHaveLength(2);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('sync finds the exact client UUID through fulltext without reposting an existing event', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const eventQueries = [];
  const postedBodies = [];
  let captured;
  await page.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'test-jwt');
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body = [];
    if (url.pathname.endsWith('/events') && request.method() === 'POST') {
      postedBodies.push(request.postDataJSON());
      body = { acknowledged: true, insertedId: 'unexpected-repost' };
    } else if (url.pathname.endsWith('/events')) {
      eventQueries.push(Object.fromEntries(url.searchParams));
      if (url.searchParams.has('fulltext') && captured) {
        body = [
          {
            id: 'server-unrelated',
            ts: captured.eventTimestampUTC,
            event_value: 'NOTE',
            event_free_text: captured.localId,
            event_options: [{ event_option_name: 'client_uuid', event_option_value: 'different-client' }]
          },
          {
            id: 'server-already-saved',
            ts: captured.eventTimestampUTC,
            event_value: 'NOTE',
            event_free_text: captured.notes,
            event_options: [{ event_option_name: 'client_uuid', event_option_value: captured.localId }]
          }
        ];
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const readEvent = () => page.evaluate(async () => {
    const { getAll } = await import(new URL('/src/db/indexed-db.js', location.href).href);
    return (await getAll('events'))[0];
  });
  try {
    await page.goto(baseURL);
    await expect(page.locator('#type option', { hasText: /^Freeform Note$/ })).toHaveCount(1);
    await page.locator('#type').selectOption({ label: 'Freeform Note' });
    await page.locator('#notes').fill('Already saved by the server.');
    await context.setOffline(true);
    await page.locator('#captureBtn').click();
    await page.locator('button.filter-chip[data-filter="all"]').click();
    const card = page.locator('#list .event-card');
    await expect(card).toHaveCount(1);
    captured = await readEvent();
    expect(captured.syncState).toBe('unsynced');

    await context.setOffline(false);
    await page.locator('#syncBtn').click();
    await expect(card).toHaveAttribute('data-sync-state', 'synced');
    expect(await readEvent()).toMatchObject({
      localId: captured.localId,
      serverId: 'server-already-saved',
      notes: captured.notes,
      syncState: 'synced'
    });
    expect(eventQueries).toContainEqual({ fulltext: `^${captured.localId}$` });
    expect(eventQueries.every((query) => !('client_uuid' in query) && !('limit' in query))).toBe(true);
    expect(postedBodies).toEqual([]);
  } finally {
    await context.close();
  }
});

const UNSAFE_ID = 'x"><img src=x onerror="window.__xss=1">';

test('Load Sealog Events keys an event with an unsafe client UUID by its server id', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'test-jwt');
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let body = [];
    if (url.pathname.endsWith('/cruises')) {
      body = [{ id: 'cruise-current', start_ts: '2026-09-08T00:00:00.000Z', stop_ts: null }];
    } else if (url.pathname.endsWith('/events')) {
      body = [{
        id: 'abc123',
        ts: '2026-09-08T12:00:00.000Z',
        event_value: 'NOTE',
        event_author: 'tester',
        cruise_id: 'cruise-current',
        event_free_text: 'Imported note',
        event_options: [{ event_option_name: 'client_uuid', event_option_value: UNSAFE_ID }]
      }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const loadServerEvents = async (expectedMessage) => {
    await page.locator('#menuBtn').click();
    await page.getByRole('button', { name: 'Load Sealog Events', exact: true }).click();
    await expect(page.locator('#confirmModal')).toContainText(expectedMessage);
    await page.locator('#confirmModalConfirm').click();
    await page.locator('#authCloseBtn').click();
  };
  try {
    await page.goto(baseURL);
    await page.locator('button.filter-chip[data-filter="all"]').click();
    await loadServerEvents('Imported 1 server event.');
    const card = page.locator('#list .event-card');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-id', 'server-abc123');
    await expect(page.locator('#list img')).toHaveCount(0);
    const stored = await page.evaluate(async () => {
      const { getAll } = await import(new URL('/src/db/indexed-db.js', location.href).href);
      return getAll('events');
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ localId: 'server-abc123', client_uuid: 'server-abc123', serverId: 'abc123' });
    // Loading again matches the stored event by server id instead of adding a copy.
    await loadServerEvents('No new server events for this cruise.');
    await expect(card).toHaveCount(1);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  } finally {
    await context.close();
  }
});

test('the event list renders a stored unsafe local id as inert text it can still act on', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'test-jwt');
  });
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  try {
    await page.goto(baseURL);
    await page.evaluate(async (localId) => {
      const { put } = await import(new URL('/src/db/indexed-db.js', location.href).href);
      await put('events', {
        localId,
        client_uuid: localId,
        type: 'NOTE',
        eventTimestampUTC: '2026-09-08T12:00:00.000Z',
        syncState: 'verify-failed',
        notes: 'Stored by an older version',
        option_values: [],
        payload: {},
        revisions: []
      });
    }, UNSAFE_ID);
    await page.reload();
    await page.locator('button.filter-chip[data-filter="all"]').click();
    const card = page.locator('#list .event-card');
    await expect(card).toHaveCount(1);
    await expect(page.locator('#list img')).toHaveCount(0);
    for (const selector of ['', ' .event-summary', ' .edit-event', ' .delete-event', ' .force-repost']) {
      expect(await page.locator(`#list .event-card${selector}`).evaluate((el) => el.dataset.id)).toBe(UNSAFE_ID);
    }
    await card.locator('.event-summary').click();
    await card.locator('.edit-event').click();
    await expect(page.locator('#eventEditor')).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  } finally {
    await context.close();
  }
});
