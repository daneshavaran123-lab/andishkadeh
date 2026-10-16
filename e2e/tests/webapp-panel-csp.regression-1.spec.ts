// Regression: ISSUE-004 — admin panel was served without a Content-Security-Policy
// Found by /qa on 2026-10-16
// Report: .gstack/qa-reports/run-20261016T172447Z/qa-report-localhost-2026-10-16.md
// Runs against the production build of the panel served by the API server (single-origin deployment).
import { expect, test } from '@playwright/test';
import { adminToken, kioskSale, ordersByMobile, randomMobile } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

test('production admin panel runs under a strict CSP: pages, images and receipt printing still work', async ({ page }) => {
  const mobile = randomMobile();
  const sale = await kioskSale(mobile, 'P-101');
  expect(sale.outcome).toBe('PAID');
  const [order] = await ordersByMobile(await adminToken(), mobile);

  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });

  await page.goto('/admin/login');
  const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(meta).toHaveCount(1);
  const csp = await meta.getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-eval'");

  await page.getByLabel('نام کاربری').fill('admin');
  await page.getByLabel('رمز عبور').fill('Admin@12345');
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByTestId('logout')).toBeVisible();

  for (const path of ['/admin/dashboard', '/admin/catalog/services', '/admin/media', '/admin/content']) {
    await page.goto(path, { waitUntil: 'networkidle' });
  }
  // Media thumbnails are loaded from the API under img-src.
  const broken = await page.locator('img').evaluateAll((imgs) => (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth === 0).length);
  expect(broken).toBe(0);

  // The receipt popup inherits the panel's CSP: printing must not depend on an inline script.
  await page.goto(`/admin/orders/${order.id}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const open = window.open.bind(window);
    window.open = (...args: Parameters<typeof window.open>) => {
      const w = open(...args);
      if (w) w.print = () => void ((window as unknown as { __printed: boolean }).__printed = true);
      return w;
    };
  });
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: /چاپ/ }).first().click();
  await expect((await popup).locator('body')).toContainText(sale.orderNumber);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed === true)).toBe(true);

  expect(violations).toEqual([]);
});

// Found by /review on 2026-10-16: media URLs are absolute (server PUBLIC_BASE_URL). Opening the panel under
// another address of the same server (here 127.0.0.1 vs localhost) must not block the thumbnails.
test('thumbnails still load when the panel is opened under another address of the server', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('http://127.0.0.1:3200/admin/login');
  await page.getByLabel('نام کاربری').fill('admin');
  await page.getByLabel('رمز عبور').fill('Admin@12345');
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByTestId('logout')).toBeVisible();
  await page.goto('http://127.0.0.1:3200/admin/media', { waitUntil: 'networkidle' });
  const imgs = page.locator('img');
  expect(await imgs.count()).toBeGreaterThan(0);
  const broken = await imgs.evaluateAll((list) => (list as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth === 0).length);
  expect(broken).toBe(0);
  expect(violations).toEqual([]);
});

