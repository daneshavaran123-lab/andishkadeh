/**
 * Subcategory and service images (seeded, upgraded with newer defaults, replaceable in the panel) and the
 * tap sound and start screen smoke settings.
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

  it('the nutrition services have photos of their own from the design, all different and large', async () => {
    const b = (await kiosk(app).get('/kiosk/bootstrap')).body as Bootstrap;
    const nutrition = b.categories.find((c) => c.code === 'N')!;
    const services = nutrition.subcategories.flatMap((s) => s.services).filter((s) => /^N-[1-8]0\d$/.test(s.code));
    expect(services).toHaveLength(32);
    const ids = services.map((s) => s.mediaId);
    expect(new Set(ids).size).toBe(32);
    // wide enough for the photo rows and the service page (which uses an image of 600 px and up)
    for (const id of ids) expect(b.media.find((m) => m.id === id)!.width).toBeGreaterThanOrEqual(600);
  });

  it('the psychology services have their design photos: large in the photo-row lists, small thumbnails in QEEG and cognitive', async () => {
    const b = (await kiosk(app).get('/kiosk/bootstrap')).body as Bootstrap;
    const psychology = b.categories.find((c) => c.code === 'PS')!;
    const width = (id: string | null) => b.media.find((m) => m.id === id)!.width ?? 0;
    const large = [
      ...psychology.subcategories.filter((s) => ['PS-2', 'NF', 'BF', 'NS', 'VR', 'PS-4', 'PS-5'].includes(s.code)).flatMap((s) => s.services),
      // assessment from PS-103 on (PS-101 and PS-102 keep their earlier small images)
      ...psychology.subcategories.find((s) => s.code === 'PS-1')!.services.filter((s) => /^PS-1(0[3-9]|10)$/.test(s.code)),
    ];
    expect(large).toHaveLength(52);
    expect(new Set(large.map((s) => s.mediaId)).size).toBe(52);
    for (const s of large) expect(width(s.mediaId)).toBeGreaterThanOrEqual(600);
    const small = psychology.subcategories.filter((s) => ['NE', 'PS-3'].includes(s.code)).flatMap((s) => s.services);
    expect(small).toHaveLength(12);
    for (const s of small) expect(width(s.mediaId)).toBeLessThan(400); // the kiosk keeps square thumbnails below 400 px
  });

  it('a newer default replaces the earlier default on the next deploy, an image chosen in the panel stays', async () => {
    const prisma = new PrismaClient();
    const fake = (originalName: string) =>
      prisma.media.create({ data: { storageKey: `old-${suffix()}.jpg`, originalName, mime: 'image/jpeg', size: 1, checksum: `old-${suffix()}${suffix()}` } });
    const [oldDefault, chosen] = [await fake('subcategories/N-4.jpg'), await fake('my-photo.jpg')];
    const [oldServiceDefault, chosenForService] = [await fake('services/N-101.jpg'), await fake('my-other-photo.jpg')];
    const revision = async () => (await prisma.counter.findUniqueOrThrow({ where: { key: 'catalogRevision' } })).value;
    const checksum = (file: string) => createHash('sha256').update(readFileSync(resolve(__dirname, '../../../assets/seed-media', file))).digest('hex');
    const before = await prisma.subcategory.findMany({ where: { code: { in: ['N-4', 'N-5'] } } });
    const servicesBefore = await prisma.service.findMany({ where: { code: { in: ['N-101', 'N-102'] } } });
    try {
      await prisma.subcategory.update({ where: { code: 'N-4' }, data: { mediaId: oldDefault.id } });
      await prisma.subcategory.update({ where: { code: 'N-5' }, data: { mediaId: chosen.id } });
      await prisma.service.update({ where: { code: 'N-101' }, data: { mediaId: oldServiceDefault.id } });
      await prisma.service.update({ where: { code: 'N-102' }, data: { mediaId: chosenForService.id } });
      const rev = await revision();
      runSeed();
      const after = await prisma.subcategory.findMany({ where: { code: { in: ['N-4', 'N-5'] } }, include: { media: true } });
      expect(after.find((s) => s.code === 'N-4')!.media!.checksum).toBe(checksum('subcategories/N-4.jpg'));
      expect(after.find((s) => s.code === 'N-5')!.mediaId).toBe(chosen.id);
      const services = await prisma.service.findMany({ where: { code: { in: ['N-101', 'N-102'] } }, include: { media: true } });
      expect(services.find((s) => s.code === 'N-101')!.media!.checksum).toBe(checksum('services/N-101.jpg'));
      expect(services.find((s) => s.code === 'N-102')!.mediaId).toBe(chosenForService.id);
      expect(await revision()).toBeGreaterThan(rev);
      // nothing left to upgrade: a second run changes nothing
      const settled = await revision();
      runSeed();
      expect(await revision()).toBe(settled);
    } finally {
      for (const s of before) await prisma.subcategory.update({ where: { id: s.id }, data: { mediaId: s.mediaId } });
      for (const s of servicesBefore) await prisma.service.update({ where: { id: s.id }, data: { mediaId: s.mediaId } });
      await prisma.media.deleteMany({ where: { id: { in: [oldDefault.id, chosen.id, oldServiceDefault.id, chosenForService.id] } } });
      await prisma.$disconnect();
    }
  }, 60_000);
});

describe('tap sound and start screen smoke settings', () => {
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

  it('the start screen smoke is on by default, can be switched off and stays off when other settings are saved', async () => {
    const a = admin(app, token);
    const before = (await a.get('/admin/settings')).body as { startSmoke: boolean; tapSound: boolean };
    try {
      expect((await a.put('/admin/settings', { startSmoke: false })).body.startSmoke).toBe(false);
      expect((await a.put('/admin/settings', { tapSound: before.tapSound })).body.startSmoke).toBe(false);
      expect(((await kiosk(app).get('/kiosk/bootstrap')).body as Bootstrap).settings.startSmoke).toBe(false);
    } finally {
      await a.put('/admin/settings', { startSmoke: before.startSmoke });
    }
    expect(before.startSmoke).toBe(true);
  });
});
