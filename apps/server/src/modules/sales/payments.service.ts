import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { PaymentAttempt } from '@prisma/client';
import {
  ErrorCode,
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  OrderDto,
  PaymentResultSource,
  PaymentStatus,
  PaymentStatusResponse,
  TerminalOutcome,
} from '@andishkadeh/shared';
import type { AdminPrincipal } from '../../common/auth';
import { AuditService } from '../../common/core.services';
import { ApiError } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { toOrderDto } from './mappers';
import { orderInclude } from './orders.service';
import { SubscriptionsService } from './subscriptions.service';

export interface ResultInput {
  outcome: TerminalOutcome;
  amount: number;
  terminalRef?: string | null;
  rrn?: string | null;
  traceNo?: string | null;
  message?: string | null;
  source: PaymentResultSource;
  occurredAt: Date;
}

export interface ApplyOutcome {
  attempt: PaymentAttempt;
  order: OrderDto;
  conflict: boolean;
}

const FINAL: PaymentStatus[] = [PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED];

/**
 * Payment state machine (PRD §12, §19, I-03):
 *  - one active attempt per order; a double tap re-uses the same idempotency key;
 *  - UNKNOWN is never treated as success and blocks new attempts until resolved;
 *  - a valid PAID result is never overwritten; contradictions are flagged for review.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
  ) {}

  async initiate(deviceId: string, req: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    return this.prisma.serializable(async (tx) => {
      const byKey = await tx.paymentAttempt.findUnique({ where: { idempotencyKey: req.idempotencyKey } });
      if (byKey) {
        if (byKey.orderId !== req.orderId || byKey.id !== req.paymentAttemptId) {
          throw ApiError.conflict(ErrorCode.IDEMPOTENCY_MISMATCH, 'کلید یکتای پرداخت برای سفارش دیگری استفاده شده است');
        }
        return this.initiateResponse(byKey);
      }

      const order = await tx.order.findFirst({ where: { id: req.orderId, deviceId } });
      if (!order) throw ApiError.notFound('سفارش');
      if (order.status === 'PAID') throw ApiError.conflict(ErrorCode.ORDER_NOT_PAYABLE, 'این سفارش قبلاً پرداخت شده است');
      if (order.status === 'CANCELLED') throw ApiError.conflict(ErrorCode.ORDER_NOT_PAYABLE, 'این سفارش لغو شده است');

      const open = await tx.paymentAttempt.findFirst({
        where: { orderId: order.id, status: { in: [PaymentStatus.INITIATED, PaymentStatus.UNKNOWN] } },
      });
      if (open?.status === PaymentStatus.UNKNOWN) {
        throw ApiError.conflict(ErrorCode.PAYMENT_UNRESOLVED, 'وضعیت پرداخت قبلی نامشخص است؛ ابتدا باید استعلام شود', {
          paymentAttemptId: open.id,
        });
      }
      if (open) {
        throw ApiError.conflict(ErrorCode.PAYMENT_IN_PROGRESS, 'پرداخت دیگری برای این سفارش در جریان است', { paymentAttemptId: open.id });
      }

      const attempt = await tx.paymentAttempt.create({
        data: { id: req.paymentAttemptId, orderId: order.id, idempotencyKey: req.idempotencyKey, amount: order.total },
      });
      await tx.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_PENDING' } });
      return this.initiateResponse(attempt);
    });
  }

  private initiateResponse(a: PaymentAttempt): InitiatePaymentResponse {
    return {
      paymentAttemptId: a.id,
      orderId: a.orderId,
      amount: a.amount,
      status: a.status as PaymentStatus,
      terminalInstruction: 'لطفاً کارت بانکی خود را در کارتخوان وارد کنید و رمز را بزنید.',
    };
  }

  async status(attemptId: string, deviceId?: string): Promise<PaymentStatusResponse> {
    const a = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { order: true } });
    if (!a || (deviceId && a.order.deviceId !== deviceId)) throw ApiError.notFound('پرداخت');
    return {
      paymentAttemptId: a.id,
      status: a.status as PaymentStatus,
      orderStatus: a.order.status,
      terminalRef: a.terminalRef,
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
    } as PaymentStatusResponse;
  }

  /** Online result report from the kiosk (POST /payments/:id/result). */
  async reportResult(deviceId: string, attemptId: string, input: ResultInput): Promise<ApplyOutcome> {
    return this.prisma.serializable(async (tx) => {
      const a = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { order: true } });
      if (!a || a.order.deviceId !== deviceId) throw ApiError.notFound('پرداخت');
      return this.apply(tx, a.orderId, attemptId, input);
    });
  }

  /**
   * Core transition. `createIfMissing` lets offline-synced results create the attempt record
   * (the POS was used while the server was unreachable, so initiate never reached us).
   */
  async apply(tx: Tx, orderId: string, attemptId: string, input: ResultInput, actor: AdminPrincipal | null = null, reason?: string): Promise<ApplyOutcome> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    let attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId } });
    const notes: string[] = [];

    if (!attempt) {
      attempt = await tx.paymentAttempt.create({
        data: { id: attemptId, orderId, idempotencyKey: attemptId, amount: input.amount, initiatedAt: input.occurredAt },
      });
    } else if (attempt.orderId !== orderId) {
      throw ApiError.conflict(ErrorCode.IDEMPOTENCY_MISMATCH, 'شناسه پرداخت متعلق به سفارش دیگری است');
    }

    const incoming = input.outcome as PaymentStatus;
    const current = attempt.status as PaymentStatus;
    let next = current;

    if (current === PaymentStatus.INITIATED || current === PaymentStatus.UNKNOWN) {
      next = incoming;
    } else if (incoming !== current && incoming !== PaymentStatus.UNKNOWN) {
      if (current === PaymentStatus.PAID) {
        notes.push(`گزارش «${incoming}» برای پرداخت موفق ثبت‌شده دریافت شد؛ وضعیت موفق حفظ شد`);
      } else if (incoming === PaymentStatus.PAID) {
        // Late confirmation (e.g. inquiry found the charge went through): accept, but flag it.
        next = PaymentStatus.PAID;
        notes.push('پرداختی که ناموفق ثبت شده بود با تأیید بعدی موفق اعلام شد');
      }
    }

    if (input.amount !== order.total && (next === PaymentStatus.PAID || incoming === PaymentStatus.PAID)) {
      notes.push(`مبلغ پرداخت (${input.amount}) با مبلغ سفارش (${order.total}) برابر نیست`);
    }

    if (next !== current || (FINAL.includes(next) && !attempt.resolvedAt)) {
      attempt = await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: next,
          terminalRef: input.terminalRef ?? attempt.terminalRef,
          rrn: input.rrn ?? attempt.rrn,
          traceNo: input.traceNo ?? attempt.traceNo,
          resultMessage: input.message ?? attempt.resultMessage,
          resultSource: input.source,
          resolvedAt: FINAL.includes(next) ? input.occurredAt : null,
          ...(actor ? { reconciledById: actor.id, reconcileReason: reason ?? null } : {}),
        },
      });
    }

    // Derive the order status from all of its attempts.
    const attempts = await tx.paymentAttempt.findMany({ where: { orderId }, orderBy: { initiatedAt: 'asc' } });
    const paid = attempts.filter((x) => x.status === PaymentStatus.PAID);
    let status: typeof order.status;
    if (paid.length > 0) status = 'PAID';
    else if (attempts.some((x) => x.status === PaymentStatus.UNKNOWN)) status = 'UNKNOWN';
    else if (attempts.some((x) => x.status === PaymentStatus.INITIATED)) status = 'PAYMENT_PENDING';
    else status = order.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    if (paid.length > 1) notes.push('بیش از یک پرداخت موفق برای این سفارش ثبت شده است (احتمال برداشت تکراری)');

    const paidAt = paid.length ? (paid[0].resolvedAt ?? input.occurredAt) : null;
    const conflictNote = [order.conflictNote, ...notes].filter(Boolean).join('؛ ') || null;
    let updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status,
        paidAt: status === 'PAID' ? (order.paidAt ?? clampToNow(paidAt!)) : null,
        conflictFlag: order.conflictFlag || notes.length > 0,
        conflictNote,
      },
      include: { ...orderInclude },
    });

    if (updated.status === 'PAID' && updated.kind === 'SUBSCRIPTION' && !updated.subscription) {
      const activation = await this.subscriptions.activate(tx, updated, updated.paidAt!);
      if (activation.conflict) {
        notes.push(activation.conflict);
        await tx.order.update({
          where: { id: orderId },
          data: { conflictFlag: true, conflictNote: [conflictNote, activation.conflict].filter(Boolean).join('؛ ') },
        });
      }
      updated = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    }

    if (notes.length) {
      this.logger.warn(`Payment conflict on order ${order.orderNumber}: ${notes.join(' | ')}`);
      await this.audit.log(tx, actor, {
        action: 'payment.conflict',
        entityType: 'Order',
        entityId: orderId,
        after: { attemptId, incoming, notes },
      });
    }

    return { attempt, order: toOrderDto(updated), conflict: notes.length > 0 };
  }

  /** A11 — documented manual resolution of an UNKNOWN (or stuck INITIATED) attempt. ADMIN only. */
  async reconcile(actor: AdminPrincipal, attemptId: string, outcome: 'PAID' | 'FAILED', reason: string, refs: { terminalRef?: string; rrn?: string }, ip: string | null) {
    return this.prisma.serializable(async (tx) => {
      const a = await tx.paymentAttempt.findUnique({ where: { id: attemptId } });
      if (!a) throw ApiError.notFound('پرداخت');
      if (a.status !== PaymentStatus.UNKNOWN && a.status !== PaymentStatus.INITIATED) {
        throw new ApiError(ErrorCode.RECONCILE_NOT_ALLOWED, 'فقط پرداخت‌های نامشخص یا معلق قابل تطبیق دستی هستند', HttpStatus.CONFLICT);
      }
      const before = { status: a.status, terminalRef: a.terminalRef };
      const out = await this.apply(
        tx,
        a.orderId,
        attemptId,
        {
          outcome: outcome as TerminalOutcome,
          amount: a.amount,
          terminalRef: refs.terminalRef ?? a.terminalRef,
          rrn: refs.rrn ?? a.rrn,
          source: PaymentResultSource.RECONCILE,
          occurredAt: new Date(),
          message: `تطبیق دستی: ${reason}`,
        },
        actor,
        reason,
      );
      await this.audit.log(tx, actor, {
        action: 'payment.reconciled',
        entityType: 'PaymentAttempt',
        entityId: attemptId,
        before,
        after: { status: out.attempt.status, terminalRef: out.attempt.terminalRef, orderStatus: out.order.status },
        reason,
        ip,
      });
      return out;
    });
  }
}

/** Device clocks may drift; never record a payment in the future. */
function clampToNow(d: Date): Date {
  const now = Date.now();
  return d.getTime() > now + 60_000 ? new Date(now) : d;
}
