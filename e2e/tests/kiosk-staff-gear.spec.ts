/**
 * The staff gear on the kiosk's welcome screen: only there, opens the sign-in with the on-screen
 * keyboard, reports a wrong password, and forgets what was typed when closed.
 */
import { expect, test } from '@playwright/test';
import { resetDevices } from './helpers';

test.beforeEach(async () => {
  await resetDevices();
});

test('gear only on the welcome screen; sign-in reports a wrong password and forgets the input', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByTestId('admin-gear')).toBeVisible();

  await page.getByTestId('admin-gear').click();
  await expect(page.getByTestId('admin-login')).toBeVisible();
  await expect(page.getByTestId('text-keyboard')).toBeVisible();
  await page.getByTestId('admin-username').click();
  for (const ch of 'operator') await page.getByTestId(`tk-${ch}`).click();
  await page.getByTestId('tk-back').click();
  await page.getByTestId('tk-r').click();
  await expect(page.getByTestId('admin-username')).toHaveValue('operator');
  await page.getByTestId('admin-password').fill('not-the-password');
  await page.getByTestId('admin-submit').click();
  await expect(page.getByTestId('admin-login-error')).toHaveText('نام کاربری یا رمز عبور نادرست است');
  await expect(page.getByTestId('admin-password')).toHaveValue('');

  // Closing forgets everything typed.
  await page.getByTestId('admin-cancel').click();
  await expect(page.getByTestId('admin-login')).toHaveCount(0);
  await page.getByTestId('admin-gear').click();
  await expect(page.getByTestId('admin-username')).toHaveValue('');
  await page.getByTestId('admin-cancel').click();

  // A correct sign-in (this resets the failed-attempt counter). In this browser-only development
  // setup the kiosk UI and the panel are on different addresses, so the panel cannot open here.
  await page.getByTestId('admin-gear').click();
  await page.getByTestId('admin-username').fill('operator');
  await page.getByTestId('admin-password').fill('Operator@12345');
  await page.getByTestId('admin-submit').click();
  await expect(page.getByTestId('admin-login-error')).toContainText('برنامه ویندوز');
  await page.getByTestId('admin-cancel').click();

  // No gear once the customer has started.
  await page.getByTestId('start').click();
  await expect(page.getByTestId('home-services')).toBeVisible();
  await expect(page.getByTestId('admin-gear')).toHaveCount(0);
});
