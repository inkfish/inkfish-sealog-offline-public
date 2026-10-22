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
let swScriptRevision = 0;
let deferWorkerActivation = false;
// Browser offline emulation does not reliably reach the worker after the
// first offline navigation, so tests that need it refuse connections instead.
let serverUnreachable = false;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (serverUnreachable) {
      req.socket.destroy();
      return;
    }
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
    if (pathname === '/sw.js') {
      let source = body.toString('utf8');
      if (deferWorkerActivation) {
        source = source.replace('await self.skipWaiting();', '// Wait for the page to request activation.');
      }
      body = Buffer.from(`${source}\n// Test build revision: ${swScriptRevision}\n`);
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
  swScriptRevision = 0;
  deferWorkerActivation = false;
  serverUnreachable = false;
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
 * Wait until the service worker has activated, claimed this page, and
 * reported its version, before attempting another registration update.
 * @param {object} page - Playwright page under test.
 * @returns {Promise<void>} Resolves once the SW controller is set.
 */
async function waitForSwControl(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.state === 'activated',
    null,
    { timeout: 20000 }
  );
  await expect(page.locator('#swVersionTag')).toHaveText(CACHE_VERSION);
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

    // Initial installation can briefly expose a waiting worker. It must not
    // queue the delayed, versionless notification used for genuine updates.
    await page.waitForTimeout(1200);
    await expect(page.locator('#updateBanner')).toBeHidden();

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

test('non-app navigations leave every deployment offline shell intact', async ({ browser }) => {
  const { ctx, page } = await freshAppPage(browser);
  for (const prefix of PREFIXES) {
    await page.goto(`${baseURL}${prefix}/`);
    await waitForSwControl(page);
  }
  // Every deployment shares one cache, so a navigation under one scope
  // could previously replace the shell for all three.
  const icon = await page.goto(`${baseURL}${PREFIX}/icons/icon-192.png`);
  expect(icon.headers()['content-type']).toBe('image/png');
  expect((await page.goto(`${baseURL}${PREFIX}/missing-route`)).status()).toBe(404);

  serverUnreachable = true;
  for (const prefix of PREFIXES) {
    for (const entry of ['/', '/index.html']) {
      const response = await page.goto(`${baseURL}${prefix}${entry}`);
      expect(response.fromServiceWorker()).toBe(true);
      await expect(page.locator('#menuBtn')).toBeVisible();
    }
  }
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

  await page.locator('#updateDismissBtn').click();
  // Another real installation reporting the same version must respect the
  // dismissal, even when both the delayed fallback and worker messages fire.
  swScriptRevision += 1;
  await page.evaluate(async () => {
    const controlled = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    });
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
    await controlled;
  });
  await page.waitForTimeout(1200);
  await expect(page.locator('#updateBanner')).toBeHidden();

  swVersionOverride = swVersionOverride.replace(/\d+$/, (part) => String(Number(part) + 1));
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
  });
  await expect(page.locator('#updateBanner')).toBeVisible();
  await expect(page.locator('#updateBannerText')).toContainText(swVersionOverride);

  await ctx.close();
});

test('an update waiting behind an active worker prompts for reload', async ({ browser }) => {
  const { ctx, page } = await freshAppPage(browser);
  await page.goto(`${baseURL}${PREFIX}/`);
  await waitForSwControl(page);

  swVersionOverride = CACHE_VERSION.replace(/\d+$/, (part) => String(Number(part) + 1));
  deferWorkerActivation = true;
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
  });
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.waiting && !!reg.active;
  });

  // A state reply from the old active worker still matches this page's
  // version, but cannot erase the update that genuinely remains waiting.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await new Promise((resolve) => {
      const onState = (event) => {
        if (event.data?.type !== 'SW_STATE') return;
        navigator.serviceWorker.removeEventListener('message', onState);
        resolve();
      };
      navigator.serviceWorker.addEventListener('message', onState);
      reg.active.postMessage({ type: 'REQUEST_SW_STATE' });
    });
  });
  await expect(page.locator('#updateBanner')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#updateBannerText')).toContainText('A newer version');

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
