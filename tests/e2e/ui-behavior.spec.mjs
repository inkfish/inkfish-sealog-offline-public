/** Browser coverage for themes, settings, authentication, GPS, and auto-fill rules. */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { PHOSPHOR_ICON_HREFS } from '../../src/ui/html-utils.js';

let server;
let baseURL;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

test.beforeAll(async () => {
  const root = resolve(import.meta.dirname, '..', '..');
  server = createServer(async (req, res) => {
    let url = req.url.split('?')[0];
    if (url === '/' || url === '') url = '/index.html';
    const filePath = join(root, url);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = url.slice(url.lastIndexOf('.'));
    const mime = MIME[ext] || 'application/octet-stream';
    const body = await readFile(filePath);
    res.setHeader('Content-Type', mime);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  baseURL = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await new Promise((r) => server.close(r));
});

/**
 * Create an isolated page with a chosen system theme, storage seed, and error log.
 * @param {import('@playwright/test').Browser} browser - Playwright browser instance.
 * @param {object} [opts] - Setup options for the new context.
 * @param {'light'|'dark'} [opts.colorScheme] - System theme to emulate.
 * @param {object|null} [opts.seed] - Extra `localStorage` key/value pairs to seed before navigation.
 * @param {boolean} [opts.signedIn] - When true (default), pre-seeds `username`+`jwt` so
 *   `app.js`'s auto-open-settings path doesn't overlay the page.
 * @returns {Promise<{ctx: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page, consoleErrors: string[]}>} Context, page, and error array.
 */
async function freshPage(browser, { colorScheme = 'light', seed = null, signedIn = true } = {}) {
  const ctx = await browser.newContext({ colorScheme });
  // The signed-in seed prevents the sign-in prompt from covering other controls.
  const baseSeed = signedIn ? { username: 'tester', jwt: 'fake-jwt-for-test' } : {};
  const finalSeed = { ...baseSeed, ...(seed || {}) };
  if (Object.keys(finalSeed).length) {
    await ctx.addInitScript((data) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, finalSeed);
  }
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });
  return { ctx, page, consoleErrors };
}

test('saved presets restore their current names', async ({ browser }) => {
  for (const preset of ['light', 'honey', 'ocean']) {
    const { page, ctx } = await freshPage(browser, { seed: { 'sealog.preset': preset } });
    await page.goto(`${baseURL}/index.html`);
    await page.waitForLoadState('domcontentloaded');
    expect(await page.evaluate(() => document.documentElement.dataset.preset)).toBe(preset);
    expect(await page.evaluate(() => localStorage.getItem('sealog.preset'))).toBe(preset);
    await ctx.close();
  }
});

test('cold boot, no stored preset, system light → light', async ({ browser }) => {
  const { page, consoleErrors } = await freshPage(browser, { colorScheme: 'light', signedIn: false });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  const preset = await page.evaluate(() => document.documentElement.dataset.preset);
  expect(preset).toBe('light');
  const stored = await page.evaluate(() => localStorage.getItem('sealog.preset'));
  expect(stored).toBeNull();
  expect(consoleErrors.filter((e) => !e.includes('manifest') && !e.includes('favicon'))).toEqual([]);
});

test('cold boot, no stored preset, system dark → ocean', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'dark', signedIn: false });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  const preset = await page.evaluate(() => document.documentElement.dataset.preset);
  expect(preset).toBe('ocean');
});

test('once user picks a preset, OS theme flip is ignored', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await openThemePicker(page);
  await page.locator('.preset-swatch[data-preset-id="honey"]').click();
  // View transitions defer theme writes to the DOM.
  await page.waitForFunction(() => document.documentElement.dataset.preset === 'honey');
  expect(await page.evaluate(() => localStorage.getItem('sealog.preset'))).toBe('honey');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.documentElement.dataset.preset)).toBe('honey');
});

test('three preset rows, correct order, Light checked when stored', async ({ browser }) => {
  const { page } = await freshPage(browser, { seed: { 'sealog.preset': 'light' } });
  await page.goto(`${baseURL}/index.html`);
  await openThemePicker(page);
  const labels = await page.locator('.preset-swatch .ps-label').allTextContents();
  expect(labels).toEqual(['Light', 'Honey', 'Ocean']);
  const checked = await page.locator('.preset-swatch[aria-checked="true"]').count();
  expect(checked).toBe(1);
  const checkedLabel = await page.locator('.preset-swatch[aria-checked="true"] .ps-label').textContent();
  expect(checkedLabel).toBe('Light');
});

test('picker click flips CSS variables and updates meta theme-color live', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await openThemePicker(page);

  const lightBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  expect(lightBg.toLowerCase()).toBe('#f5f3f0');

  await page.locator('.preset-swatch[data-preset-id="ocean"]').click();
  // View transitions defer theme writes to the DOM.
  await expect
    .poll(async () =>
      (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toLowerCase()
    )
    .toBe('#0a0e14');

  const metaContent = await page.locator('meta[name="theme-color"][data-dynamic="true"]').getAttribute('content');
  expect(metaContent?.toLowerCase()).toBe('#0a0e14');
});

test('preset choice restores the same palette after reload and on the landing page', async ({ browser }) => {
  const { ctx, page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  for (const preset of ['honey', 'ocean', 'light']) {
    await openThemePicker(page);
    await page.locator(`.preset-swatch[data-preset-id="${preset}"]`).click();
    await page.waitForFunction((id) => document.documentElement.dataset.preset === id, preset);
    const readPalette = () => page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ['--bg', '--accent', '--accent-fg', '--accent-soft'].map((token) => style.getPropertyValue(token).trim());
    });
    const selectedPalette = await readPalette();
    expect(await page.evaluate(() => localStorage.getItem('sealog.preset'))).toBe(preset);
    expect(await page.evaluate(() => localStorage.getItem('sealog.accent'))).toBeNull();

    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.preset)).toBe(preset);
    expect(await readPalette()).toEqual(selectedPalette);

    await page.goto(`${baseURL}/landing.html`);
    expect(await page.evaluate(() => document.documentElement.dataset.preset)).toBe(preset);
    expect(await readPalette()).toEqual(selectedPalette);
    await page.goto(`${baseURL}/index.html`);
  }
  await ctx.close();
});

