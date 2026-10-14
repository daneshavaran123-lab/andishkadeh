import { expect, test } from '@playwright/test';
import {
  addService,
  adminToken,
  backToCategories,
  checkoutWithMobile,
  orderDetail,
  ordersByMobile,
  randomMobile,
  resetDevices,
  startSession,
  tomanOf,
} from './helpers';

test.beforeEach(async () => {
  await resetDevices();
});

test('T01 — three services from three domains, one payment, one order, receipt printed', async ({ page }) => {
  const mobile = randomMobile();
  await startSession(page);
  await expect(page.getByTestId('test-banner')).toBeVisible(); // simulated hardware is never hidden
  await page.getByTestId('home-services').click();

  await addService(page, 'P', 'P-1', 'P-102');
  await backToCategories(page);
  await addService(page, 'N', 'N-1', 'N-101');
  await backToCategories(page);
  await addService(page, 'PS', 'PS-1', 'PS-101');

  await page.getByTestId('cartbar').click();
  for (const code of ['P-102', 'N-101', 'PS-101']) await expect(page.getByTestId(`cart-${code}`)).toBeVisible();
  const cartTotal = await tomanOf(page, 'cart-total');
  expect(cartTotal).toBeGreaterThan(0);

  await checkoutWithMobile(page, mobile);
  const fa = (v: string) => v.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  await expect(page.getByTestId('masked-mobile')).toContainText(fa(mobile.slice(-4)));
  await expect(page.getByTestId('masked-mobile')).not.toContainText(fa(mobile)); // never shown in full
  expect(await tomanOf(page, 'locked-total')).toBe(cartTotal);

  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();
  const orderNumber = (await page.getByTestId('order-number').textContent())!.trim();
  expect(orderNumber).toMatch(/^AK-\d{6}$/);

  await page.getByTestId('print').click();
  await expect(page.getByTestId('print-done')).toBeVisible();
  await expect(page.getByTestId('end')).toBeVisible({ timeout: 10_000 });

  // Server side: exactly one PAID order with the three locked lines and one PAID attempt.
  const token = await adminToken();
  const orders = await ordersByMobile(token, mobile);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ orderNumber, status: 'PAID', total: cartTotal, itemsCount: 3 });
  const detail = await orderDetail(token, orders[0].id);
  expect(detail.items.map((i) => i.code).sort()).toEqual(['N-101', 'P-102', 'PS-101']);
  expect(detail.payments.map((p) => p.status)).toEqual(['PAID']);
  expect(detail.payments[0].amount).toBe(cartTotal);
  await expect.poll(async () => (await orderDetail(token, orders[0].id)).printStatus, { timeout: 15_000 }).toBe('PRINTED');

  // K23 → K01: the end screen returns to start and the cart is gone.
  await page.getByTestId('end-now').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start').click();
  await page.getByTestId('home-services').click();
  await expect(page.getByTestId('cartbar')).toHaveCount(0);
});

test('T02 — removing an item recalculates the total before payment', async ({ page }) => {
  await startSession(page);
  await page.getByTestId('home-services').click();
  await addService(page, 'P', 'P-1', 'P-101');
  await page.getByTestId('back').click(); // services → subgroups of P
  await page.getByTestId('sub-P-2').click();
  await page.getByTestId('add-P-201').click();
  await backToCategories(page);
  await addService(page, 'N', 'N-2', 'N-201');

  await page.getByTestId('cartbar').click();
  const before = await tomanOf(page, 'cart-total');
  const line = await tomanOf(page, 'line-P-201');
  expect(line).toBeGreaterThan(0);

  await page.getByTestId('remove-P-201').click();
  await expect(page.getByTestId('cart-P-201')).toHaveCount(0);
  await expect.poll(() => tomanOf(page, 'cart-total')).toBe(before - line);

  // The locked order total follows the recalculated cart.
  await checkoutWithMobile(page, randomMobile());
  expect(await tomanOf(page, 'locked-total')).toBe(before - line);
});

test('T12 — auto return from the mobile screen wipes the personal data from the UI', async ({ page }) => {
  await page.clock.install();
  await startSession(page);
  await page.getByTestId('home-services').click();
  await addService(page, 'N', 'N-1', 'N-104');
  await page.getByTestId('cartbar').click();
  await page.getByTestId('checkout').click();
  for (const d of '0912345') await page.getByTestId(`key-${d}`).click();
  await expect(page.getByTestId('mobile-display')).toContainText('۰۹۱۲');

  // Default policy: 90 s timeout with a 15 s warning (admin-configurable).
  await page.clock.runFor(78_000);
  await expect(page.getByTestId('timeout-countdown')).toBeVisible();
  await page.clock.runFor(14_000);
  await expect(page.getByTestId('start')).toBeVisible();

  // Next customer: empty cart, empty mobile field.
  await page.getByTestId('start').click();
  await page.getByTestId('home-services').click();
  await expect(page.getByTestId('category-N')).toBeVisible();
  await expect(page.getByTestId('cartbar')).toHaveCount(0);
  await addService(page, 'N', 'N-1', 'N-105');
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-N-104')).toHaveCount(0);
  await page.getByTestId('checkout').click();
  await expect(page.getByTestId('mobile-display')).not.toContainText('۰۹۱۲۳۴۵');
  await expect(page.getByTestId('mobile-confirm')).toBeDisabled();
});

test('T12b — "stay" on the warning keeps the session', async ({ page }) => {
  await page.clock.install();
  await startSession(page);
  await page.getByTestId('home-services').click();
  await addService(page, 'N', 'N-1', 'N-105');
  await page.clock.runFor(80_000);
  await page.getByTestId('timeout-stay').click();
  await expect(page.getByTestId('timeout-countdown')).toHaveCount(0);
  await page.clock.runFor(30_000);
  await expect(page.getByTestId('cartbar')).toBeVisible();
});

test('T15 — no reservation, booking or appointment feature anywhere on the kiosk', async ({ page }) => {
  const banned = /رزرو|نوبت|وقت‌دهی|تقویم/;
  await startSession(page);
  await expect(page.locator('body')).not.toContainText(banned);
  await page.getByTestId('home-services').click();
  await expect(page.locator('body')).not.toContainText(banned);
  for (const [cat, sub] of [
    ['P', 'P-1'],
    ['N', 'N-1'],
    ['PS', 'PS-1'],
  ]) {
    await page.getByTestId(`category-${cat}`).click();
    await expect(page.locator('body')).not.toContainText(banned);
    await page.getByTestId(`sub-${sub}`).click();
    await expect(page.locator('body')).not.toContainText(banned);
    await page.locator('[data-testid^="svc-"] h3').first().click(); // K08 service detail
    await expect(page.locator('body')).not.toContainText(banned);
    await backToCategories(page);
  }
  await page.getByTestId('back').click();
  await page.getByTestId('home-subscription').click();
  await expect(page.locator('body')).not.toContainText(banned);
  await page.getByTestId('choose-plan').click();
  await expect(page.locator('body')).not.toContainText(banned);
  await expect(page.getByRole('button', { name: banned })).toHaveCount(0);
  await expect(page.getByRole('link', { name: banned })).toHaveCount(0);
});
