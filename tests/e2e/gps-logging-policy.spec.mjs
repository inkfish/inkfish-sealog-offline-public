import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const CLOCK_TIME = new Date('2026-09-12T12:00:00.000Z');
const GPS_OPTIONS = ['Latitude', 'Longitude', 'Accuracy'];
const GPS_RULES = { latitude: { source: 'lat' }, longitude: { source: 'lon' }, accuracy: { source: 'acc' } };
const TEMPLATES = [
  { id: 'tpl-gps', event_name: 'GPS Capture', event_value: 'GPS_CAPTURE', event_options: GPS_OPTIONS },
  { id: 'tpl-edit-gps', event_name: 'GPS On Edit', event_value: 'GPS_EDIT', event_options: GPS_OPTIONS },
  { id: 'tpl-note', event_name: 'Notes Only', event_value: 'NOTE', event_options: [] }
].map((template) => ({
  ...template,
  event_options: template.event_options.map((name) => ({
    event_option_name: name, event_option_type: 'text', event_option_required: false
  }))
}));
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

test.afterAll(async () => new Promise((resolveClosed) => server.close(resolveClosed)));

async function openApp(browser, { gps = {}, signedIn = true, frozen = false, savedPoorAccuracy = null } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(({ gps, signedIn, rules, savedPoorAccuracy }) => {
    if (signedIn) {
      localStorage.setItem('username', 'tester');
      localStorage.setItem('jwt', 'test-jwt');
    }
    if (savedPoorAccuracy !== null && localStorage.getItem('asnapAllowPoorAccuracy') === null) {
      localStorage.setItem('asnapAllowPoorAccuracy', savedPoorAccuracy);
    }
    localStorage.setItem('templateAutoFillRules', JSON.stringify(rules));
    window.testGps = { lat: 12.123456, lon: -68.654321, accuracy: 80, ageMs: 0, ...gps };
    window.testGpsPending = [];
    const readPosition = (success, error) => {
      const current = window.testGps;
      if (current.hold) {
        window.testGpsPending.push({ success, error });
        return;
      }
      if (current.unavailable) {
        error({ code: 2, POSITION_UNAVAILABLE: 2, message: 'Position unavailable' });
        return;
      }
      success({
        coords: { latitude: current.lat, longitude: current.lon, accuracy: current.accuracy },
        timestamp: Date.now() - current.ageMs
      });
    };
    window.releaseTestGps = () => {
      window.testGps.hold = false;
      const pending = window.testGpsPending.splice(0);
      pending.forEach(({ success, error }) => readPosition(success, error));
    };
    if (gps.unsupported) {
      delete Object.getPrototypeOf(navigator).geolocation;
      return;
    }
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: readPosition,
        watchPosition(success, error) { readPosition(success, error); return 1; },
        clearWatch() {}
      },
      configurable: true
    });
  }, {
    gps, signedIn, savedPoorAccuracy,
    rules: {
      'tpl-gps': { _lastSeenEventValue: 'GPS_CAPTURE', log: GPS_RULES, edit: {} },
      'tpl-edit-gps': { _lastSeenEventValue: 'GPS_EDIT', log: {}, edit: GPS_RULES },
      'tpl-note': { _lastSeenEventValue: 'NOTE', log: {}, edit: {} }
    }
  });
  const page = await context.newPage();
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  if (frozen) {
    await page.clock.install({ time: CLOCK_TIME });
    await page.clock.pauseAt(CLOCK_TIME);
  }
  await page.route('**/api/v1/**', async (route) => {
    const body = new URL(route.request().url()).pathname.endsWith('/event_templates') ? TEMPLATES : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(baseURL);
  if (signedIn) {
    await expect(page.locator('#type option', { hasText: /^GPS Capture$/ })).toHaveCount(1);
  } else {
    await expect(page.locator('#emptyState')).toBeVisible();
    await page.locator('#authCloseBtn').click();
  }
  await context.setOffline(true);
  return { page, context, dialogs };
}

async function readEvents(page) {
  return page.evaluate(async () => {
    const { getAll } = await import(new URL('/src/db/indexed-db.js', location.href).href);
    return getAll('events');
  });
}

function optionsOf(event) {
  return Object.fromEntries(event.option_values.map((option) => [option.event_option_name, option.event_option_value]));
}

async function setPoorGpsOverride(page, enabled) {
  await page.locator('#gpsStatus').click();
  await expect(page.locator('#gpsAllowPoorToggle')).toBeEnabled();
  await page.locator('#gpsAllowPoorToggle').setChecked(enabled);
  await page.locator('#gpsModalCloseBtn').click();
}

async function openFirstEditor(page, card = page.locator('#list .event-card').first()) {
  if (await card.locator('.event-summary').getAttribute('aria-expanded') !== 'true') {
    await card.locator('.event-summary').click();
  }
  await card.locator('.edit-event').click();
  await expect(page.locator('#eventEditor')).toBeVisible();
}

test('poor GPS blocks manual capture until the universal override is enabled with visible warnings', async ({ browser }) => {
  const { page, context, dialogs } = await openApp(browser);
  try {
    await page.locator('#type').selectOption({ label: 'GPS Capture' });
    await page.locator('#notes').fill('Station position');
    await page.locator('#captureBtn').click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toMatch(/GPS|accuracy/i);
    expect(await readEvents(page)).toHaveLength(0);
    await expect(page.locator('#notes')).toHaveValue('Station position');

    await page.locator('#gpsStatus').click();
    await expect(page.locator('#gpsAllowPoorToggle')).not.toBeChecked();
    await page.locator('#gpsAllowPoorToggle').check();
    await expect(page.locator('#fixWarning')).toContainText(/80|poor|accuracy/i);
    await page.locator('#gpsModalCloseBtn').click();
    await expect(page.locator('#gpsLoggingWarning')).toBeVisible();
    await expect(page.locator('#gpsLoggingWarning')).toContainText(/poor|accuracy/i);
    await page.locator('#captureBtn').click();
    await expect.poll(async () => (await readEvents(page)).length).toBe(1);
    const event = (await readEvents(page))[0];
    expect(event.notes).toBe('Station position');
    expect(optionsOf(event)).toMatchObject({ Latitude: '12.123456', Longitude: '-68.654321', Accuracy: '80' });
    expect(dialogs).toHaveLength(1);
    await expect(page.locator('#gpsLoggingWarning')).toBeVisible();
  } finally {
    await context.close();
  }
});

for (const lateFailure of [false, true]) {
  test(`canceling an edit isolates another event from a late GPS ${lateFailure ? 'error' : 'fix'}`, async ({ browser }) => {
    const { page, context, dialogs } = await openApp(browser, { gps: lateFailure ? { unavailable: true } : {} });
    try {
      await setPoorGpsOverride(page, true);
      await page.locator('#type').selectOption({ label: 'GPS On Edit' });
      await expect(page.locator('#optionFields input')).toHaveCount(3);
      for (const notes of ['First event', 'Second event']) {
        await page.locator('#notes').fill(notes);
        await page.locator('#captureBtn').click();
        await expect(page.locator('#list .event-card').filter({ hasText: notes })).toBeVisible();
      }
      const original = await readEvents(page);
      await page.evaluate(() => { window.testGps.hold = true; });
      await openFirstEditor(page, page.locator('#list .event-card').filter({ hasText: 'First event' }));
      await page.locator('#eventEditorNotes').fill('Canceled note must not transfer');
      await page.locator('#eventEditorSave').click();
      await expect.poll(() => page.evaluate(() => window.testGpsPending.length)).toBe(1);
      await page.locator('#eventEditorCancel').click();
      await openFirstEditor(page, page.locator('#list .event-card').filter({ hasText: 'Second event' }));
      await page.evaluate((lateFailure) => {
        if (lateFailure) window.testGps.unavailable = true;
        window.releaseTestGps();
      }, lateFailure);
      await expect(page.locator('#eventEditor')).toBeVisible();
      await expect(page.locator('#eventEditorNotes')).toHaveValue('Second event');
      expect(await readEvents(page)).toEqual(original);
      expect(dialogs).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

for (const action of ['disable', 'sign out']) {
  test(`ASNAP does not save a pending GPS request after ${action === 'disable' ? 'disabling logging' : 'signing out'}`, async ({ browser }) => {
    const { page, context } = await openApp(browser, { gps: { accuracy: 5 }, frozen: true });
    try {
      await page.locator('#asnapStatusTile').click();
      await page.locator('#asnapIntervalSelect').selectOption('60000');
      await page.locator('#asnapEnableToggle').check();
      await page.locator('#asnapModalCloseBtn').click();
      await page.evaluate(() => { window.testGps.hold = true; });
      await page.clock.runFor(10000);
      await expect.poll(() => page.evaluate(() => window.testGpsPending.length)).toBe(1);
      if (action === 'disable') {
        await page.locator('#asnapStatusTile').click();
        await page.locator('#asnapEnableToggle').uncheck();
        await page.locator('#asnapModalCloseBtn').click();
      } else {
        await page.locator('#menuBtn').click();
        await page.locator('#signOutBtn').click();
        expect(await page.evaluate(() => localStorage.getItem('jwt'))).toBeNull();
      }
      await page.evaluate(() => window.releaseTestGps());
      await page.clock.runFor(1000);
      expect(await readEvents(page)).toHaveLength(0);
      await expect(page.locator('#asnapStatusTile')).toContainText(/off/i);
    } finally {
      await context.close();
    }
  });
}

test('turning the override off while manual GPS capture is pending blocks the late poor fix', async ({ browser }) => {
  const { page, context, dialogs } = await openApp(browser);
  try {
    await setPoorGpsOverride(page, true);
    await page.locator('#type').selectOption({ label: 'GPS Capture' });
    await page.evaluate(() => { window.testGps.hold = true; });
    await page.locator('#captureBtn').click();
    await expect.poll(() => page.evaluate(() => window.testGpsPending.length)).toBe(1);
    await setPoorGpsOverride(page, false);
    await page.evaluate(() => window.releaseTestGps());
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toMatch(/accuracy/i);
    await expect(page.locator('#captureBtn')).toBeEnabled();
    expect(await readEvents(page)).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('a fresh fix at the 50 meter threshold can be captured without the override', async ({ browser }) => {
  const { page, context, dialogs } = await openApp(browser, { gps: { accuracy: 50 } });
  try {
    await page.locator('#type').selectOption({ label: 'GPS Capture' });
    await page.locator('#captureBtn').click();
    await expect.poll(async () => (await readEvents(page)).length).toBe(1);
    expect(optionsOf((await readEvents(page))[0]).Accuracy).toBe('50');
    expect(dialogs).toEqual([]);
  } finally {
    await context.close();
  }
});

test('edit GPS auto-fill is gated while filled values and later notes-only edits remain intact', async ({ browser }) => {
  const { page, context, dialogs } = await openApp(browser);
  try {
    await page.locator('#type').selectOption({ label: 'GPS On Edit' });
    const field = (name) => page.locator('#optionFields .option-field').filter({ has: page.locator('.option-label', { hasText: new RegExp(`^${name}$`) }) }).locator('input');
    await field('Latitude').fill('11.111111');
    await field('Accuracy').fill('7');
    await page.locator('#notes').fill('Before edit');
    await page.locator('#captureBtn').click();
    await expect.poll(async () => (await readEvents(page)).length).toBe(1);
    const original = (await readEvents(page))[0];

    await openFirstEditor(page);
    await page.locator('#eventEditorNotes').fill('Blocked GPS fill');
    await page.locator('#eventEditorSave').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await expect(page.locator('#eventEditor')).toBeVisible();
    expect((await readEvents(page))[0]).toEqual(original);
    await page.locator('#eventEditorCancel').click();

    await setPoorGpsOverride(page, true);
    await openFirstEditor(page);
    await page.locator('#eventEditorNotes').fill('Allowed GPS fill');
    await page.locator('#eventEditorSave').click();
    await expect(page.locator('#eventEditor')).toBeHidden();
    const edited = (await readEvents(page))[0];
    expect(edited.notes).toBe('Allowed GPS fill');
    expect(optionsOf(edited)).toMatchObject({ Latitude: '11.111111', Longitude: '-68.654321', Accuracy: '7' });

    await setPoorGpsOverride(page, false);
    await page.evaluate(() => { window.testGps.unavailable = true; });
    await openFirstEditor(page);
    await page.locator('#eventEditorNotes').fill('Notes updated with existing GPS');
    await page.locator('#eventEditorSave').click();
    await expect(page.locator('#eventEditor')).toBeHidden();
    const notesEdited = (await readEvents(page))[0];
    expect(notesEdited.notes).toBe('Notes updated with existing GPS');
    expect(optionsOf(notesEdited)).toMatchObject({ Latitude: '11.111111', Longitude: '-68.654321', Accuracy: '7' });
    expect(dialogs).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('automatic ASNAP obeys the same poor-accuracy override in both directions', async ({ browser }) => {
  const { page, context } = await openApp(browser, { frozen: true });
  try {
    await page.locator('#asnapStatusTile').click();
    await page.locator('#asnapIntervalSelect').selectOption('60000');
    await page.locator('#asnapEnableToggle').check();
    await page.locator('#asnapModalCloseBtn').click();
    await page.clock.runFor(30000);
    expect(await readEvents(page)).toHaveLength(0);
    await expect(page.locator('#asnapStatusTile')).toContainText(/paused/i);

    await setPoorGpsOverride(page, true);
    await page.clock.runFor(10000);
    await expect.poll(async () => (await readEvents(page)).length).toBe(1);
    const event = (await readEvents(page))[0];
    expect(event.type).toBe('ASNAP');
    expect(event.acc_m).toBe(80);
    await expect(page.locator('#gpsLoggingWarning')).toBeVisible();

    await setPoorGpsOverride(page, false);
    await page.clock.runFor(60000);
    expect(await readEvents(page)).toHaveLength(1);
    await expect(page.locator('#asnapStatusTile')).toContainText(/paused/i);
  } finally {
    await context.close();
  }
});

test('the override is available signed out and persists after reload', async ({ browser }) => {
  const { page, context } = await openApp(browser, { signedIn: false, gps: { accuracy: 5 } });
  try {
    await setPoorGpsOverride(page, true);
    expect(await page.evaluate(() => localStorage.getItem('jwt'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('asnapAllowPoorAccuracy'))).toBe('1');
    await expect(page.locator('#gpsLoggingWarning')).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await expect(page.locator('#emptyState')).toBeVisible();
    await page.locator('#authCloseBtn').click();
    await context.setOffline(true);
    await page.locator('#gpsStatus').click();
    await expect(page.locator('#gpsAllowPoorToggle')).toBeEnabled();
    await expect(page.locator('#gpsAllowPoorToggle')).toBeChecked();
    await page.locator('#gpsAllowPoorToggle').uncheck();
    expect(await page.evaluate(() => localStorage.getItem('asnapAllowPoorAccuracy'))).toBe('0');
  } finally {
    await context.close();
  }
});

for (const [description, gps] of [
  ['unavailable', { unavailable: true }],
  ['unsupported', { unsupported: true }]
]) {
  test(`the saved override is restored and can be disabled when GPS is ${description} at startup`, async ({ browser }) => {
    const { page, context } = await openApp(browser, { gps, signedIn: false, savedPoorAccuracy: '1' });
    try {
      if (gps.unsupported) {
        expect(await page.evaluate(() => 'geolocation' in navigator)).toBe(false);
      }
      await expect(page.locator('#gpsLoggingWarning')).toBeVisible();
      await expect(page.locator('#gpsLoggingWarning')).toContainText('Poor-accuracy GPS logging is enabled');
      await expect(page.locator('#gpsLoggingWarning')).toContainText('No valid GPS position');
      await page.locator('#gpsStatus').click();
      await expect(page.locator('#gpsAllowPoorToggle')).toBeEnabled();
      await expect(page.locator('#gpsAllowPoorToggle')).toBeChecked();
      await page.locator('#gpsAllowPoorToggle').uncheck();
      expect(await page.evaluate(() => localStorage.getItem('asnapAllowPoorAccuracy'))).toBe('0');
      await expect(page.locator('#gpsLoggingWarning')).toBeHidden();

      await context.setOffline(false);
      await page.reload();
      await expect(page.locator('#emptyState')).toBeVisible();
      await page.locator('#authCloseBtn').click();
      await context.setOffline(true);
      await page.locator('#gpsStatus').click();
      await expect(page.locator('#gpsAllowPoorToggle')).toBeEnabled();
      await expect(page.locator('#gpsAllowPoorToggle')).not.toBeChecked();
      expect(await page.evaluate(() => localStorage.getItem('asnapAllowPoorAccuracy'))).toBe('0');
      await expect(page.locator('#gpsLoggingWarning')).toBeHidden();
    } finally {
      await context.close();
    }
  });
}

for (const [description, gps] of [
  ['missing', { unavailable: true }],
  ['invalid coordinates', { lat: 91 }],
  ['invalid accuracy', { accuracy: -1 }],
  ['older than five minutes', { ageMs: 300001 }]
]) {
  test(`the override rejects GPS fixes that are ${description} for capture and ASNAP`, async ({ browser }) => {
    const { page, context, dialogs } = await openApp(browser, { gps, frozen: true });
    try {
      await setPoorGpsOverride(page, true);
      await page.locator('#type').selectOption({ label: 'GPS Capture' });
      await page.locator('#captureBtn').click();
      await expect.poll(() => dialogs.length).toBe(1);
      expect(await readEvents(page)).toHaveLength(0);

      await page.locator('#asnapStatusTile').click();
      await page.locator('#asnapIntervalSelect').selectOption('60000');
      await page.locator('#asnapEnableToggle').check();
      await page.locator('#asnapModalCloseBtn').click();
      await page.clock.runFor(60000);
      expect(await readEvents(page)).toHaveLength(0);
      await expect(page.locator('#asnapStatusTile')).toContainText(/paused/i);

      await page.locator('#type').selectOption({ label: 'Notes Only' });
      await page.clock.runFor(250);
      await expect(page.locator('#optionFields .option-field')).toHaveCount(0);
      await page.locator('#notes').fill('Can still record an observation');
      await page.locator('#captureBtn').click();
      await expect.poll(async () => (await readEvents(page)).length).toBe(1);
      expect((await readEvents(page))[0].notes).toBe('Can still record an observation');
      expect(dialogs).toHaveLength(1);
    } finally {
      await context.close();
    }
  });
}