test('backfill controls persist toggle + allowlist across reload (via ASNAP modal)', async ({ browser }) => {
  const { page } = await freshPage(browser, {
    seed: { username: 'tester', jwt: 'fake-jwt-for-test' }
  });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForFunction(() => !!document.getElementById('asnapBackfillToggle'));
  await openAsnapModal(page);
  const toggle = page.locator('#asnapBackfillToggle');
  const allow = page.locator('#asnapBackfillAllowlist');
  await toggle.check();
  await allow.fill('CTD_START\nNOTE');
  await allow.blur();
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('asnapBackfillToggle'));
  await openAsnapModal(page);
  await expect(page.locator('#asnapBackfillToggle')).toBeChecked();
  await expect(page.locator('#asnapBackfillAllowlist')).toHaveValue('CTD_START\nNOTE');
});

test('Phosphor sprite icons render with their inherited text color', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((spriteHref) => {
    const NS = 'http://www.w3.org/2000/svg';
    const div = document.createElement('div');
    div.id = 'ph-probe';
    div.style.fontSize = '16px';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ph ph-check-circle ui-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('viewBox', '0 0 256 256');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    const use = document.createElementNS(NS, 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', spriteHref);
    use.setAttribute('href', spriteHref);
    svg.appendChild(use);
    div.appendChild(svg);
    document.body.appendChild(div);
  }, PHOSPHOR_ICON_HREFS['check-circle']);
  const svgStyle = await page.locator('#ph-probe svg.ph').evaluate((el) => {
    const style = getComputedStyle(el);
    return { fill: style.fill, color: style.color, stroke: style.stroke, width: style.width };
  });
  expect(svgStyle.fill).toBe(svgStyle.color);
  expect(svgStyle.stroke).toBe('none');
  expect(svgStyle.width).toBe('16px');
  // Nonempty geometry confirms that external symbols loaded as well as their styles.
  for (const selector of ['#ph-probe use', '#menuBtn svg use']) {
    await expect.poll(() => page.locator(selector).evaluate((el) => {
      const bounds = el.getBBox();
      return bounds.width > 0 && bounds.height > 0;
    })).toBe(true);
  }
  await page.goto(`${baseURL}/landing.html`);
  await expect.poll(() => page.locator('.chev svg use').evaluateAll((icons) =>
    icons.length === 3 && icons.every((el) => {
      const bounds = el.getBBox();
      return bounds.width > 0 && bounds.height > 0;
    })
  )).toBe(true);
});

test('settings open and close with the page scroll lock', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#menuBtn').click();
  await expect(page.locator('#authPanel')).toBeVisible();
  const htmlHasModal = await page.evaluate(() => document.documentElement.classList.contains('modal-open'));
  expect(htmlHasModal).toBe(true);
  await page.locator('#authCloseBtn').click();
  await expect(page.locator('#authPanel')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.classList.contains('modal-open'))).toBe(false);
});

test('GPS readout default text is "No GPS fix"', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  const fixText = await page.locator('#fixSummary').textContent();
  expect(fixText).toBe('No GPS fix');
});

test('landing page reads sealog.preset and applies data-preset attribute', async ({ browser }) => {
  const { page } = await freshPage(browser, { seed: { 'sealog.preset': 'ocean' } });
  await page.goto(`${baseURL}/landing.html`);
  await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => document.documentElement.dataset.preset)).toBe('ocean');
  const metaContent = await page.locator('meta[name="theme-color"]').getAttribute('content');
  expect(metaContent?.toLowerCase()).toBe('#0a0e14');
});

