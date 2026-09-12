import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';

let server;
let baseURL;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

test.beforeAll(async () => {
  const root = resolve(import.meta.dirname, '..', '..');
  server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    try {
      const body = await readFile(join(root, path === '/' ? 'index.html' : path));
      res.setHeader('Content-Type', MIME[extname(path)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => new Promise((resolve) => server.close(resolve)));

async function openApp(browser, handler, { time } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('jwt', 'test-jwt');
    localStorage.setItem('username', 'tester');
  });
  const page = await context.newPage();
  if (time) {
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
  }
  await page.route('**/sealog-server/api/v1/events**', handler);
  await page.goto(`${baseURL}/index.html`);
  await expect(page.locator('#emptyState')).toBeVisible();
  return { page, context };
}

async function seedEvent(page, overrides = {}) {
  return page.evaluate(async (overrides) => {
    const { put } = await import(new URL('/src/db/indexed-db.js', location.href).href);
    const now = Date.now();
    const event = {
      localId: 'capture-uuid', client_uuid: 'capture-uuid', type: 'NOTE',
      eventTemplateId: 'fallback-note', eventTemplateName: 'Freeform Note', template_categories: ['general'],
      notes: 'Original note', eventTimestampUTC: '2026-09-08T12:00:00.000Z',
      originalTimestampUTC: '2026-09-08T12:00:00.000Z',
      createdAtMs: now, updatedAtMs: now, createdAtUTC: new Date(now).toISOString(), updatedAtUTC: new Date(now).toISOString(),
      payload: { notes: 'Original note', options: {}, client_uuid: 'capture-uuid' },
      option_values: [], revisions: [], serverId: null, syncState: 'unsynced',
      attemptCount: 0, nextAttemptMs: null, lastError: null, verifyAttemptCount: 0, verifyNextAttemptMs: null,
      ...overrides
    };
    await put('events', event);
    return event;
  }, overrides);
}

async function readEvent(page) {
  return page.evaluate(async () => {
    const { get } = await import(new URL('/src/db/indexed-db.js', location.href).href);
    return get('events', 'capture-uuid');
  });
}

function serverRecord(id = 'confirmed-event') {
  return {
    id, event_value: 'NOTE', ts: '2026-09-08T12:00:00.000Z', event_author: 'tester',
    event_free_text: 'Original note',
    event_options: [{ event_option_name: 'client_uuid', event_option_value: 'capture-uuid' }]
  };
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('a missing insert id waits for its UUID and uploads aux data before confirming', async ({ browser }) => {
  let found = false;
  let posts = 0;
  const queries = [];
  const { page, context } = await openApp(browser, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      posts += 1;
      return json(route, { acknowledged: true });
    }
    const params = new URL(request.url()).searchParams;
    queries.push([...params.keys()]);
    return json(route, found ? [serverRecord()] : [{ ...serverRecord('unrelated-event'), event_options: [] }]);
  });
  const auxUploads = [];
  await page.route('**/sealog-server/api/v1/event_aux_data', async (route) => {
    auxUploads.push(route.request().postDataJSON());
    await json(route, { acknowledged: true, insertedId: `aux-${auxUploads.length}` });
  });
  const aux_data = ['vehiclePosition', 'vesselPosition'].map((data_source) => ({
    data_source, data_array: [{ data_name: 'latitude', data_value: '12.3' }, { data_name: 'longitude', data_value: '-69.1' }]
  }));
  await seedEvent(page, { aux_data });
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).verifyAttemptCount).toBe(1);
  expect((await readEvent(page)).syncState).toBe('verify-pending');
  expect((await readEvent(page)).serverId).toBeNull();
  expect(posts).toBe(1);
  expect(auxUploads).toHaveLength(0);
  expect(queries.every((keys) => keys.length === 1 && keys[0] === 'fulltext')).toBe(true);

  found = true;
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).syncState).toBe('synced');
  expect((await readEvent(page)).serverId).toBe('confirmed-event');
  expect((await readEvent(page)).payload.backfilled_aux_uploaded).toBe(true);
  expect(auxUploads.map((entry) => entry.event_id)).toEqual(['confirmed-event', 'confirmed-event']);
  expect(posts).toBe(1);
  await context.close();
});

test('failed UUID preflight holds a captured event without issuing a POST', async ({ browser }) => {
  let posts = 0;
  const { page, context } = await openApp(browser, async (route) => {
    if (route.request().method() === 'POST') posts += 1;
    await json(route, { message: 'Temporarily unavailable' }, 503);
  });
  await seedEvent(page);
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).lastError).toContain('503');
  expect((await readEvent(page)).syncState).toBe('unsynced');
  expect(posts).toBe(0);
  await context.close();
});

