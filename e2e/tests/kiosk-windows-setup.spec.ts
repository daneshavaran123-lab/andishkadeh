/**
 * Windows app, first run: without kiosk.config.json the main process opens the setup screen (?setup).
 * The preload bridge is replaced by a stub that records what the screen sends to the main process.
 */
import { expect, test } from '@playwright/test';

test('first-run setup sends the entered server, key and Windows printer to the main process', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { kiosk: unknown; __setup: { verified: unknown[]; saved: unknown[] } };
    w.__setup = { verified: [], saved: [] };
    w.kiosk = {
      platform: 'electron',
      invoke: () => Promise.reject(new Error('not configured')),
      on: () => () => undefined,
      setup: {
        printers: async () => ['XP-80C', 'Microsoft Print to PDF'],
        verify: async (s: { deviceKey: string }) => {
          w.__setup.verified.push(s);
          return s.deviceKey === 'right-key-0123456789' ? { ok: true } : { ok: false, reason: 'auth', message: 'شناسه یا کلید دستگاه پذیرفته نشد' };
        },
        save: async (v: unknown) => {
          w.__setup.saved.push(v);
          return { ok: true };
        },
      },
    };
  });
  await page.goto('/?setup');

  await expect(page.getByRole('heading', { name: 'راه‌اندازی کیوسک' })).toBeVisible();
  await expect(page.getByTestId('setup-printer')).toHaveValue('windows');
  await expect(page.getByTestId('setup-payment')).toHaveValue('none');

  await page.getByTestId('setup-server').fill('https://andishkadeh.liara.run/');
  await page.getByTestId('setup-device').fill('KIOSK-02');
  await page.getByTestId('setup-key').fill('right-key-0123456789');

  // The receipt printer must be picked from the installed ones.
  await page.getByTestId('setup-save').click();
  await expect(page.getByTestId('setup-error')).toContainText('چاپگر رسید را انتخاب کنید');
  await page.getByTestId('setup-printer-name').selectOption('XP-80C');

  // A wrong key is reported and nothing is saved.
  await page.getByTestId('setup-key').fill('wrong-key-0123456789');
  await page.getByTestId('setup-save').click();
  await expect(page.getByTestId('setup-error')).toContainText('پذیرفته نشد');
  expect(await page.evaluate(() => (window as unknown as { __setup: { saved: unknown[] } }).__setup.saved)).toHaveLength(0);

  await page.getByTestId('setup-key').fill('right-key-0123456789');
  await page.getByTestId('setup-save').click();
  await expect(page.getByTestId('setup')).toBeHidden();
  const saved = await page.evaluate(() => (window as unknown as { __setup: { saved: unknown[] } }).__setup.saved);
  expect(saved).toEqual([
    {
      serverUrl: 'https://andishkadeh.liara.run',
      deviceId: 'KIOSK-02',
      deviceKey: 'right-key-0123456789',
      payment: 'none',
      printer: 'windows',
      printerName: 'XP-80C',
      scanner: 'keyboard',
      devControls: false,
    },
  ]);
});
