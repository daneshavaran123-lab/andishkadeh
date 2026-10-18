/**
 * Site routes and kiosk management: the public web app is at the root / (no activation, browsing
 * only), kiosk management at /kiosk (staff sign-in, server address, Windows installer, device
 * registration, status). Activating "this browser" there makes / open as that kiosk instead, on the
 * same server and database.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/kiosk');
  await expect(page).toHaveTitle(/مدیریت کیوسک‌ها/);
  await expect(page.getByRole('heading', { name: 'ورود به مدیریت کیوسک‌ها' })).toBeVisible();
  await page.locator('input[name=username]').fill(username);
  await page.locator('input[name=password]').fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page.getByTestId('kiosk-management')).toBeVisible();
}

test('/ is the public web app: start screen at once, services, prices and plans; buying at the kiosks', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('setup')).toHaveCount(0);
  await expect(page.getByTestId('admin-gear')).toHaveCount(0);
  await expect(page.getByTestId('test-banner')).toHaveCount(0);

  await page.getByTestId('start').click();
  await expect(page.getByTestId('buy-at-kiosk')).toBeVisible();
  await expect(page.getByTestId('home-member')).toHaveCount(0);

  // Services with their prices; nothing goes into a cart.
  await page.getByTestId('home-services').click();
  await page.getByTestId('category-P').click();
  await page.getByTestId('sub-P-1').click();
  await expect(page.getByTestId('svc-P-102')).toContainText('تومان');
  await expect(page.getByTestId('add-P-102')).toHaveCount(0);
  await page.getByTestId('svc-P-102').locator('button').first().click();
  await expect(page.getByTestId('buy-at-kiosk')).toBeVisible();
  await expect(page.getByTestId('detail-add')).toHaveCount(0);

  // Plans: looked at, not bought.
  await page.reload();
  await page.getByTestId('start').click();
  await page.getByTestId('home-subscription').click();
  await expect(page.getByTestId('choose-plan')).toHaveText(/مشاهده پلن‌های اشتراک/);
  await page.getByTestId('choose-plan').click();
  await page.getByTestId('plan-1').click();
  await expect(page.getByTestId('buy-at-kiosk')).toBeVisible();
  await expect(page.getByTestId('plan-continue')).toHaveCount(0);

  // Anyone may keep it open in several tabs at once (no one-kiosk-per-browser lock).
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  await second.close();
});

test('manager: /kiosk → register a kiosk → activate this browser → / opens as that kiosk, reported online', async ({ page }) => {
  await signIn(page, 'admin', 'Admin@12345');
  await expect(page).toHaveURL(/\/kiosk\/?$/);
  await expect(page.getByTestId('server-url')).toHaveText('http://localhost:3200');
  // Offered only when the release can be downloaded; otherwise said so (depends on network access to GitHub).
  await expect(page.getByTestId('kiosk-installer').or(page.getByTestId('kiosk-installer-missing'))).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.card', { hasText: 'KIOSK-01' }).first()).toBeVisible();
  // The public web app opened by the previous test.
  const publicCard = page.locator('.card', { has: page.getByTestId('public-web-app') });
  await expect(publicCard).toContainText('WEB-APP');
  await expect(publicCard).toContainText('در حال استفاده');
  await expect(publicCard.getByRole('button', { name: 'کلید جدید' })).toHaveCount(0);

  const deviceId = `WEB-${Date.now().toString(36).toUpperCase()}`;
  await page.getByRole('button', { name: 'ثبت کیوسک جدید' }).click();
  const form = page.locator('.modal', { hasText: 'ثبت کیوسک جدید' });
  await form.locator('input').nth(0).fill(deviceId);
  await form.locator('input').nth(1).fill('کیوسک وب طبقه اول');
  await form.getByRole('button', { name: 'ثبت و دریافت کلید' }).click();

  const connection = page.getByTestId('device-connection');
  await expect(connection).toContainText('http://localhost:3200');
  await expect(connection).toContainText(deviceId);
  await expect(page.getByTestId('device-key')).not.toBeEmpty();
  await page.getByTestId('activate-browser').click();
  const heartbeat = page.waitForResponse((r) => r.url().endsWith('/api/v1/devices/heartbeat') && r.ok(), { timeout: 30_000 });
  await page.getByTestId('open-web-app').click();

  // The web app at / starts as that kiosk: no setup screen, catalogue from the same server.
  await expect(page).toHaveURL(/:3200\/$/);
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  await heartbeat;

  await page.goto('/kiosk');
  const card = page.locator('.card', { hasText: deviceId });
  await expect(card).toContainText('کیوسک وب طبقه اول');
  await expect(card).toContainText('آنلاین', { timeout: 20_000 });
});

test('operator: /kiosk shows the kiosks and the server address; registration stays with the manager', async ({ page }) => {
  await signIn(page, 'operator', 'Operator@12345');
  await expect(page.getByTestId('server-url')).toHaveText('http://localhost:3200');
  await expect(page.locator('.card', { hasText: 'KIOSK-01' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'ثبت کیوسک جدید' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'کلید جدید' })).toHaveCount(0);
  await page.getByTestId('logout').click();
  await expect(page.getByRole('heading', { name: 'ورود به مدیریت کیوسک‌ها' })).toBeVisible();
});
