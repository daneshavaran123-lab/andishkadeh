/**
 * First-install seed. Idempotent: existing rows are never overwritten, so prices or texts
 * edited in the admin panel survive a re-run.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { sniffImage } from '../src/media/image-meta';
import { CATEGORIES, DEFAULT_CONTENT, DEFAULT_SETTINGS, HOME_CARD_IMAGES, PLANS, SERVICE_IMAGES, SUBCATEGORY_IMAGES } from './seed-data';

const prisma = new PrismaClient();
const SEED_MEDIA_DIR = resolve(__dirname, '../../../assets/seed-media');

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Initial passwords and keys: the example placeholders and short values are refused. */
function secret(name: string, minLength: number): string {
  const v = env(name);
  if (/CHANGE_ME/i.test(v) || v.length < minLength) throw new Error(`${name}: set a real value of at least ${minLength} characters (not the example)`);
  return v;
}

async function seedMedia(file: string): Promise<string> {
  const mediaDir = resolve(process.cwd(), env('MEDIA_DIR', './storage/media'));
  mkdirSync(mediaDir, { recursive: true });
  const buf = readFileSync(join(SEED_MEDIA_DIR, file));
  const meta = sniffImage(buf);
  if (!meta) throw new Error(`Unsupported seed image ${file}`);
  const checksum = createHash('sha256').update(buf).digest('hex');
  const storageKey = `${checksum}.${meta.ext}`;
  const target = join(mediaDir, storageKey);
  if (!existsSync(target)) copyFileSync(join(SEED_MEDIA_DIR, file), target);
  const media = await prisma.media.upsert({
    where: { checksum },
    update: {},
    create: {
      storageKey,
      originalName: file,
      mime: meta.mime,
      size: buf.length,
      checksum,
      width: meta.width,
      height: meta.height,
    },
  });
  return media.id;
}

