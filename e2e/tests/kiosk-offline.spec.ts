import { expect, test } from '@playwright/test';
import {
  addService,
  adminApi,
  adminToken,
  buySubscription,
  checkoutWithMobile,
  devControl,
  kioskStatus,
  orderDetail,
  ordersByMobile,
  randomMobile,
  resetDevices,
  scanMember,
  startSession,
  tomanOf,
  waitFor,
} from './helpers';

test.beforeEach(async () => {
  await resetDevices();
});
test.afterAll(async () => {
  await resetDevices();
});

test('T11 — network cut: local sale with an OFF code, synced exactly once after reconnect', async ({ page }) => {
  const token = await adminToken();
  const mobile = randomMobile();

  await devControl({ action: 'network', online: false });
  await startSession(page);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.getByTestId('home-services').click();
  await addService(page, 'P', 'P-1', 'P-101');
  await page.getByTestId('cartbar').click();
  const cartTotal = await tomanOf(page, 'cart-total');
  await checkoutWithMobile(page, mobile);
  await expect(page.getByText('سفارش با کد موقت')).toBeVisible();
  expect(await tomanOf(page, 'locked-total')).toBe(cartTotal);

  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();
  const localNumber = (await page.getByTestId('order-number').textContent())!.trim();
  expect(localNumber).toMatch(/^OFF-KIOSK-01-\d{5}$/);
  await expect(page.getByText('ثبت محلی')).toBeVisible();
  await page.getByTestId('finish-no-print').click();
  await expect(page.getByTestId('end')).toBeVisible();

  // Nothing has reached the server yet; the event waits in the local outbox.
  expect(await ordersByMobile(token, mobile)).toHaveLength(0);
  expect((await kioskStatus()).outbox.pending).toBeGreaterThan(0);

  await devControl({ action: 'network', online: true });
  const status = await waitFor(kioskStatus, (s) => s.online && s.outbox.pending === 0);
  expect(status.outbox).toMatchObject({ pending: 0, failed: 0 });
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);

  const synced = await ordersByMobile(token, mobile);
  expect(synced).toHaveLength(1);
  expect(synced[0]).toMatchObject({ status: 'PAID', offline: true, total: cartTotal });
  expect(synced[0].orderNumber.startsWith(localNumber)).toBe(true);

  // Re-delivery: every event is sent again as if the acknowledgements were lost → still one order.
  await devControl({ action: 'replayOutbox' });
  await devControl({ action: 'replayOutbox' });
  const replayed = await waitFor(kioskStatus, (s) => s.outbox.pending === 0);
  expect(replayed.outbox).toMatchObject({ pending: 0, failed: 0 });
  const after = await ordersByMobile(token, mobile);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: synced[0].id, status: 'PAID', total: cartTotal });
  const detail = await orderDetail(token, after[0].id);
  expect(detail.payments).toHaveLength(1);

  const sync = await adminApi<{ items: Array<{ type: string; status: string }> }>(token, 'GET', '/admin/sync?pageSize=20');
  expect(sync.status).toBe(200);
});

test('T11b — offline: subscription sales are blocked by default policy', async ({ page }) => {
  await devControl({ action: 'network', online: false });
  await startSession(page);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  // offlineSubscriptionSales=false (open policy, PRD default): the entry is disabled, service sales stay open.
  await expect(page.getByTestId('home-subscription')).toBeDisabled();
  await expect(page.getByTestId('home-services')).toBeEnabled();
});

test('T11c — offline QR validation from the local cache, access log synced later', async ({ page }) => {
  const mobile = randomMobile();
  const qr = await buySubscription(page, mobile);
  await page.getByTestId('finish').click();
  await devControl({ action: 'syncNow' }); // pull the subscription cache delta

  await devControl({ action: 'network', online: false });
  await scanMember(page, qr);
  await expect(page.getByTestId('access-ACTIVE')).toBeVisible();
  await expect(page.getByText('بدون اتصال به مرکز')).toBeVisible();
  expect((await kioskStatus()).outbox.pending).toBeGreaterThan(0);

  await devControl({ action: 'network', online: true });
  const status = await waitFor(kioskStatus, (s) => s.outbox.pending === 0);
  expect(status.outbox.failed).toBe(0);
});
