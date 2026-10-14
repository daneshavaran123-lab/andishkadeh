import { expect, test, type Page } from '@playwright/test';
import { adminApi, adminToken, createOperator, devControl, kioskSale, orderDetail, ordersByMobile, randomMobile, resetDevices, waitFor } from './helpers';

const KIOSK_URL = 'http://localhost:5284/';

async function login(page: Page, username = 'admin', password = 'Admin@12345') {
  await page.goto('/admin/login');
  await page.getByLabel('نام کاربری').fill(username);
  await page.getByLabel('رمز عبور').fill(password);
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByTestId('logout')).toBeVisible();
}

async function dashboard(token: string) {
  return (await adminApi<{ kpis: { todaySales: number }; alerts: { unknownPayments: number } }>(token, 'GET', '/admin/dashboard')).body;
}

test.afterAll(async () => {
  await resetDevices();
});

test('A01 — wrong password is rejected, correct login opens the dashboard, logout ends the session', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('نام کاربری').fill('admin');
  await page.getByLabel('رمز عبور').fill('wrong-password');
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.locator('.alert.danger')).toBeVisible();

  await login(page);
  for (const id of ['kpi-sales', 'kpi-orders', 'kpi-subs', 'kpi-devices']) await expect(page.getByTestId(id)).toBeVisible();
  await page.getByTestId('logout').click();
  await expect(page.getByRole('button', { name: 'ورود' })).toBeVisible();
  await page.goto('/admin/orders');
  await expect(page.getByRole('button', { name: 'ورود' })).toBeVisible(); // protected route
});

test('T09 — price change in the admin panel reaches the kiosk after sync; audit records it', async ({ page, context }) => {
  const token = await adminToken();
  const list = await adminApi<Array<{ id: string; code: string; price: number }>>(token, 'GET', '/admin/services?q=P-102');
  const svc = list.body.find((s) => s.code === 'P-102')!;
  const original = svc.price;
  const next = original + 50_000;
  const fa = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

  // A sale made before the change must keep its price snapshot forever.
  const historyMobile = randomMobile();
  const history = await kioskSale(historyMobile, 'P-102');
  expect(history.outcome).toBe('PAID');

  try {
    await login(page);
    await page.goto('/admin/catalog/services');
    await page.getByTestId('services-search').fill('P-102');
    await page.getByTestId('services-search').press('Enter');
    await page.getByTestId('service-row-P-102').click();
    const price = page.getByLabel('تعرفه (تومان)');
    await expect(price).toHaveValue(String(original));
    await price.fill(String(next));
    await page.getByTestId('save-service').click();
    await expect(page.getByText('تغییرات ذخیره و برای کیوسک منتشر شد')).toBeVisible();

    // The kiosk pulls the new catalogue revision on its next sync (no restart, no rebuild).
    await devControl({ action: 'syncNow' });
    const kiosk = await context.newPage();
    await kiosk.setViewportSize({ width: 540, height: 960 });
    await kiosk.goto(KIOSK_URL);
    await kiosk.getByTestId('start').click();
    await kiosk.getByTestId('home-services').click();
    await kiosk.getByTestId('category-P').click();
    await kiosk.getByTestId('sub-P-1').click();
    await expect(kiosk.getByTestId('svc-P-102')).toContainText(fa(next));
    await kiosk.close();

    // Historical order unchanged (snapshot), even though the catalogue moved on.
    const [hist] = await ordersByMobile(token, historyMobile);
    expect(hist.total).toBe(history.total);
    const histDetail = await orderDetail(token, hist.id);
    expect(histDetail.items[0]).toMatchObject({ code: 'P-102', unitPrice: original });

    // A18 — the change is in the audit trail with before/after.
    const audit = await adminApi<{ items: Array<{ action: string; before: { price: number }; after: { price: number } }> }>(token, 'GET', '/admin/audit?action=service.price_changed&pageSize=5');
    expect(audit.body.items[0]).toMatchObject({ action: 'service.price_changed', before: { price: original }, after: { price: next } });
  } finally {
    const cur = (await adminApi<Record<string, unknown>>(token, 'GET', `/admin/services/${svc.id}`)).body;
    const keys = ['code', 'title', 'subcategoryId', 'description', 'includes', 'unit', 'mediaId', 'fullAccessIncluded', 'active', 'sortOrder'];
    const body = { ...Object.fromEntries(keys.map((k) => [k, cur[k]])), price: original };
    const r = await adminApi(token, 'PATCH', `/admin/services/${svc.id}`, body);
    expect(r.status).toBe(200);
    await devControl({ action: 'syncNow' });
  }
});

