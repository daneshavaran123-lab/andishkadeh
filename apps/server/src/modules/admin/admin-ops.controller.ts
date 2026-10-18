import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AdminRole,
  AuditQuery,
  AuditRow,
  CreateDeviceRequest,
  DeviceCommandRow,
  DeviceCommandType,
  ErrorCode,
  ExtendSubscriptionRequest,
  OrderDetail,
  OrderRow,
  OrdersQuery,
  PaymentsQuery,
  PrintReceiptCommandRequest,
  ReasonRequest,
  ReconcileRequest,
  SubscriptionDetail,
  SubscriptionRow,
  SubscriptionState,
  SubscriptionsQuery,
  SyncEvent,
  SyncOverview,
  SystemInfo,
  KioskInstallerInfo,
  localDayRange,
  maskMobile,
  normalizeDigits,
  normalizeMobile,
  WEB_APP_DEVICE_ID,
} from '@andishkadeh/shared';
import { generateQrToken, hashQrToken, randomApiKey } from '@andishkadeh/shared/node';
import { z } from 'zod';
import { AdminAuth, AdminPrincipal, ClientIp, CurrentAdmin, Roles, hashDeviceKey } from '../../common/auth';
import { AuditService, CounterService, SettingsService } from '../../common/core.services';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ZodPipe } from '../../common/zod.pipe';
import { config } from '../../config';
import { DevicesService, toDeviceRow } from '../sales/devices.service';
import { toOrderDto, toPaymentRow } from '../sales/mappers';
import { OrdersService, orderInclude } from '../sales/orders.service';
import { PaymentsService } from '../sales/payments.service';
import { SyncService } from '../sales/sync.service';
import { APP_VERSION, kioskInstallerInfo, kioskInstallerUrl } from '../../version';

const UpdateDeviceRequest = z.object({ name: z.string().trim().min(2).max(80).optional(), active: z.boolean().optional() });
const SyncQuery = z.object({ status: z.enum(['APPLIED', 'REJECTED', 'CONFLICT']).optional(), deviceId: z.string().optional() });

function subState(s: { status: string; startsAt: Date; expiresAt: Date }, now = new Date()): SubscriptionState {
  if (s.status === 'CANCELLED') return 'cancelled';
  if (s.startsAt > now) return 'upcoming';
  if (s.expiresAt <= now) return 'expired';
  return 'active';
}

async function rangeWhere(prisma: PrismaService, settings: SettingsService, from?: string, to?: string) {
  if (!from && !to) return undefined;
  const tz = (await settings.settings()).timezone;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = localDayRange(from, tz).from;
  if (to) range.lt = localDayRange(to, tz).to;
  return range;
}

/** Search box accepts an order number or (part of) a mobile number in Persian or Latin digits. */
function searchTerm(q?: string) {
  if (!q) return null;
  const t = normalizeDigits(q).trim();
  return { raw: t, mobile: normalizeMobile(t) ?? t.replace(/\D/g, '') };
}

/** The public web app is every visitor's browser at once: commands would reach a random one. */
const NO_PUBLIC_COMMANDS = () => ApiError.conflict(ErrorCode.CONFLICT, 'به وب‌اپ عمومی فرمانی فرستاده نمی‌شود');

