/**
 * The deployment prefix enables service-worker registration, shell caching,
 * offline navigation, and update notifications. The server resolves all
 * deployment prefixes against the repository root for shell precaching.
 * Each test uses a fresh context to isolate service workers and storage.
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { CACHE_VERSION } from '../../src/config/constants.js';

const PREFIX = '/sealog-a';
// Precaching requires shell URLs for all deployments to resolve.
const PREFIXES = ['/sealog-a', '/sealog-b', '/sealog-c'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

let server;
let baseURL;
const ROOT = resolve(import.meta.dirname, '..', '..');

// Override worker source and reported version for the update-notification fixture.
let swVersionOverride = null;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    let pathname = decodeURIComponent(req.url.split('?')[0]);
    const requestPrefix = PREFIXES.find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) || '';
    for (const pre of PREFIXES) {
      if (pathname === pre || pathname === `${pre}/`) {
        pathname = '/index.html';
        break;
      }
      if (pathname.startsWith(`${pre}/`)) {
        pathname = pathname.slice(pre.length);
        break;
      }
    }
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const filePath = join(ROOT, pathname);
    if (!filePath.startsWith(ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const mime = MIME[extname(filePath)] || 'application/octet-stream';
    let body = await readFile(filePath);
    if (pathname === '/sw.js' && swVersionOverride) {
      body = Buffer.from(
        body.toString('utf8').replace(
          `const CACHE_VERSION = '${CACHE_VERSION}'`,
          `const CACHE_VERSION = '${swVersionOverride}'`
        )
      );
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', `${requestPrefix}/`);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  swVersionOverride = null;
});

/**
 * Build a fresh isolated context and page seeded with a light theme and a stub
 * signed-in state.
 * @param {import('@playwright/test').Browser} browser - Playwright browser.
 * @returns {Promise<{ctx: object, page: object}>} The context and its page.
 */
async function freshAppPage(browser) {
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sealog.preset', 'light');
      localStorage.setItem('jwt', 'test-jwt');
      localStorage.setItem('username', 'tester');
    } catch {
      // localStorage may be unavailable before navigation; ignore.
    }
  });
  return { ctx, page };
}

/**
 * Wait until the active service worker has claimed this page.
 * @param {object} page - Playwright page under test.
 * @returns {Promise<void>} Resolves once the SW controller is set.
 */
async function waitForSwControl(page) {
  await page.waitForFunction(
    () => !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    { timeout: 20000 }
  );
}

for (const prefix of PREFIXES) {
  test(`registers, controls, and resolves the API root under ${prefix}/`, async ({ browser }) => {
    const { ctx, page } = await freshAppPage(browser);
    const [templateRequest] = await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname.endsWith('/api/v1/event_templates')),
      page.goto(`${baseURL}${prefix}/`)
    ]);
    expect(templateRequest.url()).toBe(`${baseURL}${prefix}/sealog-server/api/v1/event_templates`);
    // clients.claim() on activate sets the controller without needing a reload.
    await waitForSwControl(page);

    const scriptURL = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
    expect(scriptURL).toBe(`${baseURL}${prefix}/sw.js`);

    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? reg.scope : '';
    });
    expect(scope).toBe(`${baseURL}${prefix}/`);

    await ctx.close();
  });
}

test('app shell loads from cache when offline', async ({ browser }) => {
  const { ctx, page } = await freshAppPage(browser);
  await page.goto(`${baseURL}${PREFIX}/`);
  await waitForSwControl(page);
  // The shell is precached via cache.addAll during install, which resolves
  // before activate — so once the worker controls the page, the cache is warm.

  await ctx.setOffline(true);
  await page.reload();

  await expect(page.locator('#menuBtn')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#emptyState')).toBeVisible();

  await ctx.setOffline(false);
  await ctx.close();
});

test('a new worker version surfaces the update banner', async ({ browser }) => {
  const { ctx, page } = await freshAppPage(browser);
  await page.goto(`${baseURL}${PREFIX}/`);
  await waitForSwControl(page);

  // The updated worker activates and broadcasts SW_UPDATE_READY. The page
  // displays the banner until the user chooses to reload.
  swVersionOverride = CACHE_VERSION.replace(/\d+$/, (part) => String(Number(part) + 1));
  expect(swVersionOverride).not.toBe(CACHE_VERSION);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
  });

  await expect(page.locator('#updateBanner')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#updateBannerText')).toContainText(swVersionOverride);

  await ctx.close();
});

test('a queued event posts to the server and flips to synced', async ({ browser }) => {
  const { ctx, page } = await freshAppPage(browser);
  await page.goto(`${baseURL}${PREFIX}/`);
  await waitForSwControl(page);
  // This server has no templates endpoint, so the app uses fallback templates.
  await expect(page.locator('#emptyState')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const sel = document.getElementById('type');
    return !!sel && [...sel.options].some((o) => o.textContent.trim() === 'Freeform Note');
  }, { timeout: 10000 });

  // The unstubbed POST returns 404, leaving the captured note queued.
  await page.evaluate(() => {
    const sel = document.getElementById('type');
    const opt = [...sel.options].find((o) => o.textContent.trim() === 'Freeform Note');
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#captureBtn').click();

  // Show "All" so the card stays visible after sync — the default "local"
  // filter hides events once they gain a serverId.
  await page.evaluate(() => {
    document.querySelector('button.filter-chip[data-filter="all"]')?.click();
  });

  const firstCard = page.locator('#list .event-card').first();
  await expect(firstCard).toHaveCount(1, { timeout: 10000 });
  await expect(firstCard).not.toHaveAttribute('data-sync-state', 'synced');

  // A successful insert lets manual sync complete the queued event.
  await page.route('**/sealog-server/api/v1/events', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ acknowledged: true, insertedId: 'srv-test-1' })
      });
    } else {
      route.fallback();
    }
  });
  await page.locator('#syncBtn').click();
  await expect(firstCard).toHaveAttribute('data-sync-state', 'synced', { timeout: 15000 });

  await ctx.close();
});
