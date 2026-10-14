import { expect, test, type Page } from '@playwright/test';
import {
  addService,
  adminApi,
  adminToken,
  checkoutWithMobile,
  createOperator,
  devControl,
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
test.afterAll(async () => {
  await resetDevices();
});

/** One service in the cart → review screen with a locked order. */
async function toReview(page: Page, mobile: string, code = 'N-201', cat = 'N', sub = 'N-2') {
  await startSession(page);
  await page.getByTestId('home-services').click();
  await addService(page, cat, sub, code);
  await page.getByTestId('cartbar').click();
  await checkoutWithMobile(page, mobile);
  return tomanOf(page, 'locked-total');
}

async function dashboard(token: string) {
  return (await adminApi<{ kpis: { todaySales: number; todayPaidOrders: number }; alerts: { unknownPayments: number } }>(token, 'GET', '/admin/dashboard')).body;
}

test('T04 — a double tap on "pay" starts exactly one payment', async ({ page }) => {
  const mobile = randomMobile();
  await toReview(page, mobile);
  await page.getByTestId('pay').dblclick();
  await expect(page.getByTestId('result-paid')).toBeVisible();

  const token = await adminToken();
  const [order] = await ordersByMobile(token, mobile);
  const detail = await orderDetail(token, order.id);
  expect(detail.payments).toHaveLength(1);
  expect(detail.payments[0].status).toBe('PAID');
});

test('K16/K17 — declined card → retry on the same order → paid; one order, two attempts', async ({ page }) => {
  const mobile = randomMobile();
  const total = await toReview(page, mobile);
  await devControl({ action: 'posScenario', scenario: 'decline' });
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-failed')).toBeVisible();

  await devControl({ action: 'posScenario', scenario: 'approve' });
  await page.getByTestId('retry').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();

  const token = await adminToken();
  const orders = await ordersByMobile(token, mobile);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: 'PAID', total });
  const detail = await orderDetail(token, orders[0].id);
  expect(detail.payments.map((p) => p.status).sort()).toEqual(['FAILED', 'PAID']);
});

test('K17 — customer abandons after a cancelled payment: order cancelled, nothing charged', async ({ page }) => {
  const mobile = randomMobile();
  await toReview(page, mobile);
  await devControl({ action: 'posScenario', scenario: 'cancel' });
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-failed')).toBeVisible();
  await page.getByTestId('abandon').click();
  await expect(page.getByTestId('end')).toContainText('هیچ مبلغی');

  const token = await adminToken();
  const [order] = await ordersByMobile(token, mobile);
  expect(order.status).toBe('CANCELLED');
});

test('T06/T14 — UNKNOWN is never success: not counted in sales until an inquiry confirms it', async ({ page }) => {
  const token = await adminToken();
  const mobile = randomMobile();
  const total = await toReview(page, mobile);
  const before = await dashboard(token);

  await devControl({ action: 'posScenario', scenario: 'unknown' });
  await devControl({ action: 'inquiryMode', mode: 'unknown' });
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-unknown')).toBeVisible();
  await expect(page.getByTestId('result-paid')).toHaveCount(0);
  // The customer cannot leave before at least one inquiry.
  await expect(page.getByTestId('unknown-finish')).toBeDisabled();

  await expect.poll(async () => (await ordersByMobile(token, mobile))[0]?.status).toBe('UNKNOWN');
  const during = await dashboard(token);
  expect(during.kpis.todaySales).toBe(before.kpis.todaySales);
  expect(during.kpis.todayPaidOrders).toBe(before.kpis.todayPaidOrders);
  expect(during.alerts.unknownPayments).toBeGreaterThan(0);

  // First inquiry: still no definite answer → still UNKNOWN, leaving is now allowed.
  await page.getByTestId('inquire').click();
  await expect(page.getByTestId('result-unknown')).toBeVisible();
  await expect(page.getByTestId('unknown-finish')).toBeEnabled();

  // The terminal now reports the real outcome.
  await devControl({ action: 'inquiryMode', mode: 'truth' });
  await page.getByTestId('inquire').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();

  await expect.poll(async () => (await ordersByMobile(token, mobile))[0]?.status).toBe('PAID');
  const after = await dashboard(token);
  expect(after.kpis.todaySales).toBe(before.kpis.todaySales + total);
  const [order] = await ordersByMobile(token, mobile);
  const detail = await orderDetail(token, order.id);
  expect(detail.payments).toHaveLength(1); // resolved in place, never a second charge
  expect(detail.payments[0].status).toBe('PAID');
});

test('T05 — printer out of paper: order stays PAID, receipt can be re-printed', async ({ page }) => {
  const mobile = randomMobile();
  await toReview(page, mobile);
  await devControl({ action: 'printerMode', mode: 'paper-out' });
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();
  await page.getByTestId('print').click();
  await expect(page.getByTestId('print-failed')).toBeVisible();
  await expect(page.getByTestId('print-failed')).toContainText('کاغذ');

  const token = await adminToken();
  const [order] = await ordersByMobile(token, mobile);
  expect(order.status).toBe('PAID');
  await expect.poll(async () => (await orderDetail(token, order.id)).printStatus, { timeout: 15_000 }).toBe('FAILED');

  await devControl({ action: 'printerMode', mode: 'ok' });
  await page.getByTestId('reprint').click();
  await expect(page.getByTestId('print-done')).toBeVisible();
  await expect.poll(async () => (await orderDetail(token, order.id)).printStatus, { timeout: 15_000 }).toBe('PRINTED');
  expect((await orderDetail(token, order.id)).status).toBe('PAID');
});

test('T13 — printer offline: clear message, order kept; admin reprint reaches the kiosk once it is back', async ({ page }) => {
  const mobile = randomMobile();
  await toReview(page, mobile, 'PS-102', 'PS', 'PS-1');
  await devControl({ action: 'printerMode', mode: 'offline' });
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();
  await page.getByTestId('print').click();
  await expect(page.getByTestId('print-failed')).toContainText('چاپگر در دسترس نیست');
  await expect(page.getByTestId('print-failed')).toContainText('خرید شما ثبت شده است');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('end')).toBeVisible();

  const token = await adminToken();
  const [order] = await ordersByMobile(token, mobile);
  expect(order.status).toBe('PAID');
  await expect.poll(async () => (await orderDetail(token, order.id)).printStatus, { timeout: 15_000 }).toBe('FAILED');

  // Printer repaired → operator requests a reprint from the panel (A10); the kiosk picks it up on heartbeat.
  await devControl({ action: 'printerMode', mode: 'ok' });
  const operator = await createOperator(token);
  const cmd = await adminApi<{ commandId: string }>(operator.token, 'POST', `/admin/orders/${order.id}/print`, { deviceId: 'KIOSK-01' });
  expect(cmd.status).toBe(200);
  await devControl({ action: 'syncNow' });
  await expect.poll(async () => (await orderDetail(token, order.id)).printStatus, { timeout: 20_000 }).toBe('PRINTED');
});

test('T13b — scanner offline: the member screen says so instead of waiting silently', async ({ page }) => {
  await devControl({ action: 'scannerMode', mode: 'offline' });
  try {
    await startSession(page);
    await page.getByTestId('home-member').click();
    await expect(page.getByText('اسکنر در دسترس نیست')).toBeVisible();
    await devControl({ action: 'scannerMode', mode: 'ok' });
    await expect(page.getByText('اسکنر در دسترس نیست')).toHaveCount(0);
  } finally {
    await devControl({ action: 'scannerMode', mode: 'ok' });
  }
});
