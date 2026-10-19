import { expect, type Page } from '@playwright/test';

export const API = 'http://localhost:3200/api/v1';
export const BRIDGE = 'http://localhost:5285';

/** Simulated hardware / network controls of the kiosk core (dev bridge only). */
export async function devControl(body: Record<string, unknown>) {
  const r = await fetch(`${BRIDGE}/ipc/dev:control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await r.json()) as { ok: boolean; message?: string };
  expect(json.ok, json.message).toBe(true);
}

export async function kioskStatus() {
  return (await (await fetch(`${BRIDGE}/health`)).json()) as { online: boolean; catalogRevision: number; outbox: { pending: number; failed: number } };
}

const tokens = new Map<string, Promise<string>>();

/**
 * Admin API token, one login per account for the whole run: the server limits logins per IP
 * (30 per 10 minutes), which a full suite logging in for every call would exceed.
 */
export function adminToken(username = 'admin', password = 'Admin@12345'): Promise<string> {
  const key = `${username}\n${password}`;
  let token = tokens.get(key);
  if (!token) {
    token = (async () => {
      const r = await fetch(`${API}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const j = (await r.json()) as { token?: string; error?: { code: string; message: string } };
      if (!r.ok || !j.token) throw new Error(`admin login failed (${r.status} ${j.error?.code ?? ''}): ${j.error?.message ?? ''}`);
      return j.token;
    })();
    tokens.set(key, token);
    token.catch(() => tokens.delete(key));
  }
  return token;
}

export async function adminApi<T = unknown>(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as T };
}

/** A fresh OPERATOR account (the seeded one keeps whatever password the first seed gave it). */
export async function createOperator(adminTok: string): Promise<{ username: string; password: string; token: string }> {
  const username = `op.e2e.${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Operator@123';
  const r = await adminApi(adminTok, 'POST', '/admin/users', { username, displayName: 'اپراتور آزمون', password, role: 'OPERATOR' });
  expect(r.status).toBe(201);
  return { username, password, token: await adminToken(username, password) };
}

/**
 * Makes the web app at / run as a freshly registered kiosk in this browser, as "activate this
 * browser" on /kiosk does (localStorage of the server's origin). Ends on the kiosk's start screen.
 */
export async function activateWebKiosk(page: Page, name: string, prefix = 'WEB'): Promise<string> {
  const token = await adminToken();
  const deviceId = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  const created = await adminApi<{ apiKey: string }>(token, 'POST', '/admin/devices', { id: deviceId, name });
  expect(created.status).toBe(201);
  await page.goto('/api/v1/health'); // same origin, no app running
  await page.evaluate(
    ([id, key]) =>
      localStorage.setItem(
        'andishkadeh.kiosk.setup.v1', // WEB_KIOSK_SETUP_STORAGE_KEY
        JSON.stringify({ serverUrl: location.origin, deviceId: id, deviceKey: key, payment: 'mock', printer: 'mock', scanner: 'keyboard', devControls: false }),
      ),
    [deviceId, created.body.apiKey],
  );
  await page.goto('/');
  await expect(page.getByTestId('start')).toBeVisible({ timeout: 30_000 });
  return deviceId;
}

export const randomMobile = () => `0912${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

export async function startSession(page: Page) {
  await page.goto('/');
  await page.getByTestId('start').click();
}

export async function addService(page: Page, category: string, sub: string, code: string) {
  await page.getByTestId(`category-${category}`).click();
  await page.getByTestId(`sub-${sub}`).click();
  await page.getByTestId(`add-${code}`).click();
  await expect(page.getByTestId(`add-${code}`)).toHaveAttribute('aria-label', /در سبد/);
}

export async function typeMobile(page: Page, mobile: string) {
  for (const d of mobile) await page.getByTestId(`key-${d}`).click();
  await page.getByTestId('mobile-confirm').click();
}

/** Back from a service list to the domain grid (services → subgroups → domains). */
/**
 * Waits until a change of screen has finished. The change applies inside a soft transition (a frame
 * after the tap), and taps during the transition do not reach the page.
 */
export async function settled(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute('data-nav', /./);
}

export async function backToCategories(page: Page) {
  while (!(await page.getByTestId('category-P').isVisible().catch(() => false))) {
    await page.getByTestId('back').click();
    await settled(page);
  }
}

/** The member scan screen is open and listening (a scan sent before it opens is not seen). */
export async function scanReady(page: Page) {
  await expect(page.getByText('کد QR کارت عضویت را مقابل اسکنر بگیرید')).toBeVisible();
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < end);
  return last;
}

/** "۱٬۲۰۰٬۰۰۰ تومان" → 1200000 */
export function parseToman(text: string | null): number {
  const latin = (text ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  return Number(latin.replace(/[^0-9]/g, ''));
}

export async function tomanOf(page: Page, testId: string): Promise<number> {
  return parseToman(await page.getByTestId(testId).textContent());
}

/** Direct call into the kiosk core (same channel the renderer uses). */
export async function ipc<T = any>(channel: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BRIDGE}/ipc/${channel}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? null) });
  return (await r.json()) as T;
}

