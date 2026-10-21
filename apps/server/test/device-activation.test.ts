/**
 * Connecting a kiosk with a one-time activation code (A15): registering issues one (and picks the
 * next free KIOSK-NN), the kiosk exchanges the code or its link for its id and a fresh key, the code
 * works once and only in time, and wrong codes are limited per address.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activationLink, type ActivateDeviceResponse, type DeviceActivation, type DeviceRow } from '@andishkadeh/shared';
import { admin, bootApp, login, suffix } from './helpers';

let app: INestApplication;
let token: string;
const prisma = new PrismaClient();
const created: string[] = [];

beforeAll(async () => {
  process.env.TRUST_PROXY = '1'; // addresses from X-Forwarded-For, as behind the proxy in production
  app = await bootApp();
  token = await login(app, 'admin', 'Admin@12345');
});

afterAll(async () => {
  for (const id of created) {
    await prisma.auditLog.deleteMany({ where: { entityType: 'Device', entityId: id } });
    await prisma.device.deleteMany({ where: { id } });
  }
  await prisma.$disconnect();
  await app?.close();
  delete process.env.TRUST_PROXY;
});

const activate = (code: string, ip = '203.0.113.7') => request(app.getHttpServer()).post('/api/v1/kiosk/activate').set('X-Forwarded-For', ip).send({ code });
const bootstrapWith = (id: string, key: string) => request(app.getHttpServer()).get('/api/v1/kiosk/bootstrap').set('Authorization', `Device ${id}:${key}`);

async function register(name = `کیوسک آزمون ${suffix()}`) {
  const r = await admin(app, token).post('/admin/devices', { name });
  expect(r.status).toBe(201);
  const body = r.body as { device: DeviceRow; apiKey: string; activation: DeviceActivation };
  created.push(body.device.id);
  return body;
}

describe('kiosk activation code', () => {
  it('registering with only a name picks the next free KIOSK-NN and issues an 8-digit code for half an hour', async () => {
    const taken = new Set((await prisma.device.findMany({ select: { id: true } })).map((d) => d.id));
    const first = await register();
    expect(first.device.id).toMatch(/^KIOSK-\d{2,}$/);
    expect(taken.has(first.device.id)).toBe(false);
    expect(first.activation.code).toMatch(/^\d{8}$/);
    const minutes = (Date.parse(first.activation.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    expect(first.device.activationExpiresAt).toBe(first.activation.expiresAt);
    // only the hash is stored
    const row = await prisma.device.findUniqueOrThrow({ where: { id: first.device.id } });
    expect(row.activationCodeHash).not.toContain(first.activation.code);
    expect((await register()).device.id).not.toBe(first.device.id);
  });

  it('the kiosk exchanges the code for its id and a fresh key; the code then stops working', async () => {
    const { device, apiKey, activation } = await register('کیوسک ورودی');
    const r = await activate(activation.code);
    expect(r.status).toBe(200);
    const got = r.body as ActivateDeviceResponse;
    expect(got).toMatchObject({ deviceId: device.id, deviceName: 'کیوسک ورودی' });
    expect(got.deviceKey.length).toBeGreaterThanOrEqual(32);
    expect((await bootstrapWith(device.id, got.deviceKey)).status).toBe(200);
    // the key from the registration is replaced
    expect((await bootstrapWith(device.id, apiKey)).status).toBe(401);
    expect((await activate(activation.code)).status).toBe(400);
    const list = (await admin(app, token).get('/admin/devices')).body as DeviceRow[];
    expect(list.find((d) => d.id === device.id)!.activationExpiresAt).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'device.activated', entityId: device.id } });
    expect(audit?.ip).toBeTruthy();
  });

  it('accepts the code with spaces or Persian digits, and the link (also as typed by a scanner on a Persian keyboard)', async () => {
    const spaced = await register();
    const persian = spaced.activation.code.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    expect((await activate(`${persian.slice(0, 4)} ${persian.slice(4)}`)).status).toBe(200);

    const linked = await register();
    expect((await activate(activationLink('https://andishkadeh.example.ir', linked.activation.code))).status).toBe(200);

    const scanned = await register();
    const latin = 'https://andishkadeh.example.ir/?activate=';
    const keys: Record<string, string> = { h: 'ا', t: 'ف', p: 'ح', s: 'س', a: 'ش', n: 'د', d: 'ی', i: 'ه', k: 'ن', e: 'ث', x: 'ط', m: 'پ', l: 'م', r: 'ق', c: 'ز', v: 'ر' };
    const typed = [...latin].map((c) => keys[c] ?? c).join('') + scanned.activation.code.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    expect((await activate(typed)).status).toBe(200);
  });

  it('a new code replaces the one not yet used; an expired code, the web app and a disabled kiosk get none', async () => {
    const { device, activation } = await register();
    const again = (await admin(app, token).post(`/admin/devices/${device.id}/activation`)).body as DeviceActivation;
    expect(again.code).not.toBe(activation.code);
    expect((await activate(activation.code)).status).toBe(400);

    await prisma.device.update({ where: { id: device.id }, data: { activationExpiresAt: new Date(Date.now() - 1000) } });
    expect((await activate(again.code)).status).toBe(400);

    expect((await admin(app, token).post('/admin/devices/WEB-APP/activation')).status).toBe(409);
    await admin(app, token).patch(`/admin/devices/${device.id}`, { active: false });
    expect((await admin(app, token).post(`/admin/devices/${device.id}/activation`)).status).toBe(409);
  });

  it('only the main admin issues codes', async () => {
    const operator = await login(app, 'operator', 'Operator@12345');
    expect((await admin(app, operator).post('/admin/devices/KIOSK-01/activation')).status).toBe(403);
  });

  it('wrong codes are limited per address; a right code from another address still works', async () => {
    const { activation } = await register();
    for (let i = 0; i < 20; i++) expect((await activate('00000000', '198.51.100.9')).status).toBe(400);
    const blocked = await activate(activation.code, '198.51.100.9');
    expect(blocked.status).toBe(429);
    expect((await activate(activation.code, '198.51.100.10')).status).toBe(200);
  });
});
