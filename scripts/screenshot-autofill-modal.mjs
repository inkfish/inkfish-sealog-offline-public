#!/usr/bin/env node
/**
 * Screenshot the auto-fill "Manage rules" modal at iPhone 14 retina.
 *
 * A stubbed BRUV template provides time and GPS fields. Browser interactions
 * select a time rule to show it alongside GPS defaults and disabled On edit
 * controls for fields that already have an On log rule.
 *
 * Run: node scripts/screenshot-autofill-modal.mjs
 * Output: docs/screenshots/11-autofill-rules.png (+ ...-gps.png)
 */
import { chromium, devices } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 8766;
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

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    urlPath = urlPath.replace(/^\/sealog-(?:a|b|c)(?=\/|$)/, '');
    if (urlPath === '' || urlPath === '/') urlPath = '/index.html';
    const fp = path.resolve(path.join(ROOT, urlPath));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

// Time and GPS fields show the available sources and default On log rules.
const BRUV_TEMPLATE = {
  id: 'tpl-bruv',
  event_name: 'BRUV',
  event_value: 'BRUV',
  event_free_text_required: false,
  event_options: [
    { event_option_name: 'Time In', event_option_type: 'text', event_option_required: false },
    { event_option_name: 'Time Out', event_option_type: 'text', event_option_required: false },
    { event_option_name: 'Latitude', event_option_type: 'text', event_option_required: false },
    { event_option_name: 'Longitude', event_option_type: 'text', event_option_required: false },
    { event_option_name: 'Device Accuracy (m)', event_option_type: 'text', event_option_required: false }
  ]
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    geolocation: { latitude: -45.12345, longitude: 170.98765, accuracy: 4 },
    permissions: ['geolocation'],
  });
  // The refresh response must retain BRUV because it replaces the template cache.
  await ctx.route('**/sealog-server/**', (route) => {
    const url = route.request().url();
    let body = '[]';
    if (url.includes('/auth/login')) body = JSON.stringify({ token: 'stub', id: 'stub' });
    else if (url.includes('/event_templates')) body = JSON.stringify([BRUV_TEMPLATE]);
    route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sealog.preset', 'light');
        localStorage.setItem('jwt', 'stub');
        localStorage.setItem('username', 'navigator');
        // Clear any prior rules so seeding shows the default GPS-on state.
        localStorage.removeItem('templateAutoFillRules');
      } catch {}
    });

    await page.goto(APP_URL);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    // A BRUV option confirms that the template cache has loaded.
    await page.waitForFunction(() => {
      const sel = document.getElementById('type');
      return !!sel && [...sel.options].some((o) => /BRUV/i.test(o.textContent || ''));
    }, { timeout: 8000 });

    await page.evaluate(() => { document.getElementById('autoFillRulesBtn')?.click(); });
    await page.waitForSelector('#autoFillRulesModal:not([hidden])', { timeout: 5000 });
    await page.evaluate(() => {
      const sel = document.getElementById('autoFillTemplateSelect');
      const opt = [...sel.options].find((o) => /BRUV/i.test(o.textContent || ''));
      if (opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForSelector('.autofill-field-row', { timeout: 5000 });

    // A Time In rule on log disables that field's On edit control.
    await page.evaluate(() => {
      const row = document.querySelector('.autofill-field-row[data-field-key="time in"]');
      const logSel = row?.querySelector('select[data-mode="log"]');
      if (logSel) {
        logSel.value = 'now_utc';
        logSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);

    const top = path.join(OUT, '11-autofill-rules.png');
    await page.screenshot({ path: top, fullPage: false });
    console.log(`✓ ${path.relative(ROOT, top)}`);

    // Scroll to the GPS rows (badges + seeded On-log + greyed On-edit).
    await page.evaluate(() => {
      const body = document.querySelector('#autoFillRulesModal .modal-body');
      if (body) body.scrollTop = body.scrollHeight;
    });
    await page.waitForTimeout(250);
    const gps = path.join(OUT, '11-autofill-rules-gps.png');
    await page.screenshot({ path: gps, fullPage: false });
    console.log(`✓ ${path.relative(ROOT, gps)}`);

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