test('preset selection updates the browser color scheme', async ({ browser }) => {
  const { ctx, page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await openThemePicker(page);
  for (const [preset, scheme] of [['honey', 'dark'], ['light', 'light'], ['ocean', 'dark']]) {
    await page.locator(`.preset-swatch[data-preset-id="${preset}"]`).click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(scheme);
  }
  await ctx.close();
});

test('every preset paints body bg + accent + accent-fg correctly', async ({ browser }) => {
  const presets = [
    { id: 'light', bg: '#f5f3f0', accent: '#4a6fa5', accentFg: '#ffffff' },
    { id: 'honey',     bg: '#0a0a0a', accent: '#d4a574', accentFg: '#0a0a0a' },
    { id: 'ocean',    bg: '#0a0e14', accent: '#5ba4cf', accentFg: '#0a0e14' }
  ];
  for (const p of presets) {
    const { page, ctx } = await freshPage(browser, { seed: { 'sealog.preset': p.id } });
    await page.goto(`${baseURL}/index.html`);
    await page.waitForLoadState('domcontentloaded');
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    const accentFg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-fg').trim());
    expect(bg.toLowerCase(), `preset ${p.id} --bg`).toBe(p.bg);
    expect(accent.toLowerCase(), `preset ${p.id} --accent`).toBe(p.accent);
    expect(accentFg.toLowerCase(), `preset ${p.id} --accent-fg`).toBe(p.accentFg);
    await ctx.close();
  }
});

test('dark preset inputs use --surface-2 background (data-preset selector wins)', async ({ browser }) => {
  // The notes field remains visible when the sign-in fields are hidden.
  async function bgOf(preset) {
    const { page, ctx } = await freshPage(browser, { seed: { 'sealog.preset': preset } });
    await page.goto(`${baseURL}/index.html`);
    await page.waitForSelector('#notes');
    const color = await page.locator('#notes').evaluate((el) => getComputedStyle(el).backgroundColor);
    await ctx.close();
    return color;
  }
  expect(await bgOf('honey')).toBe('rgb(26, 26, 26)');
  expect(await bgOf('ocean')).toBe('rgb(26, 34, 44)');
  expect(await bgOf('light')).toBe('rgb(255, 255, 255)');
});

test('signed-out users can change the universal GPS policy while backfill controls stay disabled', async ({ browser }) => {
  const { page, ctx } = await freshPage(browser, { signedIn: false });
  await page.goto(`${baseURL}/index.html`);
  // The sign-in prompt covers the ASNAP status tile on a fresh profile.
  await page.waitForSelector('#asnapBackfillToggle', { state: 'attached' });
  if (await page.locator('#authPanel').isVisible()) await page.locator('#authCloseBtn').click();
  await openAsnapModal(page);
  await expect(page.locator('#asnapBackfillToggle')).toBeDisabled();
  await expect(page.locator('#asnapBackfillAllowlist')).toBeDisabled();
  await page.locator('#asnapModalCloseBtn').click();
  await openGpsModal(page);
  await expect(page.locator('#gpsModal #gpsAllowPoorToggle')).toBeVisible();
  await expect(page.locator('#gpsModal #gpsAllowPoorToggle')).toBeEnabled();
  await ctx.close();
});

test('signed-in card meta line variants (regular vs guest vs unset)', async ({ browser }) => {
  const { page: p1, ctx: ctx1 } = await freshPage(browser, { seed: { username: 'alice', jwt: 't' } });
  await p1.goto(`${baseURL}/index.html`);
  await p1.locator('#menuBtn').click();
  await expect(p1.locator('#signedInMeta')).toHaveText('Signed in to Sealog');
  await expect(p1.locator('#signedInAvatar')).toHaveText('A');
  await expect(p1.locator('#signedInUser')).toHaveText('alice');
  await ctx1.close();

  // Guest sessions use the same account layout as named users.
  const { page: p2, ctx: ctx2 } = await freshPage(browser, { seed: { username: 'guest' } });
  await p2.goto(`${baseURL}/index.html`);
  await p2.locator('#menuBtn').click();
  await expect(p2.locator('#signedInMeta')).toHaveText('Signed in to Sealog');
  await expect(p2.locator('#signedInAvatar')).toHaveText('G');
  await ctx2.close();

  // Signed-out sessions show the sign-in fields instead of the account card.
  const { page: p3, ctx: ctx3 } = await freshPage(browser, { signedIn: false });
  await p3.goto(`${baseURL}/index.html`);
  await p3.waitForLoadState('domcontentloaded');
  await expect(p3.locator('#signedInActions')).toBeHidden();
  await expect(p3.locator('#loginFields')).toBeVisible();
  await ctx3.close();
});

test('zero JS errors on theme switch and modal open/close', async ({ browser }) => {
  const { page, consoleErrors } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await openThemePicker(page);
  for (const id of ['honey', 'ocean', 'light']) {
    await page.locator(`.preset-swatch[data-preset-id="${id}"]`).click();
  }
  await page.locator('#authCloseBtn').click();
  await page.locator('#menuBtn').click();
  await page.locator('#authCloseBtn').click();
  await page.waitForTimeout(250);
  expect(consoleErrors.filter((e) => e.startsWith('pageerror:'))).toEqual([]);
});

test('no broken static-asset requests during page load (404s on real files)', async ({ browser }) => {
  // API requests return 404 because this server only serves static files.
  const ctx = await browser.newContext({ colorScheme: 'light' });
  await ctx.addInitScript(() => { localStorage.setItem('username', 'tester'); localStorage.setItem('jwt', 't'); });
  const page = await ctx.newPage();
  const badResponses = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.startsWith(baseURL) && !u.includes('/sealog-server/')) {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${u}`);
    }
  });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('networkidle');
  expect(badResponses).toEqual([]);
});

test('no horizontal scroll at iPhone SE viewport (375px)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, colorScheme: 'light' });
  await ctx.addInitScript(() => { localStorage.setItem('username', 'tester'); localStorage.setItem('jwt', 't'); });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
});

test('tap targets meet the 44pt minimum: log event, filter chip, status tile, preset swatch', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  const captureH = await page.locator('#captureBtn').evaluate((el) => el.getBoundingClientRect().height);
  expect(captureH).toBeGreaterThanOrEqual(44);
  const chipH = await page.locator('.filter-chip').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(chipH).toBeGreaterThanOrEqual(44);
  const statusH = await page.locator('#connectStatus').evaluate((el) => el.getBoundingClientRect().height);
  expect(statusH).toBeGreaterThanOrEqual(44);
  await openThemePicker(page);
  const swatchH = await page.locator('.preset-swatch').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(swatchH).toBeGreaterThanOrEqual(44);
  const summaryH = await page.locator('details[data-section="theme"] > summary').evaluate((el) => el.getBoundingClientRect().height);
  expect(summaryH).toBeGreaterThanOrEqual(44);
});

test('a captured event expands and collapses through its actual SVG chevron', async ({ browser }) => {
  const { page, ctx } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#emptyState').waitFor({ state: 'visible' });
  await ctx.setOffline(true);
  await page.locator('#type').selectOption('fallback-note');
  await page.locator('#notes').fill('Accordion capture');
  await page.locator('#captureBtn').click();
  const card = page.locator('#list .event-card').first();
  await expect(card).toHaveAttribute('data-sync-state', 'unsynced');
  await card.locator('.event-chevron svg').click();
  await expect(card).toHaveAttribute('data-expanded', 'true');
  await expect(card.locator('.event-summary')).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.event-detail')).toBeVisible();
  await expect.poll(() => card.locator('.event-chevron').evaluate((el) => getComputedStyle(el).transform))
    .toBe('matrix(-1, 0, 0, -1, 0, 0)');
  await card.locator('.event-chevron svg').click();
  await expect(card).toHaveAttribute('data-expanded', 'false');
  await expect(card.locator('.event-detail')).toBeHidden();
  await ctx.close();
});

test('every status tile has data-state and renders a colored ::before dot', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  for (const id of ['connectStatus', 'gpsStatus', 'asnapStatusTile', 'queueInfo']) {
    const hasState = await page.locator(`#${id}`).evaluate((el) => el.hasAttribute('data-state'));
    expect(hasState, `#${id} should have data-state`).toBe(true);
    const beforeBg = await page.locator(`#${id}`).evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
    expect(beforeBg, `#${id} ::before should render`).not.toBe('rgba(0, 0, 0, 0)');
  }
});

