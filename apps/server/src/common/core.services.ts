import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  KioskContent,
  KioskSettings,
} from '@andishkadeh/shared';
import { PrismaService, Tx } from './prisma.service';
import type { AdminPrincipal } from './auth';

type Db = PrismaService | Tx;

/** Named monotonic counters (catalog revision, subscription cache revision, order sequence). */
@Injectable()
export class CounterService {
  async next(tx: Db, key: 'catalogRevision' | 'subscriptionRev' | 'orderSeq'): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ value: number }>>(
      Prisma.sql`INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
                 ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
                 RETURNING "value"`,
    );
    return Number(rows[0].value);
  }

  async current(tx: Db, key: 'catalogRevision' | 'subscriptionRev' | 'orderSeq'): Promise<number> {
    const row = await tx.counter.findUnique({ where: { key } });
    return row?.value ?? 0;
  }
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

/** Append-only audit trail for prices, discounts, subscriptions, payments and settings (PRD §18). */
@Injectable()
export class AuditService {
  async log(tx: Db, actor: AdminPrincipal | null, entry: AuditEntry) {
    await tx.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorName: actor ? `${actor.displayName} (${actor.username})` : 'system',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        ip: entry.ip ?? null,
      },
    });
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === undefined || v === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(tx: Db = this.prisma): Promise<KioskSettings> {
    const row = await tx.setting.findUnique({ where: { key: 'settings' } });
    return KioskSettings.parse(row?.value);
  }

  async content(tx: Db = this.prisma): Promise<KioskContent> {
    const row = await tx.setting.findUnique({ where: { key: 'content' } });
    return KioskContent.parse(row?.value);
  }

  async save(tx: Db, key: 'settings' | 'content', value: KioskSettings | KioskContent) {
    await tx.setting.upsert({
      where: { key },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { key, value: value as unknown as Prisma.InputJsonValue },
    });
  }
}
