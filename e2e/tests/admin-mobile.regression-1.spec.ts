// Regression: ISSUE-002 — admin panel at phone width: top bar overflowed, sidebar peeked in, menu button could not be tapped
// Found by /qa on 2026-10-16
// Report: .gstack/qa-reports/run-20261016T172447Z/qa-report-localhost-2026-10-16.md
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test('admin panel on a phone: no sideways overflow, menu opens and navigates', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('نام کاربری').fill('admin');
  await page.getByLabel('رمز عبور').fill('Admin@12345');
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByTestId('logout')).toBeVisible();
  await page.goto('/admin/orders');

  const width = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  // Page wider than the screen → the phone zooms out and the hidden sidebar shows at the edge.
  expect(await width()).toEqual({ scroll: 375, inner: 375 });
  await expect(page.getByTestId('logout')).toBeInViewport();

  await page.getByRole('button', { name: 'منو' }).tap();
  const link = page.getByRole('link', { name: 'پرداخت‌ها' });
  await expect(link).toBeInViewport();
  await link.tap();
  await expect(page).toHaveURL(/\/admin\/payments$/);
  await expect(link).not.toBeInViewport(); // the drawer closes after choosing a page
  expect(await width()).toEqual({ scroll: 375, inner: 375 });
});