/**
 * Open the Settings modal (if not already open) and expand a settings accordion
 * section so its inner controls are visible and interactive.
 * @param {import('@playwright/test').Page} page - Page to operate on.
 * @param {string} section - Value of the `data-section` attribute (data/autofill/theme).
 */
async function openSettingsSection(page, section) {
  if (await page.locator('#authPanel').isHidden()) {
    await page.locator('#menuBtn').click();
  }
  await page.evaluate((s) => {
    const d = document.querySelector(`details[data-section="${s}"]`);
    if (d) d.open = true;
  }, section);
}

/**
 * Open the theme preset picker.
 * @param {import('@playwright/test').Page} page - Page to operate on.
 */
async function openThemePicker(page) {
  await openSettingsSection(page, 'theme');
  await page.waitForSelector('.preset-swatch', { state: 'visible' });
}

/**
 * Open the ASNAP diagnostic modal by tapping the ASNAP status tile in the strip.
 * Logging, display, interval, and Backfill controls live inside this modal.
 * @param {import('@playwright/test').Page} page - Page to operate on.
 */
async function openAsnapModal(page) {
  await page.locator('#asnapStatusTile').click();
  await page.waitForSelector('#asnapModal:not([hidden])');
}

/**
 * Open the GPS diagnostic modal by tapping the GPS status tile.
 * GPS readouts and the poor-accuracy logging setting live inside this modal.
 * @param {import('@playwright/test').Page} page - Page to operate on.
 */
async function openGpsModal(page) {
  await page.locator('#gpsStatus').click();
  await page.waitForSelector('#gpsModal:not([hidden])');
}

/**
 * Stub a successful sign-in and empty API results for subsequent refreshes.
 * @param {import('@playwright/test').Page} page - Playwright page to install the route on.
 */
async function stubAuthEndpoint(page) {
  await page.route(/\/api\/v1\//, async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/login')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'stub-jwt', id: 'stub-user-id' })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('guest sign-in flow updates the signed-in card', async ({ browser }) => {
  const { page } = await freshPage(browser, { signedIn: false });
  await stubAuthEndpoint(page);
  await page.goto(`${baseURL}/index.html`);
  await page.waitForFunction(() => {
    const el = document.getElementById('authPanel');
    return el && !el.hidden;
  });
  await expect(page.locator('#guestBtn')).toBeVisible();
  await page.locator('#guestBtn').click();
  await page.waitForFunction(() => localStorage.getItem('username') === 'guest', { timeout: 5000 });
  if (await page.locator('#authPanel').isHidden()) {
    await page.locator('#menuBtn').click();
  }
  await expect(page.locator('#signedInActions')).toBeVisible();
  await expect(page.locator('#signedInMeta')).toHaveText('Signed in to Sealog');
  await expect(page.locator('#signedInAvatar')).toHaveText('G');
});

test('username/password sign-in flow updates the signed-in card', async ({ browser }) => {
  const { page } = await freshPage(browser, { signedIn: false });
  await stubAuthEndpoint(page);
  await page.goto(`${baseURL}/index.html`);
  await page.waitForFunction(() => {
    const el = document.getElementById('authPanel');
    return el && !el.hidden;
  });
  await page.locator('#user').fill('alice');
  await page.locator('#pass').fill('hunter2');
  await page.locator('#loginBtn').click();
  await page.waitForFunction(() => localStorage.getItem('username') === 'alice', { timeout: 5000 });
  if (await page.locator('#authPanel').isHidden()) {
    await page.locator('#menuBtn').click();
  }
  await expect(page.locator('#signedInUser')).toHaveText('alice');
  await expect(page.locator('#signedInMeta')).toHaveText('Signed in to Sealog');
  await expect(page.locator('#signedInAvatar')).toHaveText('A');
});

test('clicking Clear Cached Events opens the confirm modal', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light' });
  await page.goto(`${baseURL}/index.html`);
  await openSettingsSection(page, 'data');
  await page.locator('#clearSyncedBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible({ timeout: 5000 });
  await page.locator('#confirmModalCancel').click();
  await expect(page.locator('#confirmModal')).toBeHidden();
});

test('manifest.webmanifest is reachable and valid JSON with required PWA fields', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const resp = await page.goto(`${baseURL}/manifest.webmanifest`);
  expect(resp?.status()).toBe(200);
  const text = await resp.text();
  const manifest = JSON.parse(text);
  expect(manifest.name || manifest.short_name, 'manifest must have name or short_name').toBeTruthy();
  expect(manifest.start_url, 'manifest must have start_url').toBeTruthy();
  expect(manifest.display, 'manifest must have display mode').toBeTruthy();
  expect(Array.isArray(manifest.icons) && manifest.icons.length, 'manifest must declare icons').toBeTruthy();
});

