/**
 * Integration tests against a real PostgreSQL database, covering the PRD acceptance matrix (I-04)
 * on the server side: T01–T04, T06, T07–T11, T14 and RBAC / lockout rules.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { generateQrToken, hashQrToken } from '@andishkadeh/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, bootApp, kiosk, login, randomMobile, suffix, useTestEnv, uuid } from './helpers';

let app: INestApplication;
let prisma: PrismaClient;
let adminToken: string;
let operatorToken: string;
const svc: Record<string, { id: string; price: number }> = {};
const TEST_DISCOUNT = 'تخفیف آزمایشی';
let plans: Array<{ id: string; code: string; price: number; durationDays: number }> = [];

async function createOrder(items: Array<{ id: string; qty?: number }>, mobile = randomMobile(), extra: Record<string, unknown> = {}) {
  const res = await kiosk(app).post('/orders', {
    localOrderId: uuid(),
    idempotencyKey: uuid(),
    kind: 'SERVICES',
    mobile,
    items: items.map((i) => ({ itemType: 'SERVICE', itemId: i.id, quantity: i.qty ?? 1 })),
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function pay(orderId: string, outcome: 'PAID' | 'FAILED' | 'UNKNOWN', amount: number) {
  const attemptId = uuid();
  const init = await kiosk(app).post('/payments/initiate', { orderId, paymentAttemptId: attemptId, idempotencyKey: attemptId });
  expect(init.status, JSON.stringify(init.body)).toBe(200);
  const res = await kiosk(app).post(`/payments/${attemptId}/result`, {
    outcome,
    amount,
    terminalRef: outcome === 'PAID' ? `T${Date.now()}` : null,
    rrn: null,
    source: 'TERMINAL',
    occurredAt: new Date().toISOString(),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { attemptId, ...res.body };
}

beforeAll(async () => {
  useTestEnv();
  app = await bootApp();
  prisma = new PrismaClient();
  adminToken = await login(app, 'admin', 'Admin@12345');
  operatorToken = await login(app, 'operator', 'Operator@12345');
  for (const s of await prisma.service.findMany({ where: { code: { in: ['P-102', 'P-101', 'N-101', 'PS-101', 'P-103'] } } })) {
    svc[s.code] = { id: s.id, price: s.price ?? 0 };
  }
  plans = await prisma.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } });
  // Remove discounts left behind by an interrupted earlier run (test-created data only).
  const stale = await admin(app, adminToken).get('/admin/discounts');
  for (const d of stale.body as Array<{ id: string; title: string }>) {
    if (d.title === TEST_DISCOUNT) await admin(app, adminToken).del(`/admin/discounts/${d.id}`);
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  await app?.close();
});

describe('kiosk catalogue', () => {
  it('requires device authentication', async () => {
    const res = await kiosk(app).get('/kiosk/bootstrap').set('Authorization', 'Device KIOSK-01:wrong');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('publishes only active, priced services and hides reservation features', async () => {
    const res = await kiosk(app).get('/kiosk/bootstrap');
    expect(res.status).toBe(200);
    const codes = res.body.categories.flatMap((c: any) => c.subcategories.flatMap((s: any) => s.services.map((x: any) => x.code)));
    expect(codes).toContain('P-102');
    expect(codes).not.toContain('P-103'); // no approved tariff → inactive
    expect(res.body.plans.map((p: any) => p.durationMonths)).toEqual([1, 3, 6, 12]);
    expect(JSON.stringify(res.body)).not.toMatch(/reserv|booking|رزرو|نوبت‌دهی/i);
  });
});

describe('orders (T01, T02)', () => {
  it('locks one order with three services from three domains and is idempotent', async () => {
    const localOrderId = uuid();
    const body = {
      localOrderId,
      idempotencyKey: uuid(),
      kind: 'SERVICES',
      mobile: '۰۹۱۲۱۲۳۴۵۶۷',
      items: [svc['P-102'], svc['N-101'], svc['PS-101']].map((s) => ({ itemType: 'SERVICE', itemId: s.id, quantity: 1 })),
      expectedTotal: svc['P-102'].price + svc['N-101'].price + svc['PS-101'].price,
    };
    const a = await kiosk(app).post('/orders', body);
    expect(a.status).toBe(200);
    expect(a.body.status).toBe('LOCKED');
    expect(a.body.items).toHaveLength(3);
    expect(a.body.total).toBe(svc['P-102'].price + svc['N-101'].price + svc['PS-101'].price);
    expect(a.body.priceChanged).toBe(false);
    expect(a.body.mobileMasked).toBe('0912***4567');
    const b = await kiosk(app).post('/orders', body);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.order.count({ where: { localId: localOrderId } })).toBe(1);
  });

  it('rejects invalid mobile numbers and unavailable services', async () => {
    const bad = await kiosk(app).post('/orders', {
      localOrderId: uuid(),
      idempotencyKey: uuid(),
      kind: 'SERVICES',
      mobile: '0812345678',
      items: [{ itemType: 'SERVICE', itemId: svc['P-102'].id, quantity: 1 }],
    });
    expect(bad.status).toBe(400);
    const unavailable = await kiosk(app).post('/orders', {
      localOrderId: uuid(),
      idempotencyKey: uuid(),
      kind: 'SERVICES',
      mobile: '09121234567',
      items: [{ itemType: 'SERVICE', itemId: svc['P-103'].id, quantity: 1 }],
    });
    expect(unavailable.status).toBe(422);
    expect(unavailable.body.error.code).toBe('ITEM_UNAVAILABLE');
    expect(unavailable.body.error.details.unavailable).toEqual([svc['P-103'].id]);
  });
});

describe('payments (T04, T06)', () => {
  it('double tap re-uses the same attempt; a second key is refused while in flight', async () => {
    const order = await createOrder([{ id: svc['P-101'].id }]);
    const attemptId = uuid();
    const body = { orderId: order.id, paymentAttemptId: attemptId, idempotencyKey: attemptId };
    const first = await kiosk(app).post('/payments/initiate', body);
    const second = await kiosk(app).post('/payments/initiate', body);
    expect(first.status).toBe(200);
    expect(second.body.paymentAttemptId).toBe(first.body.paymentAttemptId);
    const other = uuid();
    const third = await kiosk(app).post('/payments/initiate', { orderId: order.id, paymentAttemptId: other, idempotencyKey: other });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    expect(await prisma.paymentAttempt.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('PAID result marks the order paid; a later contradicting FAILED keeps it paid and flags it', async () => {
    const order = await createOrder([{ id: svc['P-101'].id }]);
    const paid = await pay(order.id, 'PAID', order.total);
    expect(paid.order.status).toBe('PAID');
    const again = await kiosk(app).post(`/payments/${paid.attemptId}/result`, {
      outcome: 'FAILED',
      amount: order.total,
      source: 'INQUIRY',
      occurredAt: new Date().toISOString(),
    });
    expect(again.body.order.status).toBe('PAID');
    expect(again.body.conflict).toBe(true);
  });

  it('FAILED allows a new attempt', async () => {
    const order = await createOrder([{ id: svc['P-101'].id }]);
    const failed = await pay(order.id, 'FAILED', order.total);
    expect(failed.order.status).toBe('FAILED');
    const ok = await pay(order.id, 'PAID', order.total);
    expect(ok.order.status).toBe('PAID');
  });

  it('UNKNOWN blocks retries until an admin reconciles it with a reason (audited)', async () => {
    const order = await createOrder([{ id: svc['P-101'].id }]);
    const unknown = await pay(order.id, 'UNKNOWN', order.total);
    expect(unknown.order.status).toBe('UNKNOWN');
    const retryId = uuid();
    const retry = await kiosk(app).post('/payments/initiate', { orderId: order.id, paymentAttemptId: retryId, idempotencyKey: retryId });
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('PAYMENT_UNRESOLVED');

    const opRec = await admin(app, operatorToken).post(`/admin/payments/${unknown.attemptId}/reconcile`, { outcome: 'PAID', reason: 'تأیید بانک' });
    expect(opRec.status).toBe(403);
    const noReason = await admin(app, adminToken).post(`/admin/payments/${unknown.attemptId}/reconcile`, { outcome: 'PAID', reason: '' });
    expect(noReason.status).toBe(400);
    const rec = await admin(app, adminToken).post(`/admin/payments/${unknown.attemptId}/reconcile`, {
      outcome: 'PAID',
      terminalRef: 'BANK-123',
      reason: 'تأیید تراکنش در گزارش بانک',
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(rec.body.order.status).toBe('PAID');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'payment.reconciled', entityId: unknown.attemptId } });
    expect(audit?.reason).toBe('تأیید تراکنش در گزارش بانک');
  });
});

describe('admin catalogue changes (T03, T09, T10)', () => {
  it('applies a discount with snapshot, then a price change does not touch historical orders', async () => {
    const before = await kiosk(app).get('/kiosk/bootstrap');
    const d = await admin(app, adminToken).post('/admin/discounts', {
      title: TEST_DISCOUNT,
      type: 'PERCENT',
      value: 10,
      targets: [{ targetType: 'SERVICE', targetId: svc['P-102'].id }],
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const after = await kiosk(app).get('/kiosk/bootstrap');
    expect(after.body.catalogRevision).toBeGreaterThan(before.body.catalogRevision);

    const base = svc['P-102'].price;
    const order = await createOrder([{ id: svc['P-102'].id, qty: 2 }], randomMobile(), { expectedTotal: base * 2 });
    expect(order.discountTotal).toBe(Math.floor(base / 10) * 2);
    expect(order.total).toBe(base * 2 - Math.floor(base / 10) * 2);
    expect(order.priceChanged).toBe(true);
    expect(order.items[0].discountTitle).toBe(TEST_DISCOUNT);
    await admin(app, adminToken).del(`/admin/discounts/${d.body.id}`);

    const auditBefore = await prisma.auditLog.count({ where: { action: 'service.price_changed', entityId: svc['P-102'].id } });
    const newPrice = base + 150_000;
    const current = await admin(app, adminToken).get(`/admin/services/${svc['P-102'].id}`);
    const patch = await admin(app, adminToken).patch(`/admin/services/${svc['P-102'].id}`, {
      ...current.body,
      price: newPrice,
    });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const historical = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    expect(historical?.unitPriceSnapshot).toBe(base);
    const fresh = await createOrder([{ id: svc['P-102'].id }]);
    expect(fresh.items[0].unitPrice).toBe(newPrice);
    expect(await prisma.auditLog.count({ where: { action: 'service.price_changed', entityId: svc['P-102'].id } })).toBe(auditBefore + 1);

    const preview = await admin(app, adminToken).post('/admin/discounts/preview', {
      title: 'پیش‌نمایش',
      type: 'FIXED',
      value: 500_000,
      targets: [{ targetType: 'SERVICE', targetId: svc['P-102'].id }],
    });
    expect(preview.body[0]).toMatchObject({ code: 'P-102', price: newPrice, finalPrice: newPrice - 500_000, appliedDiscount: 'پیش‌نمایش' });
    // Restore the seed price so the dev experience stays predictable.
    await admin(app, adminToken).patch(`/admin/services/${svc['P-102'].id}`, { ...current.body, price: base });
    svc['P-102'].price = base;
  });

  it('operators get 403 on price/discount writes even with direct API calls (T10)', async () => {
    const current = await admin(app, operatorToken).get(`/admin/services/${svc['P-101'].id}`);
    expect(current.status).toBe(200);
    const patch = await admin(app, operatorToken).patch(`/admin/services/${svc['P-101'].id}`, { ...current.body, price: 1 });
    expect(patch.status).toBe(403);
    const disc = await admin(app, operatorToken).post('/admin/discounts', {
      title: 'x',
      type: 'PERCENT',
      value: 50,
      targets: [{ targetType: 'SERVICE', targetId: svc['P-101'].id }],
    });
    expect(disc.status).toBe(403);
    expect((await admin(app, operatorToken).get('/admin/orders')).status).toBe(200);
    expect((await admin(app, operatorToken).get('/admin/users')).status).toBe(403);
    expect((await admin(app, operatorToken).put('/admin/settings', { sessionTimeoutSec: 60 })).status).toBe(403);
  });

  it('refuses activating a service without an approved price', async () => {
    const current = await admin(app, adminToken).get(`/admin/services/${svc['P-103'].id}`);
    const res = await admin(app, adminToken).patch(`/admin/services/${svc['P-103'].id}`, { ...current.body, active: true });
    expect(res.status).toBe(400);
  });
});

describe('subscriptions and QR (T07, T08)', () => {
  it('activates only after PAID, validates active / invalid / expired / revoked and chains renewals', async () => {
    const plan = plans[0];
    const token = generateQrToken();
    const mobile = randomMobile();
    const create = await kiosk(app).post('/orders', {
      localOrderId: uuid(),
      idempotencyKey: uuid(),
      kind: 'SUBSCRIPTION',
      mobile,
      items: [{ itemType: 'PLAN', itemId: plan.id, quantity: 1 }],
      qrTokenHash: hashQrToken(token),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(200);
    expect(create.body.periodPreview.extended).toBe(false);

    // Not paid yet → QR not valid.
    const early = await kiosk(app).post('/access/validate', { token });
    expect(early.body.result).toBe('INVALID');

    const paid = await pay(create.body.id, 'PAID', create.body.total);
    expect(paid.order.subscription).toBeTruthy();
    const durationMs = new Date(paid.order.subscription.expiresAt).getTime() - new Date(paid.order.subscription.startsAt).getTime();
    expect(durationMs).toBe(plan.durationDays * 86400000);

    const active = await kiosk(app).post('/access/validate', { token: `${token}\r\n` });
    expect(active.body).toMatchObject({ result: 'ACTIVE', valid: true, memberTail: mobile.slice(-4) });
    expect(JSON.stringify(active.body)).not.toContain(mobile);

    const invalid = await kiosk(app).post('/access/validate', { token: generateQrToken() });
    expect(invalid.body.result).toBe('INVALID');
    const garbage = await kiosk(app).post('/access/validate', { token: 'https://example.com/booking' });
    expect(garbage.body.result).toBe('INVALID');

    // Renewal while active → starts at the end of current coverage.
    const token2 = generateQrToken();
    const renew = await kiosk(app).post('/orders', {
      localOrderId: uuid(),
      idempotencyKey: uuid(),
      kind: 'SUBSCRIPTION',
      mobile,
      items: [{ itemType: 'PLAN', itemId: plans[1].id, quantity: 1 }],
      qrTokenHash: hashQrToken(token2),
    });
    expect(renew.body.periodPreview.extended).toBe(true);
    expect(renew.body.activeCoverageUntil).toBe(paid.order.subscription.expiresAt);
    const renewed = await pay(renew.body.id, 'PAID', renew.body.total);
    expect(renewed.order.subscription.startsAt).toBe(paid.order.subscription.expiresAt);
    expect(renewed.order.subscription.extended).toBe(true);
    const chained = await kiosk(app).post('/access/validate', { token: token2 });
    expect(chained.body.result).toBe('ACTIVE');
    expect(chained.body.expiresAt).toBe(renewed.order.subscription.expiresAt);

    // Expire everything → EXPIRED; cancel → REVOKED.
    await prisma.subscription.updateMany({
      where: { customer: { mobile } },
      data: { startsAt: new Date(Date.now() - 40 * 86400000), expiresAt: new Date(Date.now() - 86400000) },
    });
    const expired = await kiosk(app).post('/access/validate', { token });
    expect(expired.body.result).toBe('EXPIRED');
    const cancel = await admin(app, adminToken).post(`/admin/subscriptions/${paid.order.subscription.id}/cancel`, { reason: 'درخواست مشتری' });
    expect(cancel.status).toBe(200);
    const revoked = await kiosk(app).post('/access/validate', { token });
    expect(revoked.body.result).toBe('REVOKED');
    expect(await prisma.accessLog.count({ where: { subscriptionId: paid.order.subscription.id } })).toBeGreaterThanOrEqual(3);
  });
});

describe('sync (T11) and offline orders', () => {
  it('replaying the same offline batch creates exactly one order and one payment', async () => {
    const localOrderId = uuid();
    const attemptId = uuid();
    const orderNumber = `OFF-KIOSK-01-${suffix()}`;
    const lines = [
      {
        itemType: 'SERVICE',
        itemId: svc['N-101'].id,
        code: 'N-101',
        title: 'ارزیابی اولیه تغذیه و سبک زندگی ورزشکار',
        unit: 'نفر',
        categoryId: null,
        categoryTitle: 'مرکز تغذیه و متابولیسم',
        unitPrice: svc['N-101'].price,
        quantity: 1,
        discountId: null,
        discountTitle: null,
        unitDiscount: 0,
        lineTotal: svc['N-101'].price,
      },
    ];
    const t0 = new Date(Date.now() - 60_000).toISOString();
    const events = [
      {
        eventId: uuid(),
        type: 'ORDER_OFFLINE',
        createdAt: t0,
        payload: { localOrderId, orderNumber, kind: 'SERVICES', mobile: randomMobile(), createdAt: t0, lines, subtotal: svc['N-101'].price, discountTotal: 0, total: svc['N-101'].price, qrTokenHash: null, catalogRevision: 1 },
      },
      {
        eventId: uuid(),
        type: 'PAYMENT_RESULT',
        createdAt: new Date(Date.now() - 30_000).toISOString(),
        payload: { paymentAttemptId: attemptId, localOrderId, amount: svc['N-101'].price, outcome: 'PAID', terminalRef: 'OFFREF', rrn: null, traceNo: null, message: null, source: 'TERMINAL', occurredAt: new Date(Date.now() - 30_000).toISOString() },
      },
    ];
    const first = await kiosk(app).post('/sync/push', { events });
    expect(first.status).toBe(200);
    expect(first.body.acceptedEventIds).toHaveLength(2);
    const second = await kiosk(app).post('/sync/push', { events });
    expect(second.body.acceptedEventIds).toHaveLength(2);
    expect(await prisma.order.count({ where: { localId: localOrderId } })).toBe(1);
    expect(await prisma.paymentAttempt.count({ where: { id: attemptId } })).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { localId: localOrderId } });
    expect(order).toMatchObject({ status: 'PAID', offline: true, orderNumber, total: svc['N-101'].price });
  });

  it('keeps a payment event for retry when its order is not synced yet, and rejects malformed events without blocking', async () => {
    const res = await kiosk(app).post('/sync/push', {
      events: [
        {
          eventId: uuid(),
          type: 'PAYMENT_RESULT',
          createdAt: new Date().toISOString(),
          payload: { paymentAttemptId: uuid(), localOrderId: uuid(), amount: 1000, outcome: 'PAID', terminalRef: null, rrn: null, traceNo: null, message: null, source: 'TERMINAL', occurredAt: new Date().toISOString() },
        },
        { eventId: uuid(), type: 'NOPE', createdAt: new Date().toISOString(), payload: {} },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.rejectedEvents).toHaveLength(2);
    const retryable = res.body.rejectedEvents.find((e: any) => e.code === 'ORDER_NOT_FOUND');
    expect(retryable.retryable).toBe(true);
    expect(res.body.rejectedEvents.find((e: any) => e.code === 'VALIDATION_FAILED').retryable).toBe(false);
  });

  it('pull returns the catalogue only when the revision changed', async () => {
    const full = await kiosk(app).get('/sync/pull?since=0&subSince=0');
    expect(full.body.catalog).toBeTruthy();
    const none = await kiosk(app).get(`/sync/pull?since=${full.body.catalogRevision}&subSince=${full.body.nextSubRev}`);
    expect(none.body.catalog).toBeNull();
    expect(none.body.subscriptions).toHaveLength(0);
  });
});

describe('dashboard and reports (T14)', () => {
  it('never counts UNKNOWN payments as final sales and reconciles with paid orders', async () => {
    const dashBefore = await admin(app, operatorToken).get('/admin/dashboard');
    const order = await createOrder([{ id: svc['PS-101'].id }]);
    await pay(order.id, 'UNKNOWN', order.total);
    const dash = await admin(app, operatorToken).get('/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.todaySales).toBe(dashBefore.body.kpis.todaySales);
    expect(dash.body.alerts.unknownPayments).toBeGreaterThan(dashBefore.body.alerts.unknownPayments);

    const today = dash.body.today;
    const report = await admin(app, adminToken).get(`/admin/reports/sales?from=${today}&to=${today}`);
    expect(report.status).toBe(200);
    const { localDayRange } = await import('@andishkadeh/shared');
    const range = localDayRange(today, dash.body.timezone);
    const paid = await prisma.order.aggregate({
      where: { status: 'PAID', paidAt: { gte: range.from, lt: range.to } },
      _sum: { total: true },
      _count: { _all: true },
    });
    expect(report.body.summary.paidTotal).toBe(paid._sum.total);
    expect(report.body.summary.paidCount).toBe(paid._count._all);
    expect(report.body.summary.unknownCount).toBeGreaterThanOrEqual(1);
    expect(report.body.summary.paidTotal).toBe(dash.body.kpis.todaySales);

    const csv = await admin(app, adminToken).get(`/admin/reports/sales/export?from=${today}&to=${today}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const xlsx = await admin(app, adminToken).get(`/admin/reports/sales/export?from=${today}&to=${today}&format=xlsx`);
    expect(xlsx.status).toBe(200);
  });
});

describe('admin authentication', () => {
  it('locks an account temporarily after repeated failures', async () => {
    const username = `lock.${suffix()}`;
    const create = await admin(app, adminToken).post('/admin/users', { username, displayName: 'تست قفل', password: 'Secret@123', role: 'OPERATOR' });
    expect(create.status).toBe(201);
    const request = (await import('supertest')).default;
    for (let i = 0; i < 5; i++) {
      const r = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({ username, password: 'wrong' });
      expect(r.status).toBe(401);
    }
    const locked = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({ username, password: 'Secret@123' });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    const unlock = await admin(app, adminToken).patch(`/admin/users/${create.body.id}`, { unlock: true });
    expect(unlock.status).toBe(200);
    expect(await login(app, username, 'Secret@123')).toBeTruthy();
  });

  it('invalidates tokens of deactivated users immediately', async () => {
    const username = `temp.${suffix()}`;
    const create = await admin(app, adminToken).post('/admin/users', { username, displayName: 'اپراتور موقت', password: 'Secret@123', role: 'OPERATOR' });
    const token = await login(app, username, 'Secret@123');
    expect((await admin(app, token).get('/admin/orders')).status).toBe(200);
    await admin(app, adminToken).patch(`/admin/users/${create.body.id}`, { active: false });
    expect((await admin(app, token).get('/admin/orders')).status).toBe(401);
  });
});
