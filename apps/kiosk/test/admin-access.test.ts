/**
 * Staff access from the kiosk (gear on the welcome screen) and panel → kiosk sync, against the
 * real API: the kiosk signs in for a short panel session without keeping the password, and
 * prices and subscriptions changed in the panel reach the kiosk on its next heartbeat.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ItemType, OrderKind } from '@andishkadeh/shared';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { adminPanelBase, panelUrls } from '../src/core/admin-access';
import { kvGet } from '../src/core/db';
import type { MockPaymentAdapter } from '../src/core/hardware/payment';
import type { KioskCore } from '../src/core/kiosk-core';
import { createNodeCore, loadConfig } from '../src/platform/node';
import { memoryPersistence, openSqlJsDatabase } from '../src/platform/sqljs';
import { TEST_DEVICE_KEY, TEST_PORT } from './global-setup';

const SERVER = `http://localhost:${TEST_PORT}`;
const API = `${SERVER}/api/v1`;
let core: KioskCore;
let SQL: SqlJsStatic | null = null;

async function adminApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const login = await fetch(`${API}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin@12345' }) });
  const { token } = (await login.json()) as { token: string };
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** Every value stored in the kiosk's local database, as one string. */
function everythingStored(c: KioskCore): string {
  const tables = c.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  return JSON.stringify(tables.map((t) => c.db.prepare(`SELECT * FROM "${t.name}"`).all()));
}

describe('panel addresses', () => {
  it('opens the existing panel of the kiosk server, or the configured one', () => {
    expect(adminPanelBase({ serverUrl: 'https://andishkadeh.liara.run/' })).toBe('https://andishkadeh.liara.run/admin');
    expect(adminPanelBase({ serverUrl: 'http://localhost:3001', adminPanelUrl: 'http://localhost:5173/admin/' })).toBe('http://localhost:5173/admin');
  });

  it('tells panel pages, its login page and the exit address apart', () => {
    const u = panelUrls('https://s.ir/admin');
    expect(u.isPanel('https://s.ir/admin/catalog/services?q=1')).toBe(true);
    expect(u.isPanel('https://s.ir/admin')).toBe(true);
    expect(u.isPanel('https://s.ir/administrator')).toBe(false);
    expect(u.isPanel('https://evil.example/admin/dashboard')).toBe(false);
    expect(u.isPanel('https://s.ir/api/v1/kiosk/bootstrap')).toBe(false);
    // The window's initial empty document also runs the preload; it must not receive the token.
    expect(u.isPanel('')).toBe(false);
    expect(u.isPanel('about:blank')).toBe(false);
    expect(u.isLogin('https://s.ir/admin/login')).toBe(true);
    expect(u.isExit(u.exit)).toBe(true);
    expect(u.isExit('https://s.ir/admin/dashboard')).toBe(false);
  });
});

