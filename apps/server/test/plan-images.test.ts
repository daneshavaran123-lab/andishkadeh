/**
 * Plan photos: one per plan on its card in the kiosk, seeded, replaceable in the panel and kept from
 * being deleted while a plan uses it.
 */
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminPlan, Bootstrap } from '@andishkadeh/shared';
import { admin, bootApp, kiosk, login, useTestEnv } from './helpers';

let app: INestApplication;
let token: string;

beforeAll(async () => {
  useTestEnv();
  app = await bootApp();
  token = await login(app, 'admin', 'Admin@12345');
});

afterAll(() => app?.close());

describe('plan photos', () => {
  it('every plan has its own photo, shipped to the kiosks', async () => {
    const b = (await kiosk(app).get('/kiosk/bootstrap')).body as Bootstrap;
    const ids = b.plans.map((p) => p.mediaId);
    expect(ids.length).toBe(4);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const shipped = new Set(b.media.map((m) => m.id));
    expect(ids.every((id) => shipped.has(id!))).toBe(true);
  });

  it('the panel shows the photo and can replace or remove it; an unknown image is refused', async () => {
    const a = admin(app, token);
    const plans = (await a.get('/admin/plans')).body as AdminPlan[];
    const plan = plans.find((p) => p.code === 'SUB-1M')!;
    const other = plans.find((p) => p.code === 'SUB-3M')!;
    expect(plan.mediaUrl).toMatch(/\/api\/v1\/media\//);
    const { code, title, description, durationDays, durationMonths, price, badge, active, sortOrder } = plan;
    const body = { code, title, description, durationDays, durationMonths, price, badge, active, sortOrder };
    const onKiosk = async () => ((await kiosk(app).get('/kiosk/bootstrap')).body as Bootstrap).plans.find((p) => p.code === 'SUB-1M')!.mediaId;
    try {
      expect((await a.patch(`/admin/plans/${plan.id}`, { ...body, mediaId: other.mediaId })).status).toBe(200);
      expect(await onKiosk()).toBe(other.mediaId);
      expect((await a.patch(`/admin/plans/${plan.id}`, { ...body, mediaId: null })).status).toBe(200);
      expect(await onKiosk()).toBeNull();
      expect((await a.patch(`/admin/plans/${plan.id}`, { ...body, mediaId: 'no-such-media' })).status).toBe(404);
    } finally {
      await a.patch(`/admin/plans/${plan.id}`, { ...body, mediaId: plan.mediaId });
    }
  });

  it('a photo in use by a plan cannot be deleted', async () => {
    const a = admin(app, token);
    const plan = ((await a.get('/admin/plans')).body as AdminPlan[])[0];
    expect((await a.del(`/admin/media/${plan.mediaId}`)).status).toBe(409);
  });
});
