/**
 * QR membership validation (K19/K20). Online: the server decides and logs.
 * Offline: decided from the cached subscription list with exactly the same rules
 * (shared evaluateAccess), only if the centre allows it (PRD §15), and logged via the outbox.
 */
import { randomUUID } from 'node:crypto';
import {
  AccessResult,
  SubscriptionStatus,
  SyncEventType,
  evaluateAccess,
  isQrTokenFormat,
  type CoverageEntry,
  type SubscriptionCacheEntry,
  type ValidateAccessResponse,
} from '@andishkadeh/shared';
import { cleanScannedPayload, hashQrToken } from '@andishkadeh/shared/node';
import { ApiClient, ApiResponseError, NetworkError } from './api-client';
import type { CatalogStore } from './catalog';
import type { Db } from './db';
import type { Outbox } from './outbox';
import type { ValidateResult } from './types';

interface CacheRow {
  token_hash: string;
  subscription_id: string;
  customer_key: string;
  starts_at: string;
  expires_at: string;
  status: SubscriptionStatus;
  plan_title: string;
  member_tail: string;
}

const toCoverage = (r: CacheRow): CoverageEntry => ({
  subscriptionId: r.subscription_id,
  customerKey: r.customer_key,
  startsAt: r.starts_at,
  expiresAt: r.expires_at,
  status: r.status,
  planTitle: r.plan_title,
});

export class AccessService {
  constructor(
    private readonly db: Db,
    private readonly api: ApiClient,
    private readonly catalog: CatalogStore,
    private readonly outbox: Outbox,
  ) {}

  /** Upserts subscription cache deltas pulled from the server (revocations included). */
  applyCache(entries: SubscriptionCacheEntry[]) {
    const del = this.db.prepare('DELETE FROM subscription_cache WHERE subscription_id = ? AND token_hash <> ?');
    const up = this.db.prepare(
      `INSERT INTO subscription_cache (token_hash, subscription_id, customer_key, starts_at, expires_at, status, plan_title, member_tail, rev)
       VALUES (@tokenHash, @subscriptionId, @customerKey, @startsAt, @expiresAt, @status, @planTitle, @memberTail, @rev)
       ON CONFLICT(token_hash) DO UPDATE SET subscription_id = excluded.subscription_id, customer_key = excluded.customer_key,
         starts_at = excluded.starts_at, expires_at = excluded.expires_at, status = excluded.status,
         plan_title = excluded.plan_title, member_tail = excluded.member_tail, rev = excluded.rev`,
    );
    const tx = this.db.transaction(() => {
      for (const e of entries) {
        // A re-issued QR replaces the old token hash of the same subscription.
        del.run(e.subscriptionId, e.tokenHash);
        up.run(e);
      }
    });
    tx();
  }

  async validate(rawPayload: string): Promise<ValidateResult> {
    const token = cleanScannedPayload(rawPayload);
    const eventId = randomUUID();
    try {
      const result = await this.api.post<ValidateAccessResponse>('/access/validate', { token: token.slice(0, 256) || '-', eventId });
      return { ok: true, result };
    } catch (e) {
      if (e instanceof ApiResponseError && e.status < 500) {
        return { ok: true, result: invalid(false) };
      }
      if (!(e instanceof NetworkError) && !(e instanceof ApiResponseError)) {
        return { ok: false, code: 'ERROR', message: (e as Error).message };
      }
    }

    const settings = this.catalog.current?.settings;
    if (!settings?.offlineQrValidation) {
      return { ok: false, code: 'OFFLINE_VALIDATION_DISABLED', message: 'ارتباط با سرور برقرار نیست؛ بررسی اعتبار فعلاً امکان‌پذیر نیست' };
    }
    const now = new Date();
    let result: ValidateAccessResponse = invalid(true);
    let tokenHash: string | null = null;
    if (isQrTokenFormat(token)) {
      tokenHash = hashQrToken(token);
      const row = this.db.prepare('SELECT * FROM subscription_cache WHERE token_hash = ?').get(tokenHash) as CacheRow | undefined;
      if (row) {
        const all = this.db.prepare('SELECT * FROM subscription_cache WHERE customer_key = ?').all(row.customer_key) as CacheRow[];
        const ev = evaluateAccess(toCoverage(row), all.map(toCoverage), now);
        result = { ...ev, memberTail: ev.result === AccessResult.ACTIVE ? row.member_tail : null, offline: true };
      } else {
        tokenHash = null;
      }
    }
    this.outbox.enqueue(SyncEventType.ACCESS_LOG, { tokenHash, result: result.result, checkedAt: now.toISOString(), offline: true });
    return { ok: true, result };
  }

  cacheSize(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM subscription_cache').get() as { n: number }).n;
  }
}

function invalid(offline: boolean): ValidateAccessResponse {
  return { result: AccessResult.INVALID, valid: false, expiresAt: null, startsAt: null, planTitle: null, memberTail: null, offline };
}