test('T10 — operator sees read-only screens and the API refuses edits with 403', async ({ page }) => {
  const token = await adminToken();
  const { username, password, token: opToken } = await createOperator(token);

  await login(page, username, password);
  await expect(page.getByRole('link', { name: 'کاربران و نقش‌ها' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'سوابق تغییرات' })).toHaveCount(0);

  await page.goto('/admin/catalog/services');
  await expect(page.getByText('دسترسی شما در این بخش فقط مشاهده است')).toBeVisible();
  await page.getByTestId('services-search').fill('P-102');
  await page.getByTestId('services-search').press('Enter');
  await page.getByTestId('service-row-P-102').click();
  await expect(page.getByLabel('تعرفه (تومان)')).toBeDisabled();
  await expect(page.getByTestId('save-service')).toHaveCount(0);

  await page.goto('/admin/discounts');
  await expect(page.getByTestId('new-discount')).toHaveCount(0);

  // Server-side enforcement, independent of the UI.
  const svc = (await adminApi<Array<{ id: string; code: string }>>(opToken, 'GET', '/admin/services?q=P-102')).body.find((s) => s.code === 'P-102')!;
  expect((await adminApi(opToken, 'PATCH', `/admin/services/${svc.id}`, { price: 1 })).status).toBe(403);
  expect((await adminApi(opToken, 'PUT', '/admin/settings', { sessionTimeoutSec: 30 })).status).toBe(403);
  expect((await adminApi(opToken, 'GET', '/admin/users')).status).toBe(403);
  expect((await adminApi(opToken, 'GET', '/admin/audit')).status).toBe(403);
  expect((await adminApi(opToken, 'GET', '/admin/orders')).status).toBe(200); // viewing is allowed
});

test('T14 — UNKNOWN payment is excluded from sales and flagged; manual reconcile counts it once', async ({ page }) => {
  const token = await adminToken();
  const mobile = randomMobile();
  const before = await dashboard(token);
  await devControl({ action: 'posScenario', scenario: 'unknown' });
  await devControl({ action: 'inquiryMode', mode: 'unknown' });
  try {
    const { orderNumber, total, outcome } = await kioskSale(mobile, 'N-104');
    expect(outcome).toBe('UNKNOWN');

    await waitFor(() => ordersByMobile(token, mobile), (o) => o[0]?.status === 'UNKNOWN');
    const during = await dashboard(token);
    expect(during.kpis.todaySales).toBe(before.kpis.todaySales);
    expect(during.alerts.unknownPayments).toBeGreaterThan(0);

    await login(page);
    await expect(page.getByTestId('alert-row').filter({ hasText: 'نامشخص' })).toBeVisible();

    // Reports: UNKNOWN shown separately, not in final sales.
    await page.goto('/admin/reports');
    await expect(page.getByTestId('report-unknown')).toBeVisible();

    // A07 — documented manual reconciliation (admin only, reason required).
    await page.goto(`/admin/payments?q=${orderNumber}`);
    const row = page.getByTestId('payment-UNKNOWN').filter({ hasText: orderNumber });
    await expect(row).toBeVisible();
    await row.getByTestId('reconcile').click();
    const dialog = page.locator('.modal');
    await dialog.locator('textarea').fill('تأیید بر اساس گزارش پایانه بانک — آزمون پذیرش');
    await dialog.getByRole('button', { name: 'ثبت نتیجه تطبیق' }).click();
    await expect(page.getByText('نتیجه تطبیق ثبت شد')).toBeVisible();
    await expect(page.getByTestId('payment-PAID').filter({ hasText: orderNumber })).toBeVisible();

    const after = await dashboard(token);
    expect(after.kpis.todaySales).toBe(before.kpis.todaySales + total);
    const [order] = await ordersByMobile(token, mobile);
    expect(order.status).toBe('PAID');
  } finally {
    await resetDevices();
  }
});

test('A03 — sales report exports to CSV and Excel', async ({ page }) => {
  await login(page);
  await page.goto('/admin/reports');
  await expect(page.getByTestId('report-paid')).toBeVisible();
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const text = (await (await csv.createReadStream()).toArray()).map(String).join('');
  expect(text.length).toBeGreaterThan(20);
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsx').click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
});

test('T15 — admin panel has no reservation / booking section', async ({ page }) => {
  await login(page);
  const nav = page.locator('nav, aside').first();
  await expect(nav).not.toContainText(/رزرو|نوبت|تقویم/);
  for (const path of ['/admin/catalog/services', '/admin/settings', '/admin/content']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: /رزرو|نوبت/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /رزرو|نوبت/ })).toHaveCount(0);
  }
});