export interface OrderRowLite {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  itemsCount: number;
  offline: boolean;
  printStatus: string;
}

export async function ordersByMobile(token: string, mobile: string): Promise<OrderRowLite[]> {
  const r = await adminApi<{ items: OrderRowLite[] }>(token, 'GET', `/admin/orders?q=${mobile}&pageSize=50`);
  return r.body.items;
}

export async function orderDetail(token: string, id: string) {
  const r = await adminApi<OrderRowLite & { items: Array<{ code: string; unitPrice: number; unitDiscount: number; discountTitle: string | null; lineTotal: number }>; payments: Array<{ id: string; status: string; amount: number }> }>(token, 'GET', `/admin/orders/${id}`);
  return r.body;
}

/** Customer journey: K13 mobile → K14 review (order created and price-locked). */
export async function checkoutWithMobile(page: Page, mobile: string) {
  await page.getByTestId('checkout').click();
  await typeMobile(page, mobile);
  await expect(page.getByTestId('locked-total')).toBeVisible();
}

/** Restore the simulated devices to the happy path. */
export async function resetDevices() {
  await devControl({ action: 'network', online: true });
  await devControl({ action: 'posScenario', scenario: 'approve' });
  await devControl({ action: 'inquiryMode', mode: 'truth' });
  await devControl({ action: 'printerMode', mode: 'ok' });
  await devControl({ action: 'scannerMode', mode: 'ok' });
}

/** K11 → K12 → K12D → K13 → K14 → K15 → K16 → K18; returns the QR payload shown on screen. */
export async function buySubscription(page: Page, mobile: string, months = 1): Promise<string> {
  await startSession(page);
  await page.getByTestId('home-subscription').click();
  await page.getByTestId('choose-plan').click();
  await page.getByTestId(`plan-${months}`).click();
  await page.getByTestId('plan-continue').click();
  await typeMobile(page, mobile);
  await expect(page.getByTestId('locked-total')).toBeVisible();
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('result-paid')).toBeVisible();
  await page.getByTestId('to-activation').click();
  const qr = page.getByTestId('qr');
  await expect(qr).toBeVisible();
  const token = await qr.getAttribute('data-value');
  expect(token).toMatch(/^AKQ1\.[A-Za-z0-9_-]{32}$/);
  return token!;
}

export async function scanMember(page: Page, payload: string) {
  if (await page.getByTestId('end-now').isVisible()) await page.getByTestId('end-now').click();
  else await page.goto('/');
  await page.getByTestId('start').click();
  await page.getByTestId('home-member').click();
  await scanReady(page);
  await devControl({ action: 'scan', payload });
}

/** Service id from the kiosk's current catalogue. */
export async function kioskServiceId(code: string): Promise<string> {
  const state = await ipc<{ bootstrap: { categories: Array<{ subcategories: Array<{ services: Array<{ id: string; code: string }> }> }> } }>('app:getState');
  const svc = state.bootstrap.categories.flatMap((c) => c.subcategories.flatMap((s) => s.services)).find((s) => s.code === code);
  if (!svc) throw new Error(`service ${code} not in the kiosk catalogue`);
  return svc.id;
}

/** Headless sale through the kiosk core (same IPC path as the UI) — for fixtures in admin tests. */
export async function kioskSale(mobile: string, code: string): Promise<{ localOrderId: string; orderNumber: string; total: number; outcome: string }> {
  const created = await ipc<{ ok: boolean; message?: string; order: { localOrderId: string; orderNumber: string; total: number } }>('order:create', {
    kind: 'SERVICES',
    mobile,
    items: [{ itemType: 'SERVICE', itemId: await kioskServiceId(code), quantity: 1 }],
  });
  expect(created.ok, created.message).toBe(true);
  const paid = await ipc<{ ok: boolean; result: { outcome: string } }>('payment:start', { localOrderId: created.order.localOrderId });
  return { ...created.order, outcome: paid.result.outcome };
}
