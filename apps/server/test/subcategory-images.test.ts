/**
 * Subcategory images (seeded per subgroup, upgraded with newer defaults, replaceable in the panel) and
 * the tap sound setting.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminCategory, Bootstrap } from '@andishkadeh/shared';
import { runSeed } from './global-setup';
import { admin, bootApp, kiosk, login, suffix, useTestEnv } from './helpers';

let app: INestApplication;
let token: string;

beforeAll(async () => {
  useTestEnv();
  app = await bootApp();
  token = await login(app, 'admin', 'Admin@12345');
});

afterAll(() => app?.close());

describe('subcategory images', () => {
  it('every subgroup comes with its own image, shipped to the kiosks', async () => {
    const b = (await kiosk(app).get('/kiosk/bootstrap')).body as Bootstrap;
    const subs = b.categories.flatMap((c) => c.subcategories);
    expect(subs.length).toBeGreaterThan(10);
    const ids = subs.map((s) => s.mediaId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const shipped = new Set(b.media.map((m) => m.id));
    expect(ids.every((id) => shipped.has(id!))).toBe(true);
  });

  it('the panel lists the image and can replace or remove it', async () => {
    const a = admin(app, token);
    const cats = (await a.get('/admin/categories')).body as AdminCategory[];
    const sub = cats.flatMap((c) => c.subcategories).find((s) => s.code === 'N-4')!;
    expect(sub.mediaUrl).toMatch(/\/api\/v1\/media\//);
    const other = cats.flatMap((c) => c.subcategories).find((s) => s.code === 'N-5')!;
    const body = { categoryId: sub.categoryId, code: sub.code, title: sub.title, description: sub.description, sortOrder: sub.sortOrder, active: sub.active };
    try {
      expect((await a.patch(`/admin/subcategories/${sub.id}`, { ...body, mediaId: other.mediaId })).status).toBe(200);
      expect((await a.patch(`/admin/subcategories/${sub.id}`, { ...body, mediaId: null })).status).toBe(200);
      expect((await a.patch(`/admin/subcategories/${sub.id}`, { ...body, mediaId: 'no-such-media' })).status).toBe(404);
    } finally {
      await a.patch(`/admin/subcategories/${sub.id}`, { ...body, mediaId: sub.mediaId });
    }
  });

  it('a newer default replaces the earlier default on the next deploy, an image chosen in the panel stays', async () => {
    const prisma = new PrismaClient();
    const fake = (originalName: string) =>
      prisma.media.create({ data: { storageKey: `old-${suffix()}.jpg`, originalName, mime: 'image/jpeg', size: 1, checksum: `old-${suffix()}${suffix()}` } });
    const [oldDefault, chosen] = [await fake('subcategories/N-4.jpg'), await fake('my-photo.jpg')];
    const revision = async () => (await prisma.counter.findUniqueOrThrow({ where: { key: 'catalogRevision' } })).value;
    const before = await prisma.subcategory.findMany({ where: { code: { in: ['N-4', 'N-5'] } } });
    try {
      await prisma.subcategory.update({ where: { code: 'N-4' }, data: { mediaId: oldDefault.id } });
      await prisma.subcategory.update({ where: { code: 'N-5' }, data: { mediaId: chosen.id } });
      const rev = await revision();
      runSeed();
      const after = await prisma.subcategory.findMany({ where: { code: { in: ['N-4', 'N-5'] } }, include: { media: true } });
      const current = createHash('sha256').update(readFileSync(resolve(__dirname, '../../../assets/seed-media/subcategories/N-4.jpg'))).digest('hex');
      expect(after.find((s) => s.code === 'N-4')!.media!.checksum).toBe(current);
      expect(after.find((s) => s.code === 'N-5')!.mediaId).toBe(chosen.id);
      expect(await revision()).toBeGreaterThan(rev);
      // nothing left to upgrade: a second run changes nothing
      const settled = await revision();
      runSeed();
      expect(await revision()).toBe(settled);
    } finally {
      for (const s of before) await prisma.subcategory.update({ where: { id: s.id }, data: { mediaId: s.mediaId } });
      await prisma.media.deleteMany({ where: { id: { in: [oldDefault.id, chosen.id] } } });
      await prisma.$disconnect();
    }
  }, 60_000);
});

describe('tap sound setting', () => {
  it('is on by default and stays off when other settings are saved', async () => {
    const a = admin(app, token);
    const before = (await a.get('/admin/settings')).body as { tapSound: boolean; maxItemQuantity: number };
    try {
      expect((await a.put('/admin/settings', { tapSound: false })).body.tapSound).toBe(false);
      const saved = await a.put('/admin/settings', { maxItemQuantity: before.maxItemQuantity });
      expect(saved.body.tapSound).toBe(false);
      expect(((await kiosk(app).get('/kiosk/bootstrap')).body as Bootstrap).settings.tapSound).toBe(false);
    } finally {
      await a.put('/admin/settings', { tapSound: before.tapSound });
    }
    expect(before.tapSound).toBe(true);
  });
});
