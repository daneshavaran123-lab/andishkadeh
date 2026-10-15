/**
 * Kiosk core integration tests against the real API (PRD §15, §19, I-04: T05, T06, T11, T13 + offline):
 * offline sale with OFF code, network drop after a successful card payment, power-loss recovery
 * from the journal, receipt printer failure, offline QR validation and media fallback.
 * Every scenario runs on both database drivers: better-sqlite3 (Windows app) and sql.js (web / Android app).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ItemType, OrderKind, OrderStatus, TerminalOutcome, type Bootstrap } from '@andishkadeh/shared';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type { KioskCore } from '../src/core/kiosk-core';
import { MockPaymentAdapter } from '../src/core/hardware/payment';
import { MockPrinterAdapter } from '../src/core/hardware/printer';
import { createNodeCore, loadConfig } from '../src/platform/node';
import { memoryPersistence, openSqlJsDatabase } from '../src/platform/sqljs';
import { TEST_DEVICE_KEY, TEST_PORT } from './global-setup';

const API = `http://localhost:${TEST_PORT}/api/v1`;
const DEVICE = `Device KIOSK-01:${TEST_DEVICE_KEY}`;
let core: KioskCore;
let SQL: SqlJsStatic | null = null;
const DRIVERS = ['better-sqlite3', 'sql.js'] as const;

const mobile = () => `0912${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function serverOrder(localId: string) {
  // Admin view is not needed: the device can read its own orders through checkout.
  const local = core.sales.view(localId)!;
  if (!local.serverOrderId) return null;
  const r = await fetch(`${API}/orders/${local.serverOrderId}/checkout`, { method: 'POST', headers: { Authorization: DEVICE } });
  return r.ok ? r.json() : null;
}

function firstServices(b: Bootstrap, n: number) {
  return b.categories.filter((c) => c.salesEnabled).flatMap((c) => c.subcategories.flatMap((s) => s.services)).slice(0, n);
}

describe.each(DRIVERS)('kiosk core on %s', (driver) => {
  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-test-'));
    const cfg = loadConfig(dir, { serverUrl: `http://localhost:${TEST_PORT}`, deviceKey: TEST_DEVICE_KEY, devControls: true, kioskMode: false });
    const db = driver === 'sql.js' ? await openSqlJsDatabase((SQL ??= await initSqlJs()), memoryPersistence()) : undefined;
    core = createNodeCore(cfg, { mediaBase: 'test://media', db });
    expect(core.db.driver).toBe(driver);
    (core.payment as MockPaymentAdapter).delayMs = 30;
    await core.sync.pull();
  });

  afterEach(() => core.stop());

  describe('online sale', () => {
    it('locks on the server, pays, prints and reports the print', async () => {
      const b = core.catalog.current!;
      const svc = firstServices(b, 2);
      const created = await core.sales.createOrder({
        kind: OrderKind.SERVICES,
        mobile: mobile(),
        items: svc.map((s) => ({ itemType: ItemType.SERVICE, itemId: s.id, quantity: 1 })),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.order.offline).toBe(false);
      expect(created.order.orderNumber).toMatch(/^AK-/);

      const paid = await core.sales.startPayment(created.order.localOrderId);
      expect(paid.ok && paid.result.outcome).toBe(TerminalOutcome.PAID);
      expect(paid.ok && paid.result.order.syncPending).toBe(false);
      expect((await serverOrder(created.order.localOrderId)).status).toBe('PAID');

      // T05: printer out of paper → order stays PAID, failure is reported for an admin reprint.
      (core.printer as MockPrinterAdapter).mode = 'paper-out';
      const print = await core.sales.printReceipt(created.order.localOrderId);
      expect(print.printed).toBe(false);
      expect(core.sales.view(created.order.localOrderId)!.status).toBe(OrderStatus.PAID);
      await core.sync.push();
      expect(core.outbox.stats().pending).toBe(0);
    });
  });

  describe('network drop after a successful card payment (T06 / §19)', () => {
    it('keeps the local PAID result, queues it, and syncs it exactly once', async () => {
      const svc = firstServices(core.catalog.current!, 1)[0];
      const created = await core.sales.createOrder({ kind: OrderKind.SERVICES, mobile: mobile(), items: [{ itemType: ItemType.SERVICE, itemId: svc.id, quantity: 1 }] });
      if (!created.ok) throw new Error(created.message);
      core.api.forcedOffline = true; // server unreachable from here on
      const paid = await core.sales.startPayment(created.order.localOrderId);
      expect(paid.ok && paid.result.outcome).toBe(TerminalOutcome.PAID);
      expect(paid.ok && paid.result.order.syncPending).toBe(true);
      expect(core.outbox.stats().pending).toBe(1);

      core.api.forcedOffline = false;
      await core.sync.push();
      expect(core.outbox.stats().pending).toBe(0);
      expect(core.sales.view(created.order.localOrderId)!.syncPending).toBe(false);
      expect((await serverOrder(created.order.localOrderId)).status).toBe('PAID');
    });
  });

  describe('offline sale with OFF code (T11)', () => {
    it('prices from the cached catalogue, pays by card, syncs without duplicates', async () => {
      const svc = firstServices(core.catalog.current!, 2);
      core.api.forcedOffline = true;
      const created = await core.sales.createOrder({
        kind: OrderKind.SERVICES,
        mobile: mobile(),
        items: svc.map((s) => ({ itemType: ItemType.SERVICE, itemId: s.id, quantity: 1 })),
      });
      if (!created.ok) throw new Error(created.message);
      expect(created.order.offline).toBe(true);
      expect(created.order.orderNumber).toMatch(/^OFF-KIOSK-01-\d{5}$/);
      expect(created.order.total).toBe(svc.reduce((s, x) => s + x.price, 0));

      const paid = await core.sales.startPayment(created.order.localOrderId);
      expect(paid.ok && paid.result.outcome).toBe(TerminalOutcome.PAID);
      expect(core.outbox.stats().pending).toBe(2); // ORDER_OFFLINE + PAYMENT_RESULT

      core.api.forcedOffline = false;
      await core.sync.push();
      await core.sync.push(); // replay is harmless
      expect(core.outbox.stats()).toMatchObject({ pending: 0, failed: 0 });
      const view = core.sales.view(created.order.localOrderId)!;
      expect(view.serverOrderId).toBeTruthy();
      expect(view.status).toBe(OrderStatus.PAID);
    });

    it('refuses offline subscription sales while the policy is disabled', async () => {
      const plan = core.catalog.current!.plans[0];
      core.api.forcedOffline = true;
      const r = await core.sales.createOrder({ kind: OrderKind.SUBSCRIPTION, mobile: mobile(), items: [{ itemType: ItemType.PLAN, itemId: plan.id, quantity: 1 }] });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe('OFFLINE_SUBSCRIPTION_DISABLED');
    });
  });

  describe('unknown result and journal recovery (power loss)', () => {
    it('never retries while UNKNOWN and resolves by inquiry', async () => {
      const svc = firstServices(core.catalog.current!, 1)[0];
      const pos = core.payment as MockPaymentAdapter;
      pos.scenario = 'unknown';
      pos.hiddenTruth = 'PAID';
      const created = await core.sales.createOrder({ kind: OrderKind.SERVICES, mobile: mobile(), items: [{ itemType: ItemType.SERVICE, itemId: svc.id, quantity: 1 }] });
      if (!created.ok) throw new Error(created.message);
      const first = await core.sales.startPayment(created.order.localOrderId);
      expect(first.ok && first.result.outcome).toBe(TerminalOutcome.UNKNOWN);
      expect(first.ok && first.result.canRetry).toBe(false);

      const retry = await core.sales.startPayment(created.order.localOrderId);
      expect(retry.ok).toBe(false);
      expect(!retry.ok && retry.code).toBe('PAYMENT_UNRESOLVED');
      expect((await serverOrder(created.order.localOrderId)).status).toBe('UNKNOWN');

      // Background recovery (as after a restart) asks the terminal and settles it.
      expect(await core.sales.recover()).toBe(1);
      expect(core.sales.view(created.order.localOrderId)!.status).toBe(OrderStatus.PAID);
      expect((await serverOrder(created.order.localOrderId)).status).toBe('PAID');
    });

    it('turns an IN_FLIGHT journal row left by a crash into a settled result', async () => {
      const svc = firstServices(core.catalog.current!, 1)[0];
      const created = await core.sales.createOrder({ kind: OrderKind.SERVICES, mobile: mobile(), items: [{ itemType: ItemType.SERVICE, itemId: svc.id, quantity: 1 }] });
      if (!created.ok) throw new Error(created.message);
      // Simulate: journal written, then power cut before the terminal answered.
      core.db
        .prepare("INSERT INTO payment_journal (attempt_id, local_order_id, amount, state, started_at) VALUES (?, ?, ?, 'IN_FLIGHT', ?)")
        .run('00000000-0000-4000-8000-' + String(Date.now()).slice(-12), created.order.localOrderId, created.order.total, new Date().toISOString());
      expect(core.sales.unresolvedCount()).toBe(1);
      await core.sales.recover();
      // The mock acquirer has no record of it → FAILED; the order becomes payable again.
      expect(core.sales.unresolvedCount()).toBe(0);
      expect(core.sales.view(created.order.localOrderId)!.status).toBe(OrderStatus.FAILED);
    });
  });

  describe('subscription + offline QR validation', () => {
    it('issues a QR only after payment and validates it offline from the cache', async () => {
      const plan = core.catalog.current!.plans[0];
      const created = await core.sales.createOrder({ kind: OrderKind.SUBSCRIPTION, mobile: mobile(), items: [{ itemType: ItemType.PLAN, itemId: plan.id, quantity: 1 }] });
      if (!created.ok) throw new Error(created.message);
      expect(created.order.qrToken).toBeNull();
      const paid = await core.sales.startPayment(created.order.localOrderId);
      if (!paid.ok) throw new Error(paid.message);
      const token = paid.result.order.qrToken!;
      expect(token).toMatch(/^AKQ1\./);
      expect(paid.result.order.subscription).toBeTruthy();

      const online = await core.access.validate(token);
      expect(online.ok && online.result).toMatchObject({ result: 'ACTIVE', offline: false });

      await core.sync.pull();
      core.api.forcedOffline = true;
      const offline = await core.access.validate(token);
      expect(offline.ok && offline.result).toMatchObject({ result: 'ACTIVE', offline: true });
      const bogus = await core.access.validate('AKQ1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      expect(bogus.ok && bogus.result.result).toBe('INVALID');
      expect(core.outbox.stats().pending).toBe(2); // two ACCESS_LOG events

      core.sales.endSession();
      expect(core.sales.view(created.order.localOrderId)!.qrToken).toBeNull(); // raw token wiped
    });
  });

  describe('catalogue media fallback', () => {
    it('keeps the previous image when a new one fails checksum verification', async () => {
      const before = core.catalog.current!;
      const cat = before.categories[0];
      const raw = JSON.parse(JSON.stringify(before)) as Bootstrap;
      raw.catalogRevision += 1000;
      raw.categories[0].mediaId = 'new-media';
      raw.media.push({ id: 'new-media', checksum: 'f'.repeat(64), mime: 'image/jpeg', url: `${API}/media/files/does-not-exist.jpg`, width: null, height: null });
      raw.categories[0].title = 'عنوان جدید';
      await core.catalog.accept(raw);
      const after = core.catalog.current!;
      expect(after.categories[0].title).toBe('عنوان جدید'); // texts/prices apply immediately
      expect(after.categories[0].mediaId).toBe(cat.mediaId); // image falls back to the cached one
    });
  });
});
