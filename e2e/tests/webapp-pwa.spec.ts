/**
 * Customer web app (PWA, the same build as the Android app) served by the server at the root /:
 * technician setup with a freshly registered device, a full purchase with the in-page core
 * (sql.js + IndexedDB), restart from local storage, offline restart from the service worker,
 * and the one-tab-only guard.
 */
import { expect, test } from '@playwright/test';
import { addService, adminApi, adminToken, checkoutWithMobile, ordersByMobile, randomMobile } from './helpers';

test.describe.configure({ mode: 'serial' });

test('web app: setup → purchase → restart → offline restart', async ({ page, context }) => {
  const token = await adminToken();
  const deviceId = `WEB-${Date.now().toString(36).toUpperCase()}`;
  const created = await adminApi<{ apiKey: string }>(token, 'POST', '/admin/devices', { id: deviceId, name: 'کیوسک وب آزمون' });
  expect(created.status).toBe(201);

  // First run: setup screen, server address prefilled with the page's own origin.
  await page.goto('/');
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('setup-server')).toHaveValue('http://localhost:3200');
  await page.getByTestId('setup-device').fill(deviceId);
  await page.getByTestId('setup-key').fill('wrong-key-123456');
  await page.getByTestId('setup-printer').selectOption('mock');
  await page.getByTestId('setup-save').click();
  await expect(page.getByTestId('setup-error')).toContainText('پذیرفته نشد');
  await page.getByTestId('setup-key').fill(created.body.apiKey);
  await page.getByTestId('setup-save').click();

  // The in-page core pulls the catalogue and the regular kiosk UI starts.
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  // Full purchase with the simulated card reader.
  const mobile = randomMobile();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('test-banner')).toBeVisible();
  await expect(page.locator('.home-art').first()).toHaveAttribute('style', /blob:/, { timeout: 20_000 }); // images cached in IndexedDB
  await page.getByTestId('home-services').click();
  await addService(page, 'P', 'P-1', 'P-102');
  await page.getByTestId('cartbar').click();
  await checkoutWithMobile(page, mobile);
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();
  const orderNumber = (await page.getByTestId('order-number').textContent())!.trim();
  await page.getByTestId('print').click();
  await expect(page.getByTestId('print-done')).toBeVisible();

  const orders = await ordersByMobile(token, mobile);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ orderNumber, status: 'PAID', itemsCount: 1 });
  await expect.poll(async () => (await ordersByMobile(token, mobile))[0].printStatus, { timeout: 20_000 }).toBe('PRINTED');

  // Restart: no setup again, catalogue straight from the local database.
  await page.reload();
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Offline restart: the service worker serves the app, the local database the catalogue.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('start').click();
  await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.home-art').first()).toHaveAttribute('style', /blob:/);
  await context.setOffline(false);

  // A second tab must not start a second core on the same local data.
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByTestId('boot-error')).toContainText('زبانه یا پنجره دیگری', { timeout: 20_000 });
  await second.close();
});
