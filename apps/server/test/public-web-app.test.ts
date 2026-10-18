/**
 * The public web app at / (device WEB-APP, created by a migration): no key, catalogue only. It must
 * never sell, check members or receive the member subscription cache, and gets no commands.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEB_APP_DEVICE_ID } from '@andishkadeh/shared';
import { admin, bootApp, login, useTestEnv, uuid } from './helpers';

let app: INestApplication;
let token: string;
const PUBLIC = `Device ${WEB_APP_DEVICE_ID}:anything-at-all`;
const http = () => request(app.getHttpServer());

const heartbeat = {
  appVersion: 'test',
  catalogRevision: 0,
  subRev: 0,
  hardware: {
    pos: { state: 'UNKNOWN', adapter: 'not-configured', detail: null },
    printer: { state: 'OK', adapter: 'browser', detail: null },
    scanner: { state: 'OK', adapter: 'keyboard', detail: null },
  },
  outbox: { pending: 0, failed: 0, oldestPendingAt: null },
  unresolvedPayments: 0,
  lastSyncAt: null,
};

beforeAll(async () => {
  useTestEnv();
  app = await bootApp();
  token = await login(app, 'admin', 'Admin@12345');
});

afterAll(() => app?.close());

describe('public web app: what it may read', () => {
  it('reads the catalogue without a key (header or X-Device-Id alone)', async () => {
    const a = await http().get('/api/v1/kiosk/bootstrap').set('Authorization', PUBLIC);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.categories.length).toBeGreaterThan(0);
    const b = await http().get('/api/v1/kiosk/bootstrap').set('X-Device-Id', WEB_APP_DEVICE_ID);
    expect(b.status).toBe(200);
  });

  it('pulls catalogue changes but never the member subscription cache', async () => {
    const r = await http().get('/api/v1/sync/pull?since=0&subSince=0').set('Authorization', PUBLIC);
    expect(r.status).toBe(200);
    expect(r.body.catalog).not.toBeNull();
    expect(r.body.subscriptions).toEqual([]);
    expect(r.body.nextSubRev).toBe(0);
  });

  it('heartbeat: no commands, and never "behind" on subscriptions', async () => {
    const r = await http().post('/api/v1/devices/heartbeat').set('Authorization', PUBLIC).send(heartbeat);
    expect(r.status).toBe(200);
    expect(r.body.commands).toEqual([]);
    expect(r.body.subscriptionRev).toBe(0);
    expect(r.body.catalogRevision).toBeGreaterThan(0);
  });
});

describe('public web app: what it may not do', () => {
  it.each([
    ['post', '/orders', { localOrderId: uuid(), kind: 'SERVICES', mobile: '09120000000', items: [] }],
    ['post', '/payments/initiate', { orderId: uuid(), attemptId: uuid(), amount: 1000 }],
    ['post', `/payments/${uuid()}/result`, {}],
    ['post', '/subscriptions/activate', { orderId: uuid() }],
    ['post', '/access/validate', { token: 'x', eventId: uuid() }],
    ['post', '/sync/push', { events: [{}] }],
    ['post', `/devices/commands/${uuid()}/result`, { success: true }],
  ] as const)('%s %s → 403', async (_method, path, body) => {
    const r = await http().post(`/api/v1${path}`).set('Authorization', PUBLIC).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('is closed for everyone while disabled', async () => {
    const a = admin(app, token);
    expect((await a.patch(`/admin/devices/${WEB_APP_DEVICE_ID}`, { active: false })).status).toBe(200);
    try {
      expect((await http().get('/api/v1/kiosk/bootstrap').set('Authorization', PUBLIC)).status).toBe(401);
    } finally {
      await a.patch(`/admin/devices/${WEB_APP_DEVICE_ID}`, { active: true });
    }
    expect((await http().get('/api/v1/kiosk/bootstrap').set('Authorization', PUBLIC)).status).toBe(200);
  });
});

describe('public web app in the panel', () => {
  it('is listed as the public web app; no key, no commands, not in the dashboard or sync page', async () => {
    const a = admin(app, token);
    const devices = await a.get('/admin/devices');
    expect(devices.body.find((d: { id: string }) => d.id === WEB_APP_DEVICE_ID)).toMatchObject({ publicWebApp: true, active: true });
    expect(devices.body.find((d: { id: string }) => d.id === 'KIOSK-01')).toMatchObject({ publicWebApp: false });

    expect((await a.post(`/admin/devices/${WEB_APP_DEVICE_ID}/rotate-key`)).status).toBe(409);
    expect((await a.post(`/admin/devices/${WEB_APP_DEVICE_ID}/sync-now`)).status).toBe(409);

    const dashboard = await a.get('/admin/dashboard');
    expect(dashboard.body.devices.map((d: { id: string }) => d.id)).not.toContain(WEB_APP_DEVICE_ID);
    const sync = await a.get('/admin/sync');
    expect(sync.body.devices.map((d: { id: string }) => d.id)).not.toContain(WEB_APP_DEVICE_ID);
  });
});
