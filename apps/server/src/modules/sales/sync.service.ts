import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  RejectedEvent,
  SubscriptionCacheEntry,
  SyncEvent,
  SyncEventType,
  SyncPullResponse,
  SyncPushResponse,
  TerminalOutcome,
} from '@andishkadeh/shared';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { DevicesService } from './devices.service';
import { OrdersService } from './orders.service';
import { PaymentsService } from './payments.service';
import { toCacheEntry } from './subscriptions.service';

const PULL_PAGE = 1000;

class RetryableError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Device ↔ server synchronisation (PRD §15).
 *  push: idempotent by eventId — replaying a batch never creates a second order or payment;
 *  pull: catalogue snapshot when the revision changed + subscription cache deltas.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly devices: DevicesService,
  ) {}

  async push(deviceId: string, events: SyncEvent[]): Promise<SyncPushResponse> {
    const acceptedEventIds: string[] = [];
    const rejectedEvents: RejectedEvent[] = [];
    const results: Record<string, unknown> = {};

    // Events are applied in device order: an offline order must exist before its payment.
    const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const ev of ordered) {
      const prior = await this.prisma.syncEvent.findUnique({ where: { id: ev.eventId } });
      if (prior && prior.deviceId !== deviceId) {
        rejectedEvents.push({ eventId: ev.eventId, code: ErrorCode.CONFLICT, message: 'event id belongs to another device', retryable: false });
        continue;
      }
      if (prior && (prior.status === 'APPLIED' || prior.status === 'CONFLICT')) {
        acceptedEventIds.push(ev.eventId);
        results[ev.eventId] = prior.result;
        continue;
      }

      try {
        const { result, conflict } = await this.applyEvent(deviceId, ev);
        const status = conflict ? 'CONFLICT' : 'APPLIED';
        await this.prisma.syncEvent.upsert({
          where: { id: ev.eventId },
          create: {
            id: ev.eventId,
            deviceId,
            type: ev.type,
            payload: ev.payload as unknown as Prisma.InputJsonValue,
            status,
            result: (result ?? null) as Prisma.InputJsonValue,
            appliedAt: new Date(),
          },
          update: { status, error: null, result: (result ?? null) as Prisma.InputJsonValue, appliedAt: new Date(), retryCount: { increment: 1 } },
        });
        acceptedEventIds.push(ev.eventId);
        results[ev.eventId] = result;
      } catch (e) {
        const retryable = e instanceof RetryableError || !(e instanceof ApiError);
        const code = e instanceof RetryableError ? e.code : e instanceof ApiError ? e.code : ErrorCode.INTERNAL;
        const message = (e as Error).message ?? 'error';
        if (!(e instanceof RetryableError)) this.logger.warn(`Sync event ${ev.type} ${ev.eventId} rejected: ${message}`);
        await this.prisma.syncEvent.upsert({
          where: { id: ev.eventId },
          create: { id: ev.eventId, deviceId, type: ev.type, payload: ev.payload as unknown as Prisma.InputJsonValue, status: 'REJECTED', error: message },
          update: { status: 'REJECTED', error: message, retryCount: { increment: 1 } },
        });
        rejectedEvents.push({ eventId: ev.eventId, code, message, retryable });
      }
    }

    await this.prisma.device.update({ where: { id: deviceId }, data: { lastSyncAt: new Date() } });
    return { acceptedEventIds, rejectedEvents, results };
  }

  private async applyEvent(deviceId: string, ev: SyncEvent): Promise<{ result: unknown; conflict: boolean }> {
    switch (ev.type) {
      case SyncEventType.ORDER_OFFLINE: {
        const out = await this.prisma.serializable((tx) => this.orders.ingestOffline(tx, deviceId, ev.payload));
        return { result: { orderId: out.orderId }, conflict: out.conflict !== null };
      }
      case SyncEventType.PAYMENT_RESULT: {
        const p = ev.payload;
        const order = await this.prisma.order.findUnique({ where: { deviceId_localId: { deviceId, localId: p.localOrderId } } });
        if (!order) throw new RetryableError(ErrorCode.ORDER_NOT_FOUND, 'order for this payment is not synced yet');
        const out = await this.prisma.serializable((tx) =>
          this.payments.apply(tx, order.id, p.paymentAttemptId, {
            outcome: p.outcome as TerminalOutcome,
            amount: p.amount,
            terminalRef: p.terminalRef,
            rrn: p.rrn,
            traceNo: p.traceNo,
            message: p.message,
            source: p.source,
            occurredAt: new Date(p.occurredAt),
          }),
        );
        return { result: { paymentStatus: out.attempt.status, order: out.order }, conflict: out.conflict };
      }
      case SyncEventType.ACCESS_LOG: {
        const p = ev.payload;
        const sub = p.tokenHash ? await this.prisma.subscription.findUnique({ where: { qrTokenHash: p.tokenHash }, select: { id: true } }) : null;
        await this.prisma.accessLog.upsert({
          where: { eventId: ev.eventId },
          update: {},
          create: { eventId: ev.eventId, deviceId, subscriptionId: sub?.id ?? null, checkedAt: new Date(p.checkedAt), result: p.result, offline: p.offline },
        });
        return { result: { ok: true }, conflict: false };
      }
      case SyncEventType.RECEIPT_PRINT: {
        const p = ev.payload;
        const order = await this.prisma.order.findUnique({ where: { deviceId_localId: { deviceId, localId: p.localOrderId } } });
        if (!order) throw new RetryableError(ErrorCode.ORDER_NOT_FOUND, 'order for this receipt is not synced yet');
        // A later successful print wins over an earlier failure, never the other way around.
        if (p.printed || order.printStatus !== 'PRINTED') {
          await this.prisma.order.update({ where: { id: order.id }, data: { printStatus: p.printed ? 'PRINTED' : 'FAILED', printDetail: p.detail } });
        }
        return { result: { ok: true }, conflict: false };
      }
      case SyncEventType.COMMAND_RESULT: {
        const p = ev.payload;
        await this.devices.completeCommand(this.prisma, deviceId, p.commandId, p.success, p.result);
        return { result: { ok: true }, conflict: false };
      }
    }
  }

  async pull(deviceId: string, since: number, subSince: number): Promise<SyncPullResponse> {
    const revision = await this.catalog.currentRevision();
    const catalog = since < revision ? await this.catalog.bootstrap() : null;
    const subs = await this.prisma.subscription.findMany({
      where: { rev: { gt: subSince } },
      orderBy: { rev: 'asc' },
      take: PULL_PAGE,
      include: { customer: { select: { mobile: true } } },
    });
    const entries: SubscriptionCacheEntry[] = subs.map(toCacheEntry);
    await this.prisma.device.update({ where: { id: deviceId }, data: { lastSyncAt: new Date() } });
    return {
      serverTime: new Date().toISOString(),
      catalogRevision: catalog?.catalogRevision ?? revision,
      catalog,
      subscriptions: entries,
      nextSubRev: entries.length ? entries[entries.length - 1].rev : subSince,
    };
  }
}
