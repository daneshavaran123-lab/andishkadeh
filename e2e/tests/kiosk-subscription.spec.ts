import { expect, test } from '@playwright/test';
import { withDb } from './db';
import { adminApi, adminToken, buySubscription, devControl, ordersByMobile, randomMobile, resetDevices, scanMember as scan, scanReady, typeMobile } from './helpers';

test.beforeEach(async () => {
  await resetDevices();
});

test('T07 — buy a plan, receive the QR, scan it → ACTIVE with masked member', async ({ page }) => {
  const mobile = randomMobile();
  const qr = await buySubscription(page, mobile);
  await expect(page.getByTestId('expires')).toBeVisible();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('end')).toBeVisible();

  await scan(page, qr);
  const result = page.getByTestId('access-ACTIVE');
  await expect(result).toBeVisible();
  const tail = mobile.slice(-4).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  await expect(result).toContainText(tail);
  await expect(result).not.toContainText(mobile.slice(0, 7).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]));

  // Same card through a USB HID scanner in keyboard-wedge mode (fast keystrokes + Enter).
  await page.getByTestId('access-done').click();
  await page.getByTestId('start').click();
  await page.getByTestId('home-member').click();
  await scanReady(page);
  await page.keyboard.type(qr, { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('access-ACTIVE')).toBeVisible();

  const token = await adminToken();
  const [order] = await ordersByMobile(token, mobile);
  expect(order).toMatchObject({ status: 'PAID' });
  const subs = await adminApi<{ items: Array<{ status: string; state: string }> }>(token, 'GET', `/admin/subscriptions?q=${mobile}`);
  expect(subs.body.items).toHaveLength(1);
  expect(subs.body.items[0]).toMatchObject({ status: 'ACTIVE', state: 'active' });
});

test('T07b — renewal with an active plan starts from the end of the current one', async ({ page }) => {
  const mobile = randomMobile();
  await buySubscription(page, mobile);
  await page.getByTestId('finish').click();
  await page.getByTestId('end-now').click();

  await page.getByTestId('start').click();
  await page.getByTestId('home-subscription').click();
  await page.getByTestId('choose-plan').click();
  await page.getByTestId('plan-3').click();
  await page.getByTestId('plan-continue').click();
  await typeMobile(page, mobile);
  await expect(page.getByText('شما اشتراک فعال تا')).toBeVisible();
  await page.getByTestId('pay').click();
  await page.getByTestId('to-activation').click();
  await expect(page.getByText('این اشتراک پس از پایان اشتراک فعلی شما شروع می‌شود')).toBeVisible();

  const token = await adminToken();
  const subs = await adminApi<{ items: Array<{ startsAt: string; expiresAt: string; state: string }> }>(token, 'GET', `/admin/subscriptions?q=${mobile}`);
  const [newer, older] = subs.body.items; // newest first
  expect(newer.state).toBe('upcoming');
  expect(new Date(newer.startsAt).getTime()).toBe(new Date(older.expiresAt).getTime());
});

test('T08 — unknown code → INVALID; cancelled subscription → REVOKED', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await page.getByTestId('home-member').click();
  await scanReady(page);
  await devControl({ action: 'scan', payload: 'AKQ1.notARealMembershipCode_000000000' });
  await expect(page.getByTestId('access-INVALID')).toBeVisible();
  await page.getByTestId('rescan').click();
  await scanReady(page);
  await devControl({ action: 'scan', payload: 'https://example.com/not-ours' });
  await expect(page.getByTestId('access-INVALID')).toBeVisible();

  const mobile = randomMobile();
  const qr = await buySubscription(page, mobile);
  await page.getByTestId('finish').click();

  const token = await adminToken();
  const subs = await adminApi<{ items: Array<{ id: string }> }>(token, 'GET', `/admin/subscriptions?q=${mobile}`);
  const cancel = await adminApi(token, 'POST', `/admin/subscriptions/${subs.body.items[0].id}/cancel`, { reason: 'آزمون پذیرش — ابطال کارت' });
  expect(cancel.status).toBe(200);

  await scan(page, qr);
  await expect(page.getByTestId('access-REVOKED')).toBeVisible();
  await expect(page.getByTestId('access-REVOKED')).not.toContainText(mobile.slice(-4).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]));
});

test('T08b — expired subscription → EXPIRED with the end date and an offer to buy a new plan', async ({ page }) => {
  const mobile = randomMobile();
  const qr = await buySubscription(page, mobile);
  await page.getByTestId('finish').click();

  // Fixture: move this member's period into the past (the UI cannot sell an expired plan).
  const token = await adminToken();
  const subs = await adminApi<{ items: Array<{ id: string }> }>(token, 'GET', `/admin/subscriptions?q=${mobile}`);
  await withDb(async (db) => {
    const day = 86_400_000;
    await db.subscription.update({
      where: { id: subs.body.items[0].id },
      data: { startsAt: new Date(Date.now() - 40 * day), expiresAt: new Date(Date.now() - 10 * day) },
    });
  });

  await scan(page, qr);
  const result = page.getByTestId('access-EXPIRED');
  await expect(result).toBeVisible();
  await expect(result).toContainText('به پایان رسیده است');
  await expect(result).not.toContainText(mobile.slice(-4).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]));
  await expect(page.getByTestId('buy-new')).toBeVisible();
  await page.getByTestId('buy-new').click();
  await expect(page.getByTestId('plan-1')).toBeVisible();
});
