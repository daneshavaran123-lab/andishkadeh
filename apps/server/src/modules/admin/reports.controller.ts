import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import {
  DashboardQuery,
  DashboardResponse,
  ORDER_KIND_LABEL,
  ReportBucket,
  ReportQuery,
  ReportResponse,
  addLocalDays,
  formatJalaliDate,
  formatJalaliDateTime,
  localDateKey,
  localDayRange,
  startOfLocalDay,
} from '@andishkadeh/shared';
import { z } from 'zod';
import { AdminAuth } from '../../common/auth';
import { SettingsService } from '../../common/core.services';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ZodPipe } from '../../common/zod.pipe';
import { toDeviceRow } from '../sales/devices.service';
import { toPaymentRow } from '../sales/mappers';

const SUBSCRIPTION_BUCKET = 'اشتراک کامل';
const ExportQuery = ReportQuery.and(z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }));

type ReportLine = Prisma.OrderItemGetPayload<{ include: { order: true } }>;

/** A02 dashboard and A14 reports. PAID is "final sales"; UNKNOWN is always reported separately. */
@Controller('admin')
@AdminAuth()
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get('dashboard')
  async dashboard(@Query(new ZodPipe(DashboardQuery)) _q: z.infer<typeof DashboardQuery>): Promise<DashboardResponse> {
    const tz = (await this.settings.settings()).timezone;
    const now = new Date();
    const todayStart = startOfLocalDay(now, tz);
    const seriesStart = addLocalDays(todayStart, -29, tz);

    const [todayAgg, activeSubs, paidOrders, shareLines, recent, unknownCount, staleInitiated, conflicts, rejected, devices, printFailures] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: { status: 'PAID', paidAt: { gte: todayStart } },
          _sum: { total: true },
          _count: { _all: true },
        }),
        this.prisma.subscription.count({ where: { status: 'ACTIVE', startsAt: { lte: now }, expiresAt: { gt: now } } }),
        this.prisma.order.findMany({ where: { status: 'PAID', paidAt: { gte: seriesStart } }, select: { paidAt: true, total: true } }),
        this.prisma.orderItem.findMany({
          where: { order: { status: 'PAID', paidAt: { gte: seriesStart } } },
          select: { itemType: true, categoryTitleSnapshot: true, lineTotal: true },
        }),
        this.prisma.paymentAttempt.findMany({
          orderBy: { initiatedAt: 'desc' },
          take: 8,
          include: { order: { select: { orderNumber: true, deviceId: true } } },
        }),
        this.prisma.paymentAttempt.count({ where: { status: 'UNKNOWN' } }),
        this.prisma.paymentAttempt.count({ where: { status: 'INITIATED', initiatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } } }),
        this.prisma.order.count({ where: { conflictFlag: true } }),
        this.prisma.syncEvent.count({ where: { status: 'REJECTED' } }),
        this.prisma.device.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
        this.prisma.order.count({ where: { status: 'PAID', printStatus: 'FAILED', paidAt: { gte: addLocalDays(todayStart, -7, tz) } } }),
      ]);

    const byDay = new Map<string, { total: number; orders: number }>();
    for (let i = 0; i < 30; i++) byDay.set(localDateKey(addLocalDays(seriesStart, i, tz), tz), { total: 0, orders: 0 });
    for (const o of paidOrders) {
      const key = localDateKey(o.paidAt!, tz);
      const b = byDay.get(key);
      if (b) {
        b.total += o.total;
        b.orders += 1;
      }
    }
    const share = new Map<string, number>();
    for (const l of shareLines) {
      const title = l.itemType === 'PLAN' ? SUBSCRIPTION_BUCKET : (l.categoryTitleSnapshot ?? 'سایر');
      share.set(title, (share.get(title) ?? 0) + l.lineTotal);
    }

    const rows = devices.map(toDeviceRow);
    const syncPending = rows.reduce((s, d) => s + (d.outbox?.pending ?? 0), 0);
    const hardwareErrors = rows.filter((d) => d.hardware && Object.values(d.hardware).some((h) => h.state === 'ERROR')).length;

    return {
      timezone: tz,
      today: localDateKey(now, tz),
      kpis: {
        todaySales: todayAgg._sum.total ?? 0,
        todayPaidOrders: todayAgg._count._all,
        activeSubscriptions: activeSubs,
        devicesOnline: rows.filter((d) => d.online).length,
        devicesTotal: rows.length,
      },
      salesSeries: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      categoryShare: [...share.entries()].map(([title, total]) => ({ title, total })).sort((a, b) => b.total - a.total),
      recentPayments: recent.map((p) => toPaymentRow(p)),
      alerts: {
        unknownPayments: unknownCount + staleInitiated,
        conflicts,
        syncPending,
        syncRejected: rejected,
        hardwareErrors,
        staleDevices: rows.filter((d) => !d.online).length,
        printFailures,
      },
      devices: rows,
    };
  }

  private async loadReport(q: ReportQuery) {
    const tz = (await this.settings.settings()).timezone;
    if (q.from > q.to) throw ApiError.conflict('VALIDATION_FAILED', 'تاریخ شروع بعد از تاریخ پایان است');
    const from = localDayRange(q.from, tz).from;
    const to = localDayRange(q.to, tz).to;
    if (to.getTime() - from.getTime() > 400 * 86400000) throw ApiError.conflict('VALIDATION_FAILED', 'بازه گزارش حداکثر ۴۰۰ روز است');

    const itemWhere: Prisma.OrderItemWhereInput = { order: { status: 'PAID', paidAt: { gte: from, lt: to }, ...(q.kind ? { kind: q.kind } : {}) } };
    if (q.categoryId) itemWhere.categoryIdSnapshot = q.categoryId;
    if (q.serviceId) Object.assign(itemWhere, { itemType: 'SERVICE', itemId: q.serviceId });
    if (q.planId) Object.assign(itemWhere, { itemType: 'PLAN', itemId: q.planId });
    if (q.discountId) itemWhere.discountIdSnapshot = q.discountId;

    const [lines, unknown, failedCount] = await Promise.all([
      this.prisma.orderItem.findMany({ where: itemWhere, include: { order: true }, orderBy: { order: { paidAt: 'asc' } } }),
      this.prisma.order.aggregate({
        where: { status: 'UNKNOWN', createdAt: { gte: from, lt: to }, ...(q.kind ? { kind: q.kind } : {}) },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: { status: 'FAILED', createdAt: { gte: from, lt: to } } }),
    ]);
    return { tz, lines, unknown, failedCount };
  }

  @Get('reports/sales')
  async sales(@Query(new ZodPipe(ReportQuery)) q: ReportQuery): Promise<ReportResponse> {
    const { tz, lines, unknown, failedCount } = await this.loadReport(q);
    const bucket = (map: Map<string, ReportBucket>, key: string, title: string, l: ReportLine) => {
      const b = map.get(key) ?? { key, title, total: 0, count: 0, discount: 0 };
      b.total += l.lineTotal;
      b.count += l.quantity;
      b.discount += l.unitDiscountSnapshot * l.quantity;
      map.set(key, b);
    };
    const byDay = new Map<string, { date: string; total: number; count: number }>();
    for (let d = localDayRange(q.from, tz).from; localDateKey(d, tz) <= q.to; d = addLocalDays(d, 1, tz)) {
      const k = localDateKey(d, tz);
      byDay.set(k, { date: k, total: 0, count: 0 });
    }
    const orderIds = new Set<string>();
    const dayOrders = new Map<string, Set<string>>();
    const byCategory = new Map<string, ReportBucket>();
    const byService = new Map<string, ReportBucket>();
    const byPlan = new Map<string, ReportBucket>();
    const byDiscount = new Map<string, ReportBucket>();
    let paidTotal = 0;
    let discountTotal = 0;
    let servicesTotal = 0;
    let subscriptionsTotal = 0;
    for (const l of lines) {
      orderIds.add(l.orderId);
      paidTotal += l.lineTotal;
      discountTotal += l.unitDiscountSnapshot * l.quantity;
      const day = localDateKey(l.order.paidAt!, tz);
      const d = byDay.get(day);
      if (d) {
        d.total += l.lineTotal;
        const set = dayOrders.get(day) ?? new Set();
        set.add(l.orderId);
        dayOrders.set(day, set);
        d.count = set.size;
      }
      if (l.itemType === 'PLAN') {
        subscriptionsTotal += l.lineTotal;
        bucket(byCategory, 'PLAN', SUBSCRIPTION_BUCKET, l);
        bucket(byPlan, l.itemId, l.titleSnapshot, l);
      } else {
        servicesTotal += l.lineTotal;
        bucket(byCategory, l.categoryIdSnapshot ?? 'other', l.categoryTitleSnapshot ?? 'سایر', l);
        bucket(byService, l.itemId, `${l.codeSnapshot} — ${l.titleSnapshot}`, l);
      }
      if (l.discountIdSnapshot) bucket(byDiscount, l.discountIdSnapshot, l.discountTitleSnapshot ?? 'تخفیف', l);
    }
    const sorted = (m: Map<string, ReportBucket>) => [...m.values()].sort((a, b) => b.total - a.total);
    return {
      range: { from: q.from, to: q.to },
      summary: {
        paidTotal,
        paidCount: orderIds.size,
        discountTotal,
        unknownTotal: unknown._sum.total ?? 0,
        unknownCount: unknown._count._all,
        failedCount,
        servicesTotal,
        subscriptionsTotal,
      },
      byDay: [...byDay.values()],
      byCategory: sorted(byCategory),
      byService: sorted(byService),
      byPlan: sorted(byPlan),
      byDiscount: sorted(byDiscount),
    };
  }

  @Get('reports/sales/export')
  async export(@Query(new ZodPipe(ExportQuery)) q: z.infer<typeof ExportQuery>, @Res() res: Response) {
    const { tz, lines, unknown } = await this.loadReport(q);
    const header = ['شماره سفارش', 'تاریخ پرداخت', 'نوع', 'کد', 'عنوان', 'حوزه', 'تعداد', 'قیمت واحد', 'تخفیف واحد', 'مبلغ نهایی', 'عنوان تخفیف', 'دستگاه', 'آفلاین'];
    const rows = lines.map((l) => [
      l.order.orderNumber,
      formatJalaliDateTime(l.order.paidAt!, tz, false),
      ORDER_KIND_LABEL[l.order.kind],
      l.codeSnapshot,
      l.titleSnapshot,
      l.itemType === 'PLAN' ? SUBSCRIPTION_BUCKET : (l.categoryTitleSnapshot ?? ''),
      l.quantity,
      l.unitPriceSnapshot,
      l.unitDiscountSnapshot,
      l.lineTotal,
      l.discountTitleSnapshot ?? '',
      l.order.deviceId,
      l.order.offline ? 'بله' : 'خیر',
    ]);
    const name = `sales-${q.from}_${q.to}`;

    if (q.format === 'csv') {
      const esc = (v: unknown) => {
        let s = String(v ?? '');
        // Text starting with = + - @ (or a tab/CR) would run as a formula in Excel: keep it as text.
        if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      res.send(csv);
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Andishkadeh Admin';
    const summary = wb.addWorksheet('خلاصه', { views: [{ rightToLeft: true }] });
    const paidTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    summary.addRows([
      ['بازه', `${formatJalaliDate(localDayRange(q.from, tz).from, tz, false)} تا ${formatJalaliDate(localDayRange(q.to, tz).from, tz, false)}`],
      ['فروش قطعی (تومان)', paidTotal],
      ['تعداد سفارش پرداخت‌شده', new Set(lines.map((l) => l.orderId)).size],
      ['تخفیف اعمال‌شده (تومان)', lines.reduce((s, l) => s + l.unitDiscountSnapshot * l.quantity, 0)],
      ['پرداخت نامشخص (جدا از فروش قطعی)', unknown._sum.total ?? 0],
      ['تعداد سفارش نامشخص', unknown._count._all],
    ]);
    summary.getColumn(1).width = 36;
    summary.getColumn(2).width = 28;
    summary.getColumn(2).numFmt = '#,##0';
    const sheet = wb.addWorksheet('اقلام فروش', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    sheet.addRow(header).font = { bold: true };
    rows.forEach((r) => sheet.addRow(r));
    [16, 20, 12, 10, 44, 22, 8, 14, 14, 14, 20, 12, 8].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
    [8, 9, 10].forEach((c) => (sheet.getColumn(c).numFmt = '#,##0'));
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.send(Buffer.from(buf as ArrayBuffer));
  }
}
