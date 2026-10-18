/**
 * Staff access from the kiosk (web app served by the server at /): the gear on the welcome
 * screen signs in with the on-screen keyboard and opens the existing admin panel (/admin) for the
 * staff member's role; logout, idle timeout and expiry return to the kiosk; a price changed in the
 * panel is on the kiosk when it comes back.
 */
import { expect, test, type Page } from '@playwright/test';
import { adminApi, adminToken } from './helpers';

// sessionStorage keys of the panel session (packages/shared/src/kiosk-admin.ts).
const ADMIN_TOKEN_STORAGE_KEY = 'andishkadeh.admin.token';
const ADMIN_KIOSK_STORAGE_KEY = 'andishkadeh.admin.kiosk';

test.describe.configure({ mode: 'serial' });

const fa = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/** A freshly registered web kiosk in this browser, at its welcome screen. */
async function setUpKiosk(page: Page) {
  const token = await adminToken();
  const deviceId = `ADM-${Date.now().toString(36).toUpperCase()}`;
  const created = await adminApi<{ apiKey: string }>(token, 'POST', '/admin/devices', { id: deviceId, name: 'کیوسک آزمون ورود مدیر' });
  expect(created.status).toBe(201);
  await page.goto('/');
  await page.getByTestId('setup-device').fill(deviceId);
  await page.getByTestId('setup-key').fill(created.body.apiKey);
  await page.getByTestId('setup-printer').selectOption('mock');
  await page.getByTestId('setup-save').click();
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
}

/** Types on the kiosk's own keyboard (shift for capitals, the symbol page for @). */
async function typeOnKeyboard(page: Page, text: string) {
  for (const ch of text) {
    const symbol = !/[a-z0-9]/i.test(ch);
    if (symbol) await page.getByTestId('tk-mode').click();
    if (/[A-Z]/.test(ch)) await page.getByRole('button', { name: 'حروف بزرگ' }).click();
    await page.getByTestId(`tk-${ch.toLowerCase()}`).click();
    if (symbol) await page.getByTestId('tk-mode').click();
  }
}

async function signIn(page: Page, username: string, password: string) {
  await page.getByTestId('admin-gear').click();
  await expect(page.getByTestId('admin-login')).toBeVisible();
  await page.getByTestId('admin-username').fill(username);
  await page.getByTestId('admin-password').fill(password);
  await page.getByTestId('admin-submit').click();
}

const storage = (page: Page) =>
  page.evaluate(([t, k]) => ({ token: sessionStorage.getItem(t), kiosk: sessionStorage.getItem(k) }), [ADMIN_TOKEN_STORAGE_KEY, ADMIN_KIOSK_STORAGE_KEY] as const);

test('manager: gear → sign-in on the kiosk keyboard → existing panel → price change → logout → kiosk shows it', async ({ page }) => {
  await setUpKiosk(page);
  const token = await adminToken();
  const list = await adminApi<Array<{ id: string; code: string; price: number }>>(token, 'GET', '/admin/services?q=P-101');
  const svc = list.body.find((s) => s.code === 'P-101')!;
  const next = svc.price + 20_000;

  try {
    // Sign-in with the on-screen keyboard; a wrong password is refused and cleared.
    await page.getByTestId('admin-gear').click();
    await page.getByTestId('admin-username').click();
    await typeOnKeyboard(page, 'admin');
    await expect(page.getByTestId('admin-username')).toHaveValue('admin');
    await page.getByTestId('admin-password').click();
    await typeOnKeyboard(page, 'Wrong@99');
    await page.getByTestId('admin-submit').click();
    await expect(page.getByTestId('admin-login-error')).toContainText('نادرست');
    await expect(page.getByTestId('admin-password')).toHaveValue('');
    await page.getByTestId('admin-password').click();
    await typeOnKeyboard(page, 'Admin@12345');
    await page.getByTestId('admin-submit').click();

    // The existing panel, on the manager's dashboard, in kiosk mode.
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'داشبورد' })).toBeVisible();
    await expect(page.getByTestId('kiosk-mode')).toBeVisible();
    await expect(page.getByTestId('logout')).toHaveText(/بازگشت به کیوسک/);
    expect((await storage(page)).token).toBeTruthy();

    // Change a price in the panel.
    await page.goto('/admin/catalog/services');
    await page.getByTestId('services-search').fill('P-101');
    await page.getByTestId('services-search').press('Enter');
    await page.getByTestId('service-row-P-101').click();
    await page.getByLabel('تعرفه (تومان)').fill(String(next));
    await page.getByTestId('save-service').click();
    await expect(page.getByText('تغییرات ذخیره و برای کیوسک منتشر شد')).toBeVisible();

    // Logout returns to the kiosk's welcome screen; the session is gone from the browser.
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/:3200\/$/);
    await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
    expect(await storage(page)).toEqual({ token: null, kiosk: null });

    // The kiosk synced on its way back: the new price is on sale.
    await page.getByTestId('start').click();
    await page.getByTestId('home-services').click();
    await page.getByTestId('category-P').click();
    await page.getByTestId('sub-P-1').click();
    await expect(page.getByTestId('svc-P-101')).toContainText(fa(next), { timeout: 20_000 });
  } finally {
    const cur = (await adminApi<Record<string, unknown>>(token, 'GET', `/admin/services/${svc.id}`)).body;
    const keys = ['code', 'title', 'subcategoryId', 'description', 'includes', 'unit', 'mediaId', 'fullAccessIncluded', 'active', 'sortOrder'];
    expect((await adminApi(token, 'PATCH', `/admin/services/${svc.id}`, { ...Object.fromEntries(keys.map((k) => [k, cur[k]])), price: svc.price })).status).toBe(200);
  }
});

test('reception staff land on the orders page; expiry and idle time both return to the kiosk', async ({ page }) => {
  await setUpKiosk(page);
  await signIn(page, 'operator', 'Operator@12345');
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(page.getByRole('heading', { name: 'سفارش‌ها' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'کاربران و نقش‌ها' })).toHaveCount(0); // the panel's own role rules

  // Session end (the token expires at the same moment).
  await page.evaluate((key) => {
    const s = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify({ ...s, expiresAt: new Date(Date.now() + 1500).toISOString() }));
  }, ADMIN_KIOSK_STORAGE_KEY);
  await page.reload();
  await expect(page).toHaveURL(/:3200\/$/, { timeout: 15_000 });
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  expect(await storage(page)).toEqual({ token: null, kiosk: null });

  // Idle timeout.
  await signIn(page, 'operator', 'Operator@12345');
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await page.evaluate((key) => {
    const s = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify({ ...s, idleMinutes: 0.02 }));
  }, ADMIN_KIOSK_STORAGE_KEY);
  await page.reload();
  await expect(page).toHaveURL(/:3200\/$/, { timeout: 15_000 });
});