describe.each(['better-sqlite3', 'sql.js'] as const)('staff access and panel sync on %s', (driver) => {
  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-admin-'));
    const cfg = loadConfig(dir, { serverUrl: SERVER, deviceKey: TEST_DEVICE_KEY, devControls: true, kioskMode: false });
    const db = driver === 'sql.js' ? await openSqlJsDatabase((SQL ??= await initSqlJs()), memoryPersistence()) : undefined;
    core = createNodeCore(cfg, { mediaBase: 'test://media', db });
    (core.payment as MockPaymentAdapter).delayMs = 30;
    await core.sync.pull();
  });

  afterEach(() => core.stop());

  it('signs a manager in for a short panel session on the dashboard; the password is not kept', async () => {
    const r = await core.handle('admin:login', { username: 'admin', password: 'Admin@12345' });
    if (!r.ok) throw new Error(r.message);
    expect(r.user.role).toBe('ADMIN');
    expect(r.startUrl).toBe(`${SERVER}/admin/dashboard`);
    expect(r.idleMinutes).toBe(5);
    const minutes = (Date.parse(r.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    // The token is a real panel session.
    const me = await fetch(`${API}/admin/auth/me`, { headers: { Authorization: `Bearer ${r.token}` } });
    expect(me.status).toBe(200);
    // Nothing of the sign-in is stored on the kiosk.
    const stored = everythingStored(core);
    expect(stored).not.toContain('Admin@12345');
    expect(stored).not.toContain(r.token);
  });

  it('sends reception staff to the orders page', async () => {
    const r = await core.handle('admin:login', { username: 'operator', password: 'Operator@12345' });
    expect(r.ok && r.user.role).toBe('OPERATOR');
    expect(r.ok && r.startUrl).toBe(`${SERVER}/admin/orders`);
  });

  it('reports a wrong password, empty fields and a missing connection in Persian', async () => {
    const wrong = await core.handle('admin:login', { username: 'operator', password: 'not-the-password' });
    expect(wrong).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS', message: 'نام کاربری یا رمز عبور نادرست است' });
    // A correct sign-in resets the failed-attempt counter for the other tests.
    expect((await core.handle('admin:login', { username: 'operator', password: 'Operator@12345' })).ok).toBe(true);

    expect(await core.handle('admin:login', { username: '  ', password: 'x' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    core.api.forcedOffline = true;
    const offline = await core.handle('admin:login', { username: 'admin', password: 'Admin@12345' });
    expect(offline).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(!offline.ok && offline.message).toContain('اتصال به مرکز');
  });

  it('a price changed in the panel reaches the kiosk on its next heartbeat', async () => {
    const before = core.catalog.current!;
    const svc = before.categories.flatMap((c) => c.subcategories.flatMap((s) => s.services)).find((s) => s.code === 'P-101')!;
    const full = await adminApi<Record<string, unknown>>('GET', `/admin/services/${svc.id}`);
    const keys = ['code', 'title', 'subcategoryId', 'description', 'includes', 'unit', 'mediaId', 'fullAccessIncluded', 'active', 'sortOrder'];
    const body = Object.fromEntries(keys.map((k) => [k, full[k]]));
    try {
      await adminApi('PATCH', `/admin/services/${svc.id}`, { ...body, price: (full.price as number) + 10_000 });
      await core.sync.heartbeat();
      const after = core.catalog.current!;
      expect(after.catalogRevision).toBeGreaterThan(before.catalogRevision);
      const updated = after.categories.flatMap((c) => c.subcategories.flatMap((s) => s.services)).find((s) => s.code === 'P-101')!;
      expect(updated.price).toBe((full.price as number) + 10_000);
    } finally {
      await adminApi('PATCH', `/admin/services/${svc.id}`, { ...body, price: full.price });
      await core.sync.heartbeat();
    }
  });

  it('a subscription extended in the panel reaches the kiosk cache on its next heartbeat', async () => {
    const plan = core.catalog.current!.plans[0];
    const mobile = `0912${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const created = await core.sales.createOrder({ kind: OrderKind.SUBSCRIPTION, mobile, items: [{ itemType: ItemType.PLAN, itemId: plan.id, quantity: 1 }] });
    if (!created.ok) throw new Error(created.message);
    const paid = await core.sales.startPayment(created.order.localOrderId);
    if (!paid.ok) throw new Error(paid.message);
    await core.sync.pull();
    const revBefore = kvGet<number>(core.db, 'sync.subRev') ?? 0;

    const list = await adminApi<{ items: Array<{ id: string }> }>('GET', `/admin/subscriptions?q=${mobile}`);
    await adminApi('POST', `/admin/subscriptions/${list.items[0].id}/extend`, { days: 10, reason: 'آزمون همگام‌سازی کیوسک' });
    await core.sync.heartbeat();
    expect(kvGet<number>(core.db, 'sync.subRev')!).toBeGreaterThan(revBefore);
  });
});