@Controller('admin')
@AdminAuth()
export class AdminOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly devices: DevicesService,
    private readonly sync: SyncService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ A09/A10 orders

  @Get('orders')
  async listOrders(@Query(new ZodPipe(OrdersQuery)) q: OrdersQuery) {
    const where: Prisma.OrderWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.kind) where.kind = q.kind;
    if (q.conflict) where.conflictFlag = q.conflict === 'true';
    if (q.offline) where.offline = q.offline === 'true';
    const created = await rangeWhere(this.prisma, this.settings, q.from, q.to);
    if (created) where.createdAt = created;
    const term = searchTerm(q.q);
    if (term) {
      where.OR = [
        { orderNumber: { contains: term.raw, mode: 'insensitive' } },
        ...(term.mobile.length >= 4 ? [{ customer: { mobile: { contains: term.mobile } } }] : []),
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: { customer: { select: { mobile: true } }, _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const items: OrderRow[] = rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      kind: o.kind,
      status: o.status,
      mobileMasked: maskMobile(o.customer.mobile),
      total: o.total,
      discountTotal: o.discountTotal,
      itemsCount: o._count.items,
      deviceId: o.deviceId,
      offline: o.offline,
      conflictFlag: o.conflictFlag,
      printStatus: o.printStatus,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
    }));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Get('orders/:id')
  async orderDetail(@Param('id') id: string): Promise<OrderDetail> {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: { ...orderInclude, payments: { include: { order: { select: { orderNumber: true, deviceId: true } } }, orderBy: { initiatedAt: 'asc' } } },
    });
    if (!o) throw ApiError.notFound('سفارش');
    const reconcilers = await this.prisma.adminUser.findMany({
      where: { id: { in: o.payments.map((p) => p.reconciledById).filter((x): x is string => !!x) } },
      select: { id: true, displayName: true },
    });
    const names = new Map(reconcilers.map((r) => [r.id, r.displayName]));
    const dto = toOrderDto(o);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      kind: o.kind,
      status: o.status,
      mobileMasked: dto.mobileMasked,
      total: o.total,
      discountTotal: o.discountTotal,
      subtotal: o.subtotal,
      itemsCount: o.items.length,
      deviceId: o.deviceId,
      offline: o.offline,
      conflictFlag: o.conflictFlag,
      conflictNote: o.conflictNote,
      printStatus: o.printStatus,
      createdAt: o.createdAt.toISOString(),
      lockedAt: o.lockedAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      localId: o.localId,
      items: dto.items,
      payments: o.payments.map((p) => toPaymentRow(p, p.reconciledById ? (names.get(p.reconciledById) ?? null) : null)),
      subscription: o.subscription
        ? {
            id: o.subscription.id,
            planTitle: o.subscription.planTitle,
            startsAt: o.subscription.startsAt.toISOString(),
            expiresAt: o.subscription.expiresAt.toISOString(),
            status: o.subscription.status,
          }
        : null,
    };
  }

  @Get('orders/:id/receipt')
  receipt(@Param('id') id: string) {
    return this.orders.receipt(id, true);
  }

  /** Reprint on a kiosk printer (operators allowed, PRD A-05). */
  @Post('orders/:id/print')
  @HttpCode(200)
  async print(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(PrintReceiptCommandRequest)) body: { deviceId: string }) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw ApiError.notFound('سفارش');
    if (order.status !== 'PAID') throw ApiError.conflict(ErrorCode.CONFLICT, 'فقط برای سفارش پرداخت‌شده رسید صادر می‌شود');
    if (!(await this.prisma.device.findUnique({ where: { id: body.deviceId } }))) throw ApiError.notFound('دستگاه');
    if (body.deviceId === WEB_APP_DEVICE_ID) throw NO_PUBLIC_COMMANDS();
    const receipt = await this.orders.receipt(id, true);
    const cmd = await this.devices.enqueue(body.deviceId, DeviceCommandType.PRINT_RECEIPT, { orderId: id, receipt }, admin.id);
    await this.audit.log(this.prisma, admin, { action: 'order.reprint_requested', entityType: 'Order', entityId: id, after: { deviceId: body.deviceId, commandId: cmd.id } });
    return { commandId: cmd.id };
  }

  @Post('orders/:id/resolve-conflict')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async resolveConflict(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(ReasonRequest)) body: { reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw ApiError.notFound('سفارش');
      const conflictNote = [order.conflictNote, `بررسی شد: ${body.reason}`].filter(Boolean).join('؛ ');
      // Only if nothing new was reported since the admin read the order (a new note keeps the flag up).
      const updated = await tx.order.updateMany({ where: { id, conflictNote: order.conflictNote }, data: { conflictFlag: false, conflictNote } });
      if (updated.count === 0) {
        throw ApiError.conflict(ErrorCode.CONFLICT, 'مغایرت جدیدی برای این سفارش ثبت شد؛ صفحه را تازه کنید و دوباره بررسی کنید');
      }
      await this.audit.log(tx, admin, { action: 'order.conflict_resolved', entityType: 'Order', entityId: id, before: { conflictNote: order.conflictNote }, reason: body.reason });
      return { ok: true, conflictNote };
    });
  }

  // ------------------------------------------------------------------ A11 payments

  @Get('payments')
  async listPayments(@Query(new ZodPipe(PaymentsQuery)) q: PaymentsQuery) {
    const where: Prisma.PaymentAttemptWhereInput = {};
    if (q.status) where.status = q.status;
    const range = await rangeWhere(this.prisma, this.settings, q.from, q.to);
    if (range) where.initiatedAt = range;
    const term = searchTerm(q.q);
    if (term) {
      where.OR = [
        { order: { orderNumber: { contains: term.raw, mode: 'insensitive' } } },
        { terminalRef: { contains: term.raw } },
        { rrn: { contains: term.raw } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.paymentAttempt.count({ where }),
      this.prisma.paymentAttempt.findMany({
        where,
        include: { order: { select: { orderNumber: true, deviceId: true } } },
        orderBy: { initiatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const users = await this.prisma.adminUser.findMany({ select: { id: true, displayName: true } });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      items: rows.map((p) => toPaymentRow(p, p.reconciledById ? (names.get(p.reconciledById) ?? null) : null)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  @Post('payments/:id/reconcile')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async reconcile(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(ReconcileRequest)) body: ReconcileRequest, @ClientIp() ip: string | null) {
    const out = await this.payments.reconcile(admin, id, body.outcome, body.reason, { terminalRef: body.terminalRef, rrn: body.rrn }, ip);
    return { paymentStatus: out.attempt.status, order: out.order, conflict: out.conflict };
  }

  /** Ask the kiosk holding the card reader to re-query the terminal (operators allowed). */
  @Post('payments/:id/inquire')
  @HttpCode(200)
  async inquire(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    const a = await this.prisma.paymentAttempt.findUnique({ where: { id }, include: { order: true } });
    if (!a) throw ApiError.notFound('پرداخت');
    if (a.status !== 'UNKNOWN' && a.status !== 'INITIATED') {
      throw ApiError.conflict(ErrorCode.CONFLICT, 'وضعیت این پرداخت قطعی است و نیاز به استعلام ندارد');
    }
    const cmd = await this.devices.enqueue(
      a.order.deviceId,
      DeviceCommandType.PAYMENT_INQUIRY,
      { paymentAttemptId: a.id, localOrderId: a.order.localId, terminalRef: a.terminalRef, amount: a.amount },
      admin.id,
    );
    await this.audit.log(this.prisma, admin, { action: 'payment.inquiry_requested', entityType: 'PaymentAttempt', entityId: id, after: { commandId: cmd.id } });
    return { commandId: cmd.id };
  }

  // ------------------------------------------------------------------ A07 subscriptions

  private toSubRow(s: Prisma.SubscriptionGetPayload<{ include: { customer: true; order: true } }>): SubscriptionRow {
    return {
      id: s.id,
      mobileMasked: maskMobile(s.customer.mobile),
      planTitle: s.planTitle,
      startsAt: s.startsAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      status: s.status,
      state: subState(s),
      orderId: s.orderId,
      orderNumber: s.order.orderNumber,
      qrIssuedAt: s.qrIssuedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    };
  }

  @Get('subscriptions')
  async listSubscriptions(@Query(new ZodPipe(SubscriptionsQuery)) q: SubscriptionsQuery) {
    const now = new Date();
    const where: Prisma.SubscriptionWhereInput = {};
    if (q.planId) where.planId = q.planId;
    if (q.state === 'cancelled') where.status = 'CANCELLED';
    if (q.state === 'active') Object.assign(where, { status: 'ACTIVE', startsAt: { lte: now }, expiresAt: { gt: now } });
    if (q.state === 'expired') Object.assign(where, { status: 'ACTIVE', expiresAt: { lte: now } });
    if (q.state === 'upcoming') Object.assign(where, { status: 'ACTIVE', startsAt: { gt: now } });
    const term = searchTerm(q.q);
    if (term) {
      where.OR = [
        { order: { orderNumber: { contains: term.raw, mode: 'insensitive' } } },
        ...(term.mobile.length >= 4 ? [{ customer: { mobile: { contains: term.mobile } } }] : []),
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        include: { customer: true, order: true },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map((s) => this.toSubRow(s)), total, page: q.page, pageSize: q.pageSize };
  }

  @Get('subscriptions/:id')
  async subscriptionDetail(@Param('id') id: string): Promise<SubscriptionDetail> {
    const s = await this.prisma.subscription.findUnique({
      where: { id },
      include: { customer: true, order: true, accessLogs: { orderBy: { checkedAt: 'desc' }, take: 50 } },
    });
    if (!s) throw ApiError.notFound('اشتراک');
    const history = await this.prisma.subscription.findMany({
      where: { customerId: s.customerId },
      include: { customer: true, order: true },
      orderBy: { startsAt: 'asc' },
    });
    return {
      ...this.toSubRow(s),
      cancelReason: s.cancelReason,
      cancelledAt: s.cancelledAt?.toISOString() ?? null,
      accessLogs: s.accessLogs.map((l) => ({ id: l.id, checkedAt: l.checkedAt.toISOString(), result: l.result, deviceId: l.deviceId, offline: l.offline })),
      memberHistory: history.map((h) => this.toSubRow(h)),
    };
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async cancelSubscription(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(ReasonRequest)) body: { reason: string }, @ClientIp() ip: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.subscription.findUnique({ where: { id } });
      if (!s) throw ApiError.notFound('اشتراک');
      if (s.status === 'CANCELLED') throw ApiError.conflict(ErrorCode.CONFLICT, 'این اشتراک قبلاً ابطال شده است');
      const rev = await this.counters.next(tx, 'subscriptionRev');
      const updated = await tx.subscription.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: body.reason, rev },
      });
      await this.audit.log(tx, admin, { action: 'subscription.cancelled', entityType: 'Subscription', entityId: id, before: { status: s.status }, after: { status: 'CANCELLED' }, reason: body.reason, ip });
      return { ok: true, status: updated.status };
    });
  }

  @Post('subscriptions/:id/extend')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async extendSubscription(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(ExtendSubscriptionRequest)) body: ExtendSubscriptionRequest, @ClientIp() ip: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.subscription.findUnique({ where: { id } });
      if (!s) throw ApiError.notFound('اشتراک');
      if (s.status === 'CANCELLED') throw ApiError.conflict(ErrorCode.CONFLICT, 'اشتراک ابطال‌شده قابل تمدید نیست');
      const shift = body.days * 86400000;
      const expiresAt = new Date(s.expiresAt.getTime() + shift);
      await tx.subscription.update({ where: { id }, data: { expiresAt, rev: await this.counters.next(tx, 'subscriptionRev') } });
      // Renewals that start where this one ended form one continuous coverage; shift them too,
      // or the extra days would be hidden behind the next period.
      const shifted: string[] = [];
      let chainEnd = s.expiresAt.getTime();
      const later = await tx.subscription.findMany({
        where: { customerId: s.customerId, id: { not: id }, status: { not: 'CANCELLED' }, startsAt: { gte: s.startsAt } },
        orderBy: { startsAt: 'asc' },
      });
      for (const n of later) {
        if (n.startsAt.getTime() < s.expiresAt.getTime() || n.startsAt.getTime() > chainEnd) continue;
        chainEnd = Math.max(chainEnd, n.expiresAt.getTime());
        await tx.subscription.update({
          where: { id: n.id },
          data: { startsAt: new Date(n.startsAt.getTime() + shift), expiresAt: new Date(n.expiresAt.getTime() + shift), rev: await this.counters.next(tx, 'subscriptionRev') },
        });
        shifted.push(n.id);
      }
      await this.audit.log(tx, admin, {
        action: 'subscription.extended',
        entityType: 'Subscription',
        entityId: id,
        before: { expiresAt: s.expiresAt.toISOString() },
        after: { expiresAt: expiresAt.toISOString(), days: body.days, shiftedRenewals: shifted },
        reason: body.reason,
        ip,
      });
      return { ok: true, expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * Re-issue a lost QR: the old token stops working immediately. The new raw token is returned
   * once for printing and is never stored. Identity verification policy is still open (PRD D).
   */
  @Post('subscriptions/:id/reissue-qr')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async reissueQr(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(ReasonRequest)) body: { reason: string }, @ClientIp() ip: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.subscription.findUnique({ where: { id } });
      if (!s) throw ApiError.notFound('اشتراک');
      if (s.status === 'CANCELLED') throw ApiError.conflict(ErrorCode.CONFLICT, 'برای اشتراک ابطال‌شده QR صادر نمی‌شود');
      const token = generateQrToken();
      const rev = await this.counters.next(tx, 'subscriptionRev');
      await tx.subscription.update({ where: { id }, data: { qrTokenHash: hashQrToken(token), qrIssuedAt: new Date(), rev } });
      await this.audit.log(tx, admin, { action: 'subscription.qr_reissued', entityType: 'Subscription', entityId: id, reason: body.reason, ip });
      return { qrToken: token, planTitle: s.planTitle, expiresAt: s.expiresAt.toISOString() };
    });
  }

  // ------------------------------------------------------------------ A15 devices

  @Get('system')
  system(): SystemInfo {
    return { version: APP_VERSION, kioskInstallerUrl: kioskInstallerUrl(config().KIOSK_INSTALLER_URL), publicBaseUrl: config().PUBLIC_BASE_URL };
  }

  /** Kiosk management page (/kiosk): offer the installer download only once it is published. */
  @Get('system/installer')
  installer(): Promise<KioskInstallerInfo> {
    return kioskInstallerInfo(config().KIOSK_INSTALLER_URL);
  }

  @Get('devices')
  async listDevices() {
    const rows = await this.prisma.device.findMany({ orderBy: { id: 'asc' } });
    return rows.map(toDeviceRow);
  }

  @Post('devices')
  @Roles(AdminRole.ADMIN)
  async createDevice(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(CreateDeviceRequest)) body: CreateDeviceRequest) {
    if (await this.prisma.device.findUnique({ where: { id: body.id } })) throw ApiError.conflict(ErrorCode.DUPLICATE_CODE, 'شناسه دستگاه تکراری است');
    const apiKey = randomApiKey();
    const d = await this.prisma.device.create({ data: { id: body.id, name: body.name, apiKeyHash: hashDeviceKey(apiKey) } });
    await this.audit.log(this.prisma, admin, { action: 'device.created', entityType: 'Device', entityId: d.id, after: { name: d.name } });
    return { device: toDeviceRow(d), apiKey };
  }

  @Patch('devices/:id')
  @Roles(AdminRole.ADMIN)
  async updateDevice(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body(new ZodPipe(UpdateDeviceRequest)) body: z.infer<typeof UpdateDeviceRequest>) {
    const before = await this.prisma.device.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('دستگاه');
    const d = await this.prisma.device.update({ where: { id }, data: body });
    await this.audit.log(this.prisma, admin, { action: 'device.updated', entityType: 'Device', entityId: id, before: { name: before.name, active: before.active }, after: body });
    return toDeviceRow(d);
  }

  @Post('devices/:id/rotate-key')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async rotateKey(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    if (!(await this.prisma.device.findUnique({ where: { id } }))) throw ApiError.notFound('دستگاه');
    if (id === WEB_APP_DEVICE_ID) throw ApiError.conflict(ErrorCode.CONFLICT, 'وب‌اپ عمومی کلید ندارد؛ برای قطع آن، غیرفعالش کنید');
    const apiKey = randomApiKey();
    await this.prisma.device.update({ where: { id }, data: { apiKeyHash: hashDeviceKey(apiKey) } });
    await this.audit.log(this.prisma, admin, { action: 'device.key_rotated', entityType: 'Device', entityId: id });
    return { apiKey };
  }

  @Get('devices/:id/commands')
  async commands(@Param('id') id: string): Promise<DeviceCommandRow[]> {
    const rows = await this.prisma.deviceCommand.findMany({ where: { deviceId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const users = await this.prisma.adminUser.findMany({ select: { id: true, displayName: true } });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return rows.map((c) => ({
      id: c.id,
      deviceId: c.deviceId,
      type: c.type,
      status: c.status,
      payload: c.type === 'PRINT_RECEIPT' ? { orderId: (c.payload as { orderId?: string })?.orderId } : ((c.payload ?? {}) as Record<string, unknown>),
      result: c.result,
      createdAt: c.createdAt.toISOString(),
      completedAt: c.completedAt?.toISOString() ?? null,
      createdBy: c.createdById ? (names.get(c.createdById) ?? null) : null,
    }));
  }

  @Post('devices/:id/sync-now')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async syncNow(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    if (!(await this.prisma.device.findUnique({ where: { id } }))) throw ApiError.notFound('دستگاه');
    if (id === WEB_APP_DEVICE_ID) throw NO_PUBLIC_COMMANDS();
    const cmd = await this.devices.enqueue(id, DeviceCommandType.SYNC_NOW, { retryFailed: true }, admin.id);
    await this.audit.log(this.prisma, admin, { action: 'sync.retry_requested', entityType: 'Device', entityId: id, after: { commandId: cmd.id } });
    return { commandId: cmd.id };
  }

  // ------------------------------------------------------------------ A12 sync

  @Get('sync')
  async syncOverview(@Query(new ZodPipe(SyncQuery)) q: z.infer<typeof SyncQuery>): Promise<SyncOverview> {
    const [devices, grouped, events] = await Promise.all([
      this.prisma.device.findMany({ where: { id: { not: WEB_APP_DEVICE_ID } }, orderBy: { id: 'asc' } }),
      this.prisma.syncEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.syncEvent.findMany({
        where: { status: q.status, deviceId: q.deviceId },
        orderBy: { receivedAt: 'desc' },
        take: 100,
      }),
    ]);
    const totals = { applied: 0, rejected: 0, conflict: 0 };
    for (const g of grouped) totals[g.status.toLowerCase() as keyof typeof totals] = g._count._all;
    return {
      devices: devices.map(toDeviceRow),
      totals,
      events: events.map((e) => ({
        id: e.id,
        deviceId: e.deviceId,
        type: e.type,
        status: e.status,
        error: e.error,
        retryCount: e.retryCount,
        receivedAt: e.receivedAt.toISOString(),
        appliedAt: e.appliedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Re-apply a rejected event server side. Idempotent: never charges or creates twice. */
  @Post('sync/events/:id/retry')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  async retryEvent(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    const ev = await this.prisma.syncEvent.findUnique({ where: { id } });
    if (!ev) throw ApiError.notFound('رویداد');
    if (ev.status !== 'REJECTED') throw ApiError.conflict(ErrorCode.CONFLICT, 'فقط رویدادهای ردشده قابل تلاش مجدد هستند');
    const parsed = SyncEvent.safeParse({ eventId: ev.id, type: ev.type, createdAt: ev.receivedAt.toISOString(), payload: ev.payload });
    if (!parsed.success) throw new ApiError(ErrorCode.VALIDATION_FAILED, 'محتوای رویداد نامعتبر است و قابل اعمال نیست');
    const out = await this.sync.push(ev.deviceId, [parsed.data]);
    await this.audit.log(this.prisma, admin, { action: 'sync.event_retried', entityType: 'SyncEvent', entityId: id, after: out });
    return out;
  }

  // ------------------------------------------------------------------ A18 audit

  @Get('audit')
  @Roles(AdminRole.ADMIN)
  async auditLog(@Query(new ZodPipe(AuditQuery)) q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (q.action) where.action = { startsWith: q.action };
    if (q.entityType) where.entityType = q.entityType;
    if (q.actorId) where.actorId = q.actorId;
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const items: AuditRow[] = rows.map((r) => ({
      id: r.id,
      actorName: r.actorName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