test('viewport responsive at 540px and below: status strip drops to 2 columns; form-row stacks at 460px', async ({ browser }) => {
  const ctx1 = await browser.newContext({ viewport: { width: 540, height: 800 } });
  await ctx1.addInitScript(() => { localStorage.setItem('username','t'); localStorage.setItem('jwt','t'); });
  const p1 = await ctx1.newPage();
  await p1.goto(`${baseURL}/index.html`);
  const cols540 = await p1.locator('.status-strip').evaluate((el) => {
    const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean);
    return tracks.length;
  });
  expect(cols540).toBe(2);
  await ctx1.close();

  const ctx2 = await browser.newContext({ viewport: { width: 600, height: 800 } });
  await ctx2.addInitScript(() => { localStorage.setItem('username','t'); localStorage.setItem('jwt','t'); });
  const p2 = await ctx2.newPage();
  await p2.goto(`${baseURL}/index.html`);
  const cols600 = await p2.locator('.status-strip').evaluate((el) => {
    const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean);
    return tracks.length;
  });
  expect(cols600).toBe(4);
  await ctx2.close();

  const ctx3 = await browser.newContext({ viewport: { width: 400, height: 800 } });
  await ctx3.addInitScript(() => { localStorage.setItem('username','t'); localStorage.setItem('jwt','t'); });
  const p3 = await ctx3.newPage();
  await p3.goto(`${baseURL}/index.html`);
  const formCols = await p3.locator('.form-row').first().evaluate((el) => {
    const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean);
    return tracks.length;
  });
  expect(formCols).toBe(1);
  await ctx3.close();
});

test('every preset paints without unstyled `--*` placeholders (all tokens resolve)', async ({ browser }) => {
  const tokens = ['--bg', '--surface', '--surface-2', '--ink', '--ink-2', '--mute', '--line', '--line-strong', '--accent', '--accent-bright', '--accent-dim', '--accent-fg', '--accent-soft', '--ok', '--warn', '--alert', '--run'];
  for (const id of ['light', 'honey', 'ocean']) {
    const { page, ctx } = await freshPage(browser, { seed: { 'sealog.preset': id } });
    await page.goto(`${baseURL}/index.html`);
    await page.waitForLoadState('domcontentloaded');
    const values = await page.evaluate((tks) => {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const out = {};
      for (const t of tks) out[t] = cs.getPropertyValue(t).trim();
      return out;
    }, tokens);
    for (const t of tokens) {
      expect(values[t], `preset ${id} token ${t} must be defined`).toBeTruthy();
    }
    await ctx.close();
  }
});

test('settings modal scrolls when content exceeds viewport; version footer stays stuck', async ({ browser }) => {
  // The short viewport forces the expanded settings content to scroll.
  const ctx = await browser.newContext({ viewport: { width: 400, height: 500 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('username','t');
    localStorage.setItem('jwt','t');
    localStorage.setItem('sealog.settings.accordion', JSON.stringify({ data: true, autofill: true, theme: true }));
  });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#menuBtn').click();
  await expect(page.locator('#authPanel')).toBeVisible();
  const scrollable = await page.locator('.auth-body').evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY
  }));
  expect(scrollable.overflowY).toBe('auto');
  expect(scrollable.scrollH).toBeGreaterThan(scrollable.clientH);
  await expect(page.locator('.settings-footer')).toBeVisible();
  await ctx.close();
});

test('when signed in, the .auth-form does not add phantom padding above the signed-in card', async ({ browser }) => {
  // Hidden sign-in fields must not reserve space above the account card.
  const { page } = await freshPage(browser, { seed: { username: 'alice', jwt: 't' } });
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#menuBtn').click();
  await expect(page.locator('#signedInActions')).toBeVisible();
  const authFormRect = await page.locator('#authForm').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, height: el.getBoundingClientRect().height };
  });
  expect(authFormRect.paddingTop).toBe('0px');
  expect(authFormRect.paddingBottom).toBe('0px');
  expect(authFormRect.height).toBeLessThan(5);
});

test('dark presets display a single Phosphor select caret', async ({ browser }) => {
  for (const preset of ['honey', 'ocean']) {
    const { page, ctx } = await freshPage(browser, { seed: { 'sealog.preset': preset } });
    await page.goto(`${baseURL}/index.html`);
    await openAsnapModal(page);
    const styles = await page.locator('#asnapIntervalSelect').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { repeat: cs.backgroundRepeat, size: cs.backgroundSize, image: cs.backgroundImage };
    });
    expect(styles.repeat, `${preset} select bg should not tile`).toBe('no-repeat');
    expect(styles.size, `${preset} select bg-size should retain the square Phosphor viewport`).toBe('18px 18px');
    expect(styles.image, `${preset} select should use the dark-preset Phosphor caret`).toContain('/icons/phosphor-caret-down-dark.svg');
    await ctx.close();
  }
});

test('manifest colors match the Light preset', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const resp = await page.goto(`${baseURL}/manifest.webmanifest`);
  expect(resp?.status()).toBe(200);
  const manifest = JSON.parse(await resp.text());
  expect(manifest.theme_color.toLowerCase()).toBe('#f5f3f0');
  expect(manifest.background_color.toLowerCase()).toBe('#f5f3f0');
});

test('no input/select/textarea has font-size below 16px (iOS Safari auto-zoom guard)', async ({ browser }) => {
  const { page } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#menuBtn').click();
  for (const s of ['data', 'theme']) await openSettingsSection(page, s);
  await page.locator('#authCloseBtn').click();
  await openAsnapModal(page);
  const sizes = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input, select, textarea'));
    return els.map((el) => ({ tag: el.tagName, id: el.id, fs: parseFloat(getComputedStyle(el).fontSize) }));
  });
  for (const s of sizes) {
    expect(s.fs, `${s.tag}#${s.id} font-size triggers iOS auto-zoom`).toBeGreaterThanOrEqual(16);
  }
});

test('viewport meta includes viewport-fit=cover for notched-iPhone safe-area handling', async ({ browser }) => {
  const { page } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).toContain('viewport-fit=cover');
});