test('a future retry survives reload and syncs automatically when due', async ({ browser }) => {
  let posts = 0;
  const time = new Date('2026-09-08T12:00:00.000Z');
  const { page, context } = await openApp(browser, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      return json(route, { acknowledged: true, insertedId: 'retried-event' });
    }
    return json(route, []);
  }, { time });
  await seedEvent(page, { attemptCount: 1, nextAttemptMs: time.getTime() + 5000 });
  await page.reload();
  await expect(page.locator('#syncStatus')).toHaveText('Awaiting next retry window.');
  await page.clock.runFor(4999);
  expect(posts).toBe(0);
  expect((await readEvent(page)).syncState).toBe('unsynced');

  await page.clock.runFor(1);
  await expect.poll(async () => (await readEvent(page)).syncState).toBe('synced');
  expect((await readEvent(page)).serverId).toBe('retried-event');
  expect(posts).toBe(1);
  await context.close();
});

test('verification failures reach the retry limit and can later confirm manually without an author', async ({ browser }) => {
  let found = false;
  let posts = 0;
  const { page, context } = await openApp(browser, async (route) => {
    if (route.request().method() === 'POST') posts += 1;
    await json(route, found ? [serverRecord()] : { message: 'Unavailable' }, found ? 200 : 503);
  });
  await expect(page.locator('#syncStatus')).toHaveText('All caught up.');
  await expect(page.locator('#syncBtn')).toBeEnabled();
  // Keep automatic verification out of this manual-retry fixture.
  await seedEvent(page, {
    syncState: 'verify-pending', verifyAttemptCount: 5,
    verifyNextAttemptMs: Date.now() + 60_000
  });
  await page.evaluate(() => localStorage.removeItem('username'));
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).syncState).toBe('verify-failed');
  expect((await readEvent(page)).verifyAttemptCount).toBe(6);
  expect((await readEvent(page)).verifyNextAttemptMs).toBeNull();
  found = true;
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).syncState).toBe('synced');
  expect(posts).toBe(0);
  await context.close();
});

test('duplicate UUID matches require review instead of choosing a server record', async ({ browser }) => {
  let posts = 0;
  const { page, context } = await openApp(browser, async (route) => {
    if (route.request().method() === 'POST') posts += 1;
    await json(route, [serverRecord('duplicate-a'), serverRecord('duplicate-b')]);
  });
  await seedEvent(page, { syncState: 'verify-pending' });
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).syncState).toBe('verify-failed');
  expect((await readEvent(page)).serverId).toBeNull();
  expect((await readEvent(page)).lastError).toContain('Multiple server events');
  expect(posts).toBe(0);
  await context.close();
});

test('an edit made during UUID verification is patched without losing the new note', async ({ browser }) => {
  let releaseLookup;
  let notifyLookup;
  const lookupStarted = new Promise((resolve) => { notifyLookup = resolve; });
  const lookupRelease = new Promise((resolve) => { releaseLookup = resolve; });
  const patches = [];
  let posts = 0;
  const { page, context } = await openApp(browser, async (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postDataJSON());
      return json(route, { acknowledged: true, modifiedCount: 1 });
    }
    if (route.request().method() === 'POST') posts += 1;
    notifyLookup();
    await lookupRelease;
    return json(route, [serverRecord()]);
  });
  await seedEvent(page, { syncState: 'verify-pending' });
  await page.locator('#syncBtn').click();
  await lookupStarted;
  await page.evaluate(async () => {
    const { get, put } = await import(new URL('/src/db/indexed-db.js', location.href).href);
    const event = await get('events', 'capture-uuid');
    event.notes = 'Edited during verification';
    event.updatedAtMs += 1000;
    event.syncState = 'unsynced';
    await put('events', event);
  });
  releaseLookup();
  await expect.poll(async () => (await readEvent(page)).syncState).toBe('synced');
  expect((await readEvent(page)).notes).toBe('Edited during verification');
  expect(patches[0].event_free_text).toBe('Edited during verification');
  expect(posts).toBe(0);
  await context.close();
});

test('editing an accepted event before retry patches the UUID-matched server record', async ({ browser }) => {
  let visibleOnServer = false;
  let posts = 0;
  const patches = [];
  const { page, context } = await openApp(browser, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      return json(route, { acknowledged: true });
    }
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postDataJSON());
      return json(route, { acknowledged: true, modifiedCount: 1 });
    }
    return json(route, visibleOnServer ? [serverRecord()] : []);
  });
  await seedEvent(page);
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).verifyAttemptCount).toBe(1);
  await expect(page.locator('#syncBtn')).toBeEnabled();
  await page.locator('.event-summary').click();
  await page.locator('.edit-event').click();
  await page.locator('#eventEditorNotes').fill('Edited before retry');
  visibleOnServer = true;
  await page.locator('#eventEditorSave').click();
  await page.locator('#syncBtn').click();
  await expect.poll(async () => (await readEvent(page)).syncState).toBe('synced');
  expect((await readEvent(page)).notes).toBe('Edited before retry');
  expect((await readEvent(page)).serverId).toBe('confirmed-event');
  expect(patches[0].event_free_text).toBe('Edited before retry');
  expect(posts).toBe(1);
  await context.close();
});
