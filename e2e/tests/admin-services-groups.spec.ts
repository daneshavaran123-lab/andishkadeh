/**
 * Services & tariffs (A04) grouped by domain and subcategory: domains start closed, the open ones are
 * remembered when coming back from a service, and a search or filter opens the matching domains.
 */
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('نام کاربری').fill('admin');
  await page.getByLabel('رمز عبور').fill('Admin@12345');
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByTestId('logout')).toBeVisible();
}

test('services are grouped by domain; open groups are remembered; search opens matches', async ({ page }) => {
  await login(page);
  await page.goto('/admin/catalog/services');

  // Closed by default: one header per domain, no service rows.
  const measurement = page.getByRole('button', { name: /مرکز سنجش/ });
  await expect(measurement).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /مرکز تغذیه و متابولیسم/ })).toBeVisible();
  await expect(page.getByTestId('service-row-P-101')).toHaveCount(0);

  // Open a domain: its subcategories and services appear; the header count matches the rows.
  await measurement.click();
  await expect(measurement).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('service-row-P-101')).toBeVisible();
  const group = page.locator('tbody', { has: measurement });
  const count = Number((await measurement.textContent())!.match(/([۰-۹]+) خدمت/)![1].replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
  await expect(group.locator('tr[data-testid^="service-row-"]')).toHaveCount(count);
  await expect(group.locator('tr.subgroup-row').first()).toBeVisible();
  await expect(page.getByTestId('service-row-N-101')).toHaveCount(0); // other domains stay closed

  // Edit a service and come back: the domain is still open.
  await page.getByTestId('service-row-P-101').click();
  await expect(page).toHaveURL(/\/admin\/catalog\/services\/.+/);
  await page.goBack();
  await expect(page.getByTestId('service-row-P-101')).toBeVisible();

  // Close all / open all.
  await page.getByTestId('groups-close-all').click();
  await expect(page.getByTestId('service-row-P-101')).toHaveCount(0);
  await page.getByTestId('groups-open-all').click();
  await expect(page.getByTestId('service-row-N-101')).toBeVisible();
  await page.getByTestId('groups-close-all').click();

  // A search opens the domains that contain matches, without touching the remembered state.
  await page.getByTestId('services-search').fill('N-101');
  await page.getByTestId('services-search').press('Enter');
  await expect(page.getByTestId('service-row-N-101')).toBeVisible();
  await expect(page.getByRole('button', { name: /مرکز سنجش/ })).toHaveCount(0);
});

test('domains and subgroups: every subgroup shows its image, which the edit dialog can change', async ({ page }) => {
  await login(page);
  await page.goto('/admin/catalog/categories');
  const row = page.locator('tr', { hasText: 'مکمل‌یاری' });
  await expect(row.locator('img.thumb')).toHaveAttribute('src', /\/api\/v1\/media\//);
  await row.getByRole('button', { name: 'ویرایش' }).click();
  const dialog = page.locator('.modal', { hasText: 'ویرایش مکمل‌یاری' });
  await expect(dialog.getByText('تصویر زیرگروه')).toBeVisible();
  await expect(dialog.locator('img.thumb')).toBeVisible();
  await expect(dialog.locator('button', { hasText: 'تغییر تصویر' })).toBeVisible();
  await dialog.getByRole('button', { name: 'انصراف' }).click();
});
