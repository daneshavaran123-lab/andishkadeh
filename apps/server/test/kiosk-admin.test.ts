/** Staff sign-in from a kiosk's gear, and the heartbeat that lets kiosks pull panel changes at once. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEVICE, bootApp, useTestEnv } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  useTestEnv();
  app = await bootApp();
});

afterAll(() => app?.close());

const minutesLeft = (iso: string) => (Date.parse(iso) - Date.now()) / 60_000;

describe('staff sign-in from a kiosk', () => {
  it('a kiosk sign-in gets a short session (KIOSK_ADMIN_SESSION_MINUTES), the panel a normal one', async () => {
    const kiosk = await http().post('/api/v1/admin/auth/login').send({ username: 'admin', password: 'Admin@12345', client: 'kiosk' });
    expect(kiosk.status).toBe(200);
    expect(minutesLeft(kiosk.body.expiresAt)).toBeGreaterThan(29);
    expect(minutesLeft(kiosk.body.expiresAt)).toBeLessThanOrEqual(30);
    const me = await http().get('/api/v1/admin/auth/me').set('Authorization', `Bearer ${kiosk.body.token}`);
    expect(me.body).toMatchObject({ username: 'admin', role: 'ADMIN' });

    const panel = await http().post('/api/v1/admin/auth/login').send({ username: 'admin', password: 'Admin@12345' });
    expect(minutesLeft(panel.body.expiresAt)).toBeGreaterThan(7 * 60);
  });

  it('records where the sign-in came from in the audit trail', async () => {
    const login = await http().post('/api/v1/admin/auth/login').send({ username: 'admin', password: 'Admin@12345', client: 'kiosk' });
    const audit = await http().get('/api/v1/admin/audit?action=auth.login&pageSize=1').set('Authorization', `Bearer ${login.body.token}`);
    expect(audit.body.items[0]).toMatchObject({ action: 'auth.login', after: { client: 'kiosk' } });
  });

  it('refuses an unknown client value', async () => {
    const r = await http().post('/api/v1/admin/auth/login').send({ username: 'admin', password: 'Admin@12345', client: 'other' });
    expect(r.status).toBe(400);
  });
});

describe('heartbeat', () => {
  it('reports the latest catalogue and subscription revisions so kiosks pull panel changes at once', async () => {
    const r = await http()
      .post('/api/v1/devices/heartbeat')
      .set('Authorization', DEVICE)
      .send({
        appVersion: 'test',
        catalogRevision: 0,
        subRev: 0,
        hardware: {
          pos: { state: 'OK', adapter: 'mock', detail: null },
          printer: { state: 'OK', adapter: 'mock', detail: null },
          scanner: { state: 'OK', adapter: 'mock', detail: null },
        },
        outbox: { pending: 0, failed: 0, oldestPendingAt: null },
        unresolvedPayments: 0,
        lastSyncAt: null,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.catalogRevision).toBeGreaterThan(0);
    expect(typeof r.body.subscriptionRev).toBe('number');
  });
});
