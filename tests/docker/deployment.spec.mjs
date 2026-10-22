import { test, expect } from '@playwright/test';

test('landing page links to all deployments and excludes repository files', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const landing = await response.text();
  for (const deployment of ['a', 'b', 'c']) {
    expect(landing).toContain(`/sealog-${deployment}/`);
  }
  for (const path of ['/LICENSE', '/THIRD_PARTY_NOTICES.md', '/licenses/phosphor-icons-MIT.txt', '/licenses/understand-anything-MIT.txt', '/licenses/sealog-server-MIT.txt']) {
    const notice = await request.get(path);
    expect(notice.ok()).toBe(true);
    expect(await notice.text()).toContain('MIT License');
  }
  for (const path of ['/.git/config', '/package-lock.json', '/docs/SECURITY.md', '/certs/private-ca/cert-config.json', '/.codegraph/graph.db']) {
    const excluded = await request.get(path);
    // The landing route is the fallback for paths outside the runtime bundle.
    expect(await excluded.text()).toBe(landing);
  }
});

for (const [deployment, port] of [['a', 8000], ['b', 8100], ['c', 8200]]) {
  const prefix = `/sealog-${deployment}`;

  test(`${prefix} serves runtime assets, proxies its backend, and handles debug requests`, async ({ request }) => {
    const redirect = await request.get(prefix, { maxRedirects: 0 });
    expect(redirect.status()).toBe(301);
    expect(new URL(redirect.headers().location).pathname).toBe(`${prefix}/`);

    for (const path of ['app.js', 'src/config/constants.js', 'src/sw/helpers.js']) {
      const asset = await request.get(`${prefix}/${path}`);
      expect(asset.ok()).toBe(true);
      expect(asset.headers()['content-type']).toMatch(/javascript/);
    }
    const worker = await request.get(`${prefix}/sw.js`);
    expect(worker.ok()).toBe(true);
    expect(worker.headers()['service-worker-allowed']).toBe(`${prefix}/`);
    expect(worker.headers()['cache-control']).toBe('no-cache');

    const proxy = await request.post(`${prefix}/sealog-server/docker-probe?source=smoke`, {
      data: 'proxy body',
      headers: { 'Content-Type': 'text/plain' }
    });
    expect(proxy.ok()).toBe(true);
    expect(await proxy.json()).toMatchObject({
      deployment,
      method: 'POST',
      path: '/sealog-server/docker-probe?source=smoke',
      host: `localhost:${port}`,
      forwardedProto: 'http',
      body: 'proxy body'
    });

    const debug = `${prefix}/debug/asnap-backfill`;
    expect((await request.post(debug, { data: '{}' })).status()).toBe(204);
    expect((await request.fetch(debug, { method: 'OPTIONS' })).status()).toBe(204);
    expect((await request.get(debug)).status()).toBe(405);
  });

  test(`${prefix} installs its service worker and reopens offline`, async ({ page, context, baseURL }) => {
    await page.addInitScript(() => {
      localStorage.setItem('sealog.preset', 'light');
      localStorage.setItem('jwt', 'docker-test-jwt');
      localStorage.setItem('username', 'docker-tester');
    });
    await page.goto(`${prefix}/`);
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
    expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toBe(`${baseURL}${prefix}/sw.js`);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(`${baseURL}${prefix}/`);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#menuBtn')).toBeVisible();
    await expect(page.locator('#emptyState')).toBeVisible();
  });
}
