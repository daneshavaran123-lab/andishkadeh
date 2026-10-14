import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateOrderRequest,
  ErrorCode,
  ItemType,
  OrderDto,
  OrderKind,
  OrderOfflinePayload,
  PricingItem,
  ReceiptData,
  maskMobile,
  normalizeMobile,
  priceItems,
} from '@andishkadeh/shared';
import { CounterService, SettingsService } from '../../common/core.services';
import { ApiError } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { OrderWithItems, toOrderDto } from './mappers';
import { SubscriptionsService } from './subscriptions.service';

const orderInclude = { items: true, customer: { select: { mobile: true } }, subscription: true } as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly counters: CounterService,
    private readonly settings: SettingsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async findForDevice(deviceId: string, orderId: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, deviceId }, include: orderInclude });
    if (!order) throw ApiError.notFound('سفارش');
    return order;
  }

  private async withPreview(order: OrderWithItems, extra: Partial<OrderDto> = {}): Promise<OrderDto> {
    const dto: OrderDto = { ...toOrderDto(order), ...extra };
    if (order.kind === 'SUBSCRIPTION' && !order.subscription && order.status !== 'PAID') {
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: order.items[0]?.itemId } });
      if (plan) Object.assign(dto, await this.subscriptions.preview(this.prisma, order.customerId, plan.durationDays));
    }
    return dto;
  }

  /**
   * POST /orders — creates and price-locks an order (idempotent on deviceId + localOrderId).
   * Prices are always recomputed here from the server catalogue (PRD I-03); the kiosk total is
   * only used to tell the customer when something changed since the cart.
   */
  async create(deviceId: string, req: CreateOrderRequest): Promise<OrderDto> {
    const existing = await this.prisma.order.findUnique({
      where: { deviceId_localId: { deviceId, localId: req.localOrderId } },
      include: orderInclude,
    });
    if (existing) return this.withPreview(existing);

    const mobile = normalizeMobile(req.mobile);
    if (!mobile) throw new ApiError(ErrorCode.INVALID_MOBILE, 'شماره موبایل نامعتبر است');

    const { settings, discounts, policy, now } = await this.catalog.pricingContext();
    const items = await this.resolveItems(req, settings.maxItemQuantity);
    const priced = priceItems(items, discounts, now, policy);
    const catalogRevision = await this.catalog.currentRevision();

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.upsert({ where: { mobile }, update: {}, create: { mobile } });
        const seq = await this.counters.next(tx, 'orderSeq');
        return tx.order.create({
          data: {
            orderNumber: `AK-${String(seq).padStart(6, '0')}`,
            deviceId,
            localId: req.localOrderId,
            kind: req.kind,
            customerId: customer.id,
            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            total: priced.total,
            status: 'LOCKED',
            catalogRevision,
            pendingQrTokenHash: req.kind === OrderKind.SUBSCRIPTION ? req.qrTokenHash : null,
            items: {
              create: priced.lines.map((l, i) => ({
                itemType: l.itemType,
                itemId: l.itemId,
                codeSnapshot: l.code,
                titleSnapshot: l.title,
                unitSnapshot: l.unit,
                categoryIdSnapshot: l.categoryId ?? null,
                categoryTitleSnapshot: l.categoryTitle ?? null,
                unitPriceSnapshot: l.unitPrice,
                quantity: l.quantity,
                discountIdSnapshot: l.discountId,
                discountTitleSnapshot: l.discountTitle,
                unitDiscountSnapshot: l.unitDiscount,
                lineTotal: l.lineTotal,
                sortOrder: i,
              })),
            },
          },
          include: orderInclude,
        });
      });
      return this.withPreview(order, {
        priceChanged: req.expectedTotal !== undefined && req.expectedTotal !== order.total,
      });
    } catch (e) {
      // Concurrent duplicate submit (double tap / retry): return the order that won the race.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.order.findUnique({
          where: { deviceId_localId: { deviceId, localId: req.localOrderId } },
          include: orderInclude,
        });
        if (raced) return this.withPreview(raced);
      }
      throw e;
    }
  }

  private async resolveItems(req: CreateOrderRequest, maxQty: number): Promise<PricingItem[]> {
    const unavailable: string[] = [];
    if (req.kind === OrderKind.SUBSCRIPTION) {
      const planId = req.items[0].itemId;
      const plan = await this.prisma.subscriptionPlan.findFirst({ where: { id: planId, active: true } });
      if (!plan) {
        throw new ApiError(ErrorCode.ITEM_UNAVAILABLE, 'این پلن در حال حاضر قابل خرید نیست', HttpStatus.UNPROCESSABLE_ENTITY, {
          unavailable: [planId],
        });
      }
      return [{ itemType: ItemType.PLAN, itemId: plan.id, code: plan.code, title: plan.title, unit: 'اشتراک', unitPrice: plan.price, quantity: 1 }];
    }

    const services = await this.prisma.service.findMany({
      where: {
        id: { in: req.items.map((i) => i.itemId) },
        active: true,
        deletedAt: null,
        price: { not: null },
        subcategory: { active: true, category: { active: true, salesEnabled: true } },
      },
      include: { subcategory: { include: { category: true } } },
    });
    const byId = new Map(services.map((s) => [s.id, s]));
    const items: PricingItem[] = [];
    for (const it of req.items) {
      const s = byId.get(it.itemId);
      if (!s) {
        unavailable.push(it.itemId);
        continue;
      }
      if (it.quantity > maxQty) {
        throw new ApiError(ErrorCode.VALIDATION_FAILED, `حداکثر تعداد هر خدمت ${maxQty} است`);
      }
      items.push({
        itemType: ItemType.SERVICE,
        itemId: s.id,
        code: s.code,
        title: s.title,
        unit: s.unit,
        unitPrice: s.price as number,
        quantity: it.quantity,
        categoryId: s.subcategory.categoryId,
        categoryTitle: s.subcategory.category.title,
        subcategoryId: s.subcategoryId,
      });
    }
    if (unavailable.length) {
      throw new ApiError(
        ErrorCode.ITEM_UNAVAILABLE,
        'برخی خدمات سبد دیگر قابل خرید نیستند و از سبد حذف می‌شوند',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { unavailable },
      );
    }
    return items;
  }

  /** Cancel a locked, never-paid order (customer left before paying). */
  async cancel(deviceId: string, orderId: string): Promise<OrderDto> {
    const order = await this.findForDevice(deviceId, orderId);
    if (order.status === 'LOCKED' || order.status === 'FAILED') {
      const unresolved = await this.prisma.paymentAttempt.count({ where: { orderId, status: { in: ['INITIATED', 'UNKNOWN', 'PAID'] } } });
      if (unresolved === 0) {
        const updated = await this.prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' }, include: orderInclude });
        return toOrderDto(updated);
      }
    }
    // PAID / UNKNOWN / in-flight orders are never cancelled from the kiosk (PRD K24).
    return toOrderDto(order);
  }

  /**
   * Sync ORDER_OFFLINE: an order created while the kiosk had no server connection.
   * The customer was shown (and may have paid) the kiosk price, so amounts are stored as-is.
   * Any difference with current server prices is flagged for review — never dropped (PRD §15).
   */
  async ingestOffline(tx: Tx, deviceId: string, p: OrderOfflinePayload): Promise<{ orderId: string; conflict: string | null }> {
    const existing = await tx.order.findUnique({ where: { deviceId_localId: { deviceId, localId: p.localOrderId } } });
    if (existing) return { orderId: existing.id, conflict: null };

    const mobile = normalizeMobile(p.mobile);
    if (!mobile) throw new ApiError(ErrorCode.INVALID_MOBILE, 'شماره موبایل سفارش آفلاین نامعتبر است');

    const notes: string[] = [];
    const subtotal = p.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const discount = p.lines.reduce((s, l) => s + l.unitDiscount * l.quantity, 0);
    if (subtotal !== p.subtotal || discount !== p.discountTotal || p.total !== p.subtotal - p.discountTotal) {
      notes.push('محاسبات مبلغ سفارش آفلاین با اقلام آن سازگار نیست');
    }
    for (const l of p.lines) {
      if (l.itemType === ItemType.SERVICE) {
        const s = await tx.service.findUnique({ where: { id: l.itemId } });
        if (!s || s.price !== l.unitPrice) notes.push(`قیمت ${l.code} در زمان فروش آفلاین با قیمت فعلی مرکز متفاوت است`);
      } else {
        const plan = await tx.subscriptionPlan.findUnique({ where: { id: l.itemId } });
        if (!plan || plan.price !== l.unitPrice) notes.push(`قیمت ${l.code} در زمان فروش آفلاین با قیمت فعلی مرکز متفاوت است`);
      }
    }

    const customer = await tx.customer.upsert({ where: { mobile }, update: {}, create: { mobile } });
    let orderNumber = p.orderNumber;
    if (await tx.order.findUnique({ where: { orderNumber } })) orderNumber = `${p.orderNumber}-${p.localOrderId.slice(0, 4)}`;

    const conflict = notes.length ? notes.join('؛ ') : null;
    const order = await tx.order.create({
      data: {
        orderNumber,
        deviceId,
        localId: p.localOrderId,
        kind: p.kind,
        customerId: customer.id,
        subtotal: p.subtotal,
        discountTotal: p.discountTotal,
        total: p.total,
        status: 'LOCKED',
        offline: true,
        catalogRevision: p.catalogRevision,
        pendingQrTokenHash: p.qrTokenHash,
        conflictFlag: conflict !== null,
        conflictNote: conflict,
        lockedAt: new Date(p.createdAt),
        createdAt: new Date(p.createdAt),
        items: {
          create: p.lines.map((l, i) => ({
            itemType: l.itemType,
            itemId: l.itemId,
            codeSnapshot: l.code,
            titleSnapshot: l.title,
            unitSnapshot: l.unit,
            categoryIdSnapshot: l.categoryId,
            categoryTitleSnapshot: l.categoryTitle,
            unitPriceSnapshot: l.unitPrice,
            quantity: l.quantity,
            discountIdSnapshot: l.discountId,
            discountTitleSnapshot: l.discountTitle,
            unitDiscountSnapshot: l.unitDiscount,
            lineTotal: l.lineTotal,
            sortOrder: i,
          })),
        },
      },
    });
    return { orderId: order.id, conflict };
  }

  /** Receipt payload for kiosk reprint commands and the admin browser print. */
  async receipt(orderId: string, reprint: boolean): Promise<ReceiptData> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { ...orderInclude, payments: { where: { status: 'PAID' }, orderBy: { resolvedAt: 'asc' }, take: 1 } },
    });
    if (!order) throw ApiError.notFound('سفارش');
    const settings = await this.settings.settings();
    const paid = order.payments[0];
    return {
      centerName: settings.centerName,
      header: settings.receiptHeader,
      footer: settings.receiptFooter,
      orderNumber: order.orderNumber,
      offline: order.offline,
      kind: order.kind as OrderKind,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      mobileMasked: maskMobile(order.customer.mobile),
      lines: [...order.items]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          code: i.codeSnapshot,
          title: i.titleSnapshot,
          quantity: i.quantity,
          unitPrice: i.unitPriceSnapshot,
          unitDiscount: i.unitDiscountSnapshot,
          lineTotal: i.lineTotal,
        })),
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      total: order.total,
      payment: { terminalRef: paid?.terminalRef ?? null, rrn: paid?.rrn ?? null },
      subscription: order.subscription
        ? {
            planTitle: order.subscription.planTitle,
            startsAt: order.subscription.startsAt.toISOString(),
            expiresAt: order.subscription.expiresAt.toISOString(),
            // The raw QR token is never stored server side; reprints carry no QR (PRD A12).
            qrToken: null,
          }
        : null,
      reprint,
      timezone: settings.timezone,
    };
  }
}

export { orderInclude };
