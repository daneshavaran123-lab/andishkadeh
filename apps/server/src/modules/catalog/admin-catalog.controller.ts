import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AdminCategory,
  AdminDiscount,
  AdminPlan,
  AdminRole,
  AdminService,
  CategoryUpsert,
  ContentUpdate,
  DiscountPolicy,
  DiscountPreviewRow,
  DiscountTargetType,
  DiscountUpsert,
  ErrorCode,
  ItemType,
  KioskContent,
  KioskSettings,
  PlanUpsert,
  PricingDiscount,
  ReorderRequest,
  ServiceUpsert,
  SettingsUpdate,
  SubcategoryUpsert,
  isDiscountLive,
  priceLine,
} from '@andishkadeh/shared';
import { z } from 'zod';
import { AdminAuth, AdminPrincipal, ClientIp, CurrentAdmin, Roles } from '../../common/auth';
import { AuditService, SettingsService } from '../../common/core.services';
import { ApiError } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { ZodPipe } from '../../common/zod.pipe';
import { CatalogService, mediaUrl, toDiscountDto } from './catalog.service';

const ServicesQuery = z.object({
  q: z.string().trim().max(60).optional(),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  status: z.enum(['active', 'inactive', 'noprice']).optional(),
});

/**
 * A03/A04/A08/A06/A13/A16 — catalogue management. Reads are open to operators;
 * every write is ADMIN only (RBAC enforced here, not just hidden in the UI).
 */
