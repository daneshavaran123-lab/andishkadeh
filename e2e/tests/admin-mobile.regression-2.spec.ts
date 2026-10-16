// Regression: ISSUE-007 — admin pages wider than a phone: tables stretched their grid column (dashboard, categories)
// Found by /qa on 2026-10-16
// Report: .gstack/qa-reports/run-20261016T172447Z/qa-report-localhost-2026-10-16.md
import { expect, test } from '@playwright/test';
import { kioskSale, randomMobile } from './helpers';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test('dashboard and categories fit a phone; their tables scroll inside the card', async ({ page }) => {
  await kioskSale(randomMobile(), 'P-101');
  await page.goto('/admin/login');
  await page.getByLabel('نام کاربری').fill('admin');
  await page.getByLabel('رمز عبور').fill('Admin@12345');
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByTestId('logout')).toBeVisible();
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('cell', { name: /^AK-/ }).first()).toBeVisible();

  const width = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(await width()).toEqual({ scroll: 375, inner: 375 });

  await page.goto('/admin/catalog/categories');
  await expect(page.getByRole('cell', { name: /^P-1$/ })).toBeVisible();
  expect(await width()).toEqual({ scroll: 375, inner: 375 });
});