test('settings accordions have their expected default open states', async ({ browser }) => {
  const { page } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#menuBtn').click();
  const defaults = { data: true, autofill: false, theme: true };
  for (const [s, defaultOpen] of Object.entries(defaults)) {
    const tag = await page.locator(`[data-section="${s}"]`).evaluate((el) => el.tagName);
    expect(tag, `data-section="${s}" should be DETAILS`).toBe('DETAILS');
    const isOpen = await page.locator(`[data-section="${s}"]`).evaluate((el) => el.open);
    expect(isOpen, `data-section="${s}" default open state`).toBe(defaultOpen);
  }
});

test('settings accordions: clicking summary toggles open and rotates chevron', async ({ browser }) => {
  const { page } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#menuBtn').click();
  const autofill = page.locator('details[data-section="autofill"]');
  await expect(autofill).not.toHaveAttribute('open', '');
  await autofill.locator('> summary').click();
  await expect(autofill).toHaveAttribute('open', '');
  await page.waitForFunction(() => {
    const c = document.querySelector('details[data-section="autofill"] .accordion-chevron');
    return c && getComputedStyle(c).transform === 'matrix(-1, 0, 0, -1, 0, 0)';
  }, { timeout: 1500 });
  await autofill.locator('> summary').click();
  await expect(autofill).not.toHaveAttribute('open', '');
});

test('settings accordions: open state persists across reload via sealog.settings.accordion', async ({ browser }) => {
  const { page } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  await page.locator('#menuBtn').click();
  // Closing Data differs from the default, making persistence observable.
  await page.locator('details[data-section="data"] > summary').click();
  await expect(page.locator('details[data-section="data"]')).not.toHaveAttribute('open', '');
  await page.waitForFunction(() => {
    try {
      const s = JSON.parse(localStorage.getItem('sealog.settings.accordion') || '{}');
      return s.data === false;
    } catch { return false; }
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sealog.settings.accordion') || '{}'));
  expect(stored.data).toBe(false);
  expect(stored.theme).toBe(true);
  await page.reload();
  await page.locator('#menuBtn').click();
  await expect(page.locator('details[data-section="data"]')).not.toHaveAttribute('open', '');
  await expect(page.locator('details[data-section="theme"]')).toHaveAttribute('open', '');
});

test('GPS modal shows diagnostics and preserves the poor-accuracy logging setting', async ({ browser }) => {
  const { page, ctx } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#gpsModal')).toBeHidden();
  const tag = await page.locator('#gpsStatus').evaluate((el) => el.tagName);
  expect(tag).toBe('BUTTON');
  await expect(page.locator('#gpsStatus')).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(page.locator('#gpsStatus')).toHaveAttribute('aria-controls', 'gpsModal');
  await openGpsModal(page);
  await expect(page.locator('#gpsModal')).toBeVisible();
  await expect(page.locator('#gpsModal #fixSummary')).toBeVisible();
  const allowPoorAccuracy = page.locator('#gpsModal').getByRole('checkbox', {
    name: 'Allow logging when GPS accuracy is poor'
  });
  await expect(allowPoorAccuracy).toBeVisible();
  await expect(allowPoorAccuracy).toHaveAccessibleDescription(/Applies to all device GPS logging: manual capture, GPS auto-fill, and ASNAP/);
  await expect(allowPoorAccuracy).not.toBeChecked();
  await allowPoorAccuracy.check();
  expect(await page.evaluate(() => localStorage.getItem('asnapAllowPoorAccuracy'))).toBe('1');
  await page.reload();
  await openGpsModal(page);
  await expect(allowPoorAccuracy).toBeChecked();
  await allowPoorAccuracy.uncheck();
  expect(await page.evaluate(() => localStorage.getItem('asnapAllowPoorAccuracy'))).toBe('0');
  await page.locator('#gpsModalCloseBtn').click();
  await expect(page.locator('#gpsModal')).toBeHidden();
  await ctx.close();
});

test('tapping #asnapStatusTile opens the ASNAP modal containing ASNAP + Backfill controls', async ({ browser }) => {
  const { page } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#asnapModal')).toBeHidden();
  const tag = await page.locator('#asnapStatusTile').evaluate((el) => el.tagName);
  expect(tag).toBe('BUTTON');
  await expect(page.locator('#asnapStatusTile')).toHaveAttribute('aria-controls', 'asnapModal');
  await page.locator('#asnapStatusTile').click();
  await expect(page.locator('#asnapModal')).toBeVisible();
  await expect(page.locator('#asnapModal #asnapEnableToggle')).toBeVisible();
  await expect(page.locator('#asnapModal #asnapShowToggle')).toBeVisible();
  await expect(page.locator('#asnapModal #gpsAllowPoorToggle')).toHaveCount(0);
  await expect(page.locator('#asnapModal #asnapIntervalSelect')).toBeVisible();
  await expect(page.locator('#asnapModal #asnapBackfillToggle')).toBeVisible();
  await expect(page.locator('#asnapModal #asnapBackfillAllowlist')).toBeVisible();
  await page.locator('#asnapModalCloseBtn').click();
  await expect(page.locator('#asnapModal')).toBeHidden();
});

test('system theme changes repaint the page when no preset is saved', async ({ browser }) => {
  const { page } = await freshPage(browser, { colorScheme: 'light', signedIn: false });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  const lightBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  expect(lightBg.toLowerCase()).toBe('#f5f3f0');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.preset === 'ocean');
  const darkBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  expect(darkBg.toLowerCase()).toBe('#0a0e14');
});

/**
 * Open the Settings drawer (via menu), expand the Auto-fill rules accordion,
 * and click the "Manage rules…" button. Waits for the modal to become visible.
 * @param {import('@playwright/test').Page} page - Playwright page.
 */
async function openAutoFillRulesModal(page) {
  if (await page.locator('#authPanel').isHidden()) {
    await page.locator('#menuBtn').click();
  }
  await page.evaluate(() => {
    const d = document.querySelector('details[data-section="autofill"]');
    if (d) d.open = true;
  });
  await page.locator('#autoFillRulesBtn').click();
  await page.waitForSelector('#autoFillRulesModal:not([hidden])');
}

/**
 * Serve the current BRUV template through the API so the app creates and
 * populates its own template store, including after a page reload.
 * @param {import('@playwright/test').BrowserContext} ctx - Context to mock.
 * @returns {Promise<void>} Resolves after the template route is registered.
 */
async function mockBruvTemplate(ctx) {
  await ctx.route('**/api/v1/event_templates', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 'tpl-bruv-e2e',
      event_name: 'BRUV',
      event_value: 'BRUV',
      template_categories: ['gear'],
      event_options: ['Time In', 'Time Out', 'Latitude', 'Longitude'].map((name) => ({
        event_option_name: name,
        event_option_type: 'text',
        event_option_required: false
      }))
    }])
  }));
}