@Controller('admin')
@AdminAuth()
export class AdminCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
    private readonly settingsService: SettingsService,
  ) {}

  private async mutate<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const out = await fn(tx);
      await this.catalog.bumpRevision(tx);
      return out;
    });
  }

  private async assertMedia(tx: Tx, mediaId: string | null | undefined) {
    if (mediaId && !(await tx.media.findUnique({ where: { id: mediaId } }))) throw ApiError.notFound('تصویر');
  }

  // ------------------------------------------------------------------ categories

  @Get('categories')
  async categories(): Promise<AdminCategory[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      include: {
        media: true,
        subcategories: {
          orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
          include: { _count: { select: { services: { where: { deletedAt: null } } } } },
        },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      subtitle: c.subtitle,
      description: c.description,
      theme: c.theme,
      mediaId: c.mediaId,
      mediaUrl: c.media ? mediaUrl(c.media) : null,
      sortOrder: c.sortOrder,
      active: c.active,
      salesEnabled: c.salesEnabled,
      subscriptionCovered: c.subscriptionCovered,
      subcategories: c.subcategories.map((s) => ({
        id: s.id,
        categoryId: s.categoryId,
        code: s.code,
        title: s.title,
        description: s.description,
        mediaId: s.mediaId,
        sortOrder: s.sortOrder,
        active: s.active,
        serviceCount: s._count.services,
      })),
    }));
  }

  @Post('categories')
  @Roles(AdminRole.ADMIN)
  createCategory(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(CategoryUpsert)) body: CategoryUpsert) {
    return this.mutate(async (tx) => {
      await this.assertMedia(tx, body.mediaId);
      if (await tx.category.findUnique({ where: { code: body.code } })) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد حوزه تکراری است');
      const c = await tx.category.create({ data: body });
      await this.audit.log(tx, admin, { action: 'category.created', entityType: 'Category', entityId: c.id, after: c });
      return c;
    });
  }

  @Patch('categories/:id')
  @Roles(AdminRole.ADMIN)
  updateCategory(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(CategoryUpsert)) body: CategoryUpsert) {
    return this.mutate(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw ApiError.notFound('حوزه');
      await this.assertMedia(tx, body.mediaId);
      const dup = await tx.category.findUnique({ where: { code: body.code } });
      if (dup && dup.id !== id) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد حوزه تکراری است');
      const c = await tx.category.update({ where: { id }, data: body });
      await this.audit.log(tx, admin, { action: 'category.updated', entityType: 'Category', entityId: id, before, after: c });
      return c;
    });
  }

  @Post('categories/reorder')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  reorderCategories(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(ReorderRequest)) body: ReorderRequest) {
    return this.mutate(async (tx) => {
      for (const [i, id] of body.ids.entries()) await tx.category.update({ where: { id }, data: { sortOrder: i + 1 } });
      await this.audit.log(tx, admin, { action: 'category.reordered', entityType: 'Category', after: body.ids });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ subcategories

  @Post('subcategories')
  @Roles(AdminRole.ADMIN)
  createSubcategory(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(SubcategoryUpsert)) body: SubcategoryUpsert) {
    return this.mutate(async (tx) => {
      if (!(await tx.category.findUnique({ where: { id: body.categoryId } }))) throw ApiError.notFound('حوزه');
      await this.assertMedia(tx, body.mediaId);
      if (await tx.subcategory.findUnique({ where: { code: body.code } })) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد زیرگروه تکراری است');
      const s = await tx.subcategory.create({ data: body });
      await this.audit.log(tx, admin, { action: 'subcategory.created', entityType: 'Subcategory', entityId: s.id, after: s });
      return s;
    });
  }

  @Patch('subcategories/:id')
  @Roles(AdminRole.ADMIN)
  updateSubcategory(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
    @Body(new ZodPipe(SubcategoryUpsert)) body: SubcategoryUpsert,
  ) {
    return this.mutate(async (tx) => {
      const before = await tx.subcategory.findUnique({ where: { id } });
      if (!before) throw ApiError.notFound('زیرگروه');
      await this.assertMedia(tx, body.mediaId);
      const dup = await tx.subcategory.findUnique({ where: { code: body.code } });
      if (dup && dup.id !== id) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد زیرگروه تکراری است');
      const s = await tx.subcategory.update({ where: { id }, data: body });
      await this.audit.log(tx, admin, { action: 'subcategory.updated', entityType: 'Subcategory', entityId: id, before, after: s });
      return s;
    });
  }

  @Post('subcategories/reorder')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  reorderSubcategories(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(ReorderRequest)) body: ReorderRequest) {
    return this.mutate(async (tx) => {
      for (const [i, id] of body.ids.entries()) await tx.subcategory.update({ where: { id }, data: { sortOrder: i + 1 } });
      await this.audit.log(tx, admin, { action: 'subcategory.reordered', entityType: 'Subcategory', after: body.ids });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ services

  private serviceInclude = { media: true, subcategory: { include: { category: true } } } as const;

  private toAdminService(
    s: Prisma.ServiceGetPayload<{ include: { media: true; subcategory: { include: { category: true } } } }>,
  ): AdminService {
    return {
      id: s.id,
      code: s.code,
      title: s.title,
      subcategoryId: s.subcategoryId,
      subcategoryTitle: s.subcategory.title,
      categoryId: s.subcategory.categoryId,
      categoryTitle: s.subcategory.category.title,
      description: s.description,
      includes: s.includes,
      unit: s.unit,
      price: s.price,
      mediaId: s.mediaId,
      mediaUrl: s.media ? mediaUrl(s.media) : null,
      fullAccessIncluded: s.fullAccessIncluded,
      active: s.active,
      sortOrder: s.sortOrder,
      revision: s.revision,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  @Get('services')
  async services(@Query(new ZodPipe(ServicesQuery)) q: z.infer<typeof ServicesQuery>): Promise<AdminService[]> {
    const where: Prisma.ServiceWhereInput = { deletedAt: null };
    if (q.subcategoryId) where.subcategoryId = q.subcategoryId;
    else if (q.categoryId) where.subcategory = { categoryId: q.categoryId };
    if (q.status === 'active') where.active = true;
    if (q.status === 'inactive') where.active = false;
    if (q.status === 'noprice') where.price = null;
    if (q.q) where.OR = [{ code: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }];
    const rows = await this.prisma.service.findMany({
      where,
      include: this.serviceInclude,
      orderBy: [{ subcategory: { category: { sortOrder: 'asc' } } }, { subcategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((s) => this.toAdminService(s));
  }

  @Get('services/:id')
  async service(@Param('id') id: string): Promise<AdminService> {
    const s = await this.prisma.service.findFirst({ where: { id, deletedAt: null }, include: this.serviceInclude });
    if (!s) throw ApiError.notFound('خدمت');
    return this.toAdminService(s);
  }

  @Post('services')
  @Roles(AdminRole.ADMIN)
  createService(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(ServiceUpsert)) body: ServiceUpsert, @ClientIp() ip: string | null) {
    return this.mutate(async (tx) => {
      if (!(await tx.subcategory.findUnique({ where: { id: body.subcategoryId } }))) throw ApiError.notFound('زیرگروه');
      await this.assertMedia(tx, body.mediaId);
      if (await tx.service.findUnique({ where: { code: body.code } })) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد خدمت تکراری است');
      const s = await tx.service.create({ data: body, include: this.serviceInclude });
      await this.audit.log(tx, admin, { action: 'service.created', entityType: 'Service', entityId: s.id, after: body, ip });
      return this.toAdminService(s);
    });
  }

  @Patch('services/:id')
  @Roles(AdminRole.ADMIN)
  updateService(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
    @Body(new ZodPipe(ServiceUpsert)) body: ServiceUpsert,
    @ClientIp() ip: string | null,
  ) {
    return this.mutate(async (tx) => {
      const before = await tx.service.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw ApiError.notFound('خدمت');
      if (!(await tx.subcategory.findUnique({ where: { id: body.subcategoryId } }))) throw ApiError.notFound('زیرگروه');
      await this.assertMedia(tx, body.mediaId);
      const dup = await tx.service.findUnique({ where: { code: body.code } });
      if (dup && dup.id !== id) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد خدمت تکراری است');
      const s = await tx.service.update({
        where: { id },
        data: { ...body, revision: { increment: 1 } },
        include: this.serviceInclude,
      });
      await this.audit.log(tx, admin, {
        action: before.price !== body.price ? 'service.price_changed' : 'service.updated',
        entityType: 'Service',
        entityId: id,
        before: { code: before.code, title: before.title, price: before.price, active: before.active, mediaId: before.mediaId, unit: before.unit },
        after: { code: body.code, title: body.title, price: body.price, active: body.active, mediaId: body.mediaId, unit: body.unit },
        ip,
      });
      return this.toAdminService(s);
    });
  }

  /** Soft delete: historical orders keep their snapshots; the code stays reserved. */
  @Delete('services/:id')
  @Roles(AdminRole.ADMIN)
  deleteService(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    return this.mutate(async (tx) => {
      const before = await tx.service.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw ApiError.notFound('خدمت');
      await tx.service.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, admin, { action: 'service.deleted', entityType: 'Service', entityId: id, before });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ plans

  @Get('plans')
  async plans(): Promise<AdminPlan[]> {
    const rows = await this.prisma.subscriptionPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { durationDays: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      description: p.description,
      durationDays: p.durationDays,
      durationMonths: p.durationMonths,
      price: p.price,
      badge: p.badge,
      active: p.active,
      sortOrder: p.sortOrder,
      subscriptionCount: p._count.subscriptions,
    }));
  }

  @Post('plans')
  @Roles(AdminRole.ADMIN)
  createPlan(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(PlanUpsert)) body: PlanUpsert) {
    return this.mutate(async (tx) => {
      if (await tx.subscriptionPlan.findUnique({ where: { code: body.code } })) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد پلن تکراری است');
      const p = await tx.subscriptionPlan.create({ data: body });
      await this.audit.log(tx, admin, { action: 'plan.created', entityType: 'SubscriptionPlan', entityId: p.id, after: p });
      return p;
    });
  }

  /** Changing a plan never touches existing subscriptions: they keep their dates and planTitle snapshot. */
  @Patch('plans/:id')
  @Roles(AdminRole.ADMIN)
  updatePlan(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(PlanUpsert)) body: PlanUpsert) {
    return this.mutate(async (tx) => {
      const before = await tx.subscriptionPlan.findUnique({ where: { id } });
      if (!before) throw ApiError.notFound('پلن');
      const dup = await tx.subscriptionPlan.findUnique({ where: { code: body.code } });
      if (dup && dup.id !== id) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'کد پلن تکراری است');
      const p = await tx.subscriptionPlan.update({ where: { id }, data: { ...body, revision: { increment: 1 } } });
      await this.audit.log(tx, admin, {
        action: before.price !== body.price ? 'plan.price_changed' : 'plan.updated',
        entityType: 'SubscriptionPlan',
        entityId: id,
        before,
        after: p,
      });
      return p;
    });
  }

  // ------------------------------------------------------------------ discounts

  private async targetLabels(targets: Array<{ targetType: string; targetId: string }>) {
    const ids = (t: string) => targets.filter((x) => x.targetType === t).map((x) => x.targetId);
    const [services, subs, cats, plans] = await Promise.all([
      this.prisma.service.findMany({ where: { id: { in: ids('SERVICE') } }, select: { id: true, code: true, title: true } }),
      this.prisma.subcategory.findMany({ where: { id: { in: ids('SUBCATEGORY') } }, select: { id: true, title: true } }),
      this.prisma.category.findMany({ where: { id: { in: ids('CATEGORY') } }, select: { id: true, title: true } }),
      this.prisma.subscriptionPlan.findMany({ where: { id: { in: ids('PLAN') } }, select: { id: true, title: true } }),
    ]);
    const map = new Map<string, string>();
    services.forEach((s) => map.set(`SERVICE:${s.id}`, `${s.code} — ${s.title}`));
    subs.forEach((s) => map.set(`SUBCATEGORY:${s.id}`, s.title));
    cats.forEach((s) => map.set(`CATEGORY:${s.id}`, s.title));
    plans.forEach((s) => map.set(`PLAN:${s.id}`, s.title));
    return map;
  }

  @Get('discounts')
  async discounts(): Promise<AdminDiscount[]> {
    const rows = await this.prisma.discount.findMany({ include: { targets: true }, orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
    const labels = await this.targetLabels(rows.flatMap((r) => r.targets));
    const now = new Date();
    return rows.map((d) => {
      const dto = toDiscountDto(d);
      return {
        ...dto,
        targets: dto.targets.map((t) => ({ ...t, label: labels.get(`${t.targetType}:${t.targetId}`) ?? '(حذف‌شده)' })),
        live: isDiscountLive(dto, now),
      };
    });
  }

  private async assertTargets(tx: Tx, targets: DiscountUpsert['targets']) {
    for (const t of targets) {
      const found =
        t.targetType === DiscountTargetType.SERVICE
          ? await tx.service.findFirst({ where: { id: t.targetId, deletedAt: null } })
          : t.targetType === DiscountTargetType.SUBCATEGORY
            ? await tx.subcategory.findUnique({ where: { id: t.targetId } })
            : t.targetType === DiscountTargetType.CATEGORY
              ? await tx.category.findUnique({ where: { id: t.targetId } })
              : await tx.subscriptionPlan.findUnique({ where: { id: t.targetId } });
      if (!found) throw ApiError.notFound('هدف تخفیف');
    }
  }

  @Post('discounts')
  @Roles(AdminRole.ADMIN)
  createDiscount(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(DiscountUpsert)) body: DiscountUpsert) {
    return this.mutate(async (tx) => {
      await this.assertTargets(tx, body.targets);
      const d = await tx.discount.create({
        data: { ...body, startsAt: body.startsAt ? new Date(body.startsAt) : null, endsAt: body.endsAt ? new Date(body.endsAt) : null, targets: { create: body.targets } },
        include: { targets: true },
      });
      await this.audit.log(tx, admin, { action: 'discount.created', entityType: 'Discount', entityId: d.id, after: body });
      return toDiscountDto(d);
    });
  }

  @Patch('discounts/:id')
  @Roles(AdminRole.ADMIN)
  updateDiscount(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(DiscountUpsert)) body: DiscountUpsert) {
    return this.mutate(async (tx) => {
      const before = await tx.discount.findUnique({ where: { id }, include: { targets: true } });
      if (!before) throw ApiError.notFound('تخفیف');
      await this.assertTargets(tx, body.targets);
      await tx.discountTarget.deleteMany({ where: { discountId: id } });
      const d = await tx.discount.update({
        where: { id },
        data: {
          ...body,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          targets: { create: body.targets },
        },
        include: { targets: true },
      });
      await this.audit.log(tx, admin, { action: 'discount.updated', entityType: 'Discount', entityId: id, before: toDiscountDto(before), after: body });
      return toDiscountDto(d);
    });
  }

  @Delete('discounts/:id')
  @Roles(AdminRole.ADMIN)
  deleteDiscount(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    return this.mutate(async (tx) => {
      const before = await tx.discount.findUnique({ where: { id }, include: { targets: true } });
      if (!before) throw ApiError.notFound('تخفیف');
      // Orders keep discount title/amount snapshots, so the row can be removed safely.
      await tx.discount.delete({ where: { id } });
      await this.audit.log(tx, admin, { action: 'discount.deleted', entityType: 'Discount', entityId: id, before: toDiscountDto(before) });
      return { ok: true };
    });
  }

  /** Preview final prices before publishing (PRD A06): the draft is evaluated together with live discounts. */
  @Post('discounts/preview')
  @HttpCode(200)
  async previewDiscount(
    @Body(new ZodPipe(DiscountUpsert.and(z.object({ id: z.string().optional() })))) body: DiscountUpsert & { id?: string },
  ): Promise<DiscountPreviewRow[]> {
    const { settings, discounts } = await this.catalog.pricingContext();
    const now = new Date();
    const draft: PricingDiscount = {
      id: body.id ?? '__draft__',
      title: body.title,
      type: body.type,
      value: body.value,
      priority: body.priority,
      active: true,
      // Preview the discount as if live now, regardless of its future window.
      startsAt: null,
      endsAt: null,
      targets: body.targets,
    };
    const pool = [...discounts.filter((d) => d.id !== body.id), draft];
    const policy = settings.discountPolicy as DiscountPolicy;

    const serviceIds = new Set<string>();
    const planIds = new Set<string>();
    for (const t of body.targets) {
      if (t.targetType === 'SERVICE') serviceIds.add(t.targetId);
      if (t.targetType === 'PLAN') planIds.add(t.targetId);
    }
    const bySub = body.targets.filter((t) => t.targetType === 'SUBCATEGORY').map((t) => t.targetId);
    const byCat = body.targets.filter((t) => t.targetType === 'CATEGORY').map((t) => t.targetId);
    const services = await this.prisma.service.findMany({
      where: {
        deletedAt: null,
        price: { not: null },
        OR: [{ id: { in: [...serviceIds] } }, { subcategoryId: { in: bySub } }, { subcategory: { categoryId: { in: byCat } } }],
      },
      include: { subcategory: true },
      orderBy: { code: 'asc' },
      take: 300,
    });
    const plans = await this.prisma.subscriptionPlan.findMany({ where: { id: { in: [...planIds] } } });

    const rows: DiscountPreviewRow[] = [];
    for (const s of services) {
      const line = priceLine(
        {
          itemType: ItemType.SERVICE,
          itemId: s.id,
          code: s.code,
          title: s.title,
          unit: s.unit,
          unitPrice: s.price as number,
          quantity: 1,
          categoryId: s.subcategory.categoryId,
          subcategoryId: s.subcategoryId,
        },
        pool,
        now,
        policy,
      );
      rows.push({ itemType: 'SERVICE', itemId: s.id, code: s.code, title: s.title, price: line.unitPrice, finalPrice: line.lineTotal, appliedDiscount: line.discountTitle });
    }
    for (const p of plans) {
      const line = priceLine(
        { itemType: ItemType.PLAN, itemId: p.id, code: p.code, title: p.title, unit: 'اشتراک', unitPrice: p.price, quantity: 1 },
        pool,
        now,
        policy,
      );
      rows.push({ itemType: 'PLAN', itemId: p.id, code: p.code, title: p.title, price: line.unitPrice, finalPrice: line.lineTotal, appliedDiscount: line.discountTitle });
    }
    return rows;
  }

  // ------------------------------------------------------------------ settings & content

  @Get('settings')
  getSettings() {
    return this.settingsService.settings();
  }

  @Put('settings')
  @Roles(AdminRole.ADMIN)
  updateSettings(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(SettingsUpdate)) body: SettingsUpdate) {
    return this.mutate(async (tx) => {
      const before = await this.settingsService.settings(tx);
      const next = KioskSettings.parse({ ...before, ...body });
      await this.assertMedia(tx, next.logoMediaId);
      await this.settingsService.save(tx, 'settings', next);
      await this.audit.log(tx, admin, { action: 'settings.updated', entityType: 'Setting', entityId: 'settings', before, after: next });
      return next;
    });
  }

  @Get('content')
  getContent() {
    return this.settingsService.content();
  }

  @Put('content')
  @Roles(AdminRole.ADMIN)
  updateContent(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(ContentUpdate)) body: KioskContent) {
    return this.mutate(async (tx) => {
      const before = await this.settingsService.content(tx);
      for (const id of [body.welcome.heroMediaId, body.home.servicesMediaId, body.home.subscriptionMediaId, body.home.memberMediaId]) {
        await this.assertMedia(tx, id);
      }
      await this.settingsService.save(tx, 'content', body);
      await this.audit.log(tx, admin, { action: 'content.updated', entityType: 'Setting', entityId: 'content', before, after: body });
      return body;
    });
  }
}
