import { test, expect } from '@playwright/test';

const landingUrl = new URL('../../landing.html', import.meta.url).href;

test('landing page lists deployments', async ({ page }) => {
  await page.goto(landingUrl);
  await expect(page.getByRole('heading', { name: 'Select a deployment' })).toBeVisible();
  await expect(page.locator('a[href="/sealog-a/"]')).toContainText('Deployment A');
  await expect(page.locator('a[href="/sealog-b/"]')).toContainText('Deployment B');
  await expect(page.locator('a[href="/sealog-c/"]')).toContainText('Deployment C');
});
