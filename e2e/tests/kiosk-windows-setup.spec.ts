/**
 * Windows app, first run: without kiosk.config.json the main process opens the setup screen (?setup).
 * The preload bridge is replaced by a stub that records what the screen sends to the main process.
 */
import { expect, test } from '@playwright/test';

test('first-run setup, manual way: sends the entered server, key and Windows printer to the main process', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { kiosk: unknown; __setup: { verified: unknown[]; saved: unknown[]; activated: unknown[] } };
    w.__setup = { verified: [], saved: [], activated: [] };
    w.kiosk = {
      platform: 'electron',
      invoke: () => Promise.reject(new Error('not configured')),
      on: () => () => undefined,
      setup: {
        printers: async () => ['XP-80C', 'EPSON TM-T20', 'Microsoft Print to PDF'],
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

  // the code is the easy way; this test goes the manual way
  await page.getByTestId('setup-mode').click();
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

test('first-run setup with the activation code: the on-screen pad (or a scanned link) is all it takes', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { kiosk: unknown; __setup: { activated: unknown[]; saved: unknown[] } };
    w.__setup = { activated: [], saved: [] };
    w.kiosk = {
      platform: 'electron',
      invoke: () => Promise.reject(new Error('not configured')),
      on: () => () => undefined,
      setup: {
        printers: async () => ['Microsoft Print to PDF', 'XP-80C'],
        verify: async (s: { deviceKey: string }) => (s.deviceKey === 'fresh-key-from-the-code-0123456789' ? { ok: true } : { ok: false, reason: 'auth', message: 'نه' }),
        activate: async (a: { serverUrl: string; code: string }) => {
          w.__setup.activated.push(a);
          return a.code === '20261021'
            ? { ok: true, deviceId: 'KIOSK-03', deviceName: 'کیوسک ورودی', deviceKey: 'fresh-key-from-the-code-0123456789' }
            : { ok: false, reason: 'code', message: 'کد فعال‌سازی نادرست است، یا مهلتش گذشته یا قبلاً استفاده شده؛ از پنل کد تازه بگیرید' };
        },
        save: async (v: unknown) => {
          w.__setup.saved.push(v);
          return { ok: true };
        },
      },
    };
  });
  await page.goto('/?setup');
  const state = () => page.evaluate(() => (window as unknown as { __setup: { activated: unknown[]; saved: unknown[] } }).__setup);

  await expect(page.getByTestId('setup-code')).toBeFocused();
  // the one receipt printer installed is picked already
  await expect(page.getByTestId('setup-printer-name')).toHaveValue('XP-80C');

  // a wrong code typed on the pad is reported
  for (const d of '20261020') await page.getByTestId(`key-${d}`).click();
  await expect(page.getByTestId('setup-code')).toHaveValue('20261020');
  await page.getByTestId('setup-server').fill('https://andishkadeh.liara.run');
  await page.getByTestId('setup-save').click();
  await expect(page.getByTestId('setup-error')).toContainText('کد فعال‌سازی نادرست است');

  // the scanner types the QR link into the field (here on a Persian keyboard): code and server come from it
  await page.getByTestId('key-clear').click();
  await page.getByTestId('setup-server').fill('');
  await page.getByTestId('setup-code').fill('اففحس://شدیهسانشیثا.مهشقش.قعد/؟شزفهرشفث=۲۰۲۶۱۰۲۱');
  await expect(page.getByTestId('setup-server')).toHaveValue('https://andishkadeh.liara.run');
  await page.getByTestId('setup-code').press('Enter');
  await expect(page.getByTestId('setup')).toBeHidden();
  const { activated, saved } = await state();
  expect(activated.at(-1)).toEqual({ serverUrl: 'https://andishkadeh.liara.run', code: '20261021' });
  expect(saved).toEqual([
    {
      serverUrl: 'https://andishkadeh.liara.run',
      deviceId: 'KIOSK-03',
      deviceKey: 'fresh-key-from-the-code-0123456789',
      payment: 'none',
      printer: 'windows',
      printerName: 'XP-80C',
      scanner: 'keyboard',
      devControls: false,
    },
  ]);
});
