import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Device } from '@prisma/client';
import {
  DeviceCommandDto,
  DeviceCommandType,
  DeviceRow,
  HeartbeatRequest,
  HeartbeatResponse,
} from '@andishkadeh/shared';
import { CounterService } from '../../common/core.services';
import { PrismaService, Tx } from '../../common/prisma.service';

/** A device is "online" when it sent a heartbeat within this window. */
export const ONLINE_WINDOW_MS = 2 * 60_000;
/** Delivered-but-unanswered commands are re-delivered after this delay (commands are idempotent). */
const REDELIVER_MS = 3 * 60_000;

export function toDeviceRow(d: Device): DeviceRow {
  return {
    id: d.id,
    name: d.name,
    active: d.active,
    online: !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    appVersion: d.appVersion,
    catalogRevision: d.catalogRevision,
    hardware: (d.hardware as DeviceRow['hardware']) ?? null,
    outbox: (d.outbox as DeviceRow['outbox']) ?? null,
    unresolvedPayments: d.unresolvedPayments,
    lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
  };
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
  ) {}

  async heartbeat(deviceId: string, hb: HeartbeatRequest): Promise<HeartbeatResponse> {
    const now = new Date();
    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        lastSeenAt: now,
        appVersion: hb.appVersion,
        catalogRevision: hb.catalogRevision,
        subRev: hb.subRev,
        hardware: hb.hardware as unknown as Prisma.InputJsonValue,
        outbox: hb.outbox as unknown as Prisma.InputJsonValue,
        unresolvedPayments: hb.unresolvedPayments,
        lastSyncAt: hb.lastSyncAt ? new Date(hb.lastSyncAt) : undefined,
      },
    });
    const commands = await this.prisma.deviceCommand.findMany({
      where: {
        deviceId,
        OR: [{ status: 'PENDING' }, { status: 'DELIVERED', deliveredAt: { lt: new Date(now.getTime() - REDELIVER_MS) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    if (commands.length) {
      await this.prisma.deviceCommand.updateMany({
        where: { id: { in: commands.map((c) => c.id) } },
        data: { status: 'DELIVERED', deliveredAt: now },
      });
    }
    return {
      serverTime: now.toISOString(),
      catalogRevision: await this.counters.current(this.prisma, 'catalogRevision'),
      subscriptionRev: await this.counters.current(this.prisma, 'subscriptionRev'),
      commands: commands.map(
        (c): DeviceCommandDto => ({
          id: c.id,
          type: c.type as DeviceCommandType,
          payload: (c.payload ?? {}) as Record<string, unknown>,
          createdAt: c.createdAt.toISOString(),
        }),
      ),
    };
  }

  async completeCommand(tx: Tx | PrismaService, deviceId: string, commandId: string, success: boolean, result: unknown) {
    const updated = await tx.deviceCommand.updateMany({
      where: { id: commandId, deviceId, status: { in: ['PENDING', 'DELIVERED'] } },
      data: {
        status: success ? 'DONE' : 'FAILED',
        completedAt: new Date(),
        result: (result ?? null) as Prisma.InputJsonValue,
      },
    });
    // A reprint requested from the admin panel that came out of the printer settles the receipt.
    if (updated.count && success) {
      const cmd = await tx.deviceCommand.findUnique({ where: { id: commandId } });
      const orderId = (cmd?.payload as { orderId?: string } | null)?.orderId;
      if (cmd?.type === 'PRINT_RECEIPT' && orderId) {
        await tx.order.updateMany({ where: { id: orderId }, data: { printStatus: 'PRINTED', printDetail: null } });
      }
    }
  }

  complete(deviceId: string, commandId: string, success: boolean, result: unknown) {
    return this.completeCommand(this.prisma, deviceId, commandId, success, result);
  }

  async enqueue(deviceId: string, type: DeviceCommandType, payload: Record<string, unknown>, createdById: string | null) {
    return this.prisma.deviceCommand.create({
      data: { deviceId, type, payload: payload as Prisma.InputJsonValue, createdById },
    });
  }
}