async function main() {
  // Counters
  for (const key of ['catalogRevision', 'subscriptionRev', 'orderSeq']) {
    await prisma.counter.upsert({ where: { key }, update: {}, create: { key, value: key === 'catalogRevision' ? 1 : 0 } });
  }

  const heroId = await seedMedia('hero.jpg');
  const homeMedia: Record<string, string> = {};
  for (const [field, file] of Object.entries(HOME_CARD_IMAGES)) homeMedia[field] = await seedMedia(file);
  // Set when something seeded changes what kiosks must download (they pull on a new revision).
  let catalogChanged = false;

  await prisma.setting.upsert({ where: { key: 'settings' }, update: {}, create: { key: 'settings', value: DEFAULT_SETTINGS } });
  const existingContent = await prisma.setting.findUnique({ where: { key: 'content' } });
  if (!existingContent) {
    await prisma.setting.create({
      data: {
        key: 'content',
        value: { ...DEFAULT_CONTENT, welcome: { ...DEFAULT_CONTENT.welcome, heroMediaId: heroId }, home: { ...DEFAULT_CONTENT.home, ...homeMedia } },
      },
    });
  } else {
    // Content saved before home photos existed: fill only the fields that were never set.
    const value = existingContent.value as { home?: Record<string, unknown> };
    const home = { ...(value.home ?? {}) };
    const missing = Object.keys(homeMedia).filter((f) => home[f] === undefined);
    if (missing.length) {
      missing.forEach((f) => (home[f] = homeMedia[f]));
      await prisma.setting.update({ where: { key: 'content' }, data: { value: { ...value, home } as Prisma.InputJsonObject } });
      catalogChanged = true;
    }
  }

  let catOrder = 0;
  for (const c of CATEGORIES) {
    const mediaId = await seedMedia(c.image);
    const category = await prisma.category.upsert({
      where: { code: c.code },
      update: {},
      create: {
        code: c.code,
        title: c.title,
        subtitle: c.subtitle,
        description: c.description,
        theme: c.theme,
        mediaId,
        sortOrder: ++catOrder,
        active: true,
        salesEnabled: c.salesEnabled,
        subscriptionCovered: true,
      },
    });
    let subOrder = 0;
    for (const sc of c.subcategories) {
      const sub = await prisma.subcategory.upsert({
        where: { code: sc.code },
        update: {},
        create: {
          categoryId: category.id,
          code: sc.code,
          title: sc.title,
          description: sc.description ?? '',
          sortOrder: ++subOrder,
          active: true,
        },
      });
      // Image only where none is set, so images chosen in the admin panel are kept.
      const subImage = SUBCATEGORY_IMAGES[sc.code];
      if (subImage && !sub.mediaId) {
        await prisma.subcategory.update({ where: { id: sub.id }, data: { mediaId: await seedMedia(subImage) } });
        catalogChanged = true;
      }
      let svcOrder = 0;
      for (const sv of sc.services) {
        const service = await prisma.service.upsert({
          where: { code: sv.code },
          update: {},
          create: {
            code: sv.code,
            subcategoryId: sub.id,
            title: sv.title,
            description: sv.description ?? '',
            includes: sv.includes ?? [],
            unit: sv.unit,
            price: sv.price,
            fullAccessIncluded: true,
            // Only services with an approved tariff in a sellable category start active.
            active: sv.price !== null && c.salesEnabled,
            sortOrder: ++svcOrder,
          },
        });
        // Thumbnail only where none is set, so images chosen in the admin panel are kept.
        const image = SERVICE_IMAGES[sv.code];
        if (image && !service.mediaId) {
          await prisma.service.update({ where: { id: service.id }, data: { mediaId: await seedMedia(image) } });
          catalogChanged = true;
        }
      }
    }
  }

  for (const p of PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      update: {},
      create: { ...p, description: `دسترسی کامل به حوزه‌های تحت پوشش به مدت ${p.durationMonths} ماه`, active: true },
    });
  }

  // Initial passwords are read only while the account does not exist yet, so after the first run
  // the SEED_*_PASSWORD variables can be removed (the server may re-run this seed on every start).
  const users = [
    { username: env('SEED_ADMIN_USERNAME', 'admin'), passwordEnv: 'SEED_ADMIN_PASSWORD', displayName: 'مدیر سامانه', role: 'ADMIN' as const },
    { username: env('SEED_OPERATOR_USERNAME', 'operator'), passwordEnv: 'SEED_OPERATOR_PASSWORD', displayName: 'اپراتور پذیرش', role: 'OPERATOR' as const },
  ];
  for (const u of users) {
    const exists = await prisma.adminUser.findUnique({ where: { username: u.username } });
    if (!exists) {
      await prisma.adminUser.create({
        data: { username: u.username, displayName: u.displayName, role: u.role, passwordHash: await bcrypt.hash(secret(u.passwordEnv, 8), 10) },
      });
    }
  }

  // Optional: in production kiosks are registered in the panel, which shows each key once.
  if (process.env.SEED_DEVICE_KEY) {
    const deviceId = env('SEED_DEVICE_ID', 'KIOSK-01');
    const deviceKeyHash = createHash('sha256').update(secret('SEED_DEVICE_KEY', 16), 'utf8').digest('hex');
    await prisma.device.upsert({
      where: { id: deviceId },
      update: {},
      create: { id: deviceId, name: 'کیوسک لابی اصلی', apiKeyHash: deviceKeyHash },
    });
  }

  if (catalogChanged) await prisma.counter.update({ where: { key: 'catalogRevision' }, data: { value: { increment: 1 } } });

  const counts = {
    categories: await prisma.category.count(),
    subcategories: await prisma.subcategory.count(),
    services: await prisma.service.count(),
    activeServices: await prisma.service.count({ where: { active: true } }),
    plans: await prisma.subscriptionPlan.count(),
  };
  console.log('Seed completed', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