test('opening the modal shows template picker + closes via Cancel', async ({ browser }) => {
  const { page } = await freshPage(browser);
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#autoFillRulesModal')).toBeHidden();
  await openAutoFillRulesModal(page);
  await expect(page.locator('#autoFillTemplateSelect')).toBeVisible();
  await expect(page.locator('#autoFillFieldTableEmpty')).toBeVisible();
  await expect(page.locator('#autoFillFieldTableBody')).toBeHidden();
  await page.locator('#autoFillRulesCancelBtn').click();
  await expect(page.locator('#autoFillRulesModal')).toBeHidden();
});

test('selecting a server template renders configurable rows', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'fake-jwt-for-test');
  });
  await mockBruvTemplate(ctx);
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/index.html`);
  await expect(page.locator('#type option', { hasText: /^BRUV$/ })).toHaveCount(1);
  await openAutoFillRulesModal(page);
  const optionTexts = await page.locator('#autoFillTemplateSelect option').allTextContents();
  expect(optionTexts).toContain('BRUV');
  await page.locator('#autoFillTemplateSelect').selectOption('tpl-bruv-e2e');
  await expect(page.locator('#autoFillFieldTableBody')).toBeVisible();
  await expect(page.locator('#autoFillFieldTableEmpty')).toBeHidden();
  const rowKeys = await page.locator('#autoFillFieldTableBody .autofill-field-row').evaluateAll(
    (rows) => rows.map((r) => r.dataset.fieldKey)
  );
  expect(rowKeys).toContain('time in');
  expect(rowKeys).toContain('time out');
  expect(rowKeys).toContain('latitude');
  expect(rowKeys).toContain('longitude');
  await ctx.close();
});

test('On-log and On-edit are mutually exclusive (one stamp per field)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'fake-jwt-for-test');
  });
  await mockBruvTemplate(ctx);
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/index.html`);
  await expect(page.locator('#type option', { hasText: /^BRUV$/ })).toHaveCount(1);
  await openAutoFillRulesModal(page);
  await page.locator('#autoFillTemplateSelect').selectOption('tpl-bruv-e2e');

  // Time fields have no GPS defaults, so both modes start enabled.
  const row = '#autoFillFieldTableBody .autofill-field-row[data-field-key="time in"]';
  const logSel = () => page.locator(`${row} select[data-mode="log"]`);
  const editSel = () => page.locator(`${row} select[data-mode="edit"]`);
  await expect(logSel()).toBeEnabled();
  await expect(editSel()).toBeEnabled();

  await logSel().selectOption('now_utc');
  await expect(editSel()).toBeDisabled();
  await expect(logSel()).toBeEnabled();

  await logSel().selectOption('');
  await expect(editSel()).toBeEnabled();
  await expect(logSel()).toBeEnabled();

  await editSel().selectOption('now_utc');
  await expect(logSel()).toBeDisabled();
  await ctx.close();
});

test('clearing all rules stays cleared (durable de-selection)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'fake-jwt-for-test');
  });
  await mockBruvTemplate(ctx);
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/index.html`);
  await expect(page.locator('#type option', { hasText: /^BRUV$/ })).toHaveCount(1);
  await openAutoFillRulesModal(page);
  await page.locator('#autoFillTemplateSelect').selectOption('tpl-bruv-e2e');

  const latLog = () => page.locator('#autoFillFieldTableBody .autofill-field-row[data-field-key="latitude"] select[data-mode="log"]');
  const lonLog = () => page.locator('#autoFillFieldTableBody .autofill-field-row[data-field-key="longitude"] select[data-mode="log"]');
  await expect(latLog()).toHaveValue('lat');
  await expect(lonLog()).toHaveValue('lon');
  await latLog().selectOption('');
  await lonLog().selectOption('');
  // An empty rules entry prevents GPS defaults from being restored.
  await page.locator('#autoFillRulesSaveBtn').click();
  await expect(page.locator('#autoFillRulesModal')).toBeHidden();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('templateAutoFillRules') || '{}'));
  expect(stored['tpl-bruv-e2e']).toBeTruthy();
  expect(Object.keys(stored['tpl-bruv-e2e'].log || {})).toEqual([]);
  expect(Object.keys(stored['tpl-bruv-e2e'].edit || {})).toEqual([]);
  await openAutoFillRulesModal(page);
  await page.locator('#autoFillTemplateSelect').selectOption('tpl-bruv-e2e');
  await expect(latLog()).toHaveValue('');
  await expect(lonLog()).toHaveValue('');
  await ctx.close();
});

test('Save persists rule to localStorage; reload + reopen restores it', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('username', 'tester');
    localStorage.setItem('jwt', 'fake-jwt-for-test');
  });
  await mockBruvTemplate(ctx);
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/index.html`);
  await expect(page.locator('#type option', { hasText: /^BRUV$/ })).toHaveCount(1);
  await openAutoFillRulesModal(page);
  await page.locator('#autoFillTemplateSelect').selectOption('tpl-bruv-e2e');
  const timeInLogSelect = page.locator(
    '#autoFillFieldTableBody .autofill-field-row[data-field-key="time in"] select[data-mode="log"]'
  );
  await timeInLogSelect.selectOption('now_utc');
  await page.locator('#autoFillRulesSaveBtn').click();
  await expect(page.locator('#autoFillRulesModal')).toBeHidden();
  const storedRaw = await page.evaluate(() => localStorage.getItem('templateAutoFillRules'));
  expect(storedRaw).not.toBeNull();
  const parsed = JSON.parse(storedRaw);
  expect(parsed['tpl-bruv-e2e']).toBeTruthy();
  expect(parsed['tpl-bruv-e2e'].log).toBeTruthy();
  // Rules preserve values already entered in the field.
  expect(parsed['tpl-bruv-e2e'].log['time in']).toEqual({
    source: 'now_utc'
  });
  await page.reload();
  await expect(page.locator('#type option', { hasText: /^BRUV$/ })).toHaveCount(1);
  await openAutoFillRulesModal(page);
  await page.locator('#autoFillTemplateSelect').selectOption('tpl-bruv-e2e');
  await expect(
    page.locator('#autoFillFieldTableBody .autofill-field-row[data-field-key="time in"] select[data-mode="log"]')
  ).toHaveValue('now_utc');
  await ctx.close();
});

