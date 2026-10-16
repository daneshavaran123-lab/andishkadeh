import { Injectable } from '@nestjs/common';
import type { Order, OrderItem, Subscription } from '@prisma/client';
import {
  AccessResult,
  CoverageEntry,
  RenewalPolicy,
  SubscriptionCacheEntry,
  SubscriptionStatus,
  ValidateAccessResponse,
  computePeriod,
  currentCoverageEnd,
  evaluateAccess,
  isQrTokenFormat,
  mobileTail,
} from '@andishkadeh/shared';
import { cleanScannedPayload, generateQrToken, hashQrToken } from '@andishkadeh/shared/node';
import { CounterService, SettingsService } from '../../common/core.services';
import { PrismaService, Tx } from '../../common/prisma.service';

type Db = PrismaService | Tx;

export function toCoverage(s: Subscription): CoverageEntry {
  return {
    subscriptionId: s.id,
    customerKey: s.customerId,
    startsAt: s.startsAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    status: s.status as SubscriptionStatus,
    planTitle: s.planTitle,
  };
}

export function toCacheEntry(s: Subscription & { customer: { mobile: string } }): SubscriptionCacheEntry {
  return { ...toCoverage(s), tokenHash: s.qrTokenHash, memberTail: mobileTail(s.customer.mobile), rev: s.rev };
}

export interface ActivationOutcome {
  subscription: Subscription | null;
  conflict: string | null;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly settings: SettingsService,
  ) {}

  async customerCoverage(tx: Db, customerId: string): Promise<CoverageEntry[]> {
    const subs = await tx.subscription.findMany({ where: { customerId } });
    return subs.map(toCoverage);
  }

  /** Preview shown on the confirmation screen (K14) before payment. */
  async preview(tx: Db, customerId: string, durationDays: number, at = new Date()) {
    const settings = await this.settings.settings(tx);
    const coverage = await this.customerCoverage(tx, customerId);
    const period = computePeriod(at, durationDays, coverage, settings.renewalPolicy as RenewalPolicy);
    const until = currentCoverageEnd(coverage, at);
    return {
      activeCoverageUntil: until?.toISOString() ?? null,
      periodPreview: { startsAt: period.startsAt.toISOString(), expiresAt: period.expiresAt.toISOString(), extended: period.extended },
    };
  }

  /**
   * Activates the subscription of a PAID subscription order. Idempotent.
   * No subscription is ever created for an order that is not PAID (PRD §12).
   */
  async activate(tx: Tx, order: Order & { items: OrderItem[] }, paidAt: Date): Promise<ActivationOutcome> {
    const existing = await tx.subscription.findUnique({ where: { orderId: order.id } });
    if (existing) return { subscription: existing, conflict: null };
    if (order.status !== 'PAID') return { subscription: null, conflict: null };

    const line = order.items[0];
    const plan = line ? await tx.subscriptionPlan.findUnique({ where: { id: line.itemId } }) : null;
    if (!line || !plan) return { subscription: null, conflict: 'پلن سفارش اشتراک یافت نشد؛ بررسی دستی لازم است' };

    // The customer has paid, so the subscription is always created. Without a usable QR hash it gets
    // a hash nobody holds a token for: no card works until staff press «صدور مجدد QR» in the panel.
    let qrTokenHash = order.pendingQrTokenHash;
    let conflict: string | null = null;
    if (!qrTokenHash || (await tx.subscription.findUnique({ where: { qrTokenHash } }))) {
      qrTokenHash = hashQrToken(generateQrToken());
      conflict = 'کارت QR معتبری برای این اشتراک ثبت نشد؛ از «اشتراک‌ها» گزینه «صدور مجدد QR» را بزنید';
    }

    const settings = await this.settings.settings(tx);
    const coverage = await this.customerCoverage(tx, order.customerId);
    const period = computePeriod(paidAt, plan.durationDays, coverage, settings.renewalPolicy as RenewalPolicy);
    const rev = await this.counters.next(tx, 'subscriptionRev');
    const subscription = await tx.subscription.create({
      data: {
        customerId: order.customerId,
        planId: plan.id,
        // Offline orders carry the kiosk's copy of the title; the plan record is the trusted source.
        planTitle: order.offline ? plan.title : line.titleSnapshot,
        orderId: order.id,
        startsAt: period.startsAt,
        expiresAt: period.expiresAt,
        extended: period.extended,
        qrTokenHash,
        rev,
      },
    });
    return { subscription, conflict };
  }

  /** QR validation (K19/K20). Logs every check; never reveals personal data beyond the last 4 digits. */
  async validate(
    deviceId: string,
    rawToken: string,
    opts: { eventId?: string; offline?: boolean; checkedAt?: Date } = {},
  ): Promise<ValidateAccessResponse> {
    const token = cleanScannedPayload(rawToken);
    const now = opts.checkedAt ?? new Date();

    if (opts.eventId) {
      const prior = await this.prisma.accessLog.findUnique({ where: { eventId: opts.eventId } });
      if (prior) {
        // Idempotent replay: re-evaluate without logging twice.
        return this.evaluate(token, now, opts.offline ?? false);
      }
    }

    const result = await this.evaluate(token, now, opts.offline ?? false);
    const sub = isQrTokenFormat(token)
      ? await this.prisma.subscription.findUnique({ where: { qrTokenHash: hashQrToken(token) }, select: { id: true } })
      : null;
    await this.prisma.accessLog.create({
      data: {
        subscriptionId: sub?.id ?? null,
        deviceId,
        checkedAt: now,
        result: result.result,
        offline: opts.offline ?? false,
        eventId: opts.eventId ?? null,
      },
    });
    return result;
  }

  private async evaluate(token: string, now: Date, offline: boolean): Promise<ValidateAccessResponse> {
    const invalid: ValidateAccessResponse = {
      result: AccessResult.INVALID,
      valid: false,
      expiresAt: null,
      startsAt: null,
      planTitle: null,
      memberTail: null,
      offline,
    };
    if (!isQrTokenFormat(token)) return invalid;
    const sub = await this.prisma.subscription.findUnique({
      where: { qrTokenHash: hashQrToken(token) },
      include: { customer: true },
    });
    if (!sub) return invalid;
    const coverage = await this.customerCoverage(this.prisma, sub.customerId);
    const ev = evaluateAccess(toCoverage(sub), coverage, now);
    return {
      ...ev,
      memberTail: ev.result === AccessResult.ACTIVE ? mobileTail(sub.customer.mobile) : null,
      offline,
    };
  }
}
