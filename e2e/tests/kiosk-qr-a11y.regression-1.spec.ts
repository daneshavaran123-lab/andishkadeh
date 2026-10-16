// Regression: ISSUE-005 — membership QR image on the kiosk activation screen had no accessible name
// Found by /qa on 2026-10-16
// Report: .gstack/qa-reports/run-20261016T172447Z/qa-report-localhost-2026-10-16.md
import { expect, test } from '@playwright/test';
import { buySubscription, randomMobile } from './helpers';

test('activation screen: the membership QR is announced as the membership card', async ({ page }) => {
  await buySubscription(page, randomMobile());
  await expect(page.getByRole('img', { name: 'کد QR کارت عضویت' })).toBeVisible();
});