/**
 * Route the login endpoint to a chosen response; other /api/v1/* calls return
 * empty arrays so any post-failure refresh does not hang.
 * @param {import('@playwright/test').Page} page - Page to attach routing to.
 * @param {{status: number, body: string}} loginResponse - Login fulfillment.
 * @returns {Promise<void>} Resolves once routing is registered.
 */
async function stubLoginResponse(page, loginResponse) {
  await page.route(/\/api\/v1\//, async (route) => {
    if (route.request().url().includes('/auth/login')) {
      await route.fulfill({ contentType: 'application/json', ...loginResponse });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

/**
 * Open the sign-in panel and submit a username/password login attempt.
 * @param {import('@playwright/test').Page} page - Page under test.
 * @param {string} user - Username to type.
 * @param {string} pass - Password to type.
 * @returns {Promise<void>} Resolves once the login button has been clicked.
 */
async function attemptLogin(page, user, pass) {
  await page.goto(`${baseURL}/index.html`);
  await page.waitForFunction(() => {
    const el = document.getElementById('authPanel');
    return el && !el.hidden;
  });
  await page.locator('#user').fill(user);
  await page.locator('#pass').fill(pass);
  await page.locator('#loginBtn').click();
}

test('401 surfaces an invalid-credentials message and stores no token', async ({ browser }) => {
  const { page } = await freshPage(browser, { signedIn: false });
  await stubLoginResponse(page, { status: 401, body: JSON.stringify({ message: 'nope' }) });
  await attemptLogin(page, 'alice', 'wrongpass');
  await expect(page.locator('#authStatus')).toContainText('Sign in failed');
  await expect(page.locator('#authSummary')).toContainText('Invalid username or password');
  expect(await page.evaluate(() => localStorage.getItem('jwt'))).toBeNull();
});

test('a non-ok status surfaces "Login failed (N)"', async ({ browser }) => {
  const { page } = await freshPage(browser, { signedIn: false });
  await stubLoginResponse(page, { status: 500, body: 'boom' });
  await attemptLogin(page, 'alice', 'hunter2');
  await expect(page.locator('#authStatus')).toContainText('Sign in failed');
  await expect(page.locator('#authSummary')).toContainText('Login failed (500)');
  expect(await page.evaluate(() => localStorage.getItem('jwt'))).toBeNull();
});

test('a 200 without a token surfaces the missing-token message', async ({ browser }) => {
  const { page } = await freshPage(browser, { signedIn: false });
  await stubLoginResponse(page, { status: 200, body: JSON.stringify({ id: 'x' }) });
  await attemptLogin(page, 'alice', 'hunter2');
  await expect(page.locator('#authStatus')).toContainText('Sign in failed');
  await expect(page.locator('#authSummary')).toContainText('Server did not return a token');
  expect(await page.evaluate(() => localStorage.getItem('jwt'))).toBeNull();
});

test('a good fix renders the summary, age, and an ok tile', async ({ browser }) => {
  const { page } = await freshPage(browser);
  const ctx = page.context();
  await ctx.grantPermissions(['geolocation'], { origin: baseURL });
  await ctx.setGeolocation({ latitude: -45.1234, longitude: 170.9876, accuracy: 8 });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForFunction(
    () => (document.getElementById('fixSummary')?.textContent || '').startsWith('Fix:'),
    { timeout: 15000 }
  );
  await openGpsModal(page);
  await expect(page.locator('#fixSummary')).toContainText('Fix: -45.123400, 170.987600');
  await expect(page.locator('#fixAge')).toContainText('Last fix');
  await expect(page.locator('#gpsStatus')).toHaveAttribute('data-state', 'ok');
});

test('a low-accuracy fix (>30m) shows the accuracy warning', async ({ browser }) => {
  const { page } = await freshPage(browser);
  const ctx = page.context();
  await ctx.grantPermissions(['geolocation'], { origin: baseURL });
  await ctx.setGeolocation({ latitude: -45.1234, longitude: 170.9876, accuracy: 45 });
  await page.goto(`${baseURL}/index.html`);
  await page.waitForFunction(
    () => (document.getElementById('fixSummary')?.textContent || '').startsWith('Fix:'),
    { timeout: 15000 }
  );
  await openGpsModal(page);
  await expect(page.locator('#fixWarning')).toContainText('Accuracy is ±45m');
  await expect(page.locator('#gpsStatus')).toHaveAttribute('data-state', 'warn');
});
