import { Injectable } from '@nestjs/common';
import type { Category, Discount, DiscountTarget, Media, Service, Subcategory, SubscriptionPlan } from '@prisma/client';
import {
  Bootstrap,
  CategoryDto,
  CategoryTheme,
  DiscountDto,
  DiscountPolicy,
  DiscountTargetType,
  DiscountType,
  MediaRef,
  PlanDto,
  ServiceDto,
} from '@andishkadeh/shared';
import { config } from '../../config';
import { CounterService, SettingsService } from '../../common/core.services';
import { PrismaService, Tx } from '../../common/prisma.service';

export function mediaUrl(m: Pick<Media, 'storageKey'>): string {
  return `${config().PUBLIC_BASE_URL}/api/v1/media/files/${m.storageKey}`;
}

export function toMediaRef(m: Media): MediaRef {
  return { id: m.id, checksum: m.checksum, mime: m.mime, url: mediaUrl(m), width: m.width, height: m.height };
}

export function toDiscountDto(d: Discount & { targets: DiscountTarget[] }): DiscountDto {
  return {
    id: d.id,
    title: d.title,
    type: d.type as DiscountType,
    value: d.value,
    priority: d.priority,
    active: d.active,
    startsAt: d.startsAt?.toISOString() ?? null,
    endsAt: d.endsAt?.toISOString() ?? null,
    targets: d.targets.map((t) => ({ targetType: t.targetType as DiscountTargetType, targetId: t.targetId })),
  };
}

export function toPlanDto(p: SubscriptionPlan): PlanDto {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    description: p.description,
    durationDays: p.durationDays,
    durationMonths: p.durationMonths,
    price: p.price,
    badge: p.badge,
    mediaId: p.mediaId,
    sortOrder: p.sortOrder,
  };
}

type FullCategory = Category & { subcategories: Array<Subcategory & { services: Service[] }> };

/** Catalogue snapshot for kiosks (GET /kiosk/bootstrap and sync pull). */
@Injectable()
export class CatalogService {
  private cache: { revision: number; bootstrap: Bootstrap } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly settings: SettingsService,
  ) {}

  /** Every catalogue/plan/discount/settings/media change must bump the revision so kiosks pull it. */
  async bumpRevision(tx: Tx): Promise<number> {
    return this.counters.next(tx, 'catalogRevision');
  }

  async currentRevision(): Promise<number> {
    return this.counters.current(this.prisma, 'catalogRevision');
  }

  async bootstrap(): Promise<Bootstrap> {
    const revision = await this.currentRevision();
    if (this.cache && this.cache.revision === revision) return this.cache.bootstrap;
    const bootstrap = await this.build(revision);
    this.cache = { revision, bootstrap };
    return bootstrap;
  }

  private async build(revision: number): Promise<Bootstrap> {
    const now = new Date();
    const [settings, content, categories, plans, discounts] = await Promise.all([
      this.settings.settings(),
      this.settings.content(),
      this.prisma.category.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        include: {
          subcategories: {
            where: { active: true },
            orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
            include: {
              services: {
                where: { active: true, deletedAt: null, price: { not: null } },
                orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
              },
            },
          },
        },
      }),
      this.prisma.subscriptionPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { durationDays: 'asc' }] }),
      this.prisma.discount.findMany({
        where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        include: { targets: true },
      }),
    ]);

    const categoryDtos: CategoryDto[] = (categories as FullCategory[]).map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      subtitle: c.subtitle,
      description: c.description,
      theme: (Object.values(CategoryTheme) as string[]).includes(c.theme) ? (c.theme as CategoryTheme) : CategoryTheme.BLUE,
      mediaId: c.mediaId,
      sortOrder: c.sortOrder,
      salesEnabled: c.salesEnabled,
      subscriptionCovered: c.subscriptionCovered,
      subcategories: c.subcategories.map((sc) => ({
        id: sc.id,
        code: sc.code,
        title: sc.title,
        description: sc.description,
        mediaId: sc.mediaId,
        sortOrder: sc.sortOrder,
        services: sc.services.map(
          (s): ServiceDto => ({
            id: s.id,
            code: s.code,
            title: s.title,
            description: s.description,
            includes: s.includes,
            unit: s.unit,
            price: s.price as number,
            mediaId: s.mediaId,
            categoryId: c.id,
            subcategoryId: sc.id,
            fullAccessIncluded: s.fullAccessIncluded,
            sortOrder: s.sortOrder,
            revision: s.revision,
          }),
        ),
      })),
    }));

    const mediaIds = new Set<string>();
    const add = (id: string | null | undefined) => id && mediaIds.add(id);
    add(settings.logoMediaId);
    add(content.welcome.heroMediaId);
    add(content.home.servicesMediaId);
    add(content.home.subscriptionMediaId);
    add(content.home.memberMediaId);
    for (const c of categoryDtos) {
      add(c.mediaId);
      for (const sc of c.subcategories) {
        add(sc.mediaId);
        sc.services.forEach((s) => add(s.mediaId));
      }
    }
    plans.forEach((p) => add(p.mediaId));
    const media = mediaIds.size ? await this.prisma.media.findMany({ where: { id: { in: [...mediaIds] } } }) : [];

    return {
      catalogRevision: revision,
      generatedAt: now.toISOString(),
      settings,
      content,
      categories: categoryDtos,
      plans: plans.map(toPlanDto),
      discounts: discounts.map(toDiscountDto),
      media: media.map(toMediaRef),
    };
  }

  /** Current pricing inputs for the authoritative server-side lock. */
  async pricingContext(tx: Tx | PrismaService = this.prisma) {
    const now = new Date();
    const [settings, discounts] = await Promise.all([
      this.settings.settings(tx),
      tx.discount.findMany({
        where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        include: { targets: true },
      }),
    ]);
    return { settings, discounts: discounts.map(toDiscountDto), policy: settings.discountPolicy as DiscountPolicy, now };
  }
}
