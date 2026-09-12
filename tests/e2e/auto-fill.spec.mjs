import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

test('capture and edits resolve saved rules, preserve filled values, and upload their options', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const postedBodies = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const captureUtc = '2026-09-08T12:00:00.000Z';
  const firstEditUtc = '2026-09-08T12:00:01.000Z';
  const secondEditUtc = '2026-09-08T12:00:02.000Z';
  await page.clock.setFixedTime(new Date(captureUtc));
  await page.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'test-jwt');
    localStorage.setItem('templateAutoFillRules', JSON.stringify({
      'tpl-bruv': {
        _lastSeenEventValue: 'BRUV',
        log: {
          'time in': { source: 'now_utc' },
          latitude: { source: 'lat' },
          longitude: { source: 'lon' }
        },
        edit: { 'time out': { source: 'now_utc' } }
      }
    }));
    const position = () => ({
      coords: { latitude: 12.123456, longitude: -68.654321, accuracy: 5 },
      timestamp: Date.now()
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition(success) { success(position()); },
        watchPosition(success) { success(position()); return 1; },
        clearWatch() {}
      },
      configurable: true
    });
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let body = [];
    if (pathname.endsWith('/event_templates')) {
      body = [{
        id: 'tpl-bruv',
        event_name: 'BRUV',
        event_value: 'BRUV',
        event_options: ['Time In', 'Time Out', 'Latitude', 'Longitude'].map((name) => ({
          event_option_name: name,
          event_option_type: 'text',
          event_option_required: false
        }))
      }];
    } else if (pathname.endsWith('/events') && request.method() === 'POST') {
      postedBodies.push(request.postDataJSON());
      body = { acknowledged: true, insertedId: 'srv-bruv' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  try {
    await page.goto(baseURL);
    await expect(page.locator('#type option', { hasText: 'BRUV' })).toHaveCount(1);
    await page.locator('#type').selectOption({ label: 'BRUV' });
    await context.setOffline(true);
    await page.locator('#captureBtn').click();
    const card = page.locator('#list .event-card').first();
    await expect(card).toBeVisible();

    const readEvent = () => page.evaluate(async () => {
      const { getAll } = await import(new URL('/src/db/indexed-db.js', location.href).href);
      const { EVENT_STORE } = await import(new URL('/src/config/constants.js', location.href).href);
      return (await getAll(EVENT_STORE))[0];
    });
    const optionsOf = (event) => Object.fromEntries(
      event.option_values.map((option) => [option.event_option_name, option.event_option_value])
    );
    const captured = await readEvent();
    expect(optionsOf(captured)).toMatchObject({
      'Time In': captureUtc,
      Latitude: '12.123456',
      Longitude: '-68.654321'
    });
    expect(optionsOf(captured)['Time Out'] || '').toBe('');

    await page.clock.setFixedTime(new Date(firstEditUtc));
    await card.locator('.event-summary').click();
    await card.locator('.edit-event').click();
    await page.locator('#eventEditorNotes').fill('recovered');
    await page.locator('#eventEditorSave').click();
    await expect(page.locator('#eventEditor')).toBeHidden();
    const edited = await readEvent();
    expect(optionsOf(edited)['Time In']).toBe(captureUtc);
    expect(optionsOf(edited)['Time Out']).toBe(firstEditUtc);

    await page.clock.setFixedTime(new Date(secondEditUtc));
    if (await card.locator('.event-summary').getAttribute('aria-expanded') !== 'true') {
      await card.locator('.event-summary').click();
    }
    await card.locator('.edit-event').click();
    await page.locator('#eventEditorNotes').fill('recovered and checked');
    await page.locator('#eventEditorSave').click();
    await expect(page.locator('#eventEditor')).toBeHidden();
    const reedited = await readEvent();
    expect(reedited.notes).toBe('recovered and checked');
    expect(optionsOf(reedited)['Time In']).toBe(captureUtc);
    expect(optionsOf(reedited)['Time Out']).toBe(firstEditUtc);

    await page.locator('button.filter-chip[data-filter="all"]').click();
    await context.setOffline(false);
    await page.locator('#syncBtn').click();
    await expect(card).toHaveAttribute('data-sync-state', 'synced');
    expect(postedBodies).toHaveLength(1);
    expect(Object.fromEntries(postedBodies[0].event_options.map((option) => [
      option.event_option_name, option.event_option_value
    ]))).toMatchObject({
      'Time In': captureUtc,
      'Time Out': firstEditUtc,
      Latitude: '12.123456',
      Longitude: '-68.654321'
    });
    expect(postedBodies[0].event_free_text).toBe('recovered and checked');
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
