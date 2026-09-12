#!/usr/bin/env node
/**
 * Generate documentation screenshots in an iPhone-sized headless Chromium.
 *
 * Run: node scripts/screenshot-app.mjs
 * Output: docs/screenshots/*.png
 */
import { chromium, devices } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_VERSION } from '../src/config/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 8765;
const BASE = `http://localhost:${PORT}`;
const APP_URL = `${BASE}/sealog-a/`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    urlPath = urlPath.replace(/^\/sealog-(?:a|b|c)(?=\/|$)/, '');
    if (urlPath === '' || urlPath === '/' || urlPath === '/index') urlPath = '/index.html';
    const fp = path.resolve(path.join(ROOT, urlPath));
    if (!fp.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(fp, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(fp);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const now = Date.now();
const SAMPLE_EVENTS = [
  {
    localId: 'sample-001-synced',
    client_uuid: 'sample-001-synced',
    serverId: '6a136e9e65089ab2c1be70e7',
    type: 'CTD_START',
    notes: 'Bottle 1 deployed at thermocline',
    syncState: 'synced',
    eventTimestampUTC: new Date(now - 4 * 60 * 1000).toISOString(),
    createdAtMs: now - 4 * 60 * 1000,
    createdAtUTC: new Date(now - 4 * 60 * 1000).toISOString(),
    updatedAtMs: now - 4 * 60 * 1000,
    updatedAtUTC: new Date(now - 4 * 60 * 1000).toISOString(),
    lastSyncMs: now - 3 * 60 * 1000,
    lastSyncUTC: new Date(now - 3 * 60 * 1000).toISOString(),
    lat: -45.12345,
    lon: 170.98765,
    acc_m: 4,
    option_values: [],
    revisions: [],
    payload: {},
    cruiseId: 'demo-cruise',
    isAsnap: false,
    attemptCount: 1,
  },
  {
    localId: 'sample-002-patch-pending',
    client_uuid: 'sample-002-patch-pending',
    serverId: 'a8c937aa902abce85bf710d2',
    type: 'BOTTOM_SAMPLE',
    notes: 'Depth reading corrected',
    syncState: 'patch-pending',
    eventTimestampUTC: new Date(now - 9 * 60 * 1000).toISOString(),
    createdAtMs: now - 9 * 60 * 1000,
    createdAtUTC: new Date(now - 9 * 60 * 1000).toISOString(),
    updatedAtMs: now - 90 * 1000,
    updatedAtUTC: new Date(now - 90 * 1000).toISOString(),
    nextAttemptMs: now + 10 * 60 * 1000,
    lat: -45.12108,
    lon: 170.99021,
    acc_m: 5,
    option_values: [],
    revisions: [],
    payload: {},
    cruiseId: 'demo-cruise',
    isAsnap: false,
    attemptCount: 0,
  },
  {
    localId: 'sample-003-unsynced',
    client_uuid: 'sample-003-unsynced',
    type: 'WAYPOINT',
    notes: 'Approaching station',
    syncState: 'unsynced',
    eventTimestampUTC: new Date(now - 22 * 60 * 1000).toISOString(),
    createdAtMs: now - 22 * 60 * 1000,
    createdAtUTC: new Date(now - 22 * 60 * 1000).toISOString(),
    updatedAtMs: now - 22 * 60 * 1000,
    updatedAtUTC: new Date(now - 22 * 60 * 1000).toISOString(),
    nextAttemptMs: now + 10 * 60 * 1000,
    lat: -45.11894,
    lon: 170.99230,
    acc_m: 8,
    option_values: [],
    revisions: [],
    payload: {},
    cruiseId: 'demo-cruise',
    isAsnap: false,
    attemptCount: 0,
  },
];

async function seedIdb(page, events) {
  await page.evaluate(async (events) => {
    const { put } = await import(new URL('src/db/indexed-db.js', location.href).href);
    const { syncEventPayload } = await import(new URL('src/events/event-transform.js', location.href).href);
    for (const event of events) {
      syncEventPayload(event);
      await put('events', event);
    }
  }, events);
}

async function setupContext(browser) {
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    geolocation: { latitude: -45.12345, longitude: 170.98765, accuracy: 4 },
    permissions: ['geolocation'],
  });
  await ctx.route('**/sealog-server/**', (route) => {
    const url = route.request().url();
    let body = '{}';
    if (url.includes('/auth/login')) body = JSON.stringify({ token: 'stub-jwt', id: 'stub-user' });
    else if (url.includes('/event_templates')) body = JSON.stringify([]);
    else if (url.includes('/cruises')) body = JSON.stringify([]);
    else if (url.includes('/events')) body = JSON.stringify([]);
    route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  return ctx;
}

async function newPage(ctx, { authed = true, seed = true } = {}) {
  const page = await ctx.newPage();
  await page.addInitScript(({ authed }) => {
    try {
      localStorage.setItem('sealog.preset', 'light');
      if (authed) {
        localStorage.setItem('jwt', 'stub-jwt');
        localStorage.setItem('username', 'navigator');
        localStorage.setItem('userId', 'stub-user');
      } else {
        localStorage.removeItem('jwt');
        localStorage.removeItem('username');
        localStorage.removeItem('userId');
      }
    } catch {
      // Ignore storage access errors in the fixture initialization script.
    }
  }, { authed });
  await page.goto(APP_URL);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForTimeout(400);
  if (seed && authed) {
    await seedIdb(page, SAMPLE_EVENTS);
    await page.reload();
    await page.waitForTimeout(400);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(
    (version) => document.getElementById('swVersionTag')?.textContent === version,
    CACHE_VERSION
  );
  return page;
}

async function selectAllFilter(page) {
  await page.evaluate(() => {
    document.querySelector('button.filter-chip[data-filter="all"]')?.click();
  });
  await page.waitForTimeout(200);
}

async function shoot(page, name) {
  const out = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`✓ ${name}.png`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const server = await startStaticServer();
  console.log(`serving on ${BASE}`);

  const browser = await chromium.launch();
  const ctx = await setupContext(browser);

  try {
    // Main capture screen with events.
    {
      const page = await newPage(ctx);
      await selectAllFilter(page);
      await shoot(page, '01-capture-screen');
      await page.close();
    }

    // Theme settings accordion.
    {
      const page = await newPage(ctx);
      await page.click('#menuBtn');
      await page.waitForSelector('#authPanel:not([hidden])');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        document.querySelector('details[data-section="data"]').open = false;
        const theme = document.querySelector('details[data-section="theme"]');
        theme.open = true;
        theme.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(300);
      await shoot(page, '02-settings-theme');
      await page.close();
    }

    // Data settings accordion.
    {
      const page = await newPage(ctx);
      await page.click('#menuBtn');
      await page.waitForSelector('#authPanel:not([hidden])');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        document.querySelector('details[data-section="theme"]').open = false;
        const data = document.querySelector('details[data-section="data"]');
        data.open = true;
        data.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(300);
      await shoot(page, '03-settings-data');
      await page.close();
    }

    // GPS modal.
    {
      const page = await newPage(ctx);
      await page.waitForTimeout(1500);
      await page.click('#gpsStatus');
      await page.waitForSelector('#gpsModal:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(400);
      await shoot(page, '04-gps-modal');
      await page.close();
    }

    // ASNAP modal.
    {
      const page = await newPage(ctx);
      await page.click('#asnapStatusTile');
      await page.waitForSelector('#asnapModal:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(400);
      await shoot(page, '05-asnap-modal');
      await page.close();
    }

    // Expanded event detail.
    {
      const page = await newPage(ctx);
      await selectAllFilter(page);
      await page.waitForSelector('.event-summary', { timeout: 5000 });
      await page.click('.event-summary'); // expand first (most recent = synced sample)
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        document.querySelector('.event-card[data-expanded="true"]')?.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(200);
      await shoot(page, '06-event-detail');
      await page.close();
    }

    // Update modal shown programmatically.
    {
      const page = await newPage(ctx);
      await page.evaluate((version) => {
        const banner = document.getElementById('updateBanner');
        const text = document.getElementById('updateBannerText');
        if (text) text.textContent = `Version ${version} is ready. Reload to update.`;
        if (banner) banner.hidden = false;
        document.body.classList.add('modal-open');
        document.documentElement.classList.add('modal-open');
      }, CACHE_VERSION);
      await page.waitForTimeout(400);
      await shoot(page, '07-update-modal');
      await page.close();
    }

    // The sign-in panel opens automatically for signed-out users.
    {
      const page = await newPage(ctx, { authed: false, seed: false });
      await page.waitForSelector('#authPanel:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(500);
      await shoot(page, '08-signin');
      await page.close();
    }

    // Open the signed-in Account panel through its actual control.
    {
      const page = await newPage(ctx);
      await page.locator('#menuBtn').click();
      await page.waitForSelector('#authPanel:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        document.querySelector('#authPanel .modal-card')?.scrollTo(0, 0);
      });
      await page.waitForTimeout(200);
      await shoot(page, '09-signedin-account');
      await page.close();
    }

    // All filter showing mixed sync states.
    {
      const page = await newPage(ctx);
      await selectAllFilter(page);
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        document.getElementById('list')?.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(200);
      await shoot(page, '10-mixed-states');
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
