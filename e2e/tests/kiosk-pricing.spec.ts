import { expect, test } from '@playwright/test';
import { addService, adminApi, adminToken, checkoutWithMobile, devControl, orderDetail, ordersByMobile, randomMobile, resetDevices, startSession, tomanOf } from './helpers';

test.beforeEach(async () => {
  await resetDevices();
});

test('T03 — admin discount: correct final price on the kiosk and a frozen snapshot on the order', async ({ page }) => {
  const token = await adminToken();
  const services = await adminApi<Array<{ id: string; code: string; price: number }>>(token, 'GET', '/admin/services?q=N-302');
  const svc = services.body.find((s) => s.code === 'N-302')!;
  const expectedFinal = Math.round(svc.price * 0.8);
  const title = `تخفیف پذیرش ${Date.now().toString(36)}`;
  const fa = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

  const created = await adminApi<{ id: string }>(token, 'POST', '/admin/discounts', {
    title,
    type: 'PERCENT',
    value: 20,
    priority: 100,
    active: true,
    startsAt: null,
    endsAt: null,
    targets: [{ targetType: 'SERVICE', targetId: svc.id }],
  });
  expect(created.status).toBe(201);
  let discountId: string | null = created.body.id;

  try {
    await devControl({ action: 'syncNow' }); // kiosk pulls the new catalogue revision
    const mobile = randomMobile();
    await startSession(page);
    await page.getByTestId('home-services').click();
    await page.getByTestId('category-N').click();
    await page.getByTestId('sub-N-3').click();
    const card = page.getByTestId('svc-N-302');
    await expect(card).toContainText(title);
    await expect(card.locator('.was')).toBeVisible(); // original price struck through
    await expect(card.locator('.final')).toContainText(fa(expectedFinal));
    await page.getByTestId('add-N-302').click();
    await page.getByTestId('cartbar').click();
    expect(await tomanOf(page, 'line-N-302')).toBe(expectedFinal);

    await checkoutWithMobile(page, mobile);
    expect(await tomanOf(page, 'locked-total')).toBe(expectedFinal);
    await expect(page.getByText(title)).toBeVisible();
    await page.getByTestId('pay').click();
    await expect(page.getByTestId('result-paid')).toBeVisible();

    // Removing the discount afterwards never rewrites the sold order.
    expect((await adminApi(token, 'DELETE', `/admin/discounts/${discountId}`)).status).toBeLessThan(300);
    discountId = null;
    const [order] = await ordersByMobile(token, mobile);
    expect(order.total).toBe(expectedFinal);
    const detail = await orderDetail(token, order.id);
    expect(detail.items[0]).toMatchObject({ code: 'N-302', unitPrice: svc.price, unitDiscount: svc.price - expectedFinal, discountTitle: title, lineTotal: expectedFinal });
  } finally {
    if (discountId) await adminApi(token, 'DELETE', `/admin/discounts/${discountId}`);
    await devControl({ action: 'syncNow' });
  }
});
