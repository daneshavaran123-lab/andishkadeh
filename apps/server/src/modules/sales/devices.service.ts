import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Device } from '@prisma/client';
import {
  ACTIVATION_MINUTES,
  ActivateDeviceResponse,
  DeviceActivation,
  DeviceCommandDto,
  DeviceCommandType,
  DeviceRow,
  HeartbeatRequest,
  HeartbeatResponse,
  parseActivationInput,
  WEB_APP_DEVICE_ID,
} from '@andishkadeh/shared';
import { generateActivationCode, randomApiKey, sha256Hex } from '@andishkadeh/shared/node';
import { hashDeviceKey } from '../../common/auth';
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
    publicWebApp: d.id === WEB_APP_DEVICE_ID,
    activationExpiresAt: d.activationCodeHash && d.activationExpiresAt && d.activationExpiresAt > new Date() ? d.activationExpiresAt.toISOString() : null,
  };
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
  ) {}

  /** A one-time activation code for a kiosk (replaces one not yet used); only its hash is kept. */
  async issueActivation(deviceId: string): Promise<DeviceActivation> {
    const expiresAt = new Date(Date.now() + ACTIVATION_MINUTES * 60_000);
    for (let attempt = 0; ; attempt++) {
      const code = generateActivationCode();
      try {
        await this.prisma.device.update({ where: { id: deviceId }, data: { activationCodeHash: sha256Hex(code), activationExpiresAt: expiresAt } });
        return { deviceId, code, expiresAt: expiresAt.toISOString() };
      } catch (e) {
        // the same code waiting for another kiosk (unique hash): draw again
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || attempt >= 4) throw e;
      }
    }
  }

  /**
   * A kiosk's activation code (or the link carrying it) → its id and a fresh key, which replaces the
   * previous one. Works once and only before it expires; null otherwise.
   */
  async activate(input: string): Promise<ActivateDeviceResponse | null> {
    const parsed = parseActivationInput(input);
    if (!parsed) return null;
    const hash = sha256Hex(parsed.code);
    const device = await this.prisma.device.findUnique({ where: { activationCodeHash: hash } });
    if (!device?.active || device.id === WEB_APP_DEVICE_ID || !device.activationExpiresAt || device.activationExpiresAt <= new Date()) return null;
    const deviceKey = randomApiKey();
    // only the request that still finds the code takes it
    const taken = await this.prisma.device.updateMany({
      where: { id: device.id, activationCodeHash: hash },
      data: { apiKeyHash: hashDeviceKey(deviceKey), activationCodeHash: null, activationExpiresAt: null },
    });
    return taken.count === 1 ? { deviceId: device.id, deviceName: device.name, deviceKey } : null;
  }

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

  private publicSeenAt = 0;

  /**
   * The public web app: every open browser sends heartbeats for the same device. Only "last seen"
   * is kept (at most every 30 seconds, so visitors do not queue up on one row); it has no hardware,
   * queue or commands of its own.
   */
  async publicHeartbeat(deviceId: string, hb: HeartbeatRequest): Promise<HeartbeatResponse> {
    const now = new Date();
    if (now.getTime() - this.publicSeenAt >= 30_000) {
      this.publicSeenAt = now.getTime();
      await this.prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: now, appVersion: hb.appVersion, catalogRevision: hb.catalogRevision } });
    }
    return {
      serverTime: now.toISOString(),
      catalogRevision: await this.counters.current(this.prisma, 'catalogRevision'),
      // No subscription cache: never "behind", so subscription sales do not make it pull.
      subscriptionRev: hb.subRev,
      commands: [],
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
