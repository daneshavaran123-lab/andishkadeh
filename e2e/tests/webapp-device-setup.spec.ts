/**
 * Site routes and kiosk management: the public web app is at the root / (no activation, browsing
 * only), kiosk management at /kiosk (staff sign-in, server address, Windows installer, device
 * registration, status). Activating "this browser" there makes / open as that kiosk instead, on the
 * same server and database.
 */
import { expect, test, type Page } from '@playwright/test';
import { settled } from './helpers';

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
  // the smoke layer is there (it draws only on a GPU) and lets taps through to the start button
  await expect(page.getByTestId('start-smoke')).toBeAttached();

  await page.getByTestId('start').click();
  await expect(page.getByTestId('buy-at-kiosk')).toBeVisible();
  await expect(page.getByTestId('start-smoke')).toHaveCount(0);
  await expect(page.getByTestId('home-member')).toHaveCount(0);

  // A change of screen is soft: the old screen fades away while the new one glides in.
  const motion = await page.evaluate(
    () =>
      new Promise<string[]>((done) => {
        const names = new Set<string>();
        (document.querySelector('[data-testid="home-services"]') as HTMLElement).click();
        const t0 = performance.now();
        const look = () => {
          for (const a of document.getAnimations()) if (a instanceof CSSAnimation) names.add(a.animationName);
          if (performance.now() - t0 < 600) requestAnimationFrame(look);
          else done([...names]);
        };
        requestAnimationFrame(look);
      }),
  );
  expect(motion).toEqual(expect.arrayContaining(['screen-out-forward', 'screen-in-forward']));

  // Services with their prices; nothing goes into a cart. Every subgroup has its own image; a tap
  // answers with a ring at the finger.
  await page.getByTestId('category-P').click();
  await expect(page.getByTestId('sub-P-1').locator('.row-art')).toHaveAttribute('style', /blob:/, { timeout: 20_000 });
  const art = (code: string) => page.getByTestId(`sub-${code}`).locator('.row-art').getAttribute('style');
  expect(await art('P-1')).not.toBe(await art('P-2'));
  const sub = (await page.getByTestId('sub-P-1').boundingBox())!;
  await expect(page.locator('.tap-ring')).toHaveCount(0); // the ring of the tap that opened this screen is gone
  await settled(page);
  await page.mouse.move(sub.x + sub.width / 2, sub.y + sub.height / 2);
  await page.mouse.down();
  await expect(page.locator('.tap-ring')).toHaveCount(1);
  await page.mouse.up(); // the tap opens the subgroup
  await expect(page.getByTestId('svc-P-102')).toContainText('تومان');
  await expect(page.getByTestId('svc-P-102')).not.toHaveClass(/has-photo/); // small thumbnails stay square
  await expect(page.getByTestId('add-P-102')).toHaveCount(0);
  await page.getByTestId('svc-P-102').locator('button').first().click();
  await expect(page.getByTestId('buy-at-kiosk')).toBeVisible();
  await expect(page.getByTestId('detail-add')).toHaveCount(0);

  // Nutrition: a large photo of its own at the start of every service row; a tap on it opens the service.
  await page.reload();
  await page.getByTestId('start').click();
  await page.getByTestId('home-services').click();
  await page.getByTestId('category-N').click();
  await page.getByTestId('sub-N-1').click();
  await expect(page.getByTestId('svc-N-101')).toHaveClass(/has-photo/);
  const photo = (code: string) => page.getByTestId(`svc-${code}`).locator('.svc-photo');
  await expect(photo('N-101')).toHaveAttribute('style', /blob:/, { timeout: 20_000 });
  expect(await photo('N-101').getAttribute('style')).not.toBe(await photo('N-102').getAttribute('style'));
  await settled(page);
  const box = (await photo('N-102').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
  await expect(page.getByTestId('buy-at-kiosk')).toBeVisible();

  // Psychological assessment: photos from PS-103 on; PS-101 and PS-102 (small images of their own)
  // show the subgroup's photo, so the list keeps its photo rows.
  await page.reload();
  await page.getByTestId('start').click();
  await page.getByTestId('home-services').click();
  await page.getByTestId('category-PS').click();
  await page.getByTestId('sub-PS-1').click();
  await expect(page.getByTestId('svc-PS-101')).toHaveClass(/has-photo/);
  await expect(photo('PS-103')).toHaveAttribute('style', /blob:/, { timeout: 20_000 });
  await expect(photo('PS-101')).toHaveAttribute('style', /blob:/);
  expect(await photo('PS-101').getAttribute('style')).not.toBe(await photo('PS-103').getAttribute('style'));

  // Plans: looked at, not bought.
  await page.reload();
  await page.getByTestId('start').click();
  await page.getByTestId('home-subscription').click();
  await expect(page.getByTestId('choose-plan')).toHaveText(/مشاهده پلن‌های اشتراک/);
  await page.getByTestId('choose-plan').click();
  // every plan card has its photo, each a different one
  const planPhoto = (months: number) => page.getByTestId(`plan-${months}`).locator('.plan-photo');
  await expect(planPhoto(1)).toHaveAttribute('style', /blob:/, { timeout: 20_000 });
  expect(await planPhoto(1).getAttribute('style')).not.toBe(await planPhoto(3).getAttribute('style'));
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
